#!/usr/bin/env bash
# Every lint check in the repo. CI and `npm run lint` run it over the whole repo; .husky/pre-commit runs it with
# --staged, which gives each per-file check only the staged files. The checks are the same either way, so a commit is
# held to the standard CI enforces. Add a check here, never in the hook or a workflow.
#
# Usage: scripts/lint.sh [--staged]
#
# --staged is the fast early warning, not the gate: typed ESLint rules look across files, so a type changed in a
# staged file can make an unstaged one fail, and only the full run in CI sees that. Type errors anywhere are still
# caught locally, because `npm run check` always covers the whole project.

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR" || exit 1
PATH="$DIR/node_modules/.bin:$PATH"
FAILED=0

STAGED=0
case "${1:-}" in
--staged) STAGED=1 ;;
'') ;;
*)
    echo "Usage: scripts/lint.sh [--staged]" >&2
    exit 2
    ;;
esac

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

# CI is not a TTY but GitHub Actions renders ANSI, so keep color there.
if [ ! -t 1 ] && [ -z "${CI:-}" ]; then
    GREEN='' RED='' YELLOW='' NC=''
fi

# A missing system tool is fatal in CI and a warning locally: a fresh clone should still be able to commit, but CI
# silently skipping a check is how a check stops existing. Install them with
# `brew install gitleaks shellcheck shfmt hadolint opentofu`.
require() {
    command -v "$1" >/dev/null 2>&1 && return 0
    if [ -n "${CI:-}" ]; then
        echo -e "${RED}FAIL${NC} ($1 not installed)"
        FAILED=1
    else
        echo -e "${YELLOW}SKIP${NC} ($1 not installed)"
    fi
    return 1
}

report() {
    if [ "$1" = "0" ]; then
        echo -e "${GREEN}PASS${NC}"
    else
        echo -e "${RED}FAIL${NC}"
        [ -n "${2:-}" ] && echo "$2"
        FAILED=1
    fi
}

# The files a check covers. Staged: added, copied, modified or renamed in the index, so a deletion is not linted.
# Full: tracked files plus new ones not yet added, so a file is linted before its first commit.
files() {
    if [ "$STAGED" = "1" ]; then
        git diff --cached --name-only --diff-filter=ACMR -- "$@"
    else
        git ls-files --cached --others --exclude-standard -- "$@"
    fi
}

# Runs a command over the files matched by the pathspecs after `--`. In a full run, a pathspec that matches nothing
# means the repo changed shape, so it fails rather than passing forever; in a staged run it just means none of those
# files changed.
over_files() {
    local command=()
    while [ "$1" != "--" ]; do
        command+=("$1")
        shift
    done
    shift
    local matched
    matched=$(files "$@")
    if [ -z "$matched" ]; then
        if [ "$STAGED" = "1" ]; then
            echo "none staged"
        else
            report 1 "Matched no files for: $* -- has the repo changed shape?"
        fi
        return
    fi
    local output
    # shellcheck disable=SC2086 # word splitting is how the file list is passed
    output=$("${command[@]}" $matched 2>&1)
    report "$?" "$output"
}

check() {
    local output
    output=$("$@" 2>&1)
    report "$?" "$output"
}

# Migrations changed since the last commit, by git's --diff-filter letters: in the index for a staged run, anywhere in
# the working tree for a full run. A CI run has nothing uncommitted, so it will need a base branch to diff against.
changed_migrations() {
    if [ "$STAGED" = "1" ]; then
        git diff --cached --name-only --diff-filter="$1" -- 'migrations/*.sql'
    else
        git diff HEAD --name-only --diff-filter="$1" -- 'migrations/*.sql'
        if [ "$1" = "A" ]; then
            git ls-files --others --exclude-standard -- 'migrations/*.sql'
        fi
    fi
}

if [ "$STAGED" = "1" ]; then
    echo "Running lint checks on staged files"
else
    echo "Running lint checks"
fi
echo "================================================="

echo -n "Format: Prettier (code, JSON, Markdown)... "
over_files prettier --check --log-level warn --ignore-unknown -- ':(glob)**/*'

echo -n "Lint: ESLint (code and JSON)... "
over_files eslint --max-warnings 0 --no-warn-ignored -- '*.ts' '*.mjs' '*.js' '*.json' '*.jsonc'

echo -n "Lint: Markdown (markdownlint)... "
over_files markdownlint-cli2 --no-globs -- '*.md'

# Wrangler records applied migrations by filename, so an edit to one never reaches a database that already has it, and
# a renamed one would run twice.
echo -n "Migrations: committed ones are unchanged... "
frozen=$(changed_migrations MDR)
if [ -z "$frozen" ]; then
    report 0
else
    report 1 "Add a new migration instead of changing, renaming or deleting a committed one:
$frozen"
fi

# During a deploy the old Worker version still runs against the new schema, so a migration must not take away a table
# or column it uses. A migration that has to, such as the later release removing a column the code no longer reads,
# says why on a `-- non-additive: <reason>` line.
echo -n "Migrations: new ones only add... "
removals=""
for migration in $(changed_migrations A); do
    grep -qiE '^--[[:space:]]*non-additive:[[:space:]]*[^[:space:]]' "$migration" && continue
    found=$(grep -niE '\b(drop[[:space:]]+(table|column)|rename)\b' "$migration")
    [ -n "$found" ] && removals+="$migration:"$'\n'"$found"$'\n'
done
if [ -z "$removals" ]; then
    report 0
else
    report 1 "${removals}Split the removal into a later release, or add a \`-- non-additive: <reason>\` line."
fi

# Whole file either way, since a hand edit to a generated file has to be caught whatever else is staged.
echo -n "Docs: CLAUDE.md and AGENTS.md match docs/AGENTS.src.md... "
check node scripts/build-agent-instructions.ts --check

# Whole project either way: an unused export is a fact about the files that don't import it.
echo -n "Lint: unused files, exports and dependencies (knip)... "
check knip --no-progress

echo -n "Lint: shell scripts (shellcheck)... "
if require shellcheck; then
    over_files shellcheck -- '*.sh' .husky/pre-commit .husky/commit-msg
fi

echo -n "Format: shell scripts (shfmt)... "
if require shfmt; then
    over_files shfmt --diff -- '*.sh' .husky/pre-commit .husky/commit-msg
fi

echo -n "Lint: Dockerfiles (hadolint)... "
if require hadolint; then
    over_files hadolint -- '*Dockerfile'
fi

# OpenTofu checks a module as a whole, so a staged run does all of infra/ whenever any of it changed.
if [ "$STAGED" = "1" ] && [ -z "$(files infra)" ]; then
    echo "Lint: OpenTofu (tofu fmt, tofu validate)... none staged"
else
    echo -n "Format: OpenTofu (tofu fmt)... "
    if require tofu; then
        check tofu -chdir=infra fmt -check -recursive
    fi

    # validate needs the providers, which a fresh clone or a CI runner has not downloaded. -backend=false leaves the
    # local state alone.
    echo -n "Lint: OpenTofu (tofu validate)... "
    if require tofu; then
        if [ ! -d infra/.terraform ]; then
            tofu -chdir=infra init -backend=false -input=false >/dev/null 2>&1
        fi
        check tofu -chdir=infra validate -no-color
    fi
fi

echo "================================================="
if [ "$FAILED" = "1" ]; then
    echo -e "${RED}Lint FAILED${NC}"
    exit 1
fi
echo -e "${GREEN}Lint PASSED${NC}"
