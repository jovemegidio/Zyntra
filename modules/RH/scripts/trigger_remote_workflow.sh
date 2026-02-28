#!/usr/bin/env bash
# trigger_remote_workflow.sh
# Triggers the GitHub Actions workflow 'remote-migration.yml' with optional run_smoke input.
# Requires environment variables:
#   GITHUB_TOKEN - a token with repo/workflow dispatch permissions
#   GITHUB_OWNER - repo owner (user or org)
#   GITHUB_REPO  - repo name
# Optional:
#   RUN_SMOKE    - true/false (default: true)

set -euo pipefail

if [[ -z "${GITHUB_TOKEN:-}" || -z "${GITHUB_OWNER:-}" || -z "${GITHUB_REPO:-}" ]]; then
  echo "ERROR: set GITHUB_TOKEN, GITHUB_OWNER and GITHUB_REPO environment variables before running."
  exit 2
fi

RUN_SMOKE=${RUN_SMOKE:-true}

API_URL="https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/remote-migration.yml/dispatches"

echo "Triggering workflow remote-migration.yml on ${GITHUB_OWNER}/${GITHUB_REPO} (run_smoke=${RUN_SMOKE})"

curl -sS -X POST "$API_URL" \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github.v3+json" \
  -d '{"ref":"main","inputs": {"run_smoke": "'"$RUN_SMOKE"'"}}'

if [[ $? -eq 0 ]]; then
  echo "Workflow dispatched (check Actions tab)."
else
  echo "Failed to dispatch workflow." >&2
  exit 3
fi
