#!/usr/bin/env bash
# Pre-action gate check — runs before risky shell commands.
# Called by hooks/hooks.json beforeShellExecution hook.
# Performs a quick health check via thumbgate doctor.

set -euo pipefail

npx -y thumbgate@latest doctor 2>/dev/null || {
  echo "[gate-check] thumbgate doctor returned non-zero — review before proceeding." >&2
  exit 1
}
