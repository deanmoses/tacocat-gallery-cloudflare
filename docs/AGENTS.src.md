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

This project is a re-imagining of the Tacocat photo gallery (<https://pix.tacocat.com>) on Cloudflare. The current production gallery is on AWS; this repo is to prove out that moving to Cloudflare would improve the system. The original goals, in `docs/plans/Hosting.md` and `docs/plans/HostingDeepDive.md` in the `tacocat-gallery-sam` repo, were all about performance, but we've expanded the criteria:

- **Developer ergonomics**: we find we much prefer Cloudflare's developer ergonomics. Things like:
    - **Single repo development**. We replaced AWS's four repos (sveltekit, SPA hosting, SAM, auth) with this single monorepo. So much easier to manage! AIs can make coordinated changes. Vastly speeds up development. Now when I go back to AWS I hate it, it feels agonizingly clunky.
    - **Localhost support**. Cloudflare's stack runs on localhost, meaning tests can run on the actual stuff that runs in prod. No more endlessly mocking out DynamoDB. I can run integration tests locally rather than in the cloud! I finally can log in and upload files on localhost! Much faster feedback loops, AI sessions can iterate on things super quick. Vastly speeds up development.
    - **Simpler deploys**. Because we've improved testing (see below), I'm comfortable deploying to prod when merging a PR to main. No more manually clicking on Github Actions in four separate repos.
- **Feature improvements**: we've found we can improve capabilities. For example:
    - Switching to SQLite's built-in search allows for accent-insensitive search.
    - Switching to SQLite and improved localhost support made it easier to add a users table and a photo re-ordering feature, things that I had been intimidated by on the DynamoDB based AWS system.
- **Simplicity**: the Cloudflare stack is simpler: no subdomains (eliminating whole classes of domain management issues) and very little CORS, no API Gateway, no CloudFront, no Cognito, no Redis. We simplified media storage by making it truly immutable, meaning when we replace or rename an image, it's purely adding a new file under a new ID such that the only other things that change are in the database, which greatly simplified and speeded up renames and replaces.
- **More robust**: it feels like the Cloudflare stack can be more easily made robust than AWS. Examples:
    - Because Cloudflare is a monorepo we're able to easily share code between the front end and back end, making whole classes of errors impossible by construction.
    - Because it's easier to write and run integration tests, we are writing more tests, and I feel more comfortable doing things like enabling Dependabot.

We will make the go/no go decision by closing down all the items in `docs/Risks.md`.

No albums or media have been migrated from AWS yet. For now there is only one admin, moses, only logged in to staging. The staging and production databases hold nothing that matters and can be deleted. So now is the time to do any destructive changes that would result in a better, simpler, more hardened system.

## This repo

Three npm workspaces:

- `api/`: one Worker with D1, R2, a Queue, the Images binding and an ffmpeg Container, deployed as two environments, staging (the config's top level, also what tests and `wrangler dev` run) and production (`--env production`), each with its own data.
- `web/`: the SvelteKit front end.
- `shared/`: code shared between `api/` and `web/`, such as the album schema and path helpers.

These workspaces run different Vitest majors (the Worker's tests need 4.1, `web/` is on 5), so run a workspace's scripts with `--workspace api` or `--workspace web`, or from its directory. The root holds the lint, format and test tooling for all three, and OpenTofu in `infra/` for everything outside the Worker. `README.md` has how to run, deploy and restore. See `docs/Architecture.md` for more detail.

`web/` started as the AWS app, `tacocat-gallery-sveltekit` at commit 8c57e5f of its `claude/getalbum-caching-nextprev-as8yq8` branch, so the Worker answers in the AWS API's record shapes (`shared/src/album.ts`) and the app parsed them unchanged; that is why the shapes look the way they do. Keeping the two apps identical was for measuring the platforms alone, but that phase is over: change the app wherever it makes the system more ergonomic, long term maintainable, faster; note each difference from the AWS app in `docs/Perf.md`, since a measurement is read against what both sites were doing at the time. Performance is judged in real browsers, as `docs/Perf.md` describes; `docs/Risks.md` holds what has been tested against the real account, and a risk that fails is a finding, not a setback: write it down as plainly as a success. `docs/plans/AwsPort.md` records the decisions behind the design and what is left to do, and `docs/plans/AwsDataMigration.md` how the real gallery is copied over.

## The AWS site

The site this one has to beat runs on AWS from four repos, checked out beside this one (`../<repo>`, and on GitHub under `deanmoses`). `docs/Ecosystem.md` in `tacocat-gallery-sveltekit` maps how they fit together.

| Repo                          | What it is                                                                        | Read first                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `tacocat-gallery-sam`         | The back end: DynamoDB, Lambdas, API Gateway, S3 media, the image CDN             | `docs/plans/Hosting.md` and `docs/plans/HostingDeepDive.md` (the move), `docs/plans/EdgeCachedAlbums.md`, `docs/Architecture.md` |
| `tacocat-gallery-sveltekit`   | The SvelteKit single-page app that `web/` ports                                   | `docs/plans/Observability.md` (AWS performance, measured), `docs/Observability.md` (`npm run perf`), `docs/Ecosystem.md`         |
| `tacocat-gallery-hosting-aws` | The S3 bucket and CloudFront distribution that serve the app on `pix.tacocat.com` | `template.yaml`                                                                                                                  |
| `tacocat-gallery-auth`        | Cognito login, which the passkey login here replaces                              | `template.yaml`                                                                                                                  |

Search is Redis Labs, configured by hand in its dashboard, with no repo.

## Spending

The account is on Workers Paid ($5/month), so going past an allowance costs money rather than taking the site down, and at this site's scale that is usually cents.

- **Ask before anything likely to cost more than $1 beyond the plan, and always before using Stream**, whose pricing is unchecked. Anything smaller needs no approval; say what it used, from `npx wrangler d1 info DB --env production` in `api/` for D1 and the dashboard for the rest. What can cost more than $1:
    - **Images transformations** past 5,000 unique a month, $0.50 per 1,000 after that, as in a backfill of derived images.
    - **A transcoder instance stuck running.** The transcoder is `standard-4` (4 vCPU, 12 GiB) for speed, an instance per video and ten at most, each stopping 10 s after its last request. The plan includes about an hour and a half of one encoding a month, so a monthly video costs nothing, but an instance left running costs about $0.40 an hour. Tune ffmpeg in local Docker first (`docker build -t tacocat-transcoder api/transcoder`, run with `--cpus 4`), where iteration is free.
    - **Bulk copies into R2**: storage past 10 GB-month is $0.015 per GB-month, and writes past 1M a month $4.50 per million.
- **Deploy whenever testing a risk needs it.** Every push deploys itself: a pull request branch to staging, a merge to `main` to production and staging (Deploying in `README.md`). By hand, `scripts/release.sh staging` or `scripts/release.sh production`, which ship the transcoder's image and container settings too. Say what went out. The DebugBear browser runs visit production four times a day, at the times production's `crons` in `api/wrangler.jsonc` give, and a merge's release checks production a few times. While a measurement is running, avoid its hours or note the traffic in `docs/Perf.md`.
- **Check `meta.rows_read` locally** before shipping a new query or trigger: a query that scans a table is slow as well as costly. An FTS trigger that scanned the whole index on every write once read 37.7M rows in a day.

## Design rules the code doesn't spell out

- Originals are never overwritten. Each upload gets a new time-sortable `versionId` in its R2 key, and the database says which one is current.
- The search index (a view of `item`, two FTS5 tables and their triggers) is raw SQL, defined in `api/src/db/search-index.sql`; Drizzle cannot see it, and a migration that touches it is a copy of that file. Every other table change starts in `api/src/db/schema.ts`, then `npm run db:generate --workspace api`.
- Start a raw SQL migration with `npm run db:generate --workspace api -- --custom --name <what_it_does>` and fill in the empty file it creates. That keeps it in drizzle-kit's journal, in order with the generated ones. Never hand-create a migration file or edit a generated one or its snapshot; lint fails when the migrations and `schema.ts` disagree.
- **A generated migration containing ``DROP TABLE `item` `` sits between two `--custom` migrations**, because dropping the table fires every `ON DELETE SET NULL` pointing at it. The 2026-09-27 trio `keep_links_through_item_rebuild`, `item_position_check` and `restore_links_and_search_index`, in the history at commit 38b89ea, is the model, the first one's header explains why, and Database schema in `README.md` has the steps. A new column needs a fixture in `api/test/db/migrations.test.ts`, which fails when a migration loses a value.
- After editing `api/wrangler.jsonc`, run `npm run types --workspace api`.

## Rules

- **Migrations are additive.** Old and new Worker versions share one database during a deploy; remove columns in a later release.
- **Never print, commit or paste secrets** from `api/.dev.vars` or the Worker's secrets.
- **Tests.** Never change production behavior without a test that fails without the change. Read `docs/Testing.md` before writing one.
- **The web app runs on iOS 15.6.** `.browserslistrc` is the floor, for one reader's phone that will not be replaced; Front end in `README.md` says how lint and the build hold it. Nothing runs the app in a browser that old, so Chromium passing says nothing about the floor.
- **No `eslint-disable` comments.** Fix the code, or ask the user if you can turn the rule off in `eslint.config.ts` with the reason.
- `npm run lint:fix` fixers can change what code means; review the diff.
- **New checks go in `scripts/lint.sh` or `scripts/test.sh`**, never only in the pre-commit hook.
- **`main` is protected.** Every change lands through a pull request whose CI `merge-ok` check passed on a branch up to date with `main`; nobody pushes to `main`. The repository's settings are `scripts/github-setup.sh`, not the dashboard. See Continuous integration in `README.md`.
- **Markdown** is never hard-wrapped: one line per paragraph or list item.

### Comments

Comments exist ONLY to explain what the code cannot. Never restate the code. See `docs/CodeComments.md`.

- **No planning ephemera.** Never reference plan docs, risk numbers from `docs/Risks.md`, or phase/step labels. Describe the actual rationale instead.
- **No opposition to prior state.** Don't write "This does NOT do X"; no future reader knows about X. Exceptions: regression tests, and changes a naive reader would plausibly revert.
- **Don't name consumers.** "Used by Z" is instant doc rot.
- **Don't restate the signature.** Strict TypeScript already says what a function takes and returns.

START_CLAUDE

## Custom Skills

Use this project's `/branch`, `/commit` and `/pr` skills via the Skill tool rather than running git or gh by hand.

END_CLAUDE

START_AGENTS

## Branch, Commit and PR Conventions

Use these types for branch names, commit messages, and PR titles:

- `feat`: User-facing features or behavior changes (must change production code)
- `fix`: Bug fixes (must change production code)
- `docs`: Documentation only
- `style`: Code style/formatting (no logic changes)
- `refactor`: Code restructuring without behavior change
- `test`: Adding or updating tests
- `chore`: CI/CD, tooling, dependency bumps, configs (no production code)

### Branch Naming

Use `type/short-description`:

```text
feat/album-read-api
fix/fts-trigger-rowid
chore/pre-commit-hooks
```

### Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<scope>): <description>

[optional body]
```

- **Scopes:** Optional. Use when it adds clarity (e.g., `api`, `d1`, `r2`, `images`, `upload`, `video`, `auth`, `infra`).
- **Breaking changes:** Use `!` suffix: `feat!: remove deprecated endpoint`

**Examples:**

```text
feat(upload): keep failed uploads in a dead-letter queue
fix(d1): key the FTS index by rowid
chore: add husky pre-commit hooks
docs: update API documentation
```

### Pull Requests

**PR titles:** Use conventional commit format, same as commit messages.

**PR descriptions:**

```markdown
## Summary

One sentence describing the overall change.

- Optional supporting details
- If needed

## Test plan

- [ ] How to verify it works
```

### PR Labels

Use labels on pull requests. Apply all labels that fit. Only use the following labels:

- `enhancement` - User-facing features or improvements. Must change production code behavior.
- `refactor` - Production code changes that don't alter behavior
- `bug` - Fixes broken production code functionality
- `test` - Changes to tests
- `documentation` - Documentation changes

**No label needed** for dependency bumps, CI/CD, tooling, or infrastructure changes.

END_AGENTS
