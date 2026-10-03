---
name: branch
description: Creates git branches with proper naming. Use when creating branches, starting new work, or switching to feature branches.
---

# Branch Naming

Use `type/short-description` format.

## Types

- `feat`: User-facing features or behavior changes (must change production code)
- `fix`: Bug fixes (must change production code)
- `docs`: Documentation only
- `style`: Code style/formatting (no logic changes)
- `refactor`: Code restructuring without behavior change
- `test`: Adding or updating tests
- `chore`: CI/CD, tooling, dependency bumps, configs (no production code)

## Examples

```text
feat/album-read-api
fix/fts-trigger-rowid
chore/pre-commit-hooks
docs/update-readme
refactor/derived-image-keys
test/upload-queue-retries
```

## Instructions

1. Determine the type based on what the work will accomplish
2. Choose a short, descriptive slug (2-4 words, hyphenated)
3. Create the branch: `git checkout -b type/short-description`
