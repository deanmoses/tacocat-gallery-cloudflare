# tacocat-gallery-cloudflare

Prototype to find out whether moving pix.tacocat.com to Cloudflare works. The goals and the vendor comparison are in `docs/plans/Hosting.md` and `docs/plans/HostingDeepDive.md` in the `tacocat-gallery-sam` repo. Where it stands is `docs/Risks.md`, and how performance is judged against the AWS site is `docs/Perf.md`.

The repo is three npm workspaces: `api/` is the Worker, `web/` the SvelteKit front end (see Front end below), and `shared/` the album schema and path helpers both import. One Worker holds every spike: one D1 database, two R2 buckets (originals and derived images), an upload Queue with a dead-letter queue, the Images binding, and a Container for video transcoding. It serves `pix.deanmoses.com`, a custom domain on a Cloudflare zone standing in for tacocat.com, as well as `workers.dev`, so the tacocat.com DNS move is not needed yet.

## Running it

The Worker's scripts live in `api/package.json`: run them from `api/`, or from the root with `--workspace api`, as below. So do Wrangler commands, which find `api/wrangler.jsonc` from the directory they run in. `npm run dev --workspace api` needs an `api/.dev.vars` (gitignored) holding the secrets `api/wrangler.jsonc` lists under `secrets.required`. Tests do not need it.

```bash
fnm use  # or nvm use
npm install
npm run db:migrate:local --workspace api
npm run dev --workspace api
```

Deploy with `npm run deploy --workspace api -- --containers-rollout=none`, which leaves the transcoder container untouched. When a deploy does push the container, Wrangler's "Image already exists remotely, skipping push" means the image did not change.

## Database schema

`api/src/db/schema.ts` is the source of truth for the tables, in [Drizzle](https://orm.drizzle.team). To change one, edit the schema, run `npm run db:generate --workspace api` to write the migration into `api/migrations/`, review the SQL, then `npm run db:migrate:local --workspace api` and, once it works, `npm run db:migrate --workspace api`. drizzle-kit only writes migrations; Wrangler runs them and records which have been applied.

The FTS5 search table and its triggers are raw SQL (`api/migrations/0002_fts_by_rowid.sql`), because Drizzle does not model virtual tables or triggers, and search queries go through Drizzle's `sql` template. `0001` to `0004` predate Drizzle; the `drizzle_baseline` migration only gives drizzle-kit a snapshot of what they created.

## Backup and restore

The nightly cron dumps the D1 tables, not the FTS table, to R2 as JSON. To restore into a fresh D1, load the rows, then rebuild the search index with `INSERT INTO item_fts(item_fts) VALUES('rebuild')`.

For an in-place undo, Time Travel restores `item` and `item_fts` consistently, but a restore to a timestamp can land minutes early. Before anything risky, note the current bookmark with `npx wrangler d1 time-travel info tacocat-proto` in `api/`, and restore to that with `npx wrangler d1 time-travel restore tacocat-proto --bookmark=<bookmark>`.

## Development

`npm run quality` formats, lints, type-checks and tests.

## Front end

`web/` is the SvelteKit app, an npm workspace of its own: `tacocat-gallery-sveltekit` ported, with only what the platform forces changed (the URLs in `src/lib/utils/config.ts`, the session check, the login page). `npm run dev --workspace web` serves it on `localhost:5173` with hot reloading, passing the Worker's own routes through to `npm run dev --workspace api` on 8787, and `npm run build --workspace web` writes a static single-page app to `web/build`. The Worker serves that build as static assets, so `npm run dev --workspace api` rebuilds it and serves the app and the Worker's routes together on `localhost:8787`, and `npm run deploy --workspace api` rebuilds it before deploying; a bare `wrangler deploy` or `wrangler versions upload` ships whatever `web/build` holds. Those two scripts build `web/` with `--prefix ../web` after clearing `npm_config_workspace`, because npm passes a `--workspace api` flag down to nested npm commands as that variable, where it overrides a `--workspace web` flag. `run_worker_first` in `api/wrangler.jsonc` lists the Worker's routes, and a new one has to be added there.

`api/` runs Vitest 4 and `web/` Vitest 5, each from its own directory, because `@cloudflare/vitest-plugin` needs Vitest 4.1 (Vitest 5 support is in workers-sdk PR #15500). npm hoists `api/`'s Vitest 4 to the root, so a `web/` test dependency whose peer range also accepts Vitest 4 can end up resolving it; `npm ls vitest` shows which each package gets.

## Admin login

`api/scripts/invite.sh "<name>"` prints a one-time invite link for the deployed Worker; add `--local` for `npm run dev --workspace api`. To check the whole flow without a browser, run `node api/scripts/passkey-selftest.ts "$(api/scripts/invite.sh Selftest --local)"` against `npm run dev --workspace api`. Deploying needs a `SESSION_SECRET` Worker secret; locally it comes from `api/.dev.vars`.

## Copying an album from AWS

`node api/scripts/import-album.ts /2024/12-17/` copies one day album from the AWS staging gallery into the deployed site, or from production with `--from prod`. The originals go through the upload pipeline, so the Worker records them and makes their derived images; the album's and photos' titles, descriptions, tags, crops and thumbnail then go into D1 with the account token, since the Worker has no write endpoints for them yet. Videos are left behind while the transcoder is parked on `lite`.

## Idle latency probes

The probe cron runs on Cloudflare, not locally. To read the results, run `npm run probes --workspace api`. To try the probe code without waiting for the schedule, run `npx wrangler dev --test-scheduled --enable-containers=false` in `api/` and request `/__scheduled?cron=23+0,1,3,7,15+*+*+*`. That runs the handler locally against the deployed Worker and writes to the local D1.

Requests to Globalping carry the `GLOBALPING_TOKEN` Worker secret (in `api/.dev.vars` locally), which raises Globalping's rate limit from a per-IP one shared with every Worker on the same egress IP.

## Infrastructure

`infra/` holds the OpenTofu config for everything outside the Worker. It uses an account API token named `CLOUDFLARE_TERRAFORM_API_TOKEN` in `api/.dev.vars`, kept out of `CLOUDFLARE_API_TOKEN` because Wrangler would pick that up over the `tacocat` profile. State is local and gitignored.

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
