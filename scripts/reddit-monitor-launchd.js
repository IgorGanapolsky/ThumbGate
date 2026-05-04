#!/usr/bin/env node
'use strict';

const os = require('node:os');
const path = require('node:path');
const {
  LAUNCHCTL_ENV,
  buildMonitorPlist,
  escapePlistString,
  installLaunchAgent,
  isCliInvocation: isLaunchdCliInvocation,
  loadLaunchAgent,
  parseArgs,
  plistPathForLabel: defaultPlistPathForLabel,
  runLaunchctl,
} = require('./monitor-launchd-common');

const DEFAULT_LABEL = 'com.thumbgate.reddit-monitor';
const DEFAULT_INTERVAL_MINUTES = 15;
const DEFAULT_TRACKED_THREADS = 'https://www.reddit.com/r/ClaudeCode/comments/1szi5qp/';
const DEFAULT_REPO_DIR = path.resolve(__dirname, '..');
function buildRedditMonitorPlist(options = {}) {
  const label = options.label || DEFAULT_LABEL;
  const repoDir = path.resolve(options.repoDir || DEFAULT_REPO_DIR);
  const intervalMinutes = Number(options.intervalMinutes || DEFAULT_INTERVAL_MINUTES);
  const intervalSeconds = Math.max(1, intervalMinutes) * 60;
  const scriptPath = options.scriptPath || path.join(repoDir, 'scripts', 'reddit-monitor-cron.sh');
  const logDir = options.logDir || path.join(repoDir, '.thumbgate');
  const trackedThreads = options.trackedThreads || DEFAULT_TRACKED_THREADS;

  return buildMonitorPlist({
    label,
    repoDir,
    intervalSeconds,
    scriptPath,
    stdoutPath: path.join(logDir, 'reddit-monitor-launchd.stdout.log'),
    stderrPath: path.join(logDir, 'reddit-monitor-launchd.stderr.log'),
    env: {
      HOME: os.homedir(),
      THUMBGATE_REPO_DIR: repoDir,
      THUMBGATE_REDDIT_TRACKED_THREADS: trackedThreads,
    },
  });
}

function plistPathForLabel(label = DEFAULT_LABEL) {
  return defaultPlistPathForLabel(label);
}

function installRedditMonitorLaunchAgent(options = {}) {
  const label = options.label || DEFAULT_LABEL;
  const repoDir = path.resolve(options.repoDir || DEFAULT_REPO_DIR);
  const plistPath = options.plistPath || plistPathForLabel(label);
  const plist = buildRedditMonitorPlist({ ...options, label, repoDir });

  return installLaunchAgent({ options, label, repoDir, plistPath, plist });
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
  return isLaunchdCliInvocation(__filename, argv);
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
  LAUNCHCTL_ENV,
  buildRedditMonitorPlist,
  escapePlistString,
  installRedditMonitorLaunchAgent,
  isCliInvocation,
  loadLaunchAgent,
  parseArgs,
  plistPathForLabel,
  runLaunchctl,
};
