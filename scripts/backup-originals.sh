#!/usr/bin/env bash
# Copies the production media bucket to storage outside Cloudflare, the way AWS Backup covered the S3 originals, so
# losing the bucket or the account loses nothing: the originals, and the nightly D1 dump under backups/d1/ with them.
#
# The target holds two trees. current/ mirrors the bucket. What a run deletes or replaces there goes to
# deleted/<date>/ instead of being dropped, and stays 35 days, as AWS Backup kept its snapshots; so a bug that
# empties the bucket empties current/ that night, and the month under deleted/ is what it is restored from. A run
# that fails leaves both trees as they were; rclone writes nothing partial.
#
# The source and target are rclone paths. The workflow (.github/workflows/backup.yml) gives the source through the
# RCLONE_CONFIG_R2_* variables and the target as one secret, an rclone connection string that names the provider and
# its credentials, so that the target can change without a change here. To restore: rclone copy the tree back.
#
# Usage: BACKUP_TARGET=<rclone path> scripts/backup-originals.sh [<source>]
#   BACKUP_TARGET=':b2,account=...,key=...:tacocat-backup' scripts/backup-originals.sh r2:tacocat-proto-media
set -euo pipefail

source=${1:-r2:tacocat-proto-media}
target=${BACKUP_TARGET:?the rclone path to back up to}
today=$(date -u +%Y-%m-%d)

echo "Backing up $source..."
rclone sync "$source" "$target/current" --backup-dir "$target/deleted/$today" \
    --fast-list --transfers 16 --checkers 32 --stats-one-line --stats 5m
if rclone lsd "$target/deleted" >/dev/null 2>&1; then
    echo "Dropping what was deleted or replaced more than 35 days ago..."
    rclone delete "$target/deleted" --min-age 35d
    rclone rmdirs "$target/deleted" --leave-root
fi
echo "Backed up: $(rclone size "$target/current" | tr '\n' ' ')"
echo "Held for restore: $(rclone size "$target/deleted" 2>/dev/null | tr '\n' ' ')"
