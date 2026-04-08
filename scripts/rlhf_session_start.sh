#!/usr/bin/env bash
# Best-effort Claude SessionStart hook that bootstraps ThumbGate/Codex support
# for repos under ~/workspace/git without surfacing noisy hook errors.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK_INPUT="$(cat 2>/dev/null || true)"
TARGET_DIR="${CLAUDE_PROJECT_DIR:-}"

if [ -z "${TARGET_DIR}" ] && [ -n "${HOOK_INPUT}" ]; then
  TARGET_DIR="$(printf '%s' "${HOOK_INPUT}" | /usr/bin/python3 -c 'import json,sys; raw=sys.stdin.read().strip(); print(json.loads(raw).get("cwd","")) if raw else print("")' 2>/dev/null || true)"
fi

if [ -z "${TARGET_DIR}" ]; then
  TARGET_DIR="${PWD:-}"
fi

if [ -z "${TARGET_DIR}" ]; then
  exit 0
fi

REPO_ROOT="$(git -C "${TARGET_DIR}" rev-parse --show-toplevel 2>/dev/null || true)"
WORKSPACE_ROOT="${HOME:-}/workspace/git"

case "${REPO_ROOT}" in
  "${WORKSPACE_ROOT}"/*) ;;
  *) exit 0 ;;
esac

node "${SCRIPT_DIR}/ensure-repo-bootstrap.js" "${REPO_ROOT}" >/dev/null 2>&1 || true
exit 0
