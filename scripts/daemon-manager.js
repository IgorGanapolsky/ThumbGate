#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const LABEL = 'com.thumbgate.mcp-memory-gateway';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const NODE_PATH = process.execPath;
const GATEWAY_BIN = path.join(__dirname, '..', 'bin', 'cli.js');
const LOG_DIR = path.join(os.homedir(), '.rlhf', 'logs');

function generatePlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>${GATEWAY_BIN}</string>
        <string>serve</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/daemon-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/daemon-stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>${os.homedir()}</string>
    </dict>
    <key>ThrottleInterval</key>
    <integer>10</integer>
</dict>
</plist>`;
}

function manageDaemon(subCommand) {
  switch (subCommand) {
    case 'install': {
      if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.writeFileSync(PLIST_PATH, generatePlist(), 'utf8');
      try {
        execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null`, { stdio: 'pipe' });
      } catch { /* not loaded */ }
      execSync(`launchctl load "${PLIST_PATH}"`, { stdio: 'inherit' });
      console.log(`✅ Daemon installed and started: ${LABEL}`);
      console.log(`   Plist: ${PLIST_PATH}`);
      console.log(`   Logs:  ${LOG_DIR}/daemon-*.log`);
      break;
    }

    case 'uninstall': {
      try {
        execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null`, { stdio: 'pipe' });
      } catch { /* not loaded */ }
      if (fs.existsSync(PLIST_PATH)) {
        fs.unlinkSync(PLIST_PATH);
        console.log(`✅ Daemon uninstalled: ${LABEL}`);
      } else {
        console.log('ℹ️  Daemon not installed');
      }
      break;
    }

    case 'restart': {
      try {
        execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null`, { stdio: 'pipe' });
        execSync(`launchctl load "${PLIST_PATH}"`, { stdio: 'inherit' });
        console.log(`✅ Daemon restarted: ${LABEL}`);
      } catch (e) {
        console.error(`❌ Restart failed: ${e.message}`);
      }
      break;
    }

    case 'status':
    default: {
      try {
        const output = execSync(`launchctl list 2>/dev/null | grep "${LABEL}"`, { encoding: 'utf8' });
        const parts = output.trim().split(/\s+/);
        const pid = parts[0] === '-' ? 'idle' : `PID ${parts[0]}`;
        const status = parts[1] === '0' ? 'OK' : `exit ${parts[1]}`;
        console.log(`🔧 ThumbGate Daemon: ${pid} (${status})`);
        console.log(`   Plist: ${PLIST_PATH}`);
      } catch {
        console.log('ℹ️  Daemon not installed. Run: mcp-memory-gateway daemon install');
      }
      break;
    }
  }
}

module.exports = { manageDaemon, LABEL, PLIST_PATH };
