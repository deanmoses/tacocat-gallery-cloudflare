#!/usr/bin/env bash
# Releases the Worker to one environment without a moment in which readers can reach a version nothing has checked.
#
#   1. Build the web app and upload a version. It serves no traffic.
#   2. Note the database's Time Travel bookmark, then apply the migrations. They are additive by rule (see
#      scripts/lint.sh), so the version still serving should keep working on the new schema; it is checked, since a
#      migration that breaks it has broken the site already, and the run should say so rather than go on.
#   3. Put the new version in the deployment at 0% and check it on the live hostname through the version-override
#      header: the health route must answer with the id just uploaded and a migration no older than the tree's newest,
#      the root album's JSON must parse, the app shell must be the app, and the app's files must be the build just
#      uploaded. A miss ends the release with traffic untouched.
#   4. Switch the new version to 100%, check it again without the header, and roll back if that fails.
#
# The container's image is not part of this: `wrangler versions upload` never publishes one, so a change under
# api/transcoder/ ships with `npm run deploy --workspace api` (or deploy:production), which is also the only way to ship a
# change to a Durable Object class.
#
# The Deploy workflow (.github/workflows/deploy.yml) runs this on every push: staging for a pull request branch, both
# environments for main. By hand it runs from anywhere in the repo. Either way Wrangler needs the account: a login
# here, CLOUDFLARE_API_TOKEN in the workflow.
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

# The version is tagged with the commit and its message is the commit's subject, which is what the dashboard shows
# beside a deployment. A tree with uncommitted changes says so in the tag, since the commit alone would not reproduce it.
sha=$(git rev-parse HEAD)
short="${sha:0:7}"
subject=$(git log -1 --format=%s)
if [ -n "$(git status --porcelain)" ]; then
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
# version override that routes the request to one version of the deployment, whatever its share.
fetch() {
    local path="$1" header="${2:-}"
    local args=(--silent --show-error --max-time 30 --write-out '\n%{http_code}' "$origin$path")
    if [ -n "$header" ]; then
        args+=(--header "$header")
    fi
    curl "${args[@]}"
}

# `expect_version <version> [header] [build]` checks the health route, the root album and the app shell, retrying the
# health route for a minute while a fresh deployment propagates. Given a build, the app's version.json must be that
# build's, which is what shows the header reached the version's static assets and not only its Worker code. Returns 1
# once it gives up.
expect_version() {
    local version="$1" header="${2:-}" build="${3:-}"
    local attempt body status migration
    for attempt in $(seq 1 12); do
        body=$(fetch /api/health "$header")
        status="${body##*$'\n'}"
        body="${body%$'\n'*}"
        if [ "$status" = 200 ] && [ "$(json_field d.version <<<"$body")" = "$version" ]; then
            migration=$(json_field d.migration <<<"$body")
            echo "health: version $version, migration $migration"
            break
        fi
        if [ "$attempt" = 12 ]; then
            echo "health check did not reach version $version: last answer was $status $body" >&2
            return 1
        fi
        sleep 5
    done

    # Names start with a timestamp, so they sort by age. Staging can hold a newer migration from another branch.
    if [[ "$migration" < "$newest_migration" ]]; then
        echo "health check found migration $migration applied, older than the tree's newest, $newest_migration" >&2
        return 1
    fi

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

    if [ -n "$build" ]; then
        body=$(fetch /_app/version.json "$header")
        status="${body##*$'\n'}"
        body="${body%$'\n'*}"
        if [ "$status" != 200 ] || [ "$(json_field d.version <<<"$body")" != "$build" ]; then
            echo "app build check failed: expected build $build, got $status $body" >&2
            return 1
        fi
        echo "app build: $build"
    fi
}

step "Releasing $short to $1 ($worker)"
previous=$(wrangler deployments list --json | json_field 'd.at(-1)?.versions.find((v) => v.percentage === 100)?.version_id')
# Anything else, a split between two versions or no deployment at all, is a state this script did not leave and should
# not guess its way out of, and failing here is before anything has changed.
if ! [[ "$previous" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    echo "no single version serves 100% of $worker (found: $previous); deploy one by hand, then release again" >&2
    exit 1
fi
echo "serving now: $previous"

step "Building the web app"
npm run --silent build --workspace web
build=$(json_field d.version <web/build/_app/version.json)
newest_migration=$(basename "$(find api/migrations -maxdepth 1 -name '*.sql' | LC_ALL=C sort | tail -1)")

step "Uploading the version"
# The output holds the new version's id; shown as it comes, and kept to read the id out of.
upload=$(wrangler versions upload --tag "$short" --message "${subject:0:100}" 2>&1 | tee /dev/stderr)
new=$(grep 'Worker Version ID:' <<<"$upload" | awk '{ print $NF }')
if [ -z "$new" ]; then
    echo "could not find the uploaded version's id in Wrangler's output" >&2
    exit 1
fi
echo "uploaded: $new"

step "Applying migrations"
echo "bookmark before migrating, for wrangler d1 time-travel restore: $(wrangler d1 time-travel info DB --json | json_field d.bookmark)"
wrangler d1 migrations apply DB --remote

step "Checking that $previous still works on the migrated database"
if ! expect_version "$previous" "Cloudflare-Workers-Version-Overrides: $worker=\"$previous\""; then
    echo "$previous is still serving and failing its check: the migrations broke it" >&2
    exit 1
fi

step "Checking $new at 0% through the version override"
wrangler versions deploy "$previous@100%" "$new@0%" --yes --message "release $short: $new at 0% for its check"
if ! expect_version "$new" "Cloudflare-Workers-Version-Overrides: $worker=\"$new\"" "$build"; then
    echo "leaving $previous serving; $new stays uploaded" >&2
    wrangler versions deploy "$previous@100%" --yes --message "release $short failed its check; $previous alone again"
    exit 1
fi

step "Switching traffic to $new"
wrangler versions deploy "$new@100%" --yes --message "release $short"
# No build check here: until the switch has propagated, a request can still reach the previous version's files, and only
# the health route waits for it.
if ! expect_version "$new"; then
    echo "rolling back to $previous" >&2
    wrangler rollback "$previous" --yes --message "release $short failed its check after the switch"
    exit 1
fi

step "Released $short to $1"
echo "To undo: (cd api && npx wrangler rollback $previous ${env_flag[*]})"
