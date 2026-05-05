'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

function renderEnvironmentVariables(env) {
  return Object.entries(env)
    .map(([key, value]) => [
      `    <key>${escapePlistString(key)}</key>`,
      `    <string>${escapePlistString(value)}</string>`,
    ].join('\n'))
    .join('\n');
}

function buildMonitorPlist({
  label,
  repoDir,
  intervalSeconds,
  scriptPath,
  stdoutPath,
  stderrPath,
  env,
}) {
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
  <string>${escapePlistString(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapePlistString(stderrPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${renderEnvironmentVariables(env)}
  </dict>
</dict>
</plist>
`;
}

function plistPathForLabel(label) {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
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

function installLaunchAgent({ options, repoDir, plistPath, plist }) {
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

function isCliInvocation(fileName, argv = process.argv) {
  const invokedPath = argv[1];
  return invokedPath ? path.resolve(invokedPath) === fileName : false;
}

module.exports = {
  LAUNCHCTL_ENV,
  buildMonitorPlist,
  escapePlistString,
  installLaunchAgent,
  isCliInvocation,
  loadLaunchAgent,
  parseArgs,
  plistPathForLabel,
  runLaunchctl,
};
