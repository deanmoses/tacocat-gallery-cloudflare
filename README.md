# tacocat-gallery-cloudflare

Prototype to find out whether moving pix.tacocat.com to Cloudflare works. The goals and the vendor comparison are in `docs/plans/Hosting.md` and `docs/plans/HostingDeepDive.md` in the `tacocat-gallery-sam` repo. Where it stands is `docs/Risks.md`, and how performance is judged against the AWS site is `docs/Perf.md`.

The repo is three npm workspaces: `api/` is the Worker, `web/` the SvelteKit front end (see Front end below), and `shared/` the album schema and path helpers both import. One Worker holds every spike: one D1 database, two R2 buckets (originals and derived images), an upload Queue with a dead-letter queue, the Images binding, and a Container for video transcoding. It runs in two environments (see Environments below): production on `pix.deanmoses.com` and staging on `staging-pix.deanmoses.com`, custom domains on a Cloudflare zone standing in for tacocat.com, as well as `workers.dev`, so the tacocat.com DNS move is not needed yet.

## Running it

The Worker's scripts live in `api/package.json`: run them from `api/`, or from the root with `--workspace api`, as below. So do Wrangler commands, which find `api/wrangler.jsonc` from the directory they run in. `npm run dev --workspace api` needs an `api/.dev.vars` (gitignored) holding the secrets `api/wrangler.jsonc` lists under `secrets.required`. Tests do not need it.

```bash
fnm use  # or nvm use
npm install
npm run db:migrate:local --workspace api
npm run dev --workspace api
```

Every push deploys itself (see Deploying below): a pull request branch to staging, a merge to `main` to production and staging both. By hand, `scripts/release.sh staging` or `scripts/release.sh production` runs the same release. `npm run deploy --workspace api` and `npm run deploy:production --workspace api` are the plain `wrangler deploy`, which is what ships the transcoder's image and a Durable Object change; add `-- --containers-rollout=none` to leave the container alone. When a deploy does push the container, Wrangler's "Image already exists remotely, skipping push" means the image did not change.

## Deploying

Every push deploys itself through `.github/workflows/deploy.yml`, which runs `scripts/release.sh`, the same script as by hand. A push to a pull request branch releases the branch to staging, so it can be looked at there before it is merged. A merge to `main` releases production and staging at once, so staging is back on what production runs between pull requests. Staging does not go first: branch protection needs the branch up to date with `main`, so the tree being merged is the one its last push already released there, and for the same reason the workflow does not wait for CI. Releases to one Worker run one at a time, in the order pushed. A push that changes only markdown deploys nothing.

Each run is a job against a GitHub Environment, `staging` or `production`, which is what records the history: the repository's Environments panel lists what is on each, every pull request shows when its commits reached them, and the Actions tab has each release's log. `scripts/github-setup.sh` creates the Environments, and production accepts a deploy from `main` only. The workflow can be started by hand from the Actions tab (Run workflow, choosing the environment) to release a commit again, say after a failure that was not the code's. What is live is also one request away: `/api/health` on either hostname answers with the running version and its tag, the commit it was built from.

The workflow's Wrangler authenticates with the repository secret `CLOUDFLARE_API_TOKEN`, the only credential in GitHub: an account API token made in the Cloudflare dashboard (Manage account, Account API tokens, Create Token) from the Edit Cloudflare Workers template with D1 Edit and Containers Edit added, scoped to this account, and stored with `gh secret set CLOUDFLARE_API_TOKEN`. A Dependabot pull request's run reads only Dependabot's secrets, so a second token, stored with `gh secret set CLOUDFLARE_API_TOKEN --app dependabot`, lets a dependency bump reach staging before its merge releases it to production. It runs code from packages no one has reviewed, so it has only what the release uses: Workers Editor at the account scope (Workers Scripts Write before Cloudflare replaced it), D1 Write, Workers Containers Write and Account Settings Read. The account id is in `api/wrangler.jsonc`, so the token is all the workflow needs.

The release is blue/green on Workers' versions and deployments. `scripts/release.sh` builds the web app and uploads a version, which serves no traffic; notes the database's Time Travel bookmark and applies the migrations, which are additive by rule so the version still serving keeps working, and checks that it does; puts the new version in the deployment at 0% and checks it on the live hostname through the `Cloudflare-Workers-Version-Overrides` header (the health route answers with the version id it expects and a migration no older than the tree's newest, the root album's JSON parses, the app shell is the app, and `/_app/version.json` is the build just uploaded); then switches it to 100%, checks again, and rolls back if that fails. A failed check leaves the previous version serving and the run red. If the migrations break the previous version, the release goes on to the new one, which was written for the new schema, but the run ends red and nothing rolls back to the broken version. The script ends by printing the `wrangler rollback` command that undoes the release, which is safe as long as the migrations were additive.

