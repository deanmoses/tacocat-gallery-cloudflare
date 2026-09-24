#!/usr/bin/env bash
# Installs the system tools scripts/lint.sh needs, for a Linux amd64 CI runner: each a release binary pinned to the
# version Homebrew has locally and checked against the checksum published with the release, so a compromised upstream
# cannot put a different binary into the job that gates merges. shellcheck is already on GitHub's Ubuntu runners.
# Dependabot does not see these versions; when `brew upgrade` moves one, move it here too.
#
# Usage: scripts/install-lint-tools.sh [directory on PATH, default /usr/local/bin]

set -euo pipefail

ACTIONLINT_VERSION=1.7.12
ACTIONLINT_SHA256=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8
GITLEAKS_VERSION=8.30.1
GITLEAKS_SHA256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
HADOLINT_VERSION=2.15.1
HADOLINT_SHA256=c7187db94eeeeca956519a6af171adc31453941a1e777961f6e680f697c8c507
SHFMT_VERSION=3.14.1
SHFMT_SHA256=76e77641faa025814b77f153b29796b8e6fa2fca03e0c76a691608b86c7ea7bf
TOFU_VERSION=1.12.6
TOFU_SHA256=5dc43da4f750f33873dc25e94587128709e819e544b7be9016b255316153c3a8

BIN="${1:-/usr/local/bin}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

# fetch <url> <sha256> <file to save as>
fetch() {
    curl -fsSL --retry 3 -o "$3" "$1"
    echo "$2  $3" | sha256sum -c - >/dev/null
}

# place <file> <name on PATH>
place() {
    if [ -w "$BIN" ]; then
        install -m 755 "$1" "$BIN/$2"
    else
        sudo install -m 755 "$1" "$BIN/$2"
    fi
}

fetch "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz" \
    "$ACTIONLINT_SHA256" actionlint.tar.gz
tar -xzf actionlint.tar.gz actionlint
place actionlint actionlint

fetch "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
    "$GITLEAKS_SHA256" gitleaks.tar.gz
tar -xzf gitleaks.tar.gz gitleaks
place gitleaks gitleaks

fetch "https://github.com/hadolint/hadolint/releases/download/v${HADOLINT_VERSION}/hadolint-linux-x86_64" \
    "$HADOLINT_SHA256" hadolint
place hadolint hadolint

fetch "https://github.com/mvdan/sh/releases/download/v${SHFMT_VERSION}/shfmt_v${SHFMT_VERSION}_linux_amd64" \
    "$SHFMT_SHA256" shfmt
place shfmt shfmt

fetch "https://github.com/opentofu/opentofu/releases/download/v${TOFU_VERSION}/tofu_${TOFU_VERSION}_linux_amd64.zip" \
    "$TOFU_SHA256" tofu.zip
unzip -q tofu.zip tofu
place tofu tofu

for tool in actionlint gitleaks hadolint shellcheck shfmt tofu; do
    command -v "$tool" >/dev/null || {
        echo "$tool is not on PATH after installing" >&2
        exit 1
    }
done
# sed -n 1p rather than head -1: head exits after one line, and under pipefail a tool still writing its version then
# dies of SIGPIPE and fails the step, on some runs and not others.
actionlint --version | sed -n 1p
gitleaks version
hadolint --version
shellcheck --version | grep version:
shfmt --version
tofu version | sed -n 1p
