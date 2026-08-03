#!/usr/bin/env node
'use strict';

/**
 * ThumbGate Financial Control Plane (ERP-like)
 * ============================================
 * Prevents agent-initiated financial disasters with four ERP modules:
 *
 *  1. GL / Journal   — append-only journal of financial-intent tool calls
 *  2. AP / Purchase  — classify + hard-deny paid mutations without auth
 *  3. Budget         — default $0 agent spend envelopes (daily/monthly)
 *  4. Authorization  — human-issued spend authorizations with amount + TTL
 *
 * Born from the 2026-08-02 ~$588 Apollo annual charge: memory/warn was not
 * enough. This plane is mechanical and fails closed on spend classes.
 *
 * Human spend authorization format (file ~/.thumbgate/spend-authorizations.jsonl
 * or env THUMBGATE_SPEND_AUTH):
 *   {"id":"...","amountUsd":0,"vendor":"apollo","expiresAt":"...","note":"...","scope":"upgrade"}
 * Env form: AMOUNT:VENDOR:NOTE  e.g. 0:none:no-spend (still blocks paid mutations unless amount>0
 * and vendor matches — default policy is zero spend).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function resolveDefaultConfigPath() {
  const candidates = [
    process.env.THUMBGATE_FINANCIAL_CONFIG,
    path.join(__dirname, '..', 'config', 'financial-control.json'),
    path.join(process.env.HOME || require('node:os').homedir(), '.thumbgate', 'financial-control.json'),
    path.join(process.env.HOME || require('node:os').homedir(), '.thumbgate', 'config', 'financial-control.json'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch { /* continue */ }
  }
  return path.join(__dirname, '..', 'config', 'financial-control.json');
}
const DEFAULT_CONFIG_PATH = resolveDefaultConfigPath();

const DEFAULT_POLICY = {
  version: 1,
  mode: 'hard',
  defaultAgentSpendUsd: 0,
  dailyAgentSpendCapUsd: 0,
  monthlyAgentSpendCapUsd: 0,
  requireExplicitAuthorization: true,
  authorizationTtlMinutes: 30,
  journalMaxEntries: 5000,
  freeAllowlist: [
    'apollo people search',
    'apollo search',
    'apollo usage',
    'npm view',
    'git ',
    'gh pr',
  ],
  paidMutationClasses: [
    'saas_upgrade',
    'checkout',
    'payment_method',
    'credit_purchase',
    'subscription_change',
    'billing_portal',
    'invoice_pay',
  ],
  vendorPatterns: {
    apollo: '(?:apollo|app\\.apollo\\.io)',
    stripe: '(?:stripe|checkout\\.stripe\\.com|buy\\.stripe\\.com)',
    thumbgate: '(?:thumbgate\\s*pro|thumbgate\\.ai/(?:go/)?pro)',
  },
};

const DENY_MESSAGE =
  'ThumbGate FINANCIAL CONTROL (ERP): agent-initiated spend/upgrade is denied. '
  + 'Default agent spend envelope is $0. A human must issue a spend authorization '
  + '(~/.thumbgate/spend-authorizations.jsonl) with amount, vendor, and TTL — or complete '
  + 'the purchase outside the agent. Free-tier search/usage remains allowed.';

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || '/tmp';
}

function financialRoot() {
  return (
    process.env.THUMBGATE_FINANCIAL_DIR ||
    path.join(homeDir(), '.thumbgate', 'financial')
  );
}

function journalPath() {
  return path.join(financialRoot(), 'journal.jsonl');
}

function authPath() {
  return (
    process.env.THUMBGATE_SPEND_AUTH_PATH ||
    path.join(homeDir(), '.thumbgate', 'spend-authorizations.jsonl')
  );
}

function budgetStatePath() {
  return path.join(financialRoot(), 'budget-envelope.json');
}

