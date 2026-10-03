# Contributing

- **To make a change, submit a PR**. `main` is protected and won't accept commits directly.
- **Every PR deploys to staging**. Every push to a PR branch deploys it to staging.
- **Merging deploys to prod**. When a PR is merged, it deploys to production and is live.

## The loop

1. **Branch** from `main` as `type/short-description`, such as `fix/fts-trigger-rowid` ([Branch conventions](#conventions)).
2. **Make the change with its tests.** Never change production behavior without test(s) that fail without the change; see `docs/Testing.md`. Prefer writing the test before the production code (aka TDD). `docs/Development.md` has how code is written here.
3. **Check it** with `npm run quality`, which formats, lints, type-checks and tests the whole repo, the same scripts CI runs.
4. **Commit** once, when the change is green. The pre-commit hook lints the staged files and runs every suite they touch, about 40 seconds, the commit-msg hook refuses a subject that is not a Conventional Commit, and gitleaks refuses a commit holding a secret, as CI and GitHub's push protection do again. Never `git stash` mid-change: new files are untracked until staged, and a stash drops them from the tree.
5. **Push and open a pull request** with the title, description and labels below. Every push to the branch releases it to `staging-pix.tacocat.com` through `.github/workflows/deploy.yml`, so the change can be looked at there; a push that changes only markdown deploys nothing. `/api/health` on either hostname answers with the running version, the commit it was built from and the newest migration.
6. **CI** runs `.github/workflows/ci.yml`: `npm run lint`, `npm run check`, the Worker's tests and the front end's tests as four parallel jobs, over the whole repo, and `merge-ok` passes when all four do. A change to markdown alone runs only `scripts/lint.sh --docs`. A GitHub Action in a workflow has to be pinned to a full commit id with its version as a comment; the lint fails on a tag. A new check goes in `scripts/lint.sh` or `scripts/test.sh`, never only in the pre-commit hook, so that CI and the hook stay the same checks.
7. **Merge** once `merge-ok` passes on a branch up to date with `main`. The merge releases production and staging at once, so staging is back on what production runs between pull requests. `docs/Releasing.md` has what the release does and how to undo one.

Every push applies the branch's migrations to the staging database, so a migration amended after a push, or a branch abandoned, can leave it in a state production will never get. Fix staging's database in `docs/Operations.md` has ways to put it right.

## Conventions

Use these types for branch names, commit messages and pull request titles:

- `feat`: User-facing features or behavior changes (must change production code)
- `fix`: Bug fixes (must change production code)
- `docs`: Documentation only
- `style`: Code style/formatting (no logic changes)
- `refactor`: Code restructuring without behavior change
- `test`: Adding or updating tests
- `chore`: CI/CD, tooling, dependency bumps, configs (no production code)

### Branch names

`type/short-description`:

```text
feat/album-read-api
fix/fts-trigger-rowid
chore/pre-commit-hooks
```

### Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), which `scripts/check-commit-message.sh` checks on every commit:

```text
<type>(<scope>): <description>

[optional body]
```

- **Scopes** are optional; use one when it adds clarity, such as `api`, `d1`, `r2`, `images`, `upload`, `video`, `auth` or `infra`.
- **Breaking changes** take a `!` suffix: `feat!: remove deprecated endpoint`.
- **The body** is for the why when the description does not carry it.

```text
feat(upload): keep failed uploads in a dead-letter queue
fix(d1): key the FTS index by rowid
chore: add husky pre-commit hooks
docs: update API documentation
```

### Pull requests

The title is in commit-message format. The description:

```markdown
## Summary

One sentence describing the overall change.

- Optional supporting details
- If needed

## Test plan

- [ ] How to verify it works
```

Apply every label that fits, from these alone:

- `enhancement`: user-facing features or improvements, which must change production code behavior
- `refactor`: production code changes that don't alter behavior
- `bug`: fixes broken production code functionality
- `test`: changes to tests
- `documentation`: documentation changes

Dependency bumps, CI/CD, tooling and infrastructure changes take no label.

In Claude Code, the project's `/branch`, `/commit` and `/pr` skills do each of these steps the way this page says.
