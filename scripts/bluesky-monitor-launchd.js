#!/usr/bin/env node
'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseEnvFallback } = require('./social-analytics/load-env');

const DEFAULT_LABEL = 'com.thumbgate.bluesky-monitor';
const DEFAULT_INTERVAL_MINUTES = 15;
const DEFAULT_REPO_DIR = path.resolve(__dirname, '..');
const LAUNCHCTL = '/bin/launchctl';
const LAUNCHCTL_ENV = Object.freeze({
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
});

function escapePlistString(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildBlueskyMonitorPlist(options = {}) {
  const label = options.label || DEFAULT_LABEL;
  const repoDir = path.resolve(options.repoDir || DEFAULT_REPO_DIR);
  const intervalMinutes = Number(options.intervalMinutes || DEFAULT_INTERVAL_MINUTES);
  const intervalSeconds = Math.max(1, intervalMinutes) * 60;
  const scriptPath = options.scriptPath || path.join(repoDir, 'scripts', 'bluesky-monitor-cron.sh');
  const logDir = options.logDir || path.join(repoDir, '.thumbgate');
  const publishApproved = options.publishApproved ? 'true' : 'false';
  const nodeBin = options.nodeBin || process.execPath;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapePlistString(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${escapePlistString(scriptPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapePlistString(repoDir)}</string>
  <key>StartInterval</key>
  <integer>${intervalSeconds}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapePlistString(path.join(logDir, 'bluesky-monitor-launchd.stdout.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${escapePlistString(path.join(logDir, 'bluesky-monitor-launchd.stderr.log'))}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${escapePlistString(os.homedir())}</string>
    <key>THUMBGATE_REPO_DIR</key>
    <string>${escapePlistString(repoDir)}</string>
    <key>THUMBGATE_BLUESKY_PUBLISH_APPROVED</key>
    <string>${escapePlistString(publishApproved)}</string>
    <key>NODE_BIN</key>
    <string>${escapePlistString(nodeBin)}</string>
  </dict>
</dict>
</plist>
`;
}

function plistPathForLabel(label = DEFAULT_LABEL) {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
}

function loadEnvSnapshot({ repoDir = DEFAULT_REPO_DIR, env = process.env } = {}) {
  const snapshot = { ...env };
  const envPath = path.join(path.resolve(repoDir), '.env');
  try {
    if (!fs.existsSync(envPath)) return snapshot;
    const parsed = parseEnvFallback(fs.readFileSync(envPath, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (snapshot[key] === undefined) snapshot[key] = value;
    }
  } catch {
    // Status must be diagnostic-only; never fail just because .env is unreadable.
  }
  return snapshot;
}

function countJsonlRows(filePath, predicate = () => true) {
  try {
    if (!fs.existsSync(filePath)) return 0;
    return fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter(predicate).length;
  } catch {
    return 0;
  }
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readLastNonEmptyLine(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const lines = fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.length ? lines[lines.length - 1] : null;
  } catch {
    return null;
  }
}

function buildBlueskyMonitorStatus(options = {}) {
  const label = options.label || DEFAULT_LABEL;
  const repoDir = path.resolve(options.repoDir || DEFAULT_REPO_DIR);
  const plistPath = options.plistPath || plistPathForLabel(label);
  const draftPath = options.draftPath || path.join(repoDir, '.thumbgate', 'reply-drafts.jsonl');
  const statePath = options.statePath || path.join(repoDir, '.thumbgate', 'reply-monitor-state.json');
  const logPath = options.logPath || path.join(repoDir, '.thumbgate', 'bluesky-monitor.log');
  const snapshot = loadEnvSnapshot({ repoDir, env: options.env || process.env });
  const state = readJsonFile(statePath) || {};
  const hasHandle = Boolean(String(snapshot.BLUESKY_HANDLE || '').trim());
  const hasAppPassword = Boolean(String(snapshot.BLUESKY_APP_PASSWORD || '').trim());

  return {
    label,
    plistPath,
    installed: fs.existsSync(plistPath),
    intervalMinutes: Number(options.intervalMinutes || DEFAULT_INTERVAL_MINUTES),
    credentials: {
      BLUESKY_HANDLE: hasHandle,
      BLUESKY_APP_PASSWORD: hasAppPassword,
    },
    canMonitor: hasHandle && hasAppPassword,
    drafts: {
      path: draftPath,
      exists: fs.existsSync(draftPath),
      blueskyCount: countJsonlRows(draftPath, (row) => row.platform === 'bluesky'),
      approvedUnpostedCount: countJsonlRows(
        draftPath,
        (row) => row.platform === 'bluesky' && row.approved === true && !row.postedUri
      ),
    },
    state: {
      path: statePath,
      exists: fs.existsSync(statePath),
      lastCheck: state.lastCheck?.bluesky || null,
    },
    log: {
      path: logPath,
      exists: fs.existsSync(logPath),
      lastLine: readLastNonEmptyLine(logPath),
    },
  };
}

function runLaunchctl(args, stdio) {
  return cp.execFileSync(LAUNCHCTL, args, { env: LAUNCHCTL_ENV, stdio });
}

function loadLaunchAgent(plistPath) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (uid !== null) {
    try {
      runLaunchctl(['bootout', `gui/${uid}`, plistPath], 'ignore');
    } catch {
      // Ignore if the agent was not loaded yet.
    }
    runLaunchctl(['bootstrap', `gui/${uid}`, plistPath], 'pipe');
    runLaunchctl(['enable', `gui/${uid}/${path.basename(plistPath, '.plist')}`], 'pipe');
    return;
  }

  try {
    runLaunchctl(['unload', plistPath], 'ignore');
  } catch {
    // Ignore if the agent was not loaded yet.
  }
  runLaunchctl(['load', '-w', plistPath], 'pipe');
}

function installBlueskyMonitorLaunchAgent(options = {}) {
  const label = options.label || DEFAULT_LABEL;
  const repoDir = path.resolve(options.repoDir || DEFAULT_REPO_DIR);
  const plistPath = options.plistPath || plistPathForLabel(label);
  const plist = buildBlueskyMonitorPlist({ ...options, label, repoDir });

  if (options.dryRun) return { ok: true, plistPath, plist, installed: false };

  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  fs.mkdirSync(path.join(repoDir, '.thumbgate'), { recursive: true });
  fs.writeFileSync(plistPath, plist, 'utf8');
  loadLaunchAgent(plistPath);
  return { ok: true, plistPath, plist, installed: true };
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const option = token.slice(2);
    const equalsIndex = option.indexOf('=');
    if (equalsIndex >= 0) {
      args[option.slice(0, equalsIndex)] = option.slice(equalsIndex + 1);
    } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      args[option] = argv[index + 1];
      index += 1;
    } else {
      args[option] = true;
    }
  }
  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0] || 'install';
  const options = {
    dryRun: Boolean(args['dry-run']),
    intervalMinutes: args.interval ? Number(args.interval) : DEFAULT_INTERVAL_MINUTES,
    label: args.label || DEFAULT_LABEL,
    publishApproved: Boolean(args['publish-approved']),
    repoDir: args.repo || DEFAULT_REPO_DIR,
  };

  if (command === 'install') {
    const result = installBlueskyMonitorLaunchAgent(options);
    if (options.dryRun) {
      process.stdout.write(result.plist);
      return result;
    }
    console.log(`Bluesky monitor LaunchAgent installed: ${result.plistPath}`);
    return result;
  }

  if (command === 'status') {
    const status = buildBlueskyMonitorStatus(options);
    console.log(JSON.stringify(status, null, 2));
    return status;
  }

  throw new Error(`Unknown command: ${command}`);
}

function isCliInvocation(argv = process.argv) {
  const invokedPath = argv[1];
  return invokedPath ? path.resolve(invokedPath) === __filename : false;
}

if (isCliInvocation()) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_INTERVAL_MINUTES,
  DEFAULT_LABEL,
  LAUNCHCTL_ENV,
  buildBlueskyMonitorPlist,
  buildBlueskyMonitorStatus,
  countJsonlRows,
  escapePlistString,
  installBlueskyMonitorLaunchAgent,
  isCliInvocation,
  loadEnvSnapshot,
  loadLaunchAgent,
  parseArgs,
  plistPathForLabel,
  runLaunchctl,
};
