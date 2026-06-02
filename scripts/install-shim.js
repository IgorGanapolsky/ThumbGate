'use strict';

/**
 * install-shim.js — Install a stable shim at ~/.thumbgate/bin/thumbgate-hook
 *
 * The shim is a tiny shell script that resolves the cached ThumbGate runtime
 * first, so hook commands in settings.local.json stay stable across projects
 * and agent restarts.
 *
 * The shim checks for a cached runtime binary first (fast path), and falls
 * back to `npx --yes thumbgate@latest` (slow path, first-time self-install).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const SHIM_DIR = path.join(os.homedir(), '.thumbgate', 'bin');
const SHIM_PATH = path.join(SHIM_DIR, 'thumbgate-hook');
const RUNTIME_BIN = path.join(os.homedir(), '.thumbgate', 'runtime', 'node_modules', '.bin', 'thumbgate');

/**
 * The shim script. Key design choices:
 * - Uses `exec` to replace the shell process (no zombie processes)
 * - Fast path: if cached runtime binary exists, exec it directly
 * - Slow path: npx --yes thumbgate@latest (first-time auto-installs)
 * - No default self-mutation: background upgrades are opt-in via
 *   THUMBGATE_SHIM_AUTO_UPDATE=1 so source checkouts, enterprise pins, and
 *   dogfood runtimes cannot be overwritten by a hook side effect.
 */
function shimContent() {
  const escapedRuntimeBin = JSON.stringify(RUNTIME_BIN);
  const escapedRuntimeDir = JSON.stringify(path.join(os.homedir(), '.thumbgate', 'runtime'));

  return `#!/usr/bin/env bash
# ThumbGate hook shim — DO NOT EDIT
# Installed by: thumbgate init
# Purpose: stable hook entry point that runs the cached ThumbGate runtime
# Pattern: Volta-style stable shim (see https://volta.sh)

set -euo pipefail

RUNTIME_BIN=${escapedRuntimeBin}
RUNTIME_DIR=${escapedRuntimeDir}

# Fast path: cached runtime binary exists and is executable
if [ -x "$RUNTIME_BIN" ]; then
  # Optional background upgrade. Disabled by default so hooks never mutate a
  # source checkout, enterprise pin, or dogfood runtime behind the operator's back.
  if [ "\${THUMBGATE_SHIM_AUTO_UPDATE:-0}" = "1" ]; then
    ( nohup npm install --prefix "$RUNTIME_DIR" --no-save --omit=dev thumbgate@latest >/dev/null 2>&1 & ) 2>/dev/null || true
  fi
  exec "$RUNTIME_BIN" "$@"
fi

# Slow path: no cached binary — install + exec via npx
mkdir -p "$RUNTIME_DIR"
exec npx --yes --package thumbgate@latest -- thumbgate "$@"
`;
}

function installShim() {
  fs.mkdirSync(SHIM_DIR, { recursive: true });
  fs.writeFileSync(SHIM_PATH, shimContent(), { mode: 0o755 });
  return SHIM_PATH;
}

function shimInstalled() {
  try {
    return fs.existsSync(SHIM_PATH) && (fs.statSync(SHIM_PATH).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function shimPath() {
  return SHIM_PATH;
}

module.exports = {
  installShim,
  shimInstalled,
  shimPath,
  shimContent,
  SHIM_DIR,
  SHIM_PATH,
};
