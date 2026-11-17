'use strict';

// The original one-process-per-client MCP server. `thumbgate serve` uses it
// when THUMBGATE_SERVE_MODE=standalone, and as the fallback when the shared
// daemon cannot be reached or started.

const path = require('path');

function runStandalone() {
  try {
    const { repairCodexHooks } = require(path.join(__dirname, 'codex-self-heal'));
    repairCodexHooks();
  } catch (_) { /* self-heal is best-effort */ }
  const { startStdioServer } = require(path.join(__dirname, '..', 'adapters', 'mcp', 'server-stdio.js'));
  startStdioServer();
  try {
    const { watch } = require(path.join(__dirname, 'jsonl-watcher'));
    watch();
  } catch (_) { /* watcher is non-critical */ }
}

module.exports = { runStandalone };
