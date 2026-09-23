#!/usr/bin/env bash
# The tests of every workspace: shared/'s in Node and api/'s inside workerd, both on the Vitest 4 hoisted to the root,
# and web/'s in a browser on its own Vitest 5. Each runs from its own directory with the Vitest it resolves there. CI and
# `npm test` run all of them and then the e2e tests; .husky/pre-commit runs this with --staged, which runs only the
# tests whose imports reach a staged file, and no e2e tests, since building and starting the site takes seconds.
#
# Usage: scripts/test.sh [--staged]

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR" || exit 1

case "${1:-}" in
--staged) STAGED=1 ;;
'') STAGED=0 ;;
*)
    echo "Usage: scripts/test.sh [--staged]" >&2
    exit 2
    ;;
esac

# Runs Vitest in a workspace: `workspace_vitest <dir> <args>`.
workspace_vitest() {
    local workspace="$1"
    shift
    (cd "$workspace" && npm exec --no -- vitest "$@")
}

if [ "$STAGED" = "0" ]; then
    shared_status=0
    workspace_vitest shared run || shared_status=$?
    api_status=0
    workspace_vitest api run || api_status=$?
    web_status=0
    workspace_vitest web run || web_status=$?
    e2e_status=0
    npm exec --no -- playwright test --config e2e/playwright.config.ts || e2e_status=$?
    [ "$shared_status" -eq 0 ] && [ "$api_status" -eq 0 ] && [ "$web_status" -eq 0 ] && [ "$e2e_status" -eq 0 ]
    exit
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
