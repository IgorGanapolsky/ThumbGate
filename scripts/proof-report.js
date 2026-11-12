#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROOF_WINDOW_DAYS_DEFAULT = 30;
const MAX_EXAMPLE_CHARS = 160;

const CATEGORY_RULES = [
  {
    id: 'force_push',
    label: 'Force push to a protected branch',
    gateIds: ['force-push', 'force_push', 'protected-branch-force-push'],
    pattern: /\bgit\s+push\b[^\n]{0,80}(--force\b|-f\b)/i,
  },
  {
    id: 'secret_in_command',
    label: 'Secret material in a command',
    gateIds: ['secret-exfiltration', 'secret-guard', 'secret_in_command', 'credential-leak'],
    pattern: /(secret|api[_-]?key|token|password|credential|exfiltration)/i,
  },
  {
    id: 'destructive_shell',
    label: 'Destructive shell command',
    gateIds: ['destructive-delete', 'destructive-shell', 'rm-rf', 'hard-floor'],
    pattern: /\brm\s+-[a-z]*r[a-z]*f|\bdrop\s+(database|table)\b|\btruncate\b/i,
  },
  {
    id: 'repeated_mistake',
    label: 'Repeated mistake the agent already corrected',
    gateIds: ['repeated-mistake', 'lesson-repeat', 'recurring-block'],
    pattern: /(repeat(ed)? mistake|already corrected|recurring)/i,
  },
  {
    id: 'privilege_escalation',
    label: 'Privilege escalation or unsafe sudo',
    gateIds: ['privilege-escalation', 'unsafe-sudo'],
    pattern: /\bsudo\b|\bchmod\s+777\b/i,
  },
];

const NOISE_SOURCE_PATTERN = /(test|cron|diagnostic|fixture)/i;
const NOISE_PATH_PATTERN = /(\/(?:tmp|var\/folders)\/|thumbgate-test|test-fixtures?|node_modules)/i;

function resolveProofPaths(env = process.env) {
  const homeDir = env.HOME || os.homedir() || '/tmp';
  const thumbgateDir = env.THUMBGATE_HOME || path.join(homeDir, '.thumbgate');
  return {
    thumbgateDir,
    auditTrailPath: env.THUMBGATE_AUDIT_TRAIL_PATH || path.join(thumbgateDir, 'audit-trail.jsonl'),
  };
}

function readJsonl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const out = [];
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // skip malformed line
    }
  }
  return out;
}

function isBlockedDecision(record) {
  const decision = String(record?.decision || '').toLowerCase();
  const mode = String(record?.mode || '').toLowerCase();
  return decision === 'deny' || decision === 'block' || mode === 'block';
}

function extractCommandText(record) {
  const input = record?.toolInput;
  if (!input || typeof input !== 'object') return '';
  return String(input.command || input.cmd || input.input || input.file_path || input.path || '').trim();
}

