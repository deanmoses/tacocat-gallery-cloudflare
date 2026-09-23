#!/usr/bin/env bash
# The tests: the Worker's, run by the root Vitest inside workerd, and web/'s, run by web/'s own Vitest in a browser. CI
# and `npm test` run all of them; .husky/pre-commit runs this with --staged, which runs only the tests whose imports
# reach a staged file.
#
# Usage: scripts/test.sh [--staged]

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR" || exit 1
PATH="$DIR/node_modules/.bin:$PATH"

case "${1:-}" in
--staged) STAGED=1 ;;
'') STAGED=0 ;;
*)
    echo "Usage: scripts/test.sh [--staged]" >&2
    exit 2
    ;;
esac

# web/ has its own Vitest, a different major from the root's, so it runs from web/ with web/'s binary.
web_vitest() {
    (cd web && ./node_modules/.bin/vitest "$@")
}

if [ "$STAGED" = "0" ]; then
    worker_status=0
    vitest run || worker_status=$?
    web_status=0
    web_vitest run || web_status=$?
    [ "$worker_status" -eq 0 ] && [ "$web_status" -eq 0 ]
    exit
fi

staged=$(git diff --cached --name-only --diff-filter=ACMR)

# These change every test without being imported by any, so vitest's import graph cannot see them: the test setup,
# the Worker's bindings and migrations, dependencies, and compiler settings.
run_worker() {
    if echo "$staged" | grep -qE '^(vitest\.config\.ts|wrangler\.jsonc|worker-configuration\.d\.ts|package(-lock)?\.json|tsconfig[^/]*\.json|(src|test)/tsconfig\.json|migrations/|test/(setup|helpers|env\.d)\.ts|fixtures/)'; then
        echo "Staged changes affect every Worker test; running them all."
        vitest run
        return
    fi
    local code
    code=$(echo "$staged" | grep -E '^(src|test)/.*\.ts$' || true)
    if [ -z "$code" ]; then
        echo "No staged Worker code or tests; no Worker tests to run."
        return 0
    fi
    # shellcheck disable=SC2086 # word splitting is how the file list is passed
    vitest related --run --passWithNoTests $code
}

# The same for web/: its build and compiler config, dependencies and the root tsconfig it extends change every test.
run_web() {
    if echo "$staged" | grep -qE '^(package(-lock)?\.json|tsconfig\.base\.json|web/(package\.json|vite\.config\.ts|svelte\.config\.js|tsconfig\.json))$'; then
        echo "Staged changes affect every web test; running them all."
        web_vitest run
        return
    fi
    local code
    code=$(echo "$staged" | grep -E '^web/src/.*\.(ts|js|svelte)$' | sed 's|^web/||' || true)
    if [ -z "$code" ]; then
        echo "No staged web code or tests; no web tests to run."
        return 0
    fi
    # shellcheck disable=SC2086 # word splitting is how the file list is passed
    web_vitest related --run --passWithNoTests $code
}

worker_status=0
run_worker || worker_status=$?
web_status=0
run_web || web_status=$?
[ "$worker_status" -eq 0 ] && [ "$web_status" -eq 0 ]
