#!/usr/bin/env bash
# Pre-action gate check — runs before risky shell commands.
# Called by hooks/hooks.json beforeShellExecution hook.
# Performs a quick health check via mcp-memory-gateway doctor.

set -euo pipefail

npx -y mcp-memory-gateway@latest doctor 2>/dev/null || {
  echo "[gate-check] mcp-memory-gateway doctor returned non-zero — review before proceeding." >&2
  exit 1
}
