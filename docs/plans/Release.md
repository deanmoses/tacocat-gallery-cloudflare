# The production release

How production gets a new version: built and uploaded without traffic, the database migrated under the old version, the new version health-checked on its own URL, then traffic switched, with one command to undo. This is the blue/green shape the site's owner is used to from Railway, on Cloudflare's versions and deployments. It is designed, not built; this document is the hand-off to the session that builds it, and it records what was verified so that session does not re-derive it.

## Where things stand

- **Two environments exist** from one `api/wrangler.jsonc`: staging is the config's top level, production is `env.production`. Each has its own D1, buckets, queues, image host, secrets and passkeys. README's Environments section is the reference.
- **Staging deploys on every merge to `main`** through Workers Builds, Cloudflare's GitHub App, with `npm run db:migrate && npm run deploy` as the deploy command. README's Deploying section records every setting of that connection and why. Preview builds are off and must stay off. This is a plain `wrangler deploy`, not yet the blue/green sequence: the new version takes traffic as it uploads and nothing checks it first. Staging is meant to rehearse the production release, so once the release script exists staging runs it on every merge, and a merge that fails the health check leaves staging serving the previous version, exactly as production would.
- **Production deploys by hand** with `npm run deploy:production --workspace api -- --containers-rollout=none`, which is `wrangler deploy`: the new version takes traffic the moment it uploads, migrations run separately, and nothing checks the version before it serves.
- **`main` is protected** and CI's `merge-ok` gates every merge, so a commit on `main` has passed lint, type check and every test.

## What Cloudflare gives us, verified against its docs

- A `wrangler versions upload` creates a version that serves no traffic. `wrangler versions deploy <id>@100% -y` makes it live everywhere within seconds. `wrangler rollback <id>` reverts to any of the last 100 versions. A deployment can hold at most two versions.
- **A Version URL** is a `workers.dev` hostname for an uploaded version, `<version-prefix>-<worker-name>.<subdomain>.workers.dev`, running the new code against the environment's real bindings. It is the natural place for the health check. It exists only on `workers.dev` (the passkey login and its cookie do not work there, and a health check needs neither) and only when `preview_urls` is on, which follows `workers_dev` unless set explicitly.
- **A Worker that defines a Durable Object gets no Version URL.** The Transcoder container is a Durable Object, so the main Worker gets none today. This is the finding behind the first pull request below. The alternative is the version-override header, `Cloudflare-Workers-Version-Overrides: <worker>="<id>"`, against the live hostname with the new version deployed at 0%; it works, but the Durable Object itself stays on the old version during the check.
- **Durable Object lifecycle changes** (a class created, deleted, renamed or transferred, in the `migrations` array) can only ship through `wrangler deploy`, never `versions upload`, and no rollback can cross one. Ship them alone.
- **`versions upload` never publishes a container image**; only `wrangler deploy` does. A container app's default name is `<worker name>-<class name>-<environment>`, which is why production's container entry names the existing app explicitly.
- **Percentage splits are wrong for this app.** A split would mix a new `index.html` with hashed chunks from the other version and 404. Go from 0% to 100%.
- **Secrets** can ride along with a deploy through `--secrets-file <file>`, which is how a new Worker gets past the `secrets.required` check on its first deploy. The file never enters the repo.
- **The Workers Builds API** reads triggers and build logs with the connector in a Claude session, but writes need a user-scoped API token with the Builds permission, which nothing on the owner's machine has. Changing a connection's settings is a dashboard step for the owner, one field at a time, and the owner is not an engineer: give the field and the value, once.

## Pull request 1: the transcoder in its own Worker

Move the `Transcoder` class and its container out of the main Worker into a small one, so the main Worker has no Durable Object and its releases can use Version URLs. It also frees every main-Worker deploy from needing Docker, and makes a container change its own rare deploy.