function loadPolicy(configPath = process.env.THUMBGATE_FINANCIAL_CONFIG || DEFAULT_CONFIG_PATH) {
  let filePolicy = {};
  try {
    if (fs.existsSync(configPath)) {
      filePolicy = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch {
    filePolicy = {};
  }
  return {
    ...DEFAULT_POLICY,
    ...filePolicy,
    vendorPatterns: {
      ...DEFAULT_POLICY.vendorPatterns,
      ...(filePolicy.vendorPatterns || {}),
    },
    freeAllowlist: Array.isArray(filePolicy.freeAllowlist)
      ? filePolicy.freeAllowlist
      : DEFAULT_POLICY.freeAllowlist,
    paidMutationClasses: Array.isArray(filePolicy.paidMutationClasses)
      ? filePolicy.paidMutationClasses
      : DEFAULT_POLICY.paidMutationClasses,
  };
}

function flatten(value, depth = 0) {
  if (depth > 5 || value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) return value.map((item) => flatten(item, depth + 1)).join(' ');
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, item]) => `${key} ${flatten(item, depth + 1)}`)
      .join(' ');
  }
  return '';
}

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

/**
 * Only execution surfaces can spend money. MCP analysis tools that *mention*
 * "checkout" in a goal/query (require_evidence_for_claim, distribute_context, …)
 * must not trip the ERP plane — that false-positive broke CI on #3176.
 */
function isSpendSurfaceTool(toolName) {
  const name = String(toolName || '');
  if (!name) return false;
  // Explicit purchase/billing tool names always count.
  if (/(?:^|[_-])(?:purchase|checkout|billing|payment|subscribe|buy[_-]?credits?)(?:[_-]|$)/i.test(name)) {
    return true;
  }
  // Shell / browser / fetch / computer-use can open checkout URLs or run paid CLIs.
  if (/^(?:Bash|Shell|Terminal|WebFetch|WebSearch|BashTool|shell_command|run_terminal_command)$/i.test(name)) {
    return true;
  }
  if (/(?:browser|playwright|computer[_-]?use|chrome|puppeteer|web_fetch|webfetch|open_url|navigate)/i.test(name)) {
    return true;
  }
  if (/^mcp__/i.test(name) && /(?:browser|playwright|chrome|computer|shell|bash|fetch|http)/i.test(name)) {
    return true;
  }
  return false;
}

function spendSurfaceText(toolName, toolInput) {
  // Prefer executable fields; avoid scanning entire goalContract trees.
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  const parts = [
    toolName,
    input.command,
    input.url,
    input.uri,
    input.href,
    input.path,
    input.file_path,
    Array.isArray(input.args) ? input.args.join(' ') : input.args,
  ];
  return parts.filter((p) => p != null && String(p).length).map(String).join(' ');
}

/**
 * Classify a tool call for the financial control plane.
 * @returns {{ financial: boolean, class: string|null, vendor: string|null, freeAllowed: boolean, risk: string }}
 */
function classifyFinancialIntent(toolName, toolInput, policy = loadPolicy()) {
  const name = String(toolName || '');
  // Non-execution tools: only classify if the tool *name* is itself a purchase tool.
  if (!isSpendSurfaceTool(name)) {
    return {
      financial: false,
      class: null,
      vendor: null,
      freeAllowed: true,
      risk: 'none',
      skipped: 'non_spend_surface',
    };
  }
  const text = spendSurfaceText(name, toolInput);
  const combined = text.toLowerCase();

  // Explicit free allowlist (read-only / free-tier search)
  for (const allow of policy.freeAllowlist || []) {
    if (allow && combined.includes(String(allow).toLowerCase())) {
      // Only if no paid mutation markers co-occur
      if (!hasPaidMarkers(combined)) {
        return {
          financial: false,
          class: null,
          vendor: detectVendor(combined, policy),
          freeAllowed: true,
          risk: 'none',
        };
      }
    }
  }

  const paidClass = detectPaidClass(combined);
  if (!paidClass) {
    return {
      financial: false,
      class: null,
      vendor: detectVendor(combined, policy),
      freeAllowed: true,
      risk: 'none',
    };
  }

  return {
    financial: true,
    class: paidClass,
    vendor: detectVendor(combined, policy) || 'unknown',
    freeAllowed: false,
    risk: 'critical',
  };
}

