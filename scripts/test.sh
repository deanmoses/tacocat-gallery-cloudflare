#!/usr/bin/env bash
# The tests of every workspace: shared/'s in Node and api/'s inside workerd, both on the Vitest 4 hoisted to the root,
# and web/'s in a browser on its own Vitest 5. Each runs from its own directory with the Vitest it resolves there. `npm
# test` runs all of them and then the e2e tests; CI runs the suites on separate runners; .husky/pre-commit runs this with
# --staged, which runs only the tests whose imports reach a staged file, and no e2e tests, since building and starting
# the site takes seconds.
#
# Usage: scripts/test.sh [--staged | <suite>...]   suites: shared api web e2e; all of them when none is named

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR" || exit 1

STAGED=0
SUITES="shared api web e2e"
case "${1:-}" in
--staged) STAGED=1 ;;
'') ;;
*)
    for suite in "$@"; do
        case "$suite" in
        shared | api | web | e2e) ;;
        *)
            echo "Usage: scripts/test.sh [--staged | <suite>...]   suites: shared api web e2e" >&2
            exit 2
            ;;
        esac
    done
    SUITES="$*"
    ;;
esac

# Runs Vitest in a workspace: `workspace_vitest <dir> <args>`.
workspace_vitest() {
    local workspace="$1"
    shift
    (cd "$workspace" && npm exec --no -- vitest "$@")
}

# Whether a suite was named: `runs <suite>`.
runs() {
    case " $SUITES " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
    esac
}

if [ "$STAGED" = "0" ]; then
    # The api stack tests and the e2e tests each start the site, which starts from the web app's build. Built once here,
    # and api/test/stack/start.ts sees the variable and leaves it alone, instead of each building the same thing again.
    if runs api || runs e2e; then
        if ! npm run --silent build --workspace web; then
            echo "building the web app failed" >&2
            exit 1
        fi
        export WEB_BUILD_READY=1
    fi
    status=0
    if runs shared; then workspace_vitest shared run || status=1; fi
    if runs api; then workspace_vitest api run || status=1; fi
    if runs web; then workspace_vitest web run || status=1; fi
    if runs e2e; then npm exec --no -- playwright test --config e2e/playwright.config.ts || status=1; fi
    exit "$status"
fi

staged=$(git diff --cached --name-only --diff-filter=ACMR)

# Runs a workspace's tests for what is staged: `run_staged <dir> <files that change every test> <code files>`, both
# extended regexes over repo-relative paths. The first set changes every test without being imported by any, so
# vitest's import graph cannot see it: test setup, bindings, migrations, dependencies and compiler settings.
run_staged() {
    local workspace="$1" everything="$2" code_pattern="$3"
    if echo "$staged" | grep -qE "$everything"; then
        echo "Staged changes affect every $workspace test; running them all."
        workspace_vitest "$workspace" run
        return
    fi
    local code
    code=$(echo "$staged" | grep -E "$code_pattern" | sed "s|^$workspace/||" || true)
    if [ -z "$code" ]; then
        echo "No staged $workspace code or tests; no $workspace tests to run."
        return 0
    fi
    # shellcheck disable=SC2086 # word splitting is how the file list is passed
    workspace_vitest "$workspace" related --run --passWithNoTests $code
}

# shared/ is imported through node_modules, where vitest's import graph does not follow it, so a change there runs
# every test.
SHARED='^(package-lock\.json|tsconfig\.base\.json|shared/src/.*\.ts)$'

shared_status=0
run_staged shared \
    "^(package-lock\.json|tsconfig\.base\.json)$|^shared/(package\.json|vitest\.config\.ts|tsconfig\.json)$" \
    '^shared/src/.*\.ts$' || shared_status=$?

api_status=0
run_staged api \
    "$SHARED|^api/(package\.json|vitest\.config\.ts|wrangler\.jsonc|worker-configuration\.d\.ts|tsconfig\.json|(src|test)/tsconfig\.json|migrations/|test/(setup|helpers|secrets|env\.d)\.ts|fixtures/)" \
    '^api/(src|test)/.*\.ts$' || api_status=$?
web_status=0
run_staged web \
    "$SHARED|^web/(package\.json|vite\.config\.ts|svelte\.config\.js|tsconfig\.json)$" \
    '^web/src/.*\.(ts|js|svelte)$' || web_status=$?
[ "$shared_status" -eq 0 ] && [ "$api_status" -eq 0 ] && [ "$web_status" -eq 0 ]
