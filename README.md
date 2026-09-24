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

Staging deploys itself on every merge to `main` (see Deploying below). To deploy by hand, `npm run deploy --workspace api -- --containers-rollout=none` deploys staging and leaves the transcoder container untouched, and `npm run deploy:production --workspace api -- --containers-rollout=none` does the same for production. When a deploy does push the container, Wrangler's "Image already exists remotely, skipping push" means the image did not change.

## Deploying

A merge to `main` deploys staging through Workers Builds, Cloudflare's GitHub App: Cloudflare's build machines check out the commit, install the repo, apply staging's migrations and run the same deploy script as by hand. No API token is stored in GitHub; the build uses a token Cloudflare creates and holds. The build's log and status are in the dashboard under the staging Worker, Settings, Builds, and Cloudflare posts a check run on the commit in GitHub.

Workers Builds does not wait for GitHub's checks. It is safe because branch protection lets nothing onto `main` that did not pass them on its pull request. The connection is the one setting that lives in the dashboard rather than in this repo, since the GitHub App has to be authorized as a person, so here is what it is set to, for re-creating it:

| Setting                                  | Value                                  | Why                                                                                                                                                                                                                                                          |
| ---------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Production branch                        | `main`                                 |                                                                                                                                                                                                                                                              |
| Root directory                           | `api`                                  | Cloudflare checks that the Wrangler config in the root directory names the Worker being deployed.                                                                                                                                                            |
| Build command                            | `cd .. && npm ci --ignore-scripts`     | The workspaces install from the repo root. `--ignore-scripts` skips the hook install and the Playwright browser download, which the build does not need.                                                                                                     |
| Deploy command                           | `npm run db:migrate && npm run deploy` | Migrations first, while the old version still serves, then the web app's build and the deploy.                                                                                                                                                               |
| Build variable `SKIP_DEPENDENCY_INSTALL` | `1`                                    | The root directory has no lockfile, so the automatic install would fail.                                                                                                                                                                                     |
| Build variable `HUSKY`                   | `0`                                    |                                                                                                                                                                                                                                                              |
| Build variable `NODE_VERSION`            | `24`                                   | The `.nvmrc` is at the repo root, out of the root directory's view.                                                                                                                                                                                          |
| Preview builds                           | off                                    | On by default, and then every pull request branch gets built and deployed as a throwaway copy of the Worker, container included, with settings of its own that this repo does not provide. Pull requests are checked by CI and looked at on staging instead. |
| Build watch paths                        | the defaults                           | Excluding `docs/**` and `**/*.md` would spare a redeploy on a docs-only merge, at the cost of another dashboard setting.                                                                                                                                     |

Production is not connected. It deploys by hand until the release script exists, with `npm run deploy:production --workspace api`.

## Environments

Production, on `pix.deanmoses.com`, and staging, on `staging-pix.deanmoses.com`, are two Workers from the same `api/wrangler.jsonc`, each with its own database, buckets, queues, image host, secrets and admin passkeys. Staging holds test albums, not a copy of production; upload whatever a test needs. Both are public and both send noindex, as on AWS, so performance and SEO tools can reach either.

Staging is the config's top level and production is `env.production`, so a Wrangler command without `--env` can only reach staging, and the scripts in `api/package.json` come in pairs: `deploy` and `deploy:production`, `db:migrate` and `db:migrate:production`, `logs` and `logs:production`. `wrangler dev` and the tests run the top level too, entirely locally, so their bucket and queue names are staging's. What differs between the environments beyond the bindings is four `vars`: the site's origin, which is the only origin besides local development that may create or use a passkey; the derived-image host; the media bucket's S3 name; and the idle-probe target. The probes run in production only, so staging's cron is the nightly backup alone.

To seed staging, `node api/scripts/import-album.ts /2024/12-17/` copies a day album from the AWS staging gallery into it (see Copying an album from AWS), and `api/scripts/invite.sh "<name>" --env staging` mints an invite for a passkey there. The production Worker keeps its original name, `tacocat-gallery-cloudflare`, so its custom domain, secrets, container and probe history stayed put when the environments were introduced; staging's is `tacocat-gallery-cloudflare-staging`.

