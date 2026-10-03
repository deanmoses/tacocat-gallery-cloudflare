START_IGNORE

<!-- Two top-level headings, one per output, and the first line is a marker rather than a heading; both outputs are fine. -->
<!-- markdownlint-disable-file MD025 MD041 -->

This is the source file for generating CLAUDE.md and AGENTS.md. Do not edit those files directly - edit this file instead.

Regenerate with: npm run agent-docs

Markers:

- START_CLAUDE / END_CLAUDE - content appears only in CLAUDE.md
- START_AGENTS / END_AGENTS - content appears only in AGENTS.md
- START_IGNORE / END_IGNORE - content stripped from both (like this block)

END_IGNORE

START_CLAUDE

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

END_CLAUDE

START_AGENTS

# AGENTS.md

This file provides guidance to AI programming agents when working with code in this repository.

END_AGENTS

This project, Tacocat Gallery, <https://pix.tacocat.com>, is the multi-generational family photo gallery of the Moses family: Dean (call him Moses) and Lucie and their sons Felix and Milo. Moses is the tech lead of the site, Lucie is the UX designer.

It's hosted on Cloudflare: one Worker per environment that serves a SvelteKit single-page app and everything behind it, with D1 for the catalog and search, R2 for the media, Image Transformations for derived images, a Queue and a Workflow for the upload pipeline and an ffmpeg Container for video.

## Commands

```bash
npm run dev --workspace api               # the Worker and the built app on localhost:8787
npm run dev --workspace web               # the app with hot reload on localhost:5173
npm test                                  # every workspace's tests, then e2e
npm run quality                           # format, lint, type-check, test: what CI runs
npm run db:generate --workspace api       # a migration from schema.ts
npm run db:migrate:local --workspace api  # apply migrations to the local database
npm run types --workspace api             # regenerate the Worker's binding types
npm run logs:production --workspace api   # tail production; `logs` tails staging
```

The Worker's scripts live in `api/package.json`, so they run from `api/` or with `--workspace api`; so do Wrangler commands, which find `api/wrangler.jsonc` from the directory they run in. `api/` and `web/` run different Vitest majors (Two Vitest majors in `docs/Development.md`), so each workspace's tests run from its own directory or with its `--workspace` flag.

## This repo

An npm monorepo: one `npm install` at the root, three workspaces, `api/`, `web/` and `shared/`, each with its own `package.json` and dependencies, and three plain directories beside them. The Worker's layers under `api/src/` are The code in `docs/Architecture.md`.

- `api/`: the Worker, with its tests, migrations, scripts and the transcoder's image.
- `web/`: the SvelteKit app, built to static files the Worker serves.
- `shared/`: what both import, the record schemas, the path grammar and the URL builders.
- `infra/`: OpenTofu for everything outside the Worker.
- `e2e/`: Playwright journeys through the built app and a local Worker.
- `scripts/`: the lint, test, release and repository-setup scripts.

## Read before you change

Each doc below is the one home of its subject; no other doc repeats it. Before changing what the left side names, read what the right side names.

- **Anything under `api/src/`**: Invariants in `docs/Architecture.md`, then the subsystem's own page below.
- **`api/src/db/schema.ts`, `api/migrations/`, `api/src/db/search-index.sql`**: Changing the database in `docs/Development.md`, and `docs/DataModel.md`.
- **`api/src/gallery/` reads, writes and search**: `docs/DataModel.md`, and the gotchas under The code in `docs/Development.md`.
- **`api/src/gallery/presign.ts`, `api/src/gallery/upload.ts`, the queue consumer**: `docs/Uploads.md`.
- **`api/src/media/`, `api/transcoder/`, `shared/src/urls.ts`, the `/i`, `/raw` and `/v` routes**: `docs/Media.md`.
- **`api/src/storage/`, object keys, buckets, version ids**: `docs/Storage.md`.
- **`api/src/auth/`, sessions, `api/src/http/headers.ts`, `web/static/_headers`**: `docs/Auth.md`.
- **`web/`**: `docs/WebApp.md`, then The web app in `docs/Development.md` for the build, the browser floor and the guest bundle check.
- **Any test**: `docs/Testing.md`.
- **`api/wrangler.jsonc`**: Wrangler in `docs/Infrastructure.md`, and Ship what a release can't in `docs/Releasing.md`.
- **`infra/`, DNS, tokens, `scripts/github-setup.sh`, `.github/`**: `docs/Infrastructure.md`.
- **`scripts/release.sh`, `.github/workflows/deploy.yml`, shipping or undoing a release**: `docs/Releasing.md`.
- **The deployed system**, health, logs, staging's database, admin access, backups, secrets rotation: `docs/Operations.md`.
- **Performance**: `docs/Perf.md`, whose Ruled out lists what not to propose again.
- **`api/scripts/`**: `api/scripts/README.md`, and the comment at the top of each script.
- **Getting a machine running locally**: `README.md`; what local development gets wrong is Local development in `docs/Development.md`.
- **Branches, commits, pull requests**: `CONTRIBUTING.md`.
- **The AWS gallery this one was derived from**: `docs/plans/migration_from_aws/AwsArch.md`.

## Working here

