#!/usr/bin/env bash
# Runs OpenTofu in infra/ with its credentials from api/.dev.vars: `scripts/tofu.sh plan`, `scripts/tofu.sh apply`,
# and so on. The one token, CLOUDFLARE_TERRAFORM_API_TOKEN, serves twice. The provider reads it as CLOUDFLARE_API_TOKEN,
# and the state's S3 backend reads it as an S3 key, which any API token is on R2: the access key is the token's id and
# the secret the SHA-256 of its value. The id comes from the token-verify route, the account's, since the token is an
# account token and the user route answers nothing for one. A backend block cannot read a variable, so the
# credentials go in through the environment. They are set for this one process only: Wrangler would take a
# CLOUDFLARE_API_TOKEN it found in the environment over the `tacocat` profile.
#
# Usage: scripts/tofu.sh <tofu arguments>
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

account_id=$(grep -o 'account_id *= *"[0-9a-f]*"' infra/main.tf | head -1 | cut -d'"' -f2)
token=$(grep '^CLOUDFLARE_TERRAFORM_API_TOKEN=' api/.dev.vars | head -1 | cut -d= -f2-)
if [ -z "$token" ]; then
    echo "api/.dev.vars has no CLOUDFLARE_TERRAFORM_API_TOKEN" >&2
    exit 1
fi

# The header reaches curl through a file descriptor, never as an argument, which `ps` shows.
token_id=$(curl -sS --fail-with-body -H @<(printf 'Authorization: Bearer %s' "$token") \
    "https://api.cloudflare.com/client/v4/accounts/$account_id/tokens/verify" |
    node -e "
        const body = JSON.parse(require('fs').readFileSync(0, 'utf8'));
        if (!body.success || !body.result?.id) { console.error('verifying the OpenTofu token failed:', JSON.stringify(body.errors)); process.exit(1); }
        process.stdout.write(body.result.id);
    ")
secret=$(printf '%s' "$token" | shasum -a 256 | cut -d' ' -f1)

CLOUDFLARE_API_TOKEN=$token AWS_ACCESS_KEY_ID=$token_id AWS_SECRET_ACCESS_KEY=$secret \
    exec tofu -chdir=infra "$@"
