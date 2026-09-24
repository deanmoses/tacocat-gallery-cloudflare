#!/usr/bin/env bash
# Mints a one-time, 7-day invite link that lets a user create a passkey. Also how a locked-out user gets back in.
# Only a name in the user table can be invited; a new user is a migration, as api/migrations/*_seed_users.sql is.
# Usage: api/scripts/invite.sh <user name> (--local | --env staging | --env production)
set -euo pipefail

# Wrangler finds the database through the wrangler.jsonc beside it.
cd "$(dirname "${BASH_SOURCE[0]}")/.."

usage() {
    echo "Usage: api/scripts/invite.sh <user name> (--local | --env staging | --env production)" >&2
    exit 2
}

name="${1:-}"
[ -n "$name" ] || usage
[[ "$name" =~ ^[A-Za-z0-9\ ._-]+$ ]] || {
    echo "user name may only contain letters, digits, spaces, . _ -" >&2
    exit 1
}

# Staging is wrangler.jsonc's top-level environment, so it is the one Wrangler gets without --env.
case "${2:-} ${3:-}" in
'--local ')
    where=(--local)
    base=http://localhost:8787
    ;;
'--env staging')
    where=(--remote)
    base=https://staging-pix.deanmoses.com
    ;;
'--env production')
    where=(--remote --env production)
    base=https://pix.deanmoses.com
    ;;
*) usage ;;
esac

token=$(openssl rand -hex 32)
hash=$(printf '%s' "$token" | shasum -a 256 | cut -d' ' -f1)
# The invite table's foreign key refuses a name that is not a user. Wrangler prints its errors on stdout or stderr
# depending on the environment, so both are kept for the message.
if ! output=$(npx wrangler d1 execute DB "${where[@]}" --command \
    "INSERT INTO invite (token_hash, username, expires_at)
     VALUES ('$hash', '$name', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days'))" 2>&1); then
    if [[ "$output" == *"FOREIGN KEY constraint failed"* ]]; then
        echo "no user named '$name'; a user is added by a migration, see api/migrations/*_seed_users.sql" >&2
    else
        echo "$output" >&2
    fi
    exit 1
fi
echo "$base/invite/$token"