function hasPaidMarkers(combined) {
  return (
    /\b(?:buy\s+credits?|purchase\s+credits?|credit\s*pack)\b/i.test(combined)
    || /\b(?:upgrade\s+(?:plan|subscription|tier|apollo|pro|to\s+pro)|subscribe\s+(?:to\s+)?(?:pro|paid|plan))\b/i.test(combined)
    || /\b(?:add\s+payment\s+method|enter\s+card|attach\s+payment|billing\s+portal)\b/i.test(combined)
    || /(?:create|submit|open|complete|start)\s+checkout|checkout\s+(?:session|page|url|link|flow)/i.test(combined)
    || /(?:checkout\.stripe\.com|buy\.stripe\.com|app\.apollo\.io[^\s]*(?:plans|upgrade|billing))/i.test(combined)
    || /(?:\/plans?(?:\/|#)|\/upgrade(?:\/|\?|$)|\/billing(?:\/|\?|$))/i.test(combined)
    || /\b(?:apollo\s*pro|thumbgate\s*pro)\b/i.test(combined)
  );
}

function detectPaidClass(combined) {
  if (/(?:checkout\.stripe\.com|buy\.stripe\.com|(?:create|submit|open|complete|start)\s+checkout|checkout\s+(?:session|page|url|link))/i.test(combined)) {
    return 'checkout';
  }
  if (/(?:add\s+payment\s+method|enter\s+card|attach\s+payment|payment\s*method)/i.test(combined)) {
    return 'payment_method';
  }
  if (/(?:buy\s+credits?|credit\s*pack|purchase\s+credits?)/i.test(combined)) {
    return 'credit_purchase';
  }
  if (/(?:billing\s+portal|invoice\s+pay|pay\s+invoice|\/billing(?:\/|\?|$))/i.test(combined)) {
    return 'billing_portal';
  }
  if (/(?:activate\s+subscription|cancel\s+subscription|change\s+subscription|subscribe\s+(?:to\s+)?(?:pro|paid|plan))/i.test(combined)) {
    return 'subscription_change';
  }
  if (/(?:upgrade\s+(?:plan|subscription|tier|apollo|pro|to\s+pro)|apollo\s*pro|thumbgate\s*pro|\/plans?(?:\/|#)|app\.apollo\.io[^\s]*(?:plans|upgrade))/i.test(combined)) {
    return 'saas_upgrade';
  }
  if (hasPaidMarkers(combined)) return 'saas_upgrade';
  return null;
}

function detectVendor(combined, policy) {
  const patterns = policy.vendorPatterns || {};
  for (const [vendor, pattern] of Object.entries(patterns)) {
    try {
      if (new RegExp(pattern, 'i').test(combined)) return vendor;
    } catch {
      // ignore bad pattern
    }
  }
  return null;
}

function ensureFinancialDir() {
  fs.mkdirSync(financialRoot(), { recursive: true, mode: 0o700 });
}

function appendJournal(entry) {
  ensureFinancialDir();
  const line = `${JSON.stringify({
    at: new Date().toISOString(),
    ...entry,
  })}\n`;
  fs.appendFileSync(journalPath(), line, { mode: 0o600 });
}

function readJsonl(filePath, limit = 200) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  const lines = raw.split('\n');
  const slice = lines.slice(Math.max(0, lines.length - limit));
  const out = [];
  for (const line of slice) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip bad lines
    }
  }
  return out;
}

function loadBudgetEnvelope() {
  try {
    if (fs.existsSync(budgetStatePath())) {
      return JSON.parse(fs.readFileSync(budgetStatePath(), 'utf8'));
    }
  } catch {
    // reset
  }
  return {
    day: dayKey(),
    month: monthKey(),
    spentDayUsd: 0,
    spentMonthUsd: 0,
    authorizedSpends: [],
  };
}

function saveBudgetEnvelope(state) {
  ensureFinancialDir();
  const next = { ...state };
  if (next.day !== dayKey()) {
    next.day = dayKey();
    next.spentDayUsd = 0;
  }
  if (next.month !== monthKey()) {
    next.month = monthKey();
    next.spentMonthUsd = 0;
  }
  fs.writeFileSync(budgetStatePath(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return next;
}

function loadAuthorizations(policy = loadPolicy()) {
  const now = Date.now();
  const ttlMs = (policy.authorizationTtlMinutes || 30) * 60 * 1000;
  const fromFile = readJsonl(authPath(), 100).filter((row) => {
    if (!row || typeof row !== 'object') return false;
    if (row.revoked === true) return false;
    if (row.expiresAt) {
      const exp = Date.parse(row.expiresAt);
      if (Number.isFinite(exp) && exp < now) return false;
    } else if (row.issuedAt) {
      const issued = Date.parse(row.issuedAt);
      if (Number.isFinite(issued) && now - issued > ttlMs) return false;
    }
    return Number(row.amountUsd) > 0;
  });

  // Env one-shot auth (still requires amount > 0 and vendor match)
  const envAuth = process.env.THUMBGATE_SPEND_AUTH;
  if (envAuth && String(envAuth).trim()) {
    const [amountRaw, vendor = '*', note = ''] = String(envAuth).split(':');
    const amountUsd = Number(amountRaw);
    if (Number.isFinite(amountUsd) && amountUsd > 0) {
      fromFile.push({
        id: 'env-THUMBGATE_SPEND_AUTH',
        amountUsd,
        vendor: vendor || '*',
        note,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(now + ttlMs).toISOString(),
        source: 'env',
      });
    }
  }

  return fromFile;
}

/**
 * Find a matching live authorization for a classified financial intent.
 */
function findMatchingAuthorization(classification, policy = loadPolicy()) {
  if (!classification || !classification.financial) return null;
  const auths = loadAuthorizations(policy);
  const vendor = (classification.vendor || '').toLowerCase();
  return (
    auths.find((auth) => {
      const authVendor = String(auth.vendor || '*').toLowerCase();
      const vendorOk = authVendor === '*' || authVendor === vendor || vendor.includes(authVendor);
      return vendorOk && Number(auth.amountUsd) > 0;
    }) || null
  );
}

/**
 * Core ERP evaluation for PreToolUse.
 * Default: hard deny all paid mutations. Free allowlist passes.
 * Authorized spends are logged and counted against envelopes.
 */
function evaluateFinancialControl(toolName, toolInput, options = {}) {
  const policy = options.policy || loadPolicy();
  const classification = classifyFinancialIntent(toolName, toolInput, policy);

  if (!classification.financial) {
    if (options.journalAll) {
      appendJournal({
        event: 'allow_non_financial',
        toolName: String(toolName || ''),
        class: null,
        vendor: classification.vendor,
      });
    }
    return { decision: 'allow', classification };
  }

  // Paid mutation path
  const mode = String(policy.mode || 'hard').toLowerCase();
  const auth = findMatchingAuthorization(classification, policy);
  const envelope = saveBudgetEnvelope(loadBudgetEnvelope());

  // Default $0 agent spend: no auth => hard deny
  if (!auth) {
    const result = {
      decision: 'deny',
      gate: 'financial-control-plane',
      class: classification.class,
      vendor: classification.vendor,
      message: DENY_MESSAGE,
      severity: 'critical',
      erpModule: 'AP+Budget',
      reasoning: [
        `Classified as paid mutation: ${classification.class}`,
        `Vendor: ${classification.vendor || 'unknown'}`,
        `Agent spend envelope: day $${envelope.spentDayUsd}/$${policy.dailyAgentSpendCapUsd}, month $${envelope.spentMonthUsd}/$${policy.monthlyAgentSpendCapUsd}`,
        'No matching human spend authorization (amountUsd>0 + vendor + TTL)',
      ],
    };
    appendJournal({
      event: 'deny_unauth_spend',
      toolName: String(toolName || ''),
      class: classification.class,
      vendor: classification.vendor,
      decision: 'deny',
    });
    if (mode === 'warn') {
      return {
        ...result,
        decision: 'warn',
        warnByDefault: true,
        message: `${result.message}\n(ERP mode=warn — would hard-block in mode=hard)`,
      };
    }
    return result;
  }

  // Authorization present — still enforce envelope caps (default 0 means any spend needs cap raise)
  const amount = Number(auth.amountUsd) || 0;
  const dayCap = Number(policy.dailyAgentSpendCapUsd);
  const monthCap = Number(policy.monthlyAgentSpendCapUsd);
  if (
    (Number.isFinite(dayCap) && envelope.spentDayUsd + amount > dayCap)
    || (Number.isFinite(monthCap) && envelope.spentMonthUsd + amount > monthCap)
  ) {
    const result = {
      decision: 'deny',
      gate: 'financial-control-envelope',
      class: classification.class,
      vendor: classification.vendor,
      message:
        `ThumbGate FINANCIAL CONTROL (ERP): authorized amount $${amount} would exceed agent spend envelope `
        + `(day $${envelope.spentDayUsd}/$${dayCap}, month $${envelope.spentMonthUsd}/$${monthCap}). `
        + 'Raise caps only via human-edited config/financial-control.json — not by the agent.',
      severity: 'critical',
      erpModule: 'Budget',
      reasoning: [
        `Auth id: ${auth.id || 'unknown'} amountUsd=${amount}`,
        `Envelope day=${envelope.spentDayUsd} month=${envelope.spentMonthUsd}`,
      ],
    };
    appendJournal({
      event: 'deny_envelope',
      toolName: String(toolName || ''),
      class: classification.class,
      vendor: classification.vendor,
      authId: auth.id,
      amountUsd: amount,
      decision: 'deny',
    });
    return result;
  }

  // Record authorized spend against envelope
  envelope.spentDayUsd = (envelope.spentDayUsd || 0) + amount;
  envelope.spentMonthUsd = (envelope.spentMonthUsd || 0) + amount;
  envelope.authorizedSpends = envelope.authorizedSpends || [];
  envelope.authorizedSpends.push({
    at: new Date().toISOString(),
    authId: auth.id,
    amountUsd: amount,
    vendor: classification.vendor,
    class: classification.class,
  });
  saveBudgetEnvelope(envelope);

  appendJournal({
    event: 'allow_authorized_spend',
    toolName: String(toolName || ''),
    class: classification.class,
    vendor: classification.vendor,
    authId: auth.id,
    amountUsd: amount,
    decision: 'allow',
  });

  return {
    decision: 'allow',
    classification,
    authorization: { id: auth.id, amountUsd: amount, vendor: auth.vendor },
    envelope: {
      spentDayUsd: envelope.spentDayUsd,
      spentMonthUsd: envelope.spentMonthUsd,
    },
  };
}

function getFinancialStatus(policy = loadPolicy()) {
  const envelope = saveBudgetEnvelope(loadBudgetEnvelope());
  const auths = loadAuthorizations(policy);
  const recent = readJsonl(journalPath(), 20);
  const denials = recent.filter((e) => e.decision === 'deny' || String(e.event || '').startsWith('deny'));
  return {
    erp: 'ThumbGate Financial Control Plane',
    mode: policy.mode,
    defaultAgentSpendUsd: policy.defaultAgentSpendUsd,
    envelope: {
      day: envelope.day,
      month: envelope.month,
      spentDayUsd: envelope.spentDayUsd,
      spentMonthUsd: envelope.spentMonthUsd,
      dailyCapUsd: policy.dailyAgentSpendCapUsd,
      monthlyCapUsd: policy.monthlyAgentSpendCapUsd,
    },
    liveAuthorizations: auths.map((a) => ({
      id: a.id,
      amountUsd: a.amountUsd,
      vendor: a.vendor,
      expiresAt: a.expiresAt,
    })),
    journalPath: journalPath(),
    recentDenials: denials.slice(-10),
    recentJournal: recent.slice(-10),
  };
}

/**
 * Human issues a spend authorization (CLI / operator tooling).
 * Agents must NOT call this without human intent — CLI only.
 */
function issueAuthorization({
  amountUsd,
  vendor = '*',
  note = '',
  ttlMinutes,
  scope = 'spend',
} = {}) {
  const policy = loadPolicy();
  const amount = Number(amountUsd);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('amountUsd must be a positive number (default agent spend is $0)');
  }
  const ttl = Number.isFinite(Number(ttlMinutes))
    ? Number(ttlMinutes)
    : policy.authorizationTtlMinutes || 30;
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ttl * 60 * 1000);
  const row = {
    id: `auth_${issuedAt.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
    amountUsd: amount,
    vendor,
    note,
    scope,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    source: 'human-cli',
  };
  fs.mkdirSync(path.dirname(authPath()), { recursive: true, mode: 0o700 });
  fs.appendFileSync(authPath(), `${JSON.stringify(row)}\n`, { mode: 0o600 });
  appendJournal({ event: 'auth_issued', ...row });
  return row;
}

function formatHookDeny(result) {
  return {
    decision: 'deny',
    reason: result.message,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `[ERP:${result.erpModule || 'Financial'}] ${result.message}`,
    },
  };
}

function runCli(argv = process.argv.slice(2)) {
  const cmd = argv[0] || 'status';
  if (cmd === 'status') {
    console.log(JSON.stringify(getFinancialStatus(), null, 2));
    return 0;
  }
  if (cmd === 'journal') {
    const n = Number(argv[1]) || 50;
    console.log(JSON.stringify(readJsonl(journalPath(), n), null, 2));
    return 0;
  }
  if (cmd === 'classify') {
    const tool = argv[1] || 'Bash';
    const command = argv.slice(2).join(' ') || '';
    console.log(JSON.stringify(classifyFinancialIntent(tool, { command }), null, 2));
    return 0;
  }
  if (cmd === 'evaluate') {
    const tool = argv[1] || 'Bash';
    const command = argv.slice(2).join(' ') || '';
    console.log(JSON.stringify(evaluateFinancialControl(tool, { command }), null, 2));
    return 0;
  }
  if (cmd === 'authorize') {
    // Human-only: thumbgate finance authorize --amount=5 --vendor=apollo --note="..."
    const amountArg = argv.find((a) => a.startsWith('--amount='));
    const vendorArg = argv.find((a) => a.startsWith('--vendor='));
    const noteArg = argv.find((a) => a.startsWith('--note='));
    const ttlArg = argv.find((a) => a.startsWith('--ttl='));
    if (!amountArg) {
      console.error('Usage: financial-control-plane authorize --amount=USD --vendor=NAME [--note=...] [--ttl=minutes]');
      return 1;
    }
    const row = issueAuthorization({
      amountUsd: Number(amountArg.replace('--amount=', '')),
      vendor: vendorArg ? vendorArg.replace('--vendor=', '') : '*',
      note: noteArg ? noteArg.replace('--note=', '') : '',
      ttlMinutes: ttlArg ? Number(ttlArg.replace('--ttl=', '')) : undefined,
    });
    console.log(JSON.stringify(row, null, 2));
    return 0;
  }
  console.error('Usage: financial-control-plane <status|journal|classify|evaluate|authorize>');
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exitCode = runCli();
}

module.exports = {
  DENY_MESSAGE,
  DEFAULT_POLICY,
  classifyFinancialIntent,
  isSpendSurfaceTool,
  spendSurfaceText,
  evaluateFinancialControl,
  getFinancialStatus,
  issueAuthorization,
  loadPolicy,
  loadAuthorizations,
  findMatchingAuthorization,
  appendJournal,
  readJsonl,
  formatHookDeny,
  flatten,
  journalPath,
  authPath,
  financialRoot,
  runCli,
};
