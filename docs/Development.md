# Development

How code is written here. `docs/Architecture.md` is the system as built, and its Invariants section lists the rules a change breaks without noticing; read that before changing the Worker. `docs/Testing.md` has where a test goes and how one is written, and `CONTRIBUTING.md` how a change gets in.

## The repo

Three npm workspaces, and the tooling around them:

- `api/`: the Worker, with its tests, migrations, scripts and the transcoder's image.
- `web/`: the SvelteKit app, built to static files the Worker serves.
- `shared/`: what both import, the record schemas, the path grammar and the URL builders.
- `infra/`: OpenTofu for everything outside the Worker.
- `e2e/`: Playwright journeys through the built app and a local Worker.
- `scripts/`: the lint, test, release and repository-setup scripts.

The Worker's scripts live in `api/package.json`: run them from `api/`, or from the root with `--workspace api`. So do Wrangler commands, which find `api/wrangler.jsonc` from the directory they run in. `api/` and `web/` run different Vitest majors ([The web app](#the-web-app)), so each workspace's tests run from its own directory or with its `--workspace` flag.

**Checking your work.** `npm test` runs every workspace's tests and then the end-to-end tests, and `scripts/test.sh` takes suite names to run some of them; `npm run quality` formats, lints, type-checks and tests the whole repo, the same scripts CI runs. The pre-commit hook lints the staged files and runs every suite they touch, about 40 seconds, so commit once, when the change is green ([CONTRIBUTING.md](../CONTRIBUTING.md)).

## Local development

`npm run dev --workspace api` applies any migrations the local database lacks (with `CI=true`, since Wrangler otherwise stops to ask, even for a local database), builds the web app and serves it with the Worker's routes on `localhost:8787`. `npm run dev --workspace web` serves the app on `localhost:5173` with hot reloading, passing the Worker's own routes through to 8787. Both run against `api/.dev.vars`, which Getting started in `README.md` sets up.

What local development gets wrong, all of it the local Images binding or the platform and none of it the Worker:

- **Images.** Deployed, Image Transformations make the images; they run only on Cloudflare's edge, so `npm run dev --workspace api` sets `IMAGE_MODE=binding` and the local Images binding makes them instead. The local binding is Sharp, whose libvips cannot decode HEIC, so a HEIC upload ends as an upload error where the real service decodes it. EXIF orientation is not applied, so a phone photo shows turned and its thumbnail crop off-centre. The encoding options are ignored, so a thumbnail weighs the same at any quality and an animated GIF's thumbnail and media page image are still frames whether or not asked. What a thumbnail weighs, whether a GIF moves and whether a phone photo shows upright are judged on staging.
- **Uploads.** A local Worker cannot consume a real queue, so `UPLOAD_MODE=local` in `api/.dev.vars` makes presign hand the browser a URL of the Worker's own; `PUT /upload/<versionId>` stores the file as the original and raises the event R2 would, and the pipeline runs unchanged. Without it, the browser's PUT goes to the account's staging bucket, which refuses it, since the bucket accepts uploads only from the site's own origin.
- **Video** needs the ffmpeg container, which `npm run dev --workspace api` leaves off so it starts without Docker. `npm run dev:video --workspace api` builds and runs it with Docker up.
- **The nightly job**, which drops old upload errors and spent challenges, never runs unless its cron is fired by hand.

`api/.dev.vars`, gitignored, holds what a developer's machine needs and nothing else reads: the Worker's three secrets and `UPLOAD_MODE=local` for `wrangler dev` (Getting started in `README.md`), `CLOUDFLARE_TERRAFORM_API_TOKEN` for `scripts/tofu.sh` and so for `scripts/secrets.sh`, `SESSION_SECRET_STAGING` and `SESSION_SECRET_PRODUCTION` for `scripts/secrets.sh staging` and `production`, and `DEBUGBEAR_API_KEY` for the browser runs. Never print, commit or paste any of it.

## The code

`shared/` holds every record, request and response schema, the path grammar and the URL builders, and neither the Worker nor the app imports the other. The Worker's layers under `api/src/` are enforced by import rules and a cycle check in `eslint.config.ts`; The code in `docs/Architecture.md` names them. Which paths reach the Worker rather than the app's files is the `run_worker_first` list in `api/wrangler.jsonc`, so a new Worker route has to be added there. After editing `api/wrangler.jsonc`, run `npm run types --workspace api`.

Things a fresh session would otherwise find out the hard way:

