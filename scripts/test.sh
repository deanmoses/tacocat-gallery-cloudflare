#!/usr/bin/env bash
# The tests. CI and `npm test` run all of them; .husky/pre-commit runs this with --staged, which runs only the tests
# whose imports reach a staged file.
#
# Usage: scripts/test.sh [--staged]

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR" || exit 1
PATH="$DIR/node_modules/.bin:$PATH"

case "${1:-}" in
--staged) ;;
'') exec vitest run ;;
*)
    echo "Usage: scripts/test.sh [--staged]" >&2
    exit 2
    ;;
esac

staged=$(git diff --cached --name-only --diff-filter=ACMR)

# These change every test without being imported by any, so vitest's import graph cannot see them: the test setup,
# the Worker's bindings and migrations, dependencies, and compiler settings.
if echo "$staged" | grep -qE '^(vitest\.config\.ts|wrangler\.jsonc|worker-configuration\.d\.ts|package(-lock)?\.json|tsconfig[^/]*\.json|(src|test)/tsconfig\.json|migrations/|test/(setup|helpers|env\.d)\.ts|fixtures/)'; then
    echo "Staged changes affect every test; running them all."
    exec vitest run
fi

code=$(echo "$staged" | grep -E '^(src|test)/.*\.ts$' || true)
if [ -z "$code" ]; then
    echo "No staged Worker code or tests; no tests to run."
    exit 0
fi
# shellcheck disable=SC2086 # word splitting is how the file list is passed
exec vitest related --run --passWithNoTests $code
