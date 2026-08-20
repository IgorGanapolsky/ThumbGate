#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { buildAgenticDataPipelineJobSpec } = require('./agentic-data-pipeline');
const { ensureDir } = require('./fs-utils');

const SCHEDULES_DIR = path.join(os.homedir(), '.thumbgate', 'schedules');
const PLIST_PREFIX = 'com.thumbgate.schedule';


function escapePlistString(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Parse a simple cron-like spec into LaunchAgent calendar intervals
 * Supports: "daily 9:00", "weekly monday 8:30", "hourly", "every 6h"
 */
function parseCronSpec(spec) {
  const s = spec.toLowerCase().trim();

  if (s === 'hourly') {
    return { Minute: 0 };
  }

  const everyHMatch = s.match(/^every\s+(\d+)\s*h/);
  if (everyHMatch) {
    return { Minute: 0 }; // LaunchAgent doesn't support "every Nh" natively, use hourly
  }

  const dailyMatch = s.match(/^daily\s+(\d{1,2}):(\d{2})$/);
  if (dailyMatch) {
    return { Hour: parseInt(dailyMatch[1]), Minute: parseInt(dailyMatch[2]) };
  }

  const weeklyMatch = s.match(/^weekly\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(\d{1,2}):(\d{2})$/);
  if (weeklyMatch) {
    const dayMap = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    return {
      Weekday: dayMap[weeklyMatch[1]],
      Hour: parseInt(weeklyMatch[2]),
      Minute: parseInt(weeklyMatch[3]),
    };
  }

  // Fallback: try to parse as "HH:MM" (daily)
  const timeMatch = s.match(/^(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    return { Hour: parseInt(timeMatch[1]), Minute: parseInt(timeMatch[2]) };
  }

  return null;
}

const LAPTOP_BOUND_RUNTIMES = new Set([
  'laptop', 'macos', 'darwin', 'launchd', 'launchagent',
  'lid-close', 'lid_close', 'continuity', 'mac-pair', 'phone-leash', 'local',
]);
const ALWAYS_ON_RUNTIMES = new Set([
  'vps', 'hosted', 'always-on', 'always_on', 'railway', 'fenced-vps',
]);

function inferScheduleRuntime(params = {}) {
  const explicit = String(params.runtime || '').trim().toLowerCase();
  if (explicit) return explicit;
  if (process.env.THUMBGATE_ALWAYS_ON_VPS === '1') return 'vps';
  if (process.env.THUMBGATE_HOSTED === '1') return 'hosted';
  if (process.platform === 'darwin') return 'launchd';
  return 'laptop';
}

function isTwentyFourSevenSchedule(params = {}) {
  // Interval alone is not a live claim. Existing hourly LaunchAgent/cron jobs
  // (slow-loop, revenue-truth) stay installable; only explicit always-on/live
  // claims fail closed when the path is laptop-bound.
  return params.alwaysOn === true || params.twentyFourSeven === true || params.claimLive === true;
}

function isSendSpendAction(params = {}) {
  const text = [params.action, params.command, params.toolName, params.purpose]
    .map((value) => String(value || ''))
    .join(' ');
  if (params.economicAction === true || params.autoBook === true) return true;
  return /\b(?:send|spend|pay|purchase|transfer|wire|invoice|payout|book|auto-?book)\b/i.test(text);
}

function resolveEscalationOptions(input = {}, options = {}) {
  const approval = input.humanApproval || {};
  return {
    feedbackDir: options.feedbackDir || input.feedbackDir || approval.feedbackDir,
    inputPath: options.inputPath || input.escalationPath || approval.escalationPath,
    approvalVerificationKey: options.approvalVerificationKey || input.approvalVerificationKey,
    approvalSigningKey: options.approvalSigningKey || input.approvalSigningKey,
    now: options.now || input.now,
  };
}

function hasVerifiedHumanSendSpendApproval(input = {}, options = {}) {
  const approval = input.humanApproval;
  if (!approval || typeof approval !== 'object') return false;
  const escalationId = String(approval.escalationId || approval.approval?.escalationId || '').trim();
  if (!escalationId) return false;
  try {
    const { consumeVerifiedApproval, getVerifiedApproval } = require('./human-escalation');
    const consumer = approval.consumer && typeof approval.consumer === 'object'
      ? approval.consumer
      : { id: 'schedule-manager', kind: 'system' };
    const consumed = consumeVerifiedApproval(escalationId, { consumer }, resolveEscalationOptions(input, options));
    if (consumed.consumed === true && consumed.approval?.actor?.kind === 'human') {
      return true;
    }
    if (consumed.replayed === true) {
      const verified = getVerifiedApproval(escalationId, {
        ...resolveEscalationOptions(input, options),
        allowConsumed: true,
      });
      return Boolean(verified && verified.actor?.kind === 'human');
    }
    return false;
  } catch {
    return false;
  }
}

function resolveScheduleClaimLive(runtimeGate, platform = process.platform) {
  if (!runtimeGate || runtimeGate.allowed !== true) {
    return { claimLive: false, schedulerInstallation: 'blocked' };
  }
  if (platform === 'darwin') {
    return { claimLive: false, schedulerInstallation: 'launchd' };
  }
  if (platform === 'linux') {
    return { claimLive: false, schedulerInstallation: 'pending-crontab' };
  }
  return { claimLive: false, schedulerInstallation: 'unsupported' };
}

function evaluateAlwaysOnSchedule(input = {}, options = {}) {
  const runtime = inferScheduleRuntime(input);
  const alwaysOn = ALWAYS_ON_RUNTIMES.has(runtime);
  const actionText = [input.action, input.command, input.toolName]
    .map((value) => String(value || ''))
    .join(' ');

  if (input.autoBook === true || /\bauto-?book\b/i.test(actionText)) {
    return {
      allowed: false,
      failClosed: true,
      claimLive: false,
      reason: 'auto_book_forbidden',
      message: 'Auto-book is not stolen. Send/spend stays behind a human gate.',
      runtime,
    };
  }

  if (isTwentyFourSevenSchedule(input) && (LAPTOP_BOUND_RUNTIMES.has(runtime) || !alwaysOn)) {
    return {
      allowed: false,
      failClosed: true,
      claimLive: false,
      reason: 'laptop_bound_schedule',
      message: 'Scheduled/24-7 work must run on an always-on VPS. Laptop, launchd, and lid-close paths fail closed and must not claim live.',
      runtime,
    };
  }

  if (isSendSpendAction(input) && !hasVerifiedHumanSendSpendApproval(input, options)) {
    return {
      allowed: false,
      failClosed: true,
      claimLive: false,
      reason: 'human_gate_required',
      message: 'Send/spend requires a consumed human approval from the escalation ledger.',
      runtime,
    };
  }

  return {
    allowed: true,
    failClosed: true,
    claimLive: alwaysOn,
    runtime,
    boundTo: alwaysOn ? 'always-on-vps' : null,
  };
}

function shouldEnforceAlwaysOnGate(params = {}) {
  return isTwentyFourSevenSchedule(params) || isSendSpendAction(params) || params.autoBook === true;
}

function generatePlist(schedule) {
  const label = escapePlistString(`${PLIST_PREFIX}.${schedule.id}`);
  const interval = schedule.calendarInterval;

  let intervalXml = '<dict>\n';
  for (const [key, value] of Object.entries(interval)) {
    intervalXml += `        <key>${key}</key>\n        <integer>${value}</integer>\n`;
  }
  intervalXml += '    </dict>';

  const logDir = escapePlistString(path.join(os.homedir(), '.thumbgate', 'logs'));
  const workingDirectory = escapePlistString(schedule.workingDirectory || os.homedir());
  const command = escapePlistString(schedule.command);
  const homeDir = escapePlistString(os.homedir());
  const escapedScheduleId = escapePlistString(schedule.id);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${process.execPath}</string>
        <string>-e</string>
        <string>${command}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${workingDirectory}</string>
    <key>StartCalendarInterval</key>
    ${intervalXml}
    <key>StandardOutPath</key>
    <string>${logDir}/schedule-${escapedScheduleId}.log</string>
    <key>StandardErrorPath</key>
    <string>${logDir}/schedule-${escapedScheduleId}-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>${homeDir}</string>
    </dict>
</dict>
</plist>`;
}

function buildManagedScheduleCommand(params = {}) {
  if (!params.jobFile) {
    throw new Error('buildManagedScheduleCommand requires jobFile');
  }

  const runnerPath = path.join(__dirname, 'async-job-runner.js');
  const jobFile = path.resolve(params.jobFile);
  const autoResume = params.autoResume !== false;

  return [
    `const runner = require(${JSON.stringify(runnerPath)});`,
    `const result = runner.runJobFromFile(${JSON.stringify(jobFile)}, ${JSON.stringify({ autoResume })});`,
    'process.stdout.write(JSON.stringify(result, null, 2) + "\\n");',
    'if (["failed", "cancelled"].includes(result.status)) process.exit(1);',
  ].join(' ');
}

function buildAgenticDataPipelineSchedule(params = {}) {
  const id = params.id || params.name || 'agentic-data-pipeline';
  const jobFile = path.resolve(
    params.jobFile || path.join(SCHEDULES_DIR, `${id}.job.json`)
  );
  const jobSpec = buildAgenticDataPipelineJobSpec({
    jobId: id,
    feedbackDir: params.feedbackDir,
    outDir: params.outDir,
    window: params.window,
    liveBilling: params.liveBilling,
    recordWorkflowRun: params.recordWorkflowRun,
  });

  return {
    id,
    jobFile,
    jobSpec,
    command: buildManagedScheduleCommand({
      jobFile,
      autoResume: params.autoResume !== false,
    }),
  };
}

function createSchedule(params) {
  const runtimeGate = evaluateAlwaysOnSchedule(params);
  if (shouldEnforceAlwaysOnGate(params) && !runtimeGate.allowed) {
    return { success: false, error: runtimeGate.message || runtimeGate.reason, gate: runtimeGate };
  }

  ensureDir(SCHEDULES_DIR);

  const id = params.id || params.name || `sched_${Date.now()}`;
  const calendarInterval = parseCronSpec(params.schedule);
  if (!calendarInterval) {
    return { success: false, error: `Cannot parse schedule: "${params.schedule}". Use formats like "daily 9:00", "weekly monday 8:30", "hourly"` };
  }

  const jobFile = params.jobFile ? path.resolve(params.jobFile) : null;
  const command = params.command || (jobFile ? buildManagedScheduleCommand({
    jobFile,
    autoResume: params.autoResume !== false,
  }) : null);

  if (!command) {
    return { success: false, error: 'Schedule requires command or jobFile' };
  }

  const schedule = {
    id,
    name: params.name || id,
    description: params.description || '',
    schedule: params.schedule,
    command,
    jobFile,
    resumePolicy: jobFile ? (params.autoResume !== false ? 'auto_resume' : 'fresh_only') : null,
    workingDirectory: params.workingDirectory || (jobFile ? path.dirname(jobFile) : process.cwd()),
    calendarInterval,
    createdAt: new Date().toISOString(),
    runtimeGate,
    ...resolveScheduleClaimLive(runtimeGate),
  };

  // Save schedule metadata
  const metaPath = path.join(SCHEDULES_DIR, `${id}.json`);
  fs.writeFileSync(metaPath, JSON.stringify(schedule, null, 2), 'utf8');

  // Generate and install LaunchAgent
  if (process.platform === 'darwin') {
    const plistContent = generatePlist(schedule);
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${PLIST_PREFIX}.${id}.plist`);
    const logDir = path.join(os.homedir(), '.thumbgate', 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.mkdirSync(path.dirname(plistPath), { recursive: true });

    fs.writeFileSync(plistPath, plistContent, 'utf8');
    try {
      execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: 'pipe' });
    } catch { /* not loaded */ }
    try {
      execSync(`launchctl load "${plistPath}"`, { stdio: 'pipe' });
    } catch (e) {
      return { success: false, error: `Failed to load LaunchAgent: ${e.message}`, schedule };
    }

    return { success: true, schedule, plistPath, message: `Schedule "${id}" created and loaded` };
  }

  // Linux keeps the schedule metadata so operators can install it via user crontab tooling.
  return { success: true, schedule, message: `Schedule "${id}" saved for Linux crontab installation` };
}

function listSchedules() {
  ensureDir(SCHEDULES_DIR);
  const files = fs.readdirSync(SCHEDULES_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    try {
      return JSON.parse(fs.readFileSync(path.join(SCHEDULES_DIR, f), 'utf8'));
    } catch {
      return { id: f.replace('.json', ''), error: 'corrupt' };
    }
  });
}

function deleteSchedule(id) {
  const metaPath = path.join(SCHEDULES_DIR, `${id}.json`);
  const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${PLIST_PREFIX}.${id}.plist`);

  try {
    execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: 'pipe' });
  } catch { /* not loaded */ }

  if (fs.existsSync(plistPath)) fs.unlinkSync(plistPath);
  if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);

  return { success: true, message: `Schedule "${id}" deleted` };
}

module.exports = {
  createSchedule,
  listSchedules,
  deleteSchedule,
  escapePlistString,
  generatePlist,
  parseCronSpec,
  buildManagedScheduleCommand,
  buildAgenticDataPipelineSchedule,
  evaluateAlwaysOnSchedule,
  inferScheduleRuntime,
  hasVerifiedHumanSendSpendApproval,
  resolveScheduleClaimLive,
};
