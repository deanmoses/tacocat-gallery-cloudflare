#!/usr/bin/env bash
# Puts the R2 signing credentials where they are used, straight from OpenTofu's outputs, so no token value passes
# through a person. The tokens themselves are defined in infra/: one per environment that can read and write its
# uploads and derived buckets and nothing else, and one for the backup that can read production's originals and
# backups buckets and nothing else. Rotating one is `tofu apply -replace=<its address>` in infra/, then this again.
#
#   staging | production   the Worker's secrets, in one bulk upload: the environment's R2 pair from OpenTofu, and its
#                          SESSION_SECRET_<ENVIRONMENT> and DEBUGBEAR_API_KEY from api/.dev.vars. Wrangler creates a
#                          Worker that does not exist yet as a draft, so this can run before the first deploy.
#   backup                 the repository secrets the Backup workflow reads.
#   dev                    api/.dev.vars's R2 pair, set to staging's, for `wrangler dev`.
#
# Usage: scripts/secrets.sh (staging | production | backup | dev)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

target="${1:-}"
case "$target" in
staging | production | backup | dev) ;;
*)
    echo "Usage: scripts/secrets.sh (staging | production | backup | dev)" >&2
    exit 2
    ;;
esac

# `dev_var <name>` prints one value from api/.dev.vars, or fails naming it.
dev_var() {
    local value
    value=$(grep "^$1=" api/.dev.vars | head -1 | cut -d= -f2-)
    if [ -z "$value" ]; then
        echo "api/.dev.vars has no $1" >&2
        exit 1
    fi
    printf '%s' "$value"
}

# `credential <who> <field>` prints one field of OpenTofu's r2_credentials output, read with the OpenTofu token.
credential() {
    CLOUDFLARE_API_TOKEN=$(dev_var CLOUDFLARE_TERRAFORM_API_TOKEN) tofu -chdir=infra output -json r2_credentials |
        node -e "
            const [who, field] = process.argv.slice(1);
            const value = JSON.parse(require('fs').readFileSync(0, 'utf8'))[who]?.[field];
            if (!value) { console.error('no r2_credentials.' + who + '.' + field + ' in the OpenTofu outputs'); process.exit(1); }
            process.stdout.write(value);
        " "$1" "$2"
}

case "$target" in
staging | production)
    environment_upper=$(tr '[:lower:]' '[:upper:]' <<<"$target")
    if [ "$target" = staging ]; then
        # Staging is wrangler.jsonc's top level; an empty --env names it without Wrangler's warning that none was given.
        env_flag=(--env '')
    else
        env_flag=(--env "$target")
    fi
    # Wrangler reads the pairs from stdin; nothing is written to disk.
    node -e "
        const [id, secret, session, debugbear] = process.argv.slice(1);
        process.stdout.write(JSON.stringify({
            R2_ACCESS_KEY_ID: id,
            R2_SECRET_ACCESS_KEY: secret,
            SESSION_SECRET: session,
            DEBUGBEAR_API_KEY: debugbear,
        }));
    " "$(credential "$target" access_key_id)" "$(credential "$target" secret_access_key)" \
        "$(dev_var "SESSION_SECRET_$environment_upper")" "$(dev_var DEBUGBEAR_API_KEY)" |
        (cd api && npx wrangler secret bulk "${env_flag[@]}")
    ;;
backup)
    gh secret set R2_ACCESS_KEY_ID --body "$(credential backup access_key_id)"
    gh secret set R2_SECRET_ACCESS_KEY --body "$(credential backup secret_access_key)"
    echo "Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY on the repository."
    ;;
dev)
    id=$(credential staging access_key_id)
    secret=$(credential staging secret_access_key)
    # In place, keeping every other line: the pair is staging's, since wrangler dev runs the top-level config.
    node -e "
        const fs = require('fs');
        const [id, secret] = process.argv.slice(1);
        const lines = fs.readFileSync('api/.dev.vars', 'utf8').split('\n').map((line) =>
            line.startsWith('R2_ACCESS_KEY_ID=') ? 'R2_ACCESS_KEY_ID=' + id
            : line.startsWith('R2_SECRET_ACCESS_KEY=') ? 'R2_SECRET_ACCESS_KEY=' + secret
            : line);
        fs.writeFileSync('api/.dev.vars', lines.join('\n'));
    " "$id" "$secret"
    echo "Set api/.dev.vars's R2 pair to staging's."
    ;;
esac