## Database schema

`api/src/db/schema.ts` is the source of truth for the tables, in [Drizzle](https://orm.drizzle.team). To change one, edit the schema, run `npm run db:generate --workspace api` to write the migration into `api/migrations/`, review the SQL, then `npm run db:migrate:local --workspace api` and, once it works, `npm run db:migrate --workspace api` for staging and `npm run db:migrate:production --workspace api` for production. drizzle-kit only writes migrations; Wrangler runs them and records which have been applied.

The FTS5 search table and its triggers are raw SQL (`api/migrations/0002_fts_by_rowid.sql`), because Drizzle does not model virtual tables or triggers, and search queries go through Drizzle's `sql` template. `0001` to `0004` predate Drizzle; the `drizzle_baseline` migration only gives drizzle-kit a snapshot of what they created.

## Backup and restore

The nightly cron dumps the D1 tables, not the FTS table, to R2 as JSON. To restore into a fresh D1, load the rows, then rebuild the search index with `INSERT INTO item_fts(item_fts) VALUES('rebuild')`.

For an in-place undo, Time Travel restores `item` and `item_fts` consistently, but a restore to a timestamp can land minutes early. Before anything risky, note the current bookmark with `npx wrangler d1 time-travel info DB --env production` in `api/`, and restore to that with `npx wrangler d1 time-travel restore DB --env production --bookmark=<bookmark>`.

## Development

`npm run quality` formats, lints, type-checks and tests. The lint step needs `brew install actionlint gitleaks shellcheck shfmt hadolint opentofu`; without them it warns and skips those checks, where CI fails.

## Continuous integration

The repo is `deanmoses/tacocat-gallery-cloudflare` on GitHub. `main` is protected: every change goes through a pull request, and merging needs the `merge-ok` check of `.github/workflows/ci.yml` to pass on a branch up to date with `main`. Behind it, `npm run lint`, `npm run check`, the Worker's tests and the front end's tests run as four parallel jobs, the same scripts as `npm run quality` and the pre-commit hook, over the whole repo; a change to markdown alone runs only `scripts/lint.sh --docs`. Each job starts from `.github/actions/setup`, which installs Node and the packages with the npm and Playwright caches, and the lint job adds `scripts/install-lint-tools.sh`, which gives the runner the system tools the lint needs, each pinned to the version Homebrew has locally and verified against its release checksum; when `brew upgrade` moves one, move it there too. GitHub gives a public repo unlimited Actions minutes, so a parallel job costs nothing but the setup it repeats.

The repository's own settings are applied by `scripts/github-setup.sh` with the GitHub API, so they can be read and re-applied from here: branch protection, secret scanning with push protection, Dependabot alerts and security updates, merge options and the labels the `/pr` skill uses. Run it once after creating the repository and again whenever it changes.

Three things keep the supply chain honest. Dependabot (`.github/dependabot.yml`) proposes npm, GitHub Actions, Docker and OpenTofu updates weekly, grouped, after a seven-day cooldown so a version pulled within days of publication never arrives. Every GitHub Action is pinned to a full commit id with its version as a comment; the lint fails on a tag, and Dependabot moves the ids. Secrets are caught three times: gitleaks on the staged files at commit, gitleaks over the whole history in CI, and GitHub's push protection at the remote.

## Front end

`web/` is the SvelteKit app, an npm workspace of its own: `tacocat-gallery-sveltekit` ported, with only what the platform forces changed (the URLs in `src/lib/utils/config.ts`, the session check, the login page). `npm run dev --workspace web` serves it on `localhost:5173` with hot reloading, passing the Worker's own routes through to `npm run dev --workspace api` on 8787, and `npm run build --workspace web` writes a static single-page app to `web/build`. The Worker serves that build as static assets, so `npm run dev --workspace api` rebuilds it and serves the app and the Worker's routes together on `localhost:8787`, and `npm run deploy --workspace api` rebuilds it before deploying; a bare `wrangler deploy` or `wrangler versions upload` ships whatever `web/build` holds. Those two scripts build `web/` with `--prefix ../web` after clearing `npm_config_workspace`, because npm passes a `--workspace api` flag down to nested npm commands as that variable, where it overrides a `--workspace web` flag. `run_worker_first` in `api/wrangler.jsonc` lists the Worker's routes, and a new one has to be added there.

`api/` runs Vitest 4 and `web/` Vitest 5, each from its own directory, because `@cloudflare/vitest-plugin` needs Vitest 4.1 (Vitest 5 support is in workers-sdk PR #15500). npm hoists `api/`'s Vitest 4 to the root, so a `web/` test dependency whose peer range also accepts Vitest 4 can end up resolving it; `npm ls vitest` shows which each package gets.

## Admin login

`api/scripts/invite.sh "<name>" --env staging` (or `--env production`) prints a one-time invite link for that environment's Worker; `--local` is for `npm run dev --workspace api`. To check the whole flow without a browser, run `node api/scripts/passkey-selftest.ts "$(api/scripts/invite.sh Selftest --local)"` against `npm run dev --workspace api`. Deploying needs a `SESSION_SECRET` Worker secret; locally it comes from `api/.dev.vars`.

## Copying an album from AWS

`node api/scripts/import-album.ts /2024/12-17/` copies one day album from the AWS staging gallery into this project's staging site, or into production with `--to production`, and from the AWS production gallery with `--from prod`. The originals go through the upload pipeline, so the Worker records them and makes their derived images; the album's and photos' titles, descriptions, tags, crops and thumbnail then go into D1 with the account token, since the Worker has no write endpoints for them yet. Videos are left behind while the transcoder is parked on `lite`.

## Idle latency probes

The probe cron runs on Cloudflare, not locally. To read the results, run `npm run probes --workspace api`. To try the probe code without waiting for the schedule, run `npx wrangler dev --test-scheduled --enable-containers=false` in `api/` and request `/__scheduled?cron=23+0,1,3,7,15+*+*+*`. That runs the handler locally against the deployed Worker and writes to the local D1.

Requests to Globalping carry the `GLOBALPING_TOKEN` Worker secret (in `api/.dev.vars` locally), which raises Globalping's rate limit from a per-IP one shared with every Worker on the same egress IP.

## Browser runs

`.github/workflows/perf.yml` runs the album journey in DebugBear four times a day, and can be started by hand from the Actions tab. To start one from here, run `node api/scripts/debugbear.ts run`; to read the results, `node api/scripts/debugbear.ts report --from <YYYY-MM-DD>`. Both need a DebugBear API key as `DEBUGBEAR_API_KEY`, in `api/.dev.vars` locally and as a repository secret for the workflow. The pages, device and journey script are described in `docs/Perf.md`.

## Infrastructure

`infra/` holds the OpenTofu config for everything outside the Worker: the zone and its settings once, and each environment's database, buckets, queues and image host through the `environment` module, one instance per entry in `local.environments`. Its `d1_database_ids` output is what `api/wrangler.jsonc` binds. It uses an account API token named `CLOUDFLARE_TERRAFORM_API_TOKEN` in `api/.dev.vars`, kept out of `CLOUDFLARE_API_TOKEN` because Wrangler would pick that up over the `tacocat` profile. State is local and gitignored.

```bash
cd infra
CLOUDFLARE_API_TOKEN=$(grep '^CLOUDFLARE_TERRAFORM_API_TOKEN=' ../api/.dev.vars | cut -d= -f2-) tofu plan
```

On a new account, R2 has to be enabled once in the dashboard before `tofu apply` can create a bucket.

The S3 credentials for presigned uploads come from an account API token: the access key is the token's id, and the secret is the SHA-256 of the token.

Adding `routes` to `api/wrangler.jsonc` switches off `workers.dev` unless `workers_dev` is set.

The planned release, not built yet: tests, `wrangler versions upload`, apply migrations, smoke-test the preview URL, `wrangler versions deploy`, and `wrangler rollback` to undo.

A wrangler auth profile bound to the repo's directory keeps Wrangler commands here, `api/` included, from reaching any other account:

```bash
npx wrangler auth create tacocat        # choose only the Tacocat account
npx wrangler auth activate tacocat .
```
