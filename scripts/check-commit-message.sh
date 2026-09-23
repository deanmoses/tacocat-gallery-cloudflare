#!/usr/bin/env bash
# Checks a commit message's subject against Conventional Commits, the format the /commit skill writes. .husky/commit-msg
# runs it on every commit; CI can run it on each commit or pull request title.
#
# Usage: scripts/check-commit-message.sh <file holding the message>

set -euo pipefail

if [ "$#" -ne 1 ]; then
    echo "Usage: scripts/check-commit-message.sh <file holding the message>" >&2
    exit 2
fi

# The first line that is not a `#` comment.
subject=$(sed -n '/^#/!{p;q;}' "$1")

# Subjects git writes itself.
case "$subject" in
'Merge '* | 'Revert '* | 'fixup! '* | 'squash! '* | 'amend! '*) exit 0 ;;
*) ;;
esac

if ! printf '%s\n' "$subject" | grep -qE '^(feat|fix|docs|style|refactor|test|chore)(\([a-z0-9-]+\))?!?: [^ ]'; then
    echo "Commit subject is not a Conventional Commit:" >&2
    echo "  $subject" >&2
    echo "Expected <type>(<scope>): <description>, with type one of feat, fix, docs, style, refactor, test, chore" >&2
    echo "and an optional lower-case scope, e.g. 'fix(d1): key the FTS index by rowid'." >&2
    exit 1
fi

if [ "${#subject}" -gt 72 ]; then
    echo "Commit subject is ${#subject} characters; keep it to 72:" >&2
    echo "  $subject" >&2
    exit 1
fi
