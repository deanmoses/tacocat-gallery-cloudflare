#!/usr/bin/env bash
# The GitHub repository's settings, applied with the GitHub API so they live here rather than in a browser. Idempotent:
# run it once after creating the repository and again whenever a setting changes. Needs `gh auth login` as an admin of
# the repository.
#
# Usage: scripts/github-setup.sh [owner/repo, default the checkout's origin]

set -euo pipefail

REPO="${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
echo "Configuring $REPO"

# Secret scanning covers what push protection lets through and what was there before it was on; push protection
# rejects a push carrying a recognized token before it becomes public.
echo "Repository settings and secret scanning"
gh api --silent -X PATCH "repos/$REPO" --input - <<'JSON'
{
    "has_wiki": false,
    "has_projects": false,
    "delete_branch_on_merge": true,
    "allow_auto_merge": true,
    "allow_update_branch": true,
    "squash_merge_commit_title": "COMMIT_OR_PR_TITLE",
    "squash_merge_commit_message": "COMMIT_MESSAGES",
    "security_and_analysis": {
        "secret_scanning": { "status": "enabled" },
        "secret_scanning_push_protection": { "status": "enabled" }
    }
}
JSON

# Alerts for known-vulnerable dependencies, and pull requests that fix them without waiting for the weekly run.
echo "Dependabot alerts and security updates"
gh api --silent -X PUT "repos/$REPO/vulnerability-alerts"
gh api --silent -X PUT "repos/$REPO/automated-security-fixes"

# Every change reaches main through a pull request whose `merge-ok` check passed on a branch up to date with main. No
# approvals are required, since one person maintains this. Admins are held to it too, so the pull request is the only
# path, and no one can force-push or delete main.
echo "Branch protection on main"
gh api --silent -X PUT "repos/$REPO/branches/main/protection" --input - <<'JSON'
{
    "required_status_checks": {
        "strict": true,
        "checks": [{ "context": "merge-ok", "app_id": 15368 }]
    },
    "enforce_admins": true,
    "required_pull_request_reviews": { "required_approving_review_count": 0 },
    "restrictions": null,
    "required_linear_history": false,
    "allow_force_pushes": false,
    "allow_deletions": false,
    "required_conversation_resolution": true
}
JSON

# One Environment per Worker. The Deploy workflow's jobs run against them, which is what gives the repository its
# deployment history: the Environments panel and, on each pull request, when its commits reached staging and
# production. Production takes a deploy from a protected branch only, which is main.
echo "Environments"
gh api --silent -X PUT "repos/$REPO/environments/staging" --input - <<'JSON'
{ "deployment_branch_policy": null }
JSON
gh api --silent -X PUT "repos/$REPO/environments/production" --input - <<'JSON'
{ "deployment_branch_policy": { "protected_branches": true, "custom_branch_policies": false } }
JSON

# The labels the /pr skill applies, beyond GitHub's defaults.
echo "Labels"
gh label create refactor --repo "$REPO" --color 'fbca04' --description 'Production code changes that do not alter behavior' --force
gh label create test --repo "$REPO" --color '0e8a16' --description 'Changes to tests' --force

echo "Done"
