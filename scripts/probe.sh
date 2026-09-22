#!/usr/bin/env bash
# Times cold-ish and warm requests against a deployed prototype.
# Usage: scripts/probe.sh https://tacocat-gallery-cloudflare.<subdomain>.workers.dev [runs]
set -euo pipefail

base="${1:?base URL required}"
runs="${2:-5}"

probe() {
    local label="$1" url="$2"
    echo "== $label"
    for _ in $(seq "$runs"); do
        curl -s -o /dev/null -D - -w 'ttfb=%{time_starttransfer}s total=%{time_total}s\n' "$url" |
            grep -iE '^(x-worker-colo|server-timing)|ttfb=' | tr -d '\r' | paste -sd ' ' -
    done
}

probe 'edge floor' "$base/"
probe 'album via replica' "$base/api/album/2001/"
probe 'album via primary' "$base/api/album/2001/?consistency=primary"
probe 'search' "$base/api/search?q=marseille"
probe 'derived image (stored)' "$base/i/2024/06-15/FullMetadata.jpg/v1?size=200x200"
