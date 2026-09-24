#!/usr/bin/env bash
# Releases the Worker to one environment without a moment in which readers can reach a version nothing has checked.
#
#   1. Build the web app and upload a version. It serves no traffic.
#   2. Note the database's Time Travel bookmark, then apply the migrations. They are additive by rule (see
#      scripts/lint.sh), so the version still serving keeps working on the new schema.
#   3. Put the new version in the deployment at 0% and check it on the live hostname through the version-override
#      header: the health route must answer with the id just uploaded, the root album's JSON must parse, and the app
#      shell must be the app. A miss ends the release with traffic untouched.
#   4. Switch the new version to 100%, check it again without the header, and roll back if that fails.
#
# The container's image is not part of this: `wrangler versions upload` never publishes one, so a change under
# api/transcoder/ ships with `npm run deploy --workspace api` (or deploy:production), which is also the only way to ship a
# change to a Durable Object class.
#
# Workers Builds runs this from the api/ root directory on every push (staging for a pull request branch, both
# environments for main); by hand it runs from anywhere in the repo. Both need Wrangler logged in to the account.
#
# Usage: scripts/release.sh (staging | production)

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

case "${1:-}" in
staging)
    # Staging is wrangler.jsonc's top level; an empty --env names it without Wrangler's warning that none was given.
    env_flag=(--env '')
    worker=tacocat-gallery-cloudflare-staging
    origin=https://staging-pix.deanmoses.com
    ;;
production)
    env_flag=(--env production)
    worker=tacocat-gallery-cloudflare
    origin=https://pix.deanmoses.com
    ;;
*)
    echo "Usage: scripts/release.sh (staging | production)" >&2
    exit 2
    ;;
esac

# Workers Builds names the commit it checked out; by hand it is whatever is checked out here, and a tree with
# uncommitted changes says so in the version's tag, since the commit alone would not reproduce it.
sha="${WORKERS_CI_COMMIT_SHA:-$(git rev-parse HEAD)}"
short="${sha:0:7}"
if [ -z "${WORKERS_CI_COMMIT_SHA:-}" ] && [ -n "$(git status --porcelain)" ]; then
    short="$short-dirty"
fi

wrangler() {
    (cd api && npx wrangler "$@" "${env_flag[@]}")
}

# `json_field <expression>` reads JSON on stdin and prints one value of it, with the parsed document as `d`.
json_field() {
    node -e "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); console.log($1)"
}

step() {
    echo
    echo "==> $*"
}

# `fetch <path> [header]` prints the status line and body of a GET on the live hostname. The header, when given, is the
# version override that routes the request to a version at 0%.
fetch() {
    local path="$1" header="${2:-}"
    local args=(--silent --show-error --max-time 30 --write-out '\n%{http_code}' "$origin$path")
    if [ -n "$header" ]; then
        args+=(--header "$header")
    fi
    curl "${args[@]}"
}

# `expect_version <version> [header]` checks the health route, the root album and the app shell, retrying for a minute
# while a fresh deployment propagates. Returns 1 once it gives up.
expect_version() {
    local version="$1" header="${2:-}"
    local attempt body status
    for attempt in $(seq 1 12); do
        body=$(fetch /api/health "$header")
        status="${body##*$'\n'}"
        body="${body%$'\n'*}"
        if [ "$status" = 200 ] && [ "$(json_field d.version <<<"$body")" = "$version" ]; then
            echo "health: version $version, migration $(json_field d.migration <<<"$body")"
            break
        fi
        if [ "$attempt" = 12 ]; then
            echo "health check did not reach version $version: last answer was $status $body" >&2
            return 1
        fi
        sleep 5
    done

    body=$(fetch /api/album/ "$header")
    status="${body##*$'\n'}"
    body="${body%$'\n'*}"
    if [ "$status" != 200 ] || [ "$(json_field d.itemType <<<"$body")" != album ]; then
        echo "root album check failed: $status $body" >&2
        return 1
    fi
    echo "root album: ok"

    body=$(fetch / "$header")
    status="${body##*$'\n'}"
    if [ "$status" != 200 ] || ! grep -q '<meta name="robots" content="noindex" />' <<<"$body"; then
        echo "app shell check failed: $status" >&2
        return 1
    fi
    echo "app shell: ok"
}

step "Releasing $short to $1 ($worker)"
previous=$(wrangler deployments list --json | json_field 'd.at(-1).versions.find((v) => v.percentage === 100).version_id')
echo "serving now: $previous"

step "Building the web app"
npm run --silent build --workspace web

step "Uploading the version"
# The output holds the new version's id; shown as it comes, and kept to read the id out of.
upload=$(wrangler versions upload --tag "$short" --message "release $sha" 2>&1 | tee /dev/stderr)
new=$(grep 'Worker Version ID:' <<<"$upload" | awk '{ print $NF }')
if [ -z "$new" ]; then
    echo "could not find the uploaded version's id in Wrangler's output" >&2
    exit 1
fi
echo "uploaded: $new"

step "Applying migrations"
echo "bookmark before migrating, for wrangler d1 time-travel restore: $(wrangler d1 time-travel info DB --json | json_field d.bookmark)"
wrangler d1 migrations apply DB --remote

step "Checking $new at 0% through the version override"
wrangler versions deploy "$previous@100%" "$new@0%" --yes --message "release $short: $new at 0% for its check"
if ! expect_version "$new" "Cloudflare-Workers-Version-Overrides: $worker=\"$new\""; then
    echo "leaving $previous serving; $new stays uploaded" >&2
    wrangler versions deploy "$previous@100%" --yes --message "release $short failed its check; $previous alone again"
    exit 1
fi

step "Switching traffic to $new"
wrangler versions deploy "$new@100%" --yes --message "release $short"
if ! expect_version "$new"; then
    echo "rolling back to $previous" >&2
    wrangler rollback "$previous" --yes --message "release $short failed its check after the switch"
    exit 1
fi

step "Released $short to $1"
echo "To undo: (cd api && npx wrangler rollback $previous ${env_flag[*]})"
