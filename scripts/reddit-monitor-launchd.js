#!/usr/bin/env node
'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_LABEL = 'com.thumbgate.reddit-monitor';
const DEFAULT_INTERVAL_MINUTES = 15;
const DEFAULT_TRACKED_THREADS = 'https://www.reddit.com/r/ClaudeCode/comments/1szi5qp/';
const DEFAULT_REPO_DIR = path.resolve(__dirname, '..');
const LAUNCHCTL = '/bin/launchctl';

function escapePlistString(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildRedditMonitorPlist(options = {}) {
  const label = options.label || DEFAULT_LABEL;
  const repoDir = path.resolve(options.repoDir || DEFAULT_REPO_DIR);
  const intervalMinutes = Number(options.intervalMinutes || DEFAULT_INTERVAL_MINUTES);
  const intervalSeconds = Math.max(1, intervalMinutes) * 60;
  const scriptPath = options.scriptPath || path.join(repoDir, 'scripts', 'reddit-monitor-cron.sh');
  const logDir = options.logDir || path.join(repoDir, '.thumbgate');
  const trackedThreads = options.trackedThreads || DEFAULT_TRACKED_THREADS;

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
  <string>${escapePlistString(path.join(logDir, 'reddit-monitor-launchd.stdout.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${escapePlistString(path.join(logDir, 'reddit-monitor-launchd.stderr.log'))}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key>
    <string>${escapePlistString(os.homedir())}</string>
    <key>THUMBGATE_REPO_DIR</key>
    <string>${escapePlistString(repoDir)}</string>
    <key>THUMBGATE_REDDIT_TRACKED_THREADS</key>
    <string>${escapePlistString(trackedThreads)}</string>
  </dict>
</dict>
</plist>
`;
}

function plistPathForLabel(label = DEFAULT_LABEL) {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
}

function loadLaunchAgent(plistPath) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (uid !== null) {
    try {
      cp.execFileSync(LAUNCHCTL, ['bootout', `gui/${uid}`, plistPath], { stdio: 'ignore' });
    } catch {
      // Ignore if the agent was not loaded yet.
    }
    cp.execFileSync(LAUNCHCTL, ['bootstrap', `gui/${uid}`, plistPath], { stdio: 'pipe' });
    cp.execFileSync(LAUNCHCTL, ['enable', `gui/${uid}/${path.basename(plistPath, '.plist')}`], { stdio: 'pipe' });
    return;
  }

  try {
    cp.execFileSync(LAUNCHCTL, ['unload', plistPath], { stdio: 'ignore' });
  } catch {
    // Ignore if the agent was not loaded yet.
  }
  cp.execFileSync(LAUNCHCTL, ['load', '-w', plistPath], { stdio: 'pipe' });
}

function installRedditMonitorLaunchAgent(options = {}) {
  const label = options.label || DEFAULT_LABEL;
  const repoDir = path.resolve(options.repoDir || DEFAULT_REPO_DIR);
  const plistPath = options.plistPath || plistPathForLabel(label);
  const plist = buildRedditMonitorPlist({ ...options, label, repoDir });

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
    repoDir: args.repo || DEFAULT_REPO_DIR,
    trackedThreads: args.threads || process.env.THUMBGATE_REDDIT_TRACKED_THREADS || DEFAULT_TRACKED_THREADS,
  };

  if (command === 'install') {
    const result = installRedditMonitorLaunchAgent(options);
    if (options.dryRun) {
      process.stdout.write(result.plist);
      return result;
    }
    console.log(`Reddit monitor LaunchAgent installed: ${result.plistPath}`);
    return result;
  }

  if (command === 'status') {
    const plistPath = plistPathForLabel(options.label);
    const exists = fs.existsSync(plistPath);
    console.log(JSON.stringify({ label: options.label, plistPath, exists }, null, 2));
    return { label: options.label, plistPath, exists };
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
  DEFAULT_TRACKED_THREADS,
  buildRedditMonitorPlist,
  escapePlistString,
  installRedditMonitorLaunchAgent,
  isCliInvocation,
  parseArgs,
  plistPathForLabel,
};