- **The write pattern is built; reuse it.** A gallery write is one statement whose cross-row rules are `EXISTS` subqueries in its `WHERE`, returning `Written`, the changes and D1's meta, from `api/src/gallery/writes.ts`. When it changed nothing, one read of subselects, `describeAlbum` or `describeMedia`, says why, and the route turns that into the 400 or 404 with its message. Routes read bodies with `parsedBody` and answer with `wrote` from `api/src/routes/requests.ts`, 204 with the bookmark cookie, which is all the app checks.
- Hono dispatches a `HEAD` as a `GET` before any route matches, so a handler that answers a `HEAD` differently reads the raw method, as the album and media handlers do.
- A Drizzle query builder is changed by what is called on it, so a builder reused for several subqueries silently gives them all the last `where`. Start each from `database.select()`.
- Drizzle's `run()` returns rows under their SQL column names, not the builder's aliases, so name a computed column in SQL with `.as()`; its `batch()` returns rows without D1's meta, so a write whose cost is watched runs its statements one at a time.
- A statement in a `batch()` has to come from a query builder: Drizzle's D1 driver cannot batch a raw `sql` statement, and its insert from a select takes every column of the table, in the table's order, each aliased to its column name. `insertItem` in `api/src/gallery/upload.ts` is the example.
- D1's `meta.changes` counts what the FTS triggers wrote too, so a write tests for more than zero changes, never exactly one.
- A `CHECK` whose expression comes out `NULL` passes, so every constraint says what must be non-null, and D1 refuses a GLOB pattern over 50 characters, so a long format is checked in pieces or by a `strftime` round trip.
- D1 binds at most 100 parameters to one statement, so rows go in as a batch of single-row inserts, never one multi-row insert. Local D1 enforces the limit, so a test with a day's worth of rows catches it.
- `eslint --fix` turns `expect(a > b).toBe(true)` into `toBeGreaterThan`, which throws on strings. Compare timestamps with `Date.parse`. More generally, `npm run lint:fix` can change what code means; review the diff.
- `import-x/no-cycle` sees `.ts` files only because the config names the extension; the comment there says so, so it is not a setting to tidy away.
- No `eslint-disable` comments. Fix the code, or turn the rule off in `eslint.config.ts` with the reason.

## Changing the database

