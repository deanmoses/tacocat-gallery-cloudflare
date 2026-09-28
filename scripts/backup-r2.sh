#!/usr/bin/env bash
# Copies production's buckets to storage outside Cloudflare, the way AWS Backup covered the S3 originals, so losing a
# bucket or the account loses nothing: the originals, and the nightly D1 dumps in the backups bucket with them.
#
# The target holds two trees per bucket, under the bucket's name. current/ mirrors the bucket. What a run deletes or
# replaces there goes to deleted/<date>/ instead of being dropped, and stays 35 days, as AWS Backup kept its
# snapshots; so a bug that empties a bucket empties its current/ that night, and the month under deleted/ is what it
# is restored from. A day's directory is dropped whole by its name's date: rclone keeps each file's own modification
# time when it moves it aside, so judging files by age would drop an original older than 35 days the night it was
# moved, which is the night it is needed. A run that fails leaves both trees as they were; rclone writes nothing
# partial.
#
# The sources and target are rclone paths. The workflow (.github/workflows/backup.yml) gives the sources through the
# RCLONE_CONFIG_R2_* variables and the target as one secret, an rclone connection string that names the provider and
# its credentials, so that the target can change without a change here. To restore: rclone copy the tree back.
#
# Usage: BACKUP_TARGET=<rclone path> scripts/backup-r2.sh <source>...
#   BACKUP_TARGET=':b2,account=...,key=...:tacocat-backup' scripts/backup-r2.sh r2:production-originals r2:production-backups
set -euo pipefail

target=${BACKUP_TARGET:?the rclone path to back up to}
if [ $# -eq 0 ]; then
    echo "Usage: BACKUP_TARGET=<rclone path> scripts/backup-r2.sh <source>..." >&2
    exit 2
fi
today=$(date -u +%Y-%m-%d)
# GNU date on the runner, BSD date on a Mac.
cutoff=$(date -u -d '35 days ago' +%Y-%m-%d 2>/dev/null || date -u -v-35d +%Y-%m-%d)

for source in "$@"; do
    # The bucket's name, after the remote's, so each bucket has its own trees on the target.
    bucket=${source##*:}
    echo "Backing up $source..."
    rclone sync "$source" "$target/$bucket/current" --backup-dir "$target/$bucket/deleted/$today" \
        --fast-list --transfers 16 --checkers 32 --stats-one-line --stats 5m
    if rclone lsd "$target/$bucket/deleted" >/dev/null 2>&1; then
        rclone lsf --dirs-only "$target/$bucket/deleted" | while read -r dated; do
            dated=${dated%/}
            if [[ "$dated" < "$cutoff" ]]; then
                echo "Dropping $bucket/deleted/$dated, moved aside more than 35 days ago..."
                rclone purge "$target/$bucket/deleted/$dated"
            fi
        done
    fi
    echo "Backed up: $(rclone size "$target/$bucket/current" | tr '\n' ' ')"
    echo "Held for restore: $(rclone size "$target/$bucket/deleted" 2>/dev/null | tr '\n' ' ')"
done