- A new workspace, `transcoder/`, with its own `wrangler.jsonc`: the class, the container entry, the Durable Object migration, staging at the top level and `env.production`, no routes and `workers_dev: false`. Worker names of its own, such as `tacocat-transcoder-staging` and `tacocat-transcoder`. Production's container entry keeps `name: tacocat-gallery-cloudflare-transcoder`, the app that exists, only if that app can be transferred; otherwise a fresh app and the old one deleted with `wrangler containers delete`.
- The main Worker binds it with `durable_objects.bindings[].script_name` naming the transcoder Worker of the same environment; `env.TRANSCODER.getByName('transcoder')` in `api/src/video.ts` does not change. The `containers` entry leaves `api/wrangler.jsonc`, and a `deleted_classes: ["Transcoder"]` migration with a new tag removes the class, which is a lifecycle change: its deploy is `wrangler deploy`, on its own, after the transcoder Worker is up in that environment. Deploy staging first, then production.
- Tests: `api/test/unit/video.test.ts` fakes `TRANSCODER` and is unaffected; the stack tests run with containers off. The transcoder workspace needs a test of its own only if it gains logic; today it is the class from `@cloudflare/containers` and a Dockerfile.
- Set `preview_urls: true` in `api/wrangler.jsonc` explicitly, so Version URLs do not depend on the `workers_dev` default.
- Staging's Workers Builds connection is unchanged; the transcoder Worker deploys by hand for now (`wrangler deploy` in `transcoder/`), since it changes rarely.

## Pull request 2: the release script

`scripts/release.sh <environment>`, run from the repo root, the same script for staging and production. Staging gets it first, as its Workers Builds deploy command, so every merge to `main` rehearses the exact sequence production will run, health-check gate included, and a bug in the script shows up on staging rather than on the release that matters. Only after it has carried a few staging merges does production get connected to it.

1. Build the web app and upload: `wrangler versions upload --env production --tag <git sha>`. Capture the version id from the output.
2. Record the D1 Time Travel bookmark (`wrangler d1 time-travel info DB --env production`), then `wrangler d1 migrations apply DB --env production --remote`. Migrations are additive by rule, so the old version keeps working on the new schema. Wrangler applies each file as one D1 batch, so a file that fails midway rolls back but earlier files stay applied; confirm this when the script is first tested.
3. Health check the Version URL, waiting briefly for it to exist: the app shell at `/` is 200 with the app's `index.html`; a known album's JSON is 200 and parses; `/api/health` is 200. The version id in the health response must equal the uploaded id, which proves the check hit the new code. Fail the script on any miss, leaving the version uploaded and traffic untouched.
4. `wrangler versions deploy <id>@100% -y --message <git sha>`.
5. Check the live hostname once more, then print the previous version id as the rollback command: `wrangler rollback <previous id> --env production`. Rollback is only safe while the migration was additive, which the lint enforces.

`/api/health`, new in the Worker: `SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1`, an R2 `head` or `list` with limit 1 on each bucket, and the version id from the `version_metadata` binding. Add the binding to both environments and run `npm run types --workspace api`. The route is under `/api/*`, already in `run_worker_first`. Test it in `api/test/integration/`.

Switching staging to the script is one dashboard field: the staging connection's deploy command becomes `../scripts/release.sh staging` (the root directory is `api`, hence the `../`). Then connect production to the repo the way staging is: the same dialog on the production Worker, production branch `production`, root directory `api`, build command and variables as in the README's table, deploy command `../scripts/release.sh production`, preview builds off. Promoting is a fast-forward: `git push origin main:production`. Protect `production` in `scripts/github-setup.sh` against force-push and deletion, without required checks, since `main` already had them.

## Also worth doing, independent of the above

- **noindex on the Worker.** The app carries the meta tag; the AWS site also sends an `X-Robots-Tag` header and serves a `robots.txt` that allows crawling so the noindex is seen. The Worker serves neither yet. Both environments, one change, a test each.
- **Docs-only merges redeploy staging.** Excluding `docs/**` and `**/*.md` in the connection's build watch paths would stop that. One dashboard field; not worth the owner's time unless it becomes annoying.

## For the session that builds this

- Read `CLAUDE.md`, then README's Environments, Deploying and Continuous integration sections, then this document.
- Work in a worktree of your own if another session shares the checkout; two sessions committing on one branch tangled a pull request once.
- Every merge to `main` deploys staging, which is the intended first test of everything here. Production is touched only by the owner's decision to promote.
- The owner is not an engineer. When something needs the dashboard, name the one field and the one value, and say what will happen when it is saved.
