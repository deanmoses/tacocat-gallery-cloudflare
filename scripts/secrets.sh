#!/usr/bin/env bash
# Puts the R2 signing credentials where they are used, straight from OpenTofu's outputs, so no token value passes
# through a person. The tokens themselves are defined in infra/: one per environment that can read and write its
# originals and derived buckets and nothing else, one for the backup that can read production's originals bucket and
# nothing else, one that can reach D1 and nothing else, and the AWS key that can reach the backup bucket and nothing
# else. Rotating one is `scripts/tofu.sh apply -replace=<its address>`, then this again.
#
#   staging | production   the Worker's secrets, in one bulk upload: the environment's R2 pair from OpenTofu, and its
#                          SESSION_SECRET_<ENVIRONMENT> from api/.dev.vars. Wrangler creates a Worker that does not
#                          exist yet as a draft, so this can run before the first deploy.
#   backup                 the repository secrets the Backup workflow reads: the R2 pair, the D1 token and the target.
#   dev                    api/.dev.vars's R2 pair, set to staging's, for `wrangler dev`.
#
# Every value is assigned to a variable before it is used: a `$(...)` inside an argument or a pipeline fails silently
# under `set -e`, and would send an empty secret; `gh secret set` takes an empty stdin as a value.
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

# Read once: each read verifies the token and fetches the state from R2. Handed on by printf, a builtin, rather
# than a here-string, which bash 3.2 backs with a temp file.
credentials=$(scripts/tofu.sh output -json r2_credentials)

# `credential <who> <field>` prints one field of OpenTofu's r2_credentials output.
credential() {
    printf '%s' "$credentials" |
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
    access_key_id=$(credential "$target" access_key_id)
    secret_access_key=$(credential "$target" secret_access_key)
    session_secret=$(dev_var "SESSION_SECRET_$environment_upper")
    # Through the environment and stdin, never as arguments, which `ps` shows; nothing is written to disk.
    R2_ACCESS_KEY_ID=$access_key_id R2_SECRET_ACCESS_KEY=$secret_access_key SESSION_SECRET=$session_secret node -e "
        const names = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'SESSION_SECRET'];
        process.stdout.write(JSON.stringify(Object.fromEntries(names.map((name) => [name, process.env[name]]))));
    " | (cd api && npx wrangler secret bulk "${env_flag[@]}")
    ;;
backup)
    id=$(credential backup access_key_id)
    secret=$(credential backup secret_access_key)
    target=$(scripts/tofu.sh output -raw backup_target)
    d1_token=$(scripts/tofu.sh output -raw d1_export_token)
    if [ -z "$target" ] || [ -z "$d1_token" ]; then
        echo "no backup_target or d1_export_token in the OpenTofu outputs" >&2
        exit 1
    fi
    printf '%s' "$id" | gh secret set R2_ACCESS_KEY_ID
    printf '%s' "$secret" | gh secret set R2_SECRET_ACCESS_KEY
    printf '%s' "$d1_token" | gh secret set D1_EXPORT_API_TOKEN
    printf '%s' "$target" | gh secret set BACKUP_TARGET
    echo "Set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, D1_EXPORT_API_TOKEN and BACKUP_TARGET on the repository."
    ;;
dev)
    id=$(credential staging access_key_id)
    secret=$(credential staging secret_access_key)
    # In place, keeping every other line: the pair is staging's, since wrangler dev runs the top-level config.
    R2_ACCESS_KEY_ID=$id R2_SECRET_ACCESS_KEY=$secret node -e "
        const fs = require('fs');
        const lines = fs.readFileSync('api/.dev.vars', 'utf8').split('\n').map((line) =>
            line.startsWith('R2_ACCESS_KEY_ID=') ? 'R2_ACCESS_KEY_ID=' + process.env.R2_ACCESS_KEY_ID
            : line.startsWith('R2_SECRET_ACCESS_KEY=') ? 'R2_SECRET_ACCESS_KEY=' + process.env.R2_SECRET_ACCESS_KEY
            : line);
        fs.writeFileSync('api/.dev.vars', lines.join('\n'));
    "
    echo "Set api/.dev.vars's R2 pair to staging's."
    ;;
esac
