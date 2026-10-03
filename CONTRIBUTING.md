# Contributing

Every change is a pull request: `main` is protected and takes no direct commits. Every push to its branch deploys it to staging, and merging deploys it to production (`docs/Releasing.md`).

## The loop

1. **Branch** from `main` as `type/short-description`, such as `fix/fts-trigger-rowid` ([Branch conventions](#conventions)).
2. **Make the change with its tests**, preferably test first (`docs/Testing.md`). `docs/Development.md` has how code is written here.
3. **Check it** with `npm run quality`, which formats, lints, type-checks and tests the whole repo, the same scripts CI runs.
4. **Commit** once, when the change is green. The pre-commit hook lints the staged files and runs every suite they touch, about 40 seconds, the commit-msg hook refuses a subject that is not a Conventional Commit, and gitleaks refuses a commit holding a secret, as CI and GitHub's push protection do again. Never `git stash` mid-change: new files are untracked until staged, and a stash drops them from the tree.
5. **Push and open a pull request** with the title, description and labels below. The push releases the branch to `staging-pix.tacocat.com`, so the change can be looked at there.
6. **CI** runs `.github/workflows/ci.yml`: `npm run lint`, `npm run check`, the Worker's tests and the front end's tests as four parallel jobs, over the whole repo, and `merge-ok` passes when all four do. A change to markdown alone runs only `scripts/lint.sh --docs`.
7. **Merge** once `merge-ok` passes on a branch up to date with `main`. The merge releases production (`docs/Releasing.md`).

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