Two things the release does not ship. The transcoder's image: `wrangler versions upload` never publishes one, so a change under `api/transcoder/` goes out by hand with `npm run deploy --workspace api` or `npm run deploy:production --workspace api`, the plain `wrangler deploy`. And a Durable Object class change (the `migrations` array in `api/wrangler.jsonc`), which Cloudflare accepts only through `wrangler deploy`, on its own, and which no rollback can cross.

## Environments

Production, on `pix.deanmoses.com`, and staging, on `staging-pix.deanmoses.com`, are two Workers from the same `api/wrangler.jsonc`, each with its own database, buckets, queues, image host, secrets and admin passkeys. Staging holds test albums, not a copy of production; upload whatever a test needs. Its database is disposable: every push to a pull request branch applies that branch's migrations to it (see Deploying), so a migration amended after a push, or a branch abandoned, leaves it with something production never gets. When that happens, restore it to the bookmark the release printed, or empty it and seed it again. Both are public and both send noindex, as on AWS, so performance and SEO tools can reach either.

Staging is the config's top level and production is `env.production`, so a Wrangler command without `--env` can only reach staging, and the scripts in `api/package.json` come in pairs: `deploy` and `deploy:production`, `db:migrate` and `db:migrate:production`, `logs` and `logs:production`. `wrangler dev` and the tests run the top level too, entirely locally, so their bucket and queue names are staging's. What differs between the environments beyond the bindings is four `vars`: the site's origin, which is the only origin besides local development that may create or use a passkey; the derived-image host; the media bucket's S3 name; and the idle-probe target. The probes run in production only, so staging's cron is the nightly backup alone.

To seed staging, `node api/scripts/import-album.ts /2024/12-17/` copies a day album from the AWS staging gallery into it (see Copying an album from AWS), and `api/scripts/invite.sh <user> --env staging` mints an invite for a passkey there. The production Worker keeps its original name, `tacocat-gallery-cloudflare`, so its custom domain, secrets, container and probe history stayed put when the environments were introduced; staging's is `tacocat-gallery-cloudflare-staging`.

## Database schema