- **The pre-commit hook** runs the suites the staged files touch and takes about 40 seconds, so commit once, when the change is green.
- **Local dev is not the edge.** Images are made by the local Images binding, which cannot decode HEIC and ignores EXIF orientation and the encoding options, so judge thumbnails, GIFs and phone photos on staging. Video needs Docker, and uploads complete only with `UPLOAD_MODE=local` (Local development in `docs/Development.md`).
- **Staging is the default.** A Wrangler command without `--env production` touches staging, and so do the tests and `wrangler dev` (`docs/Operations.md`).
- **Pushing deploys.** A push to a pull request branch releases it to staging and a merge releases production (`docs/Releasing.md`). So push when the branch is worth looking at on staging, never to park work, and say what went out; Is production okay? in `docs/Operations.md` says how to see what is running.
- **Logs** are Workers Logs, a week of every request, through the observability MCP (Is production okay? in `docs/Operations.md`).

## Rules

- **Never print, commit or paste secrets** from `api/.dev.vars` or the Worker's secrets.
- **Tests.** Never change production behavior without a test that fails without the change.
- **The web app runs on iOS 15.6.** `.browserslistrc` is the floor, for Lucie's mom's phone that will not be replaced; The browser floor in `docs/Development.md` says how lint and the build hold it. Nothing in this repo runs the app in a browser that old, so Chromium passing says nothing about the floor.
- **No `eslint-disable` comments.** Fix the code, or ask the user if you can turn the rule off in `eslint.config.ts` with the reason.
- `npm run lint:fix` fixers can change what code means; review the diff.
- **New checks go in `scripts/lint.sh` or `scripts/test.sh`**, never only in the pre-commit hook.
- **`main` is protected.** Every change lands through a pull request whose CI `merge-ok` check passed on a branch up to date with `main`; nobody pushes to `main`. The repository's settings are `scripts/github-setup.sh`, not the dashboard. `CONTRIBUTING.md` has the loop and the conventions.
- **After editing `api/wrangler.jsonc`, run `npm run types --workspace api`.**
- **Markdown** is never hard-wrapped: one line per paragraph or list item.
- **A fact lives in one doc.** Change it there, and point to it from elsewhere rather than restating it, since two copies drift into a contradiction. Read before you change, above, names each doc's subject; this file holds only what every session needs.
- **`docs/plans/` is the archive of plans, past, present and future.** A plan is written before its work and updated while the work runs; once built it is frozen as the record of what was decided and why, and nobody brings it up to date with the code. What the system is now belongs in `docs/Architecture.md` and the pages it links, `docs/Development.md`, `docs/Releasing.md`, `docs/Operations.md`, `docs/Infrastructure.md`, `docs/Testing.md`, `CONTRIBUTING.md` and `README.md`, which are kept current.

### Comments

Comments exist ONLY to explain what the code cannot. Never restate the code. See `docs/CodeComments.md`.

- **No planning ephemera.** Never reference plan docs, risk numbers, or phase/step labels. Describe the actual rationale instead.
- **No opposition to prior state.** Don't write "This does NOT do X"; no future reader knows about X. Exceptions: regression tests, and changes a naive reader would plausibly revert.
- **Don't name consumers.** "Used by Z" is instant doc rot.
- **Don't restate the signature.** Strict TypeScript already says what a function takes and returns.

## Database changes

Changing the database in `docs/Development.md` has the procedure; these are the rules a change breaks without reading it.

- **Migrations are additive**: remove a column in a later release than the one that stopped using it.
- **Start in `api/src/db/schema.ts`** and generate. Never hand-create a migration or edit a generated one or its snapshot.
- **A rebuild of `item` is three migrations**, since dropping the table clears every link to it.
- **A new query, trigger or index gets a case in `api/test/db/rows-read.test.ts`**, and a new column a fixture in `api/test/db/migrations.test.ts`.

## Spending

The account is on Workers Paid ($5/month). Don't do anything likely to cost more than 10 cents beyond the plan without asking first. Anything smaller needs no approval; say what it used, from `npx wrangler d1 info DB --env production` in `api/` for D1 and the dashboard for the rest. What reaches 10 cents:

- **Image Transformations** past 5,000 unique a month: $0.50 per 1,000 after that, so about 200 first-time derivatives, which a backfill or a sweep of an album's thumbnails reaches at once.
- **The transcoder**, about $0.40 an hour per `standard-4` instance, so 15 minutes of one. **NEVER leave a transcoder instance running.** An instance stops itself 10 s after its last request (`sleepAfter` in `api/src/media/transcoder.ts`): never raise that, never hold an instance awake with a long-running or repeated request, and after any work that touched the transcoder check in the dashboard, under Containers, that no instance is still live. The plan covers about an hour and a half of encoding a month, so a monthly video costs nothing. Tune ffmpeg in local Docker (`docker build -t tacocat-transcoder api/transcoder`, run with `--cpus 4`), where iteration is free, never on a deployed instance.
- **Bulk copies into R2**: storage past 10 GB-month is $0.015 per GB-month, about 7 GB-month, and writes past 1M a month $4.50 per million, about 22,000 writes.
- **Stream** is a $5-a-month subscription per 1,000 minutes stored, from the first video uploaded, plus $1 per 1,000 minutes watched. Nothing uses it, and the transcoder does what it would; enabling it is a decision, not an experiment.

START_CLAUDE

## Custom Skills

Use this project's `/branch`, `/commit` and `/pr` skills via the Skill tool rather than running git or gh by hand.

END_CLAUDE

START_AGENTS

## Branch, Commit and PR Conventions

Follow `CONTRIBUTING.md`: branches are `type/short-description`, commits are Conventional Commits, which the commit-msg hook checks, and pull requests take its title format, description template and labels.

END_AGENTS
