#!/usr/bin/env bash
# Mints a one-time, 7-day invite link that lets an admin create a passkey. Also how a locked-out admin gets back in.
# Usage: scripts/invite.sh <admin name> [--local]
set -euo pipefail

name="${1:?admin name required}"
[[ "$name" =~ ^[A-Za-z0-9\ ._-]+$ ]] || {
    echo "admin name may only contain letters, digits, spaces, . _ -" >&2
    exit 1
}

if [[ "${2:-}" == "--local" ]]; then
    where=--local
    base=http://localhost:8787
else
    where=--remote
    base=https://pix.deanmoses.com
fi

token=$(openssl rand -hex 32)
hash=$(printf '%s' "$token" | shasum -a 256 | cut -d' ' -f1)
npx wrangler d1 execute tacocat-proto "$where" --command \
    "INSERT INTO admin_invite (token_hash, admin_name, expires_at)
     VALUES ('$hash', '$name', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days'))" >/dev/null
echo "$base/invite/$token"