`api/src/db/schema.ts` is the source of truth for the tables, in [Drizzle](https://orm.drizzle.team). To change one, edit the schema, run `npm run db:generate --workspace api` to write the migration into `api/migrations/`, review the SQL, then `npm run db:migrate:local --workspace api`. The release applies it to staging when the branch is pushed and to production when it is merged (see Deploying); `npm run db:migrate --workspace api` and `npm run db:migrate:production --workspace api` apply it by hand. drizzle-kit only writes migrations; Wrangler runs them and records which have been applied.

The FTS5 search table and its triggers are raw SQL (`api/migrations/0002_fts_by_rowid.sql`), because Drizzle does not model virtual tables or triggers, and search queries go through Drizzle's `sql` template. `0001` to `0004` predate Drizzle; the `drizzle_baseline` migration only gives drizzle-kit a snapshot of what they created.

## Backup and restore

The nightly cron dumps the D1 tables, not the FTS table, to R2 as JSON. To restore into a fresh D1, load the rows, then rebuild the search index with `INSERT INTO item_fts(item_fts) VALUES('rebuild')`.

For an in-place undo, Time Travel restores `item` and `item_fts` consistently, but a restore to a timestamp can land minutes early. Before anything risky, note the current bookmark with `npx wrangler d1 time-travel info DB --env production` in `api/`, and restore to that with `npx wrangler d1 time-travel restore DB --env production --bookmark=<bookmark>`.

The originals, and that dump with them, are copied out of Cloudflare every night by the Backup originals workflow, which runs `scripts/backup-originals.sh` with rclone: `current/` on the target mirrors the production media bucket, and whatever a night's sync deleted or replaced waits under `deleted/<date>/` for 35 days. It needs three repository secrets, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` for the bucket and `BACKUP_TARGET`, an rclone connection string for the other provider's bucket with its credentials in it; the workflow's header has the shape. To restore, rclone copy from `current/`, or from the dated tree, back into the bucket.

## Development

`npm run quality` formats, lints, type-checks and tests. The lint step needs `brew install actionlint gitleaks shellcheck shfmt hadolint opentofu`; without them it warns and skips those checks, where CI fails.

## Claude Code on the web

A cloud session starts in a container that has only this repository, an older Node than `.nvmrc` pins and none of the lint's system tools, so `.claude/hooks/session-start.sh` prepares it: Node from `.nvmrc` through nvm, `npm install`, and the lint tools through `scripts/install-lint-tools.sh` plus shellcheck from apt. It runs only when `CLAUDE_CODE_REMOTE` is set, takes about a minute on a cold image, and its `[session-start]` lines in the session banner say how long each step took and which one failed if one did.

What a session can reach is set in the cloud environment (the environment menu in the session's title bar, then Edit), not in the repo:

- A Cloudflare token under the environment's API credentials, a Bearer token for `api.cloudflare.com`, lets a session run `scripts/release.sh staging`, `wrangler d1 info` and `wrangler tail` as a developer would. The proxy adds it to each request, so the session never sees it, but Wrangler will not send a request without a token of its own, so the environment's variables also set `CLOUDFLARE_API_TOKEN=injected-by-proxy`, which the proxy's header replaces. Give the session its own token with the deploy token's scopes (see Deploying), so it can be revoked on its own; the account id is in `api/wrangler.jsonc`. Without it a session still deploys, through the push.
- `DEBUGBEAR_API_KEY`, for `node api/scripts/debugbear.ts`.
- `api/.dev.vars` is not there, so `wrangler dev` does not run; the tests do not need it (see `docs/Testing.md`).
- Pushes and the GitHub tools use the GitHub connection of the account that started the session. `gh` is not installed, so `scripts/github-setup.sh` stays a script for a developer's machine.
- `.mcp.json` holds only `cloudflare-docs`, which needs no login. The Cloudflare account itself is reached through claude.ai's Cloudflare Developer Platform connector, enabled for the session, which logs in once and works in a cloud session as on a developer's machine; a server needing OAuth in `.mcp.json` cannot log in from a cloud session, and one alongside the connector shows every tool twice. Servers a developer keeps outside the repo, such as Context7 with an API key, stay outside it: a project entry of the same name would win over theirs.

## Continuous integration

The repo is `deanmoses/tacocat-gallery-cloudflare` on GitHub. `main` is protected: every change goes through a pull request, and merging needs the `merge-ok` check of `.github/workflows/ci.yml` to pass on a branch up to date with `main`. Behind it, `npm run lint`, `npm run check`, the Worker's tests and the front end's tests run as four parallel jobs, the same scripts as `npm run quality` and the pre-commit hook, over the whole repo; a change to markdown alone runs only `scripts/lint.sh --docs`. Each job starts from `.github/actions/setup`, which installs Node and the packages with the npm and Playwright caches, and the lint job adds `scripts/install-lint-tools.sh`, which gives the runner the system tools the lint needs, each pinned to the version Homebrew has locally and verified against its release checksum; when `brew upgrade` moves one, move it there too. GitHub gives a public repo unlimited Actions minutes, so a parallel job costs nothing but the setup it repeats.

The repository's own settings are applied by `scripts/github-setup.sh` with the GitHub API, so they can be read and re-applied from here: branch protection, the deploy Environments, secret scanning with push protection, Dependabot alerts and security updates, merge options and the labels the `/pr` skill uses. Run it once after creating the repository and again whenever it changes.

Three things keep the supply chain honest. Dependabot (`.github/dependabot.yml`) proposes npm, GitHub Actions, Docker and OpenTofu updates weekly, grouped, after a seven-day cooldown so a version pulled within days of publication never arrives. Every GitHub Action is pinned to a full commit id with its version as a comment; the lint fails on a tag, and Dependabot moves the ids. Secrets are caught three times: gitleaks on the staged files at commit, gitleaks over the whole history in CI, and GitHub's push protection at the remote.

## Front end

`web/` is the SvelteKit app, an npm workspace of its own: `tacocat-gallery-sveltekit` ported, with only what the platform forces changed (the URLs in `src/lib/utils/config.ts`, the session check, the login page). `npm run dev --workspace web` serves it on `localhost:5173` with hot reloading, passing the Worker's own routes through to `npm run dev --workspace api` on 8787, and `npm run build --workspace web` writes a static single-page app to `web/build`. The Worker serves that build as static assets, so `npm run dev --workspace api` rebuilds it and serves the app and the Worker's routes together on `localhost:8787`, and `npm run deploy --workspace api` rebuilds it before deploying; a bare `wrangler deploy` or `wrangler versions upload` ships whatever `web/build` holds. Those two scripts build `web/` with `--prefix ../web` after clearing `npm_config_workspace`, because npm passes a `--workspace api` flag down to nested npm commands as that variable, where it overrides a `--workspace web` flag. `run_worker_first` in `api/wrangler.jsonc` lists the Worker's routes, and a new one has to be added there.

`api/` runs Vitest 4 and `web/` Vitest 5, each from its own directory, because `@cloudflare/vitest-plugin` needs Vitest 4.1 (Vitest 5 support is in workers-sdk PR #15500). npm hoists `api/`'s Vitest 4 to the root, so a `web/` test dependency whose peer range also accepts Vitest 4 can end up resolving it; `npm ls vitest` shows which each package gets.

## Admin login

`api/scripts/invite.sh <user> --env staging` (or `--env production`) prints a one-time invite link for that environment's Worker; `--local` is for `npm run dev --workspace api`. The name has to be in the `user` table, which no screen edits: a migration seeds it (`api/migrations/*_seed_users.sql`), so adding a user is another migration, and every environment gets the same users. To check the whole flow without a browser, run `node api/scripts/passkey-selftest.ts "$(api/scripts/invite.sh moses --local)"` against `npm run dev --workspace api`. Deploying needs a `SESSION_SECRET` Worker secret; locally it comes from `api/.dev.vars`.

## Copying an album from AWS

`node api/scripts/import-album.ts /2024/12-17/` copies one day album from the AWS staging gallery into this project's staging site, or into production with `--to production`, and from the AWS production gallery with `--from prod`. The originals go through the upload pipeline as a browser's would, presigned by the Worker as the admin `--user` names (`moses` unless told otherwise) with a session signed from the `SESSION_SECRET` in `api/.dev.vars`, so the Worker records them and makes their derived images; the album's and photos' titles, descriptions, tags, crops and thumbnail then go into D1 with the account token, since the Worker has no write endpoints for them yet. Videos are left behind while the transcoder is parked on `lite`.

## Finding an item's objects

The buckets are keyed by version id, not gallery path, so the dashboard cannot browse them by album. `node api/scripts/media.ts /2024/12-17/felix.jpg` prints the item's row from the deployed database and every object stored for its version in each bucket, `--env production` for production. Each original also carries the path it was uploaded to as custom metadata, so a stray object can say where it came from.

## Idle latency probes

The probe cron runs on Cloudflare, not locally. To read the results, run `npm run probes --workspace api`. To try the probe code without waiting for the schedule, run `npx wrangler dev --test-scheduled --enable-containers=false` in `api/` and request `/__scheduled?cron=23+0,1,3,7,15+*+*+*`. That runs the handler locally against the deployed Worker and writes to the local D1.

Requests to Globalping carry the `GLOBALPING_TOKEN` Worker secret (in `api/.dev.vars` locally), which raises Globalping's rate limit from a per-IP one shared with every Worker on the same egress IP.

## Browser runs

The production Worker's cron starts the album journey in DebugBear four times a day, with the `DEBUGBEAR_API_KEY` Worker secret. `.github/workflows/perf.yml` starts a run by hand from the Actions tab; to start one from here, run `node api/scripts/debugbear.ts run`; to read the results, `node api/scripts/debugbear.ts report --from <YYYY-MM-DD>`. Both need the same key as `DEBUGBEAR_API_KEY`, in `api/.dev.vars` locally and as a repository secret for the workflow. The pages, device and journey script are described in `docs/Perf.md`.

## Infrastructure

`infra/` holds the OpenTofu config for everything outside the Worker: the zone and its settings once, and each environment's database, buckets, queues and image host through the `environment` module, one instance per entry in `local.environments`. Its `d1_database_ids` output is what `api/wrangler.jsonc` binds. It uses an account API token named `CLOUDFLARE_TERRAFORM_API_TOKEN` in `api/.dev.vars`, kept out of `CLOUDFLARE_API_TOKEN` because Wrangler would pick that up over the `tacocat` profile. State is local and gitignored.

```bash
cd infra
CLOUDFLARE_API_TOKEN=$(grep '^CLOUDFLARE_TERRAFORM_API_TOKEN=' ../api/.dev.vars | cut -d= -f2-) tofu plan
```

On a new account, R2 has to be enabled once in the dashboard before `tofu apply` can create a bucket.

`infra/tacocat.tf` also declares the `tacocat.com` zone with every record DreamHost serves today, ahead of moving the nameservers; until GoDaddy points at the nameservers `tofu output tacocat_name_servers` prints, nothing in it is live, and Cloudflare deletes a zone left pending 28 days, so apply again before the switch. Before switching, run the Zone diff workflow from the Actions tab with those nameservers: `scripts/zone-diff.sh` compares every record on both and must see authoritative answers, which a home network that intercepts DNS never gives it.

The S3 credentials for presigned uploads come from an account API token: the access key is the token's id, and the secret is the SHA-256 of the token.

Adding `routes` to `api/wrangler.jsonc` switches off `workers.dev` unless `workers_dev` is set.

A wrangler auth profile bound to the repo's directory keeps Wrangler commands here, `api/` included, from reaching any other account:

```bash
npx wrangler auth create tacocat        # choose only the Tacocat account
npx wrangler auth activate tacocat .
```