function classifyCategory(record) {
  const gateId = String(record?.gateId || '').toLowerCase();
  const reason = String(record?.reason || record?.message || '');
  const command = extractCommandText(record);
  const haystack = `${gateId}\n${reason}\n${command}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.gateIds.some((id) => gateId === id || gateId.includes(id))) return rule;
    if (rule.pattern.test(haystack)) return rule;
  }
  return { id: 'other_risky_action', label: 'Other risky action stopped' };
}

function isNoiseRecord(record) {
  const source = String(record?.source || '');
  const sessionId = String(record?.sessionId || '');
  const identity = `${source} ${sessionId}`;
  const command = extractCommandText(record);
  return NOISE_SOURCE_PATTERN.test(identity) || NOISE_PATH_PATTERN.test(command);
}

function anonymizeExample(text) {
  let out = String(text || '').replace(/\s+/g, ' ').trim();
  out = out
    .replace(/\/(?:Users|home)\/[^\s'"]+/gi, '~/<redacted-path>')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '<redacted-email>')
    .replace(/\b(?:sk|rk|pk|ghp|gho|github_pat|xox[baprs]|AKIA|ASIA)[_-][A-Za-z0-9_\-]{8,}\b/g, '<redacted-secret>')
    .replace(/\b(?:api[_-]?key|token|secret|password|passwd|credential)\s*[:=]\s*\S+/gi, '<redacted-secret>');
  if (out.length > MAX_EXAMPLE_CHARS) out = `${out.slice(0, MAX_EXAMPLE_CHARS - 1)}…`;
  return out;
}

function buildProofReport(options = {}) {
  const days = Math.max(1, Math.trunc(Number(options.days) || PROOF_WINDOW_DAYS_DEFAULT));
  const nowMs = options.now ? new Date(options.now).getTime() : Date.now();
  const windowStartMs = nowMs - days * 24 * 60 * 60 * 1000;
  const paths = options.paths || resolveProofPaths(options.env);
  const records = options.records || readJsonl(paths.auditTrailPath);

  const realByCategory = new Map();
  const excluded = { test: 0, cron: 0, diagnostic: 0, fixture: 0, other: 0 };
  let realBlocked = 0;
  let excludedTotal = 0;

  for (const record of records) {
    if (!isBlockedDecision(record)) continue;
    const ts = new Date(record.timestamp || 0).getTime();
    if (!Number.isFinite(ts) || ts < windowStartMs || ts > nowMs) continue;

    if (isNoiseRecord(record)) {
      excludedTotal += 1;
      const haystack = `${record.source || ''} ${record.sessionId || ''} ${record.reason || ''} ${extractCommandText(record)}`.toLowerCase();
      if (haystack.includes('cron')) excluded.cron += 1;
      else if (haystack.includes('diagnostic')) excluded.diagnostic += 1;
      else if (haystack.includes('fixture')) excluded.fixture += 1;
      else if (haystack.includes('test')) excluded.test += 1;
      else excluded.other += 1;
      continue;
    }

    realBlocked += 1;
    const category = classifyCategory(record);
    const bucket = realByCategory.get(category.id) || {
      id: category.id,
      label: category.label,
      count: 0,
      example: '',
    };
    bucket.count += 1;
    if (!bucket.example) {
      const exampleSource = extractCommandText(record) || String(record.message || record.reason || '');
      bucket.example = anonymizeExample(exampleSource);
    }
    realByCategory.set(category.id, bucket);
  }

  const categories = [...realByCategory.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    windowDays: days,
    generatedAt: new Date(nowMs).toISOString(),
    source: 'founder-local-audit-trail',
    realAgentToolCallsBlocked: realBlocked,
    excludedNoise: {
      total: excludedTotal,
      ...excluded,
    },
    categories,
  };
}

function formatProofText(report) {
  const lines = [
    `ThumbGate proof — last ${report.windowDays} days (founder local use, not a customer)`,
    `Real agent tool calls blocked: ${report.realAgentToolCallsBlocked}`,
    `Excluded noise (test/cron/diagnostic/fixture): ${report.excludedNoise.total}`,
    '',
    'Top categories:',
  ];
  const top = report.categories.slice(0, 5);
  if (!top.length) {
    lines.push('  (none in window)');
  } else {
    for (const cat of top) {
      lines.push(`  - ${cat.label}: ${cat.count}`);
      if (cat.example) lines.push(`    example: ${cat.example}`);
    }
  }
  return lines.join('\n');
}

function runProofCli(argv = process.argv.slice(3), options = {}) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [key, ...rest] = arg.slice(2).split('=');
    if (rest.length) args[key] = rest.join('=');
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      args[key] = argv[i + 1];
      i += 1;
    } else args[key] = true;
  }
  const report = buildProofReport({
    days: args.days,
    env: options.env,
    paths: options.paths,
    records: options.records,
    now: options.now,
  });
  const out = args.json ? JSON.stringify(report, null, 2) : formatProofText(report);
  if (!options.silent) process.stdout.write(`${out}\n`);
  return report;
}

module.exports = {
  CATEGORY_RULES,
  anonymizeExample,
  buildProofReport,
  formatProofText,
  isNoiseRecord,
  resolveProofPaths,
  runProofCli,
};

if (require.main === module) {
  runProofCli(process.argv.slice(2));
}