`api/src/db/schema.ts` is the source of truth for the tables, in [Drizzle](https://orm.drizzle.team). Migrations are additive by rule: old and new Worker versions share one database during a release, so a column is removed in a later release than the one that stopped using it.

1. Edit the schema.
2. `npm run db:generate --workspace api` writes the migration into `api/migrations/`. Review the SQL. Never hand-create a migration file or edit a generated one or its snapshot; lint fails when the migrations and `schema.ts` disagree.
3. `npm run db:migrate:local --workspace api` applies it locally. The release applies it to staging when the branch is pushed and to production when it is merged.
4. A new column gets a fixture in `api/test/db/migrations.test.ts`, which migrates a database with every column filled through the whole chain and fails when any value is lost.
5. A new query, trigger or index gets a case in `api/test/db/rows-read.test.ts`: D1 bills by rows read, a query that scans a table is slow as well as costly, and an FTS trigger that scanned the whole index on every write once read 37.7M rows in a day.

drizzle-kit only writes migrations; Wrangler runs them and records which have been applied.

**The search index is raw SQL.** The two FTS5 tables, the view they index and their triggers are defined in `api/src/db/search-index.sql`, because Drizzle models none of them; every migration that makes them is a copy of it, and a test holds the file to what the migrations leave in the database. Search queries go through Drizzle's `sql` template. Start a raw SQL migration with `npm run db:generate --workspace api -- --custom --name <what_it_does>` and fill in the empty file it creates, which keeps it in drizzle-kit's journal, in order with the generated ones.

**Rebuilding `item`.** A constraint, type or default on `item` changes by rebuilding the table, which drizzle-kit generates as a ``DROP TABLE `item` `` and a rename. D1 never lets a migration turn foreign keys off, so the drop deletes the rows first and every `ON DELETE SET NULL` pointing at `item` fires, clearing the album thumbnails and the uploads' album and target links. So the rebuild is three migrations, modelled by the trio `keep_links_through_item_rebuild`, `item_position_check` and `restore_links_and_search_index` in the git history, the first one's header explaining why:

1. A `--custom` migration that copies the link columns into keyed `rebuild_*` tables, drops the view `item_indexed` (on D1 the rebuild's rename fails while a view names the dropped table) and reshapes any row the new rule would refuse, since the rebuild's copy stops at the first such row and would leave the database between the first and second migration.
2. The generated rebuild, with a `-- non-additive: <reason>` line added at its top, the one edit lint expects.
3. A `--custom` migration that writes the links back with `coalesce`, so one set in between is kept, drops the scratch tables and ends with `api/src/db/search-index.sql` verbatim.

Between the first and third, seconds apart within one `d1 migrations apply`, search finds nothing and an insert, a delete or an update of an indexed column fails; an upload row made then loses its links. If a step fails midway, fix forward with another migration, or restore the bookmark the release printed (Restore the database to a bookmark in `docs/Operations.md`). `wrangler d1 export` cannot rehearse against a deployed database, since it refuses FTS5 tables.

## The web app

`web/` started as the AWS gallery's SvelteKit app, so the Worker answers in the record shapes that app was written against (`shared/src/album.ts`); it changes wherever that makes the site simpler or faster. How its code is written, the stores, the album cache and the components, is `docs/WebApp.md`. `npm run build --workspace web` writes a static single-page app to `web/build`, which the Worker serves as static assets. `npm run dev --workspace api` and `npm run deploy --workspace api` build it first; a bare `wrangler deploy` or `wrangler versions upload` ships whatever `web/build` holds. Those two scripts build `web/` with `--prefix ../web` after clearing `npm_config_workspace`, because npm passes a `--workspace api` flag down to nested npm commands as that variable, where it overrides a `--workspace web` flag.

**The browser floor.** The app has to load and run on iOS 15.6, the oldest browser a reader visits from, and `.browserslistrc` at the root is that floor. `browser-floor.ts` names the language features the floor lacks as `eslint-plugin-es-x` rules, and the browser floor block in `eslint.config.ts` applies them to `web/` and `shared/`, with `eslint-plugin-compat` for Web APIs, and turns off the autofixes that would rewrite working code into one of those features. `web/vite.config.ts` builds for the floor: Rolldown lowers the syntax it can, Lightning CSS rewrites the CSS, media query ranges included, and a plugin checks every chunk of the output, dependencies included, against the same rules as untyped code, so the build fails naming the chunk and the feature. The case that matters is a regular expression the bundler cannot rewrite, which it leaves as a `RegExp()` call that throws at module load. Untyped, the check cannot tell an iterator helper from an array method, so a dependency's use of one is the gap it leaves; and it takes any `.toSorted()` or `.union()` for the real thing, so a dependency upgrade can trip it on a call that never reaches such an object. When it does, read the chunk it names: a genuine use means the upgrade waits or the feature is polyfilled, and a false one means that rule comes out of `browser-floor.ts` with the reason. Nothing runs the app in a Safari that old: Vitest's browser mode and Playwright run Chromium, so the floor is held by these checks, not by a test.

**A guest downloads no admin code.** Admin pages, stores and libraries reach a guest's page only through a dynamic import, so they load once someone logs in. `web/guest-bundle.ts` holds that on every build: it follows the static imports from each guest's route, and fails the build naming the route and the module when one reaches a module it lists as admin-only, and fails too when it finds no guest route or a listed module in no chunk, since either would let it pass without looking. It reads the chunks as the bundler emits them, before minifying, which counts on `"sideEffects": false` in `shared/package.json`: without it the bundler keeps every module `shared/` exports and leaves the unused ones to the minifier. A new admin-only module or library goes in its list, and a schema only an admin writes goes in `shared/src/item.ts`.

**Two Vitest majors.** `api/` runs Vitest 4 and `web/` Vitest 5, each from its own directory, because `@cloudflare/vitest-plugin` needs Vitest 4.1 (Vitest 5 support is in workers-sdk PR #15500). npm hoists `api/`'s Vitest 4 to the root, so a `web/` test dependency whose peer range also accepts Vitest 4 can end up resolving it; `npm ls vitest` shows which each package gets. The lint fails when workspaces that declare the same package give it different ranges or would load different copies of it, since a second copy of a package whose types cross workspaces, like `valibot`, breaks quietly; `scripts/check-dependency-versions.ts` lists the packages allowed to differ, today Vitest and its coverage plugin, each with why.

## Claude Code on the web

A cloud session starts in a container that has only this repository, an older Node than `.nvmrc` pins and none of the lint's system tools, so `.claude/hooks/session-start.sh` prepares it: Node from `.nvmrc` through nvm, `npm install`, and the lint tools through `scripts/install-lint-tools.sh` plus shellcheck from apt. It runs only when `CLAUDE_CODE_REMOTE` is set, takes about a minute on a cold image, and its `[session-start]` lines in the session banner say how long each step took and which one failed if one did.

What a session can reach is set in the cloud environment (the environment menu in the session's title bar, then Edit), not in the repo:

- A Cloudflare token under the environment's API credentials, a Bearer token for `api.cloudflare.com`, lets a session run `scripts/release.sh staging`, `wrangler d1 info` and `wrangler tail` as a developer would. The proxy adds it to each request, so the session never sees it, but Wrangler will not send a request without a token of its own, so the environment's variables also set `CLOUDFLARE_API_TOKEN=injected-by-proxy`, which the proxy's header replaces. Give the session its own token with the deploy token's scopes (The deploy tokens in `docs/Releasing.md`), so it can be revoked on its own; the account id is in `api/wrangler.jsonc`. Without it a session still deploys, through the push.
- `DEBUGBEAR_API_KEY`, for `node api/scripts/debugbear.ts`.
- `api/.dev.vars` is not there, so `wrangler dev` does not run; the tests do not need it.
- Pushes and the GitHub tools use the GitHub connection of the account that started the session. `gh` is not installed, so `scripts/github-setup.sh` stays a script for a developer's machine.
- `.mcp.json` holds only `cloudflare-docs`, which needs no login. The Cloudflare account itself is reached through claude.ai's Cloudflare Developer Platform connector, enabled for the session, which logs in once and works in a cloud session as on a developer's machine; a server needing OAuth in `.mcp.json` cannot log in from a cloud session, and one alongside the connector shows every tool twice. Servers a developer keeps outside the repo, such as Context7 with an API key, stay outside it: a project entry of the same name would win over theirs.
