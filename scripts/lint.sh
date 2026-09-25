#!/usr/bin/env bash
# Every lint check in the repo. CI and `npm run lint` run it over the whole repo; .husky/pre-commit runs it with
# --staged, which gives each per-file check only the staged files. The checks are the same either way, so a commit is
# held to the standard CI enforces. Add a check here, never in the hook or a workflow.
#
# Usage: scripts/lint.sh [--staged | --docs]
#
# --staged is the fast early warning, not the gate: typed ESLint rules look across files, so a type changed in a
# staged file can make an unstaged one fail, and only the full run in CI sees that. Type errors anywhere are still
# caught locally, because `npm run check` always covers the whole project.
#
# --docs runs only the checks that can fail on a change to markdown, for a CI run in which nothing else changed.
#
# The migration checks look at what changed. A full run compares the working tree with HEAD, or with the branch named in
# LINT_BASE_REF when that is set, which is how CI sees every commit of a pull request.

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR" || exit 1
PATH="$DIR/node_modules/.bin:$PATH"
FAILED=0

STAGED=0
DOCS=0
case "${1:-}" in
--staged) STAGED=1 ;;
--docs) DOCS=1 ;;
'') ;;
*)
    echo "Usage: scripts/lint.sh [--staged | --docs]" >&2
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
# `brew install actionlint gitleaks shellcheck shfmt hadolint opentofu`; CI gets the same versions from
# scripts/install-lint-tools.sh.
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
# Full: tracked files plus new ones not yet added, so a file is linted before its first commit, less any deleted in
# the working tree and not yet staged, which the index still lists.
files() {
    if [ "$STAGED" = "1" ]; then
        git diff --cached --name-only --diff-filter=ACMR -- "$@"
    else
        comm -23 <(git ls-files --cached --others --exclude-standard -- "$@" | sort) <(git ls-files --deleted -- "$@" | sort)
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

finish() {
    echo "================================================="
    if [ "$FAILED" = "1" ]; then
        echo -e "${RED}Lint FAILED${NC}"
        exit 1
    fi
    echo -e "${GREEN}Lint PASSED${NC}"
}

# Migrations changed, by git's --diff-filter letters: in the index for a staged run; in the working tree and every
# commit since the branch left LINT_BASE_REF, or since HEAD when that is unset, for a full run.
#
# A move that keeps a migration's file name and content is not a change, because Wrangler records a migration by its
# file name alone. So the diff covers the whole repo rather than just the migrations directory, which lets git pair an
# exact move (-M100%) instead of seeing a deletion and an addition, and such a move is dropped.
changed_migrations() {
    local diff base=HEAD
    if [ "$STAGED" = "1" ]; then
        diff=$(git diff --cached --name-status -M100% --diff-filter="$1")
    else
        if [ -n "${LINT_BASE_REF:-}" ]; then
            base=$(git merge-base "$LINT_BASE_REF" HEAD)
        fi
        diff=$(git diff "$base" --name-status -M100% --diff-filter="$1")
        if [ "$1" = "A" ]; then
            diff+=$'\n'$(git ls-files --others --exclude-standard | sed 's/^/A\t/')
        fi
    fi
    echo "$diff" |
        awk -F'\t' '$1 ~ /^R100/ { n = split($2, from, "/"); m = split($3, to, "/"); if (from[n] == to[m]) next } { print $NF }' |
        grep -E '^api/migrations/[^/]*\.sql$'
}

if [ "$STAGED" = "1" ]; then
    echo "Running lint checks on staged files"
elif [ "$DOCS" = "1" ]; then
    echo "Running lint checks on markdown"
else
    echo "Running lint checks"
fi
echo "================================================="

if [ "$DOCS" = "1" ]; then
    echo -n "Format: Prettier (Markdown)... "
    over_files prettier --check --log-level warn -- '*.md'
else
    echo -n "Format: Prettier (code, JSON, Markdown)... "
    over_files prettier --check --log-level warn --ignore-unknown -- ':(glob)**/*'
fi

echo -n "Lint: Markdown (markdownlint)... "
over_files markdownlint-cli2 --no-globs -- '*.md'

# Whole file either way, since a hand edit to a generated file has to be caught whatever else is staged.
echo -n "Docs: CLAUDE.md and AGENTS.md match docs/AGENTS.src.md... "
check node scripts/build-agent-instructions.ts --check

if [ "$DOCS" = "1" ]; then
    finish
    exit 0
fi

echo -n "Lint: ESLint (code, Svelte and JSON)... "
over_files eslint --max-warnings 0 --no-warn-ignored -- '*.ts' '*.mjs' '*.js' '*.svelte' '*.json' '*.jsonc'

echo -n "Lint: Stylelint (CSS and Svelte styles)... "
over_files stylelint --max-warnings 0 -- '*.css' '*.svelte'

# Wrangler records applied migrations by filename, so an edit to one never reaches a database that already has it, and
# a renamed one would run twice.
echo -n "Migrations: committed ones are unchanged... "
frozen=$(changed_migrations MDR)
# A reset starts the migrations over from one baseline, after every database has been emptied by hand. A new migration
# whose top says `-- resets: <reason>` lets the committed ones be deleted alongside it, and a new one that git pairs
# with a deleted one as a rename, because their content is the same, counts as deleted too; a committed migration
# still cannot be changed.
for migration in $(changed_migrations A); do
    if grep -qE '^--[[:space:]]*resets:[[:space:]]*[^[:space:]]' "$migration"; then
        frozen=$(comm -23 <(sort <<<"$frozen") <(changed_migrations DR | sort) | sed '/^$/d')
    fi
done
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

# The migrations are what a database gets and schema.ts is what the code's types promise, so a schema change without
# `npm run db:generate` compiles and passes tests against a database that lacks it. Generating into a copy of the
# migrations shows whether anything is missing without writing to the working tree. drizzle-kit exits 0 even when it
# fails, so only its all-clear messages count as a pass. Whole schema either way, like the migrations it is diffed with.
echo -n "Migrations: match api/src/db/schema.ts (drizzle-kit)... "
scratch=$(mktemp -d)
cp -R api/migrations "$scratch/migrations"
drift=$(
    cd "$scratch" &&
        drizzle-kit check --dialect sqlite --out migrations 2>&1 &&
        drizzle-kit generate --dialect sqlite --schema "$DIR/api/src/db/schema.ts" --out migrations </dev/null 2>&1
)
rm -rf "$scratch"
if grep -q "Everything's fine" <<<"$drift" && grep -q 'nothing to migrate' <<<"$drift"; then
    report 0
else
    report 1 "$drift
Run \`npm run db:generate --workspace api\` after changing the schema, and never edit a generated migration or snapshot."
fi

# Whole project either way: an unused export is a fact about the files that don't import it.
echo -n "Lint: unused files, exports and dependencies (knip)... "
check knip --no-progress

# api/.dev.vars holds real tokens, and one pasted into a file is public once pushed. A staged run scans what is about
# to be committed; a full run scans every commit, since a token in any of them is as public as one in the newest.
echo -n "Secrets: none committed (gitleaks)... "
if require gitleaks; then
    if [ "$STAGED" = "1" ]; then
        check gitleaks git --pre-commit --staged --no-banner --redact .
    else
        check gitleaks git --no-banner --redact .
    fi
fi

echo -n "Lint: GitHub Actions workflows (actionlint)... "
if require actionlint; then
    over_files actionlint -- '.github/workflows/*.yml'
fi

# A tag can be moved to different code after review; a commit id cannot. Dependabot moves the ids and keeps the version
# comment beside each one current. Actions in this repo (`./`) have no version. Covers the composite actions under
# .github/actions too, which actionlint does not read.
pinned_actions() {
    local unpinned
    unpinned=$(grep -nE '^[[:space:]]*(- )?uses:' "$@" |
        grep -vE 'uses:[[:space:]]*(\./|[^[:space:]@]+@[0-9a-f]{40}([[:space:]]|$))')
    if [ -n "$unpinned" ]; then
        echo "Pin each action to a full commit id, with the version as a comment, e.g. actions/checkout@<40 hex> # v7:"
        echo "$unpinned"
        return 1
    fi
}
echo -n "Workflows: actions pinned to a commit... "
over_files pinned_actions -- '.github/*.yml'

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

finish
