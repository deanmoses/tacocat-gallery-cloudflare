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

The pix.tacocat.com photo gallery, moving from AWS to Cloudflare: one Worker with D1, R2, a Queue, the Images binding and an ffmpeg Container, and OpenTofu in `infra/` for everything outside the Worker. `README.md` has the risk register, the budget, and how to run and restore; read it before anything that touches the account.

## The Cloudflare account costs money

An FTS trigger that scanned the whole index on every write once read 37.7M D1 rows in a day and took the whole site down.

- **Ask before consuming more than 1% of a monthly allowance** in the README's Budget table, or anything billed outside it (a larger container instance, Stream, transformations past the free 5,000). Estimate before you run: a query's `rows_read` locally, a transcode's vCPU-minutes from the instance size and the last run's time. Under 1%, go ahead and say what it used. Local work (`npm run dev`, tests, `--local` D1) needs no approval.
- **Never deploy unless asked.**
- **Watch rows read**, not rows returned: check `meta.rows_read` locally before shipping a new query or trigger.
- **Migrations are additive.** Old and new Worker versions share one database during a deploy; remove columns in a later release.
- **Never print, commit or paste secrets** from `.dev.vars` or the Worker's secrets.

## Design rules the code doesn't spell out

- Originals are never overwritten. Each upload gets a new time-sortable `versionId` in its R2 key, and the database says which one is current.
- The FTS5 table and its triggers are raw SQL in `migrations/`; Drizzle cannot see them. Every other table change starts in `src/db/schema.ts`, then `npm run db:generate`.
- After editing `wrangler.jsonc`, run `npm run types`.

## Rules

- **Tests.** Never change production behavior without a test that fails without the change.
- **No `eslint-disable` comments.** Fix the code, or ask the user if you can turn the rule off in `eslint.config.ts` with the reason.
- `npm run lint:fix` fixers can change what code means; review the diff.
- **New checks go in `scripts/lint.sh` or `scripts/test.sh`**, never only in the pre-commit hook.
- **Markdown** is never hard-wrapped: one line per paragraph or list item.

### Comments

Comments exist ONLY to explain what the code cannot. Never restate the code. See `docs/CodeComments.md`.

- **No planning ephemera.** Never reference plan docs, risk numbers from the README, or phase/step labels. Describe the actual rationale instead.
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
