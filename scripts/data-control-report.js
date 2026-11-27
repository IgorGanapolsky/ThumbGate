#!/usr/bin/env node
'use strict';

/**
 * data-control-report.js — `npx thumbgate control`.
 *
 * Read-only answer to "what does ThumbGate keep, where, and what does it send?":
 *   - the local stores (feedback log, lessons, prevention rules, learned gates) with file sizes,
 *   - the anonymous usage ping: on or off, where it goes, the exact fields it carries, the off switch,
 *   - whether a hosted API key is set,
 *   - how to export or delete your data.
 *
 * It never writes a file and never opens a socket, so running it does not create an install id
 * or send a ping. Buyers in the 2026 AI infrastructure survey (Crusoe/MetaLab) ranked control and
 * transparency next to performance; this is the one-command view of both for ThumbGate.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Keys of the JSON body scripts/cli-telemetry.js buildPayload() posts, before per-event metadata.
// tests/data-control-report.test.js fails if this list and buildPayload drift apart.
const USAGE_PING_FIELDS = Object.freeze([
  'eventType', 'installId', 'sessionId', 'visitorType', 'clientType', 'platform',
  'arch', 'nodeVersion', 'pkgVersion', 'timestamp',
]);
const USAGE_PING_OPTIONAL_FIELDS = Object.freeze(['source', 'utmSource']);
const DEFAULT_PING_HOST = 'https://thumbgate-production.up.railway.app';
const OFF_SWITCH = 'THUMBGATE_NO_TELEMETRY=1 (or DO_NOT_TRACK=1)';
const MAX_LISTED_FILES = 12;

function homeDir(env) {
  return env.HOME || env.USERPROFILE || os.homedir() || '';
}

function describeDir(label, dirPath) {
  const entry = { label, path: dirPath, exists: false, files: [], fileCount: 0, totalBytes: 0 };
  let names = [];
  try {
    if (!fs.statSync(dirPath).isDirectory()) return entry;
    entry.exists = true;
    names = fs.readdirSync(dirPath);
  } catch (_) {
    return entry;
  }
  for (const name of names.sort()) {
    try {
      const stat = fs.statSync(path.join(dirPath, name));
      if (!stat.isFile()) continue;
      entry.fileCount += 1;
      entry.totalBytes += stat.size;
      entry.files.push({ name, bytes: stat.size });
    } catch (_) { /* unreadable entry: skip */ }
  }
  entry.files.sort((a, b) => b.bytes - a.bytes);
  entry.files = entry.files.slice(0, MAX_LISTED_FILES);
  return entry;
}

function buildControlReport(options = {}) {
  const env = options.env || process.env;
  const home = homeDir(env);
  const paths = require('./feedback-paths');
  const pathOptions = { env, cwd: options.cwd };

  let activeDir = options.dataDir || null;
  if (!activeDir) {
    try { activeDir = paths.resolveFeedbackDir(pathOptions); } catch (_) { activeDir = null; }
  }
  let otherDirs = [];
  if (!options.dataDir) {
    try { otherDirs = paths.listFallbackFeedbackDirs(pathOptions); } catch (_) { otherDirs = []; }
  }

  const stores = [];
  if (activeDir) stores.push(describeDir('Active project store (lessons, rules, feedback log)', activeDir));
  for (const dir of otherDirs) {
    const described = describeDir('Older store this project can still read', dir);
    if (described.exists) stores.push(described);
  }
  const machineDir = path.join(home, '.thumbgate');
  stores.push(describeDir('Machine-wide files (install id, install source, settings)', machineDir));

  const pingOff = env.THUMBGATE_NO_TELEMETRY === '1' || env.DO_NOT_TRACK === '1';
  const pingHost = (() => {
    try { return new URL(env.THUMBGATE_API_URL || DEFAULT_PING_HOST).host; } catch (_) { return 'invalid THUMBGATE_API_URL'; }
  })();
  const installIdPath = path.join(machineDir, 'install-id');

  return {
    generatedAt: new Date().toISOString(),
    stores,
    usagePing: {
      enabled: !pingOff,
      host: pingHost,
      fields: [...USAGE_PING_FIELDS],
      optionalFields: [...USAGE_PING_OPTIONAL_FIELDS],
      installIdPath,
      installIdExists: fs.existsSync(installIdPath),
      offSwitch: OFF_SWITCH,
      eventMetadata: 'Each event can add a few fields of its own, such as the ThumbGate subcommand name or the id of a built-in gate. The full body is built in scripts/cli-telemetry.js.',
    },
    hostedKeySet: Boolean(String(env.THUMBGATE_API_KEY || '').trim()),
    actions: {
      inventory: 'npx thumbgate inventory',
      exportDpo: 'npx thumbgate export-dpo',
      remove: activeDir || null,
    },
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderControlReportText(report) {
  const lines = ['ThumbGate control report (read-only; nothing was written or sent)', ''];
  lines.push('Where your data lives');
  for (const store of report.stores) {
    if (!store.exists) {
      lines.push(`  ${store.label}`, `    ${store.path}  (not created yet)`);
      continue;
    }
    lines.push(`  ${store.label}`, `    ${store.path}  ${store.fileCount} files, ${formatBytes(store.totalBytes)}`);
    for (const file of store.files) lines.push(`      ${file.name.padEnd(34)} ${formatBytes(file.bytes)}`);
  }
  const ping = report.usagePing;
  lines.push('', 'What leaves your machine');
  lines.push(`  Usage ping: ${ping.enabled ? 'ON' : 'OFF'}${ping.enabled ? ` -> ${ping.host}` : ''}`);
  lines.push(`    Fields: ${ping.fields.join(', ')} (+ ${ping.optionalFields.join(', ')} if you set an install source)`);
  lines.push(`    ${ping.eventMetadata}`);
  lines.push(`    Anonymous install id: ${ping.installIdPath}${ping.installIdExists ? '' : ' (not created yet)'}`);
  if (ping.enabled) lines.push('    Turn it off:  export THUMBGATE_NO_TELEMETRY=1', '    DO_NOT_TRACK=1 works too.');
  lines.push(`  Hosted API key (THUMBGATE_API_KEY): ${report.hostedKeySet ? 'set; commands that use the hosted API will call it' : 'not set'}`);
  lines.push('', 'Take it with you');
  lines.push(`  See what agents did:  ${report.actions.inventory}`);
  lines.push(`  Export your pairs:    ${report.actions.exportDpo} (Pro)`);
  if (report.actions.remove) lines.push(`  Delete this project's store: remove the folder ${report.actions.remove}`);
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  USAGE_PING_FIELDS,
  USAGE_PING_OPTIONAL_FIELDS,
  OFF_SWITCH,
  buildControlReport,
  renderControlReportText,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const report = buildControlReport();
  process.stdout.write(args.includes('--json') ? `${JSON.stringify(report, null, 2)}\n` : renderControlReportText(report));
}
