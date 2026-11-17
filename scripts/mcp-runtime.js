'use strict';

// Paths and tunables shared by the shared MCP daemon (scripts/mcp-daemon.js)
// and the thin stdio shim (scripts/mcp-shim.js). Dependency-light on purpose:
// the shim loads this file, and its resident memory is the whole point.

const fs = require('fs');
const os = require('os');
const path = require('path');

const PKG_ROOT = path.join(__dirname, '..');
const MAX_SOCKET_PATH = 100; // sun_path is 104 bytes on macOS, 108 on Linux

function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version || '0';
  } catch {
    return '0';
  }
}

function resolveRunDir(env = process.env) {
  if (env.THUMBGATE_RUN_DIR) return env.THUMBGATE_RUN_DIR;
  const preferred = path.join(os.homedir(), '.thumbgate', 'run');
  if (preferred.length + 24 <= MAX_SOCKET_PATH) return preferred;
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'u';
  return path.join(os.tmpdir(), `thumbgate-run-${uid}`);
}

// FNV-1a, not crypto: requiring crypto costs the shim about 2 MB.
function fnv1a(text) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + text.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0').slice(0, 4);
}

// One daemon per package root and version: an upgrade starts a fresh daemon
// instead of attaching clients to a process running old code.
function daemonKey(env = process.env) {
  let root = PKG_ROOT;
  try { root = fs.realpathSync(PKG_ROOT); } catch { /* keep unresolved root */ }
  return fnv1a(`${root}\0${readVersion()}`);
}

function getRuntimePaths(env = process.env) {
  const dir = resolveRunDir(env);
  const key = daemonKey(env);
  return {
    dir,
    key,
    socket: path.join(dir, `serve-${key}.sock`),
    pidFile: path.join(dir, `serve-${key}.pid`),
    logFile: path.join(dir, `serve-${key}.log`),
  };
}

function ensureRunDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* best effort */ }
}

function numberFromEnv(name, fallback, env = process.env) {
  const value = Number(env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

module.exports = {
  PKG_ROOT,
  ensureRunDir,
  getRuntimePaths,
  numberFromEnv,
  resolveRunDir,
};
