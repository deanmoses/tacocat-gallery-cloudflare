#!/usr/bin/env bash
# Mints a one-time, 7-day invite link that lets an admin create a passkey. Also how a locked-out admin gets back in.
# Usage: api/scripts/invite.sh <admin name> (--local | --env staging | --env production)
set -euo pipefail

# Wrangler finds the database through the wrangler.jsonc beside it.
cd "$(dirname "${BASH_SOURCE[0]}")/.."

usage() {
    echo "Usage: api/scripts/invite.sh <admin name> (--local | --env staging | --env production)" >&2
    exit 2
}

name="${1:-}"
[ -n "$name" ] || usage
[[ "$name" =~ ^[A-Za-z0-9\ ._-]+$ ]] || {
    echo "admin name may only contain letters, digits, spaces, . _ -" >&2
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
npx wrangler d1 execute DB "${where[@]}" --command \
    "INSERT INTO admin_invite (token_hash, admin_name, expires_at)
     VALUES ('$hash', '$name', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days'))" >/dev/null
echo "$base/invite/$token"
