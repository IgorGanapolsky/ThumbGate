#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');

const MAX_AUTO_GATES = 10;
// 1+ failure auto-promotes to a warning gate. Cold buyers expect "one 👎 → blocked next time"
// — a 2-capture threshold made first-capture invisible and broke the activation loop. Block
// escalation still requires 3 captures (BLOCK_THRESHOLD) so noise doesn't auto-hard-block.
const WARN_THRESHOLD = 1;
const BLOCK_THRESHOLD = 3; // 3+ repeated failures hard-block the action
const WINDOW_DAYS = 30;

// Default TTL on auto-promoted gates. Reddit reviewer @MomSausageandPeppers
// (2026-05-13) flagged that without expiry, "accidental dislikes become policy
// forever." Gates expire 90 days after promotion UNLESS they keep firing —
// every fire refreshes lastFiredAt, and expireGates() keeps any gate fired
// within the last TTL window regardless of original promotion date. Manual
// force-promote bypasses TTL (operator says "permanent"). Override via
// THUMBGATE_RULE_TTL_DAYS env var.
const DEFAULT_RULE_TTL_DAYS = 90;
function getRuleTtlDays() {
  const raw = Number(process.env.THUMBGATE_RULE_TTL_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RULE_TTL_DAYS;
}
function getRuleTtlMs() {
  return getRuleTtlDays() * 24 * 60 * 60 * 1000;
}

const NEG_SIGNALS = new Set(['negative', 'negative_strong', 'down', 'thumbs_down']);

function getFeedbackLogPath() {
  if (process.env.THUMBGATE_FEEDBACK_DIR) {
    return path.join(process.env.THUMBGATE_FEEDBACK_DIR, 'feedback-log.jsonl');
  }
  const localFallback = path.join(process.cwd(), '.thumbgate', 'feedback-log.jsonl');
  const localClaude = path.join(process.cwd(), '.claude', 'memory', 'feedback', 'feedback-log.jsonl');
  if (fs.existsSync(localFallback)) return localFallback;
  if (fs.existsSync(localClaude)) return localClaude;
  // Fall back to resolveFeedbackDir() for proper home-dir resolution
  const resolved = path.join(resolveFeedbackDir(), 'feedback-log.jsonl');
  if (fs.existsSync(resolved)) return resolved;
  return localFallback; // default even if doesn't exist
}

function getAutoGatesPath() {
  return path.join(path.dirname(getFeedbackLogPath()), 'auto-promoted-gates.json');
}

// The global store. NOT resolveFeedbackDir() — that is itself cwd-dependent and
// returns ~/.thumbgate/projects/<name>/ per repository, so using it here yields a
// path identical to the repo-local one and unions to a single entry.
function getGlobalAutoGatesPath() {
  return path.join(os.homedir(), '.thumbgate', 'auto-promoted-gates.json');
}

// Every per-project store on this machine.
function getProjectAutoGatesPaths() {
  const projectsRoot = path.join(os.homedir(), '.thumbgate', 'projects');
  let entries;
  try {
    entries = fs.readdirSync(projectsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(projectsRoot, e.name, 'auto-promoted-gates.json'))
    .filter((p) => fs.existsSync(p));
}

// A lesson learned in one repository must gate every repository. getAutoGatesPath()
// resolves to exactly ONE store — repo-local when present, otherwise the global one —
// so gates promoted in repo A were invisible in repo B.
//
// Measured 2026-08-04, same engine and same moment, only cwd differing:
//   cwd=ThumbGate -> 45 auto-promoted gates loaded
//   cwd=Resume    ->  4 auto-promoted gates loaded
// The missing gates included every one promoted from an outbound-send failure, and an
// agent then sent outbound mail from the repository that could not see them.
//
// Global first, repo-local second, so a repo-local entry may override a global one
// sharing its id.
function getAutoGatesPaths() {
  const seen = new Set();
  const paths = [];
  const candidates = [
    getGlobalAutoGatesPath(),
    ...getProjectAutoGatesPaths(),
    getAutoGatesPath(),
  ];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    paths.push(resolved);
  }
  return paths;
}

function readJSONL(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

// --- Self-Harness stage 3: regression-gated promotion -----------------------
// Inspired by "Self-Harness: Harnesses That Improve Themselves" (arXiv 2606.09498).
// Stages 1-2 (weakness mining -> rule extraction) already exist via lesson
// inference + this promoter. Stage 3 — accept a harness change only after
// regression-testing it does not degrade behavior — was missing: a noisy 3x
// capture could hard-block an over-broad pattern with no check that it wouldn't
// have wrongly blocked actions that were previously ALLOWED. This replays a
// candidate BLOCK rule against the audit trail's prior `allow` decisions; if it
// would have blocked safe actions, the caller quarantines it to `warn` instead.
const REGRESSION_FALSE_BLOCK_LIMIT = 0; // any prior safe action it would block => quarantine

function getAuditTrailPath() {
  return path.join(path.dirname(getFeedbackLogPath()), 'audit-trail.jsonl');
}

// Returns { falseBlocks, allowSampleSize } or null when there is no history /
// matcher available — in which case the caller promotes as usual (fail-open to
// existing behavior, since regression gating is an enhancement, not a hard gate).
function regressionCheck(gate, options = {}) {
  const auditPath = options.auditTrailPath || getAuditTrailPath();
  const entries = readJSONL(auditPath);
  if (!entries.length) return null;
  // Lazy-require to avoid the gates-engine <-> auto-promote-gates require cycle.
  let matchesGate;
  try { ({ matchesGate } = require('./gates-engine')); } catch { return null; }
  if (typeof matchesGate !== 'function') return null;
  let allowed = entries.filter((e) => e && e.decision === 'allow' && e.toolName);
  if (!allowed.length) return null;

  // The command we just learned to block was, by definition, ALLOWED before we
  // learned it — that prior allow IS the incident the operator thumbs-downed.
  // Counting it as a false block quarantines every gate learned from a real
  // failure, which is the normal path (run it, get burned, 👎 it). Exclude the
  // originating contexts so the check only measures collateral damage to
  // genuinely unrelated actions.
  // Match on normalized command EQUALITY, not substring containment: a longer,
  // genuinely different command that merely quotes the incident text (e.g.
  // `notify-team --dry-run "<incident>"`) is real collateral damage and must
  // still count toward quarantine.
  const incidentSignatures = new Set(
    (options.incidentContexts || [])
      .map((c) => normalizeCommandSignature(String(c || '')))
      .filter(Boolean),
  );
  if (incidentSignatures.size > 0) {
    allowed = allowed.filter((e) => {
      const cmd = (e.toolInput && (e.toolInput.command || e.toolInput.pattern)) || '';
      return !incidentSignatures.has(normalizeCommandSignature(String(cmd)));
    });
    if (!allowed.length) return { falseBlocks: 0, allowSampleSize: 0 };
  }

  let falseBlocks = 0;
  for (const e of allowed) {
    try {
      if (matchesGate(gate, e.toolName, e.toolInput || {})) falseBlocks += 1;
    } catch { /* a bad pattern/entry never counts as a false block */ }
  }
  return { falseBlocks, allowSampleSize: allowed.length };
}

function safeRegressionCheck(gate, options) {
  try { return regressionCheck(gate, options); } catch { return null; }
}

function loadAutoGates() {
  const autoGatesPath = getAutoGatesPath();
  if (!fs.existsSync(autoGatesPath)) {
    return { version: 1, gates: [], promotionLog: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(autoGatesPath, 'utf-8'));
  } catch {
    return { version: 1, gates: [], promotionLog: [] };
  }
}

function saveAutoGates(data) {
  const autoGatesPath = getAutoGatesPath();
  const dir = path.dirname(autoGatesPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(autoGatesPath, JSON.stringify(data, null, 2) + '\n');
}

function isNegative(entry) {
  const sig = (entry.signal || entry.feedback || '').toLowerCase();
  return NEG_SIGNALS.has(sig);
}

/**
 * Normalize a captured command/context string so trivial variants collapse
 * to the same gate signature.
 *
 * Reddit critique (MomSausageandPeppers, 2026-05-17): "commands are matched
 * by string equality, so `rm -rf node_modules` and `rm -rf ./node_modules`
 * create separate gates."
 *
 * Conservative — only collapse variants that are *unambiguously* the same
 * intent. Does NOT reorder flags, strip `&&` chains, or canonicalize
 * subcommands (each can change semantics).
 *
 *  1. Lowercase
 *  2. Strip `/Users/<name>` and `/home/<name>` home-dir prefixes (→ `~`)
 *  3. Drop `:LINE` and `:LINE:COL` refs
 *  4. Per-token: strip one layer of matching outer quotes/backticks
 *  5. Per-token: drop leading `./`
 *  6. Collapse whitespace + trim
 */
function normalizeCommandSignature(input) {
  let text = String(input || '');
  if (!text) return '';
  text = text.toLowerCase();
  text = text.replace(/\/users\/[^\s/]+/g, '~').replace(/\/home\/[^\s/]+/g, '~');
  text = text.replace(/:\d+(?::\d+)?\b/g, '');
  const tokens = text.split(/\s+/).filter(Boolean).map((tok) => {
    let t = tok;
    if (t.length >= 2) {
      const first = t[0];
      const last = t[t.length - 1];
      if ((first === '"' || first === "'" || first === '`') && first === last) {
        t = t.slice(1, -1);
      }
    }
    if (t.startsWith('./')) t = t.slice(2);
    return t;
  }).filter(Boolean);
  return tokens.join(' ').trim();
}

/**
 * Prefer an executable action we can match at PreToolUse time.
 * Tag-only or pure prose feedback is useful memory — not an enforcement pattern.
 */
function extractExecutableAction(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const fromTool =
    (entry.toolInput && (entry.toolInput.command || entry.toolInput.pattern))
    || (entry.tool_input && (entry.tool_input.command || entry.tool_input.pattern))
    || entry.command
    || entry.failedCommand
    || null;
  if (fromTool && String(fromTool).trim().length >= 4) {
    return String(fromTool).trim();
  }

  const ctx = String(entry.context || entry.whatWentWrong || '').trim();
  if (ctx.length < 4) return null;

  // Looks like a shell / CLI invocation (not free-form prose).
  const looksExecutable = /^(?:sudo\s+)?(?:~\/|\.\/|\/)?(?:[A-Za-z0-9._+-]+\/)*[A-Za-z0-9._+-]+(?:\s|$)/.test(ctx)
    && /\s|^[a-z0-9._+-]+(?:\s|$)/i.test(ctx)
    && !/\s+(?:broke|failed|wrong|should|never|please|the agent)\b/i.test(ctx.slice(0, 80));
  // Strong signal: known tool prefixes
  const known = /^(?:sudo\s+)?(?:kubectl|git|npm|npx|yarn|pnpm|python|python3|node|curl|wget|docker|podman|rm|mv|cp|chmod|chown|psql|mysql|mongo|terraform|pulumi|aws|gcloud|az|helm|ssh|scp|rsync|make|cargo|go|ruby|perl|bash|sh|zsh)\b/i.test(ctx);
  if (known || (looksExecutable && /[\s-]/.test(ctx) && ctx.length <= 200)) {
    return ctx;
  }
  return null;
}

function extractPatternKey(entry) {
  // Enforcement groups by executable action only. Tags remain diagnostic metadata
  // and must not create hard-block thresholds for a single unrelated latest command.
  const action = extractExecutableAction(entry);
  if (!action) return null;
  return normalizeCommandSignature(action).slice(0, 100);
}

function extractDiagnosticKeys(entry) {
  const keys = [];
  const diagnosis = entry && entry.diagnosis ? entry.diagnosis : null;
  if (!diagnosis) return keys;

  if (diagnosis.rootCauseCategory) {
    keys.push(`diagnosis:${diagnosis.rootCauseCategory}`);
  }

  const violations = Array.isArray(diagnosis.violations) ? diagnosis.violations : [];
  violations.slice(0, 3).forEach((violation) => {
    const key = violation.constraintId || violation.message;
    if (key) {
      keys.push(`constraint:${key}`);
    }
  });

  return keys;
}

function groupNegativeFeedback(entries, windowDays) {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const groups = {};

  for (const entry of entries) {
    if (!isNegative(entry)) continue;

    const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
    if (ts < cutoff) continue;

    // Enforcement groups ONLY by executable action. Tag/diagnosis metadata is
    // useful for memory and dashboards, but must not create hard-block thresholds
    // that attach to an unrelated latest command.
    const key = extractPatternKey(entry);
    if (!key) continue;

    if (!groups[key]) {
      groups[key] = {
        key,
        count: 0,
        entries: [],
        latestContext: '',
        latestTimestamp: '',
        latestExecutable: '',
      };
    }
    groups[key].count++;
    groups[key].entries.push(entry);
    if (!groups[key].latestTimestamp || (entry.timestamp && entry.timestamp > groups[key].latestTimestamp)) {
      groups[key].latestTimestamp = entry.timestamp || '';
      const action = extractExecutableAction(entry);
      groups[key].latestContext = action || entry.context || entry.whatWentWrong || '';
      groups[key].latestExecutable = action || '';
    }
  }

  return groups;
}

function patternToGateId(key) {
  return 'auto-' + key.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 50).toLowerCase();
}

/**
 * Turn a captured context string into a pattern the gates engine can actually
 * match. `gates-engine.js` compiles `gate.pattern` with `new RegExp(...)` and
 * tests it against the tool-call text, so the pattern MUST be regex-safe text
 * drawn from the command itself.
 *
 * It must NOT be the group key: keys are frequently tag-derived
 * ("entity:Customer+entity:Funnel"), which is both meaningless against a command
 * string and actively hazardous as a regex ('+' is a quantifier). Grouping by tag
 * is correct — reusing that key as the match pattern is not.
 */
function contextToPattern(context) {
  const raw = String(context || '').trim();
  if (raw.length < 4) return null;
  // Escape every regex metacharacter: the captured command is literal text.
  return raw.slice(0, 120).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A gate that cannot match the very context that produced it is inert — it
 * shows up in the dashboard as an active blocking rule while enforcing nothing.
 * That failure mode is worse than no gate at all, so callers drop these.
 */
function gateMatchesOwnContext(gate, context) {
  if (!gate || !gate.pattern) return false;
  try {
    return new RegExp(gate.pattern).test(String(context || ''));
  } catch {
    return false;
  }
}

function buildGateRule(group, actionOverride) {
  const action = actionOverride || (group.count === 'MANUAL' ? group.manualAction || 'block' : (group.count >= BLOCK_THRESHOLD ? 'block' : 'warn'));
  const severity = action === 'block' ? 'critical' : action === 'approve' ? 'high' : 'medium';
  const executable = (group.latestExecutable || extractExecutableAction({ context: group.latestContext }) || group.latestContext || '').slice(0, 120);
  const context = executable;
  const kind = group.key.startsWith('diagnosis:')
    ? 'repeated diagnosis'
    : group.key.startsWith('constraint:')
      ? 'repeated constraint violation'
      : 'repeated executable action';

  const occurrencesText = group.count === 'MANUAL' ? 'manual' : `${group.count} occurrences`;
  const suggestedMessage = `Auto-promoted ${kind}: "${context}" (${occurrencesText} in ${WINDOW_DAYS} days)`;

  // TTL: auto-promoted rules expire after the configured window unless
  // refreshed by a fresh fire. Manual force-promote bypasses TTL — operator
  // says "permanent" by going through the force path.
  const nowMs = Date.now();
  const isManual = group.count === 'MANUAL';
  const expiresAt = isManual ? null : new Date(nowMs + getRuleTtlMs()).toISOString();

  return {
    id: patternToGateId(group.key),
    trigger: `auto:${group.key}`,
    // Derived from the executable action, NOT from tag keys — see contextToPattern.
    pattern: contextToPattern(executable),
    action,
    message: suggestedMessage,
    severity,
    occurrences: group.count,
    promotedAt: new Date().toISOString(),
    expiresAt,
    lastFiredAt: null,
    source: group.source || 'auto-promote',
  };
}

/**
 * Drop expired gates from the data and return the gates removed.
 *
 * A gate is expired when its `expiresAt` is in the past AND its
 * `lastFiredAt` (if set) is also outside the TTL window — high-signal
 * gates that keep firing get continuously renewed and never expire.
 *
 * `expiresAt: null` is treated as "permanent" (used by force-promote /
 * legacy gates without TTL data).
 */
function expireGates(data, now = Date.now()) {
  const safeData = data && typeof data === 'object'
    ? { version: data.version || 1, gates: Array.isArray(data.gates) ? data.gates : [], promotionLog: Array.isArray(data.promotionLog) ? data.promotionLog : [] }
    : { version: 1, gates: [], promotionLog: [] };
  const ttlMs = getRuleTtlMs();
  const kept = [];
  const expired = [];
  for (const gate of safeData.gates) {
    if (!gate || typeof gate !== 'object') continue;
    // No expiresAt → treat as permanent (manual force-promote, legacy gates).
    if (gate.expiresAt == null) {
      kept.push(gate);
      continue;
    }
    const expiresMs = Date.parse(gate.expiresAt);
    if (!Number.isFinite(expiresMs)) {
      kept.push(gate);
      continue;
    }
    // If last fire is within TTL window, refresh the gate (extend expiresAt).
    const lastFiredMs = gate.lastFiredAt ? Date.parse(gate.lastFiredAt) : NaN;
    if (Number.isFinite(lastFiredMs) && now - lastFiredMs < ttlMs) {
      kept.push({ ...gate, expiresAt: new Date(lastFiredMs + ttlMs).toISOString() });
      continue;
    }
    if (now < expiresMs) {
      kept.push(gate);
    } else {
      expired.push({ id: gate.id, expiresAt: gate.expiresAt, lastFiredAt: gate.lastFiredAt });
    }
  }
  safeData.gates = kept;
  if (expired.length > 0) {
    safeData.promotionLog.push(
      ...expired.map((e) => ({ type: 'expired', gateId: e.id, expiredAt: e.expiresAt, timestamp: new Date(now).toISOString() }))
    );
  }
  return { data: safeData, expired };
}

/**
 * Mark a gate as fired now. Refreshes lastFiredAt AND extends expiresAt by
 * the full TTL — a gate that keeps catching repeats sharpens, doesn't
 * decay. Caller passes the gate ID; returns the updated gate (or null).
 */
function recordGateFire(data, gateId, now = Date.now()) {
  if (!data || !Array.isArray(data.gates)) return null;
  const idx = data.gates.findIndex((g) => g && g.id === gateId);
  if (idx === -1) return null;
  const gate = data.gates[idx];
  const lastFiredAtIso = new Date(now).toISOString();
  const updated = {
    ...gate,
    lastFiredAt: lastFiredAtIso,
    expiresAt: gate.expiresAt == null ? null : new Date(now + getRuleTtlMs()).toISOString(),
  };
  data.gates[idx] = updated;
  return updated;
}

function forcePromote(context, action = 'block') {
  if (!context) throw new Error('context is required for force-promote');
  const data = loadAutoGates();
  const gateId = patternToGateId(context);
  
  // Remove existing if any
  data.gates = data.gates.filter(g => g.id !== gateId);
  
  const gate = buildGateRule({
    key: context,
    latestContext: context,
    count: 'MANUAL',
    manualAction: action,
    source: 'force-promote'
  });
  data.gates.unshift(gate);
  
  if (data.gates.length > MAX_AUTO_GATES) {
    data.gates = data.gates.slice(0, MAX_AUTO_GATES);
  }

  data.promotionLog = data.promotionLog || [];
  data.promotionLog.push({
    gateId,
    context,
    action,
    promotedAt: new Date().toISOString(),
    source: 'force-promote'
  });

  saveAutoGates(data);
  return { gateId, action, totalGates: data.gates.length };
}

function promote(feedbackLogPath, options) {
  const opts = options || {};
  const logPath = feedbackLogPath || getFeedbackLogPath();
  const entries = readJSONL(logPath);
  const groups = groupNegativeFeedback(entries, WINDOW_DAYS);
  // Expire stale gates BEFORE running the promotion loop so an expiring
  // gate that's about to be re-promoted gets a fresh TTL via the normal
  // path rather than carrying a near-stale expiresAt.
  const { data: expiredData, expired } = expireGates(loadAutoGates());
  const data = expiredData;
  if (expired.length > 0) {
    saveAutoGates(data);
  }
  const promotions = expired.map((e) => ({ type: 'expired', gateId: e.id, expiredAt: e.expiresAt }));

  for (const group of Object.values(groups)) {
    if (group.count < WARN_THRESHOLD) continue;

    const gateId = patternToGateId(group.key);

    // Contexts that produced this gate. Their prior "allow" decisions are the
    // incident the operator thumbs-downed, not false positives — both the
    // new-gate and the warn->block upgrade path must exclude them from the
    // regression check, or every gate learned from a real failure is held at warn.
    const incidentContexts = [
      group.latestContext,
      ...(group.entries || []).map((e) => e && (e.context || e.whatWentWrong)),
    ].filter(Boolean);
    const regressionOpts = { ...opts, incidentContexts };

    // Check for existing gate — possibly upgrade
    const existingIdx = data.gates.findIndex((g) => g.id === gateId);
    if (existingIdx !== -1) {
      const existing = data.gates[existingIdx];
      const newAction = group.count >= BLOCK_THRESHOLD ? 'block' : 'warn';
      if (existing.action !== newAction && newAction === 'block') {
        // Self-Harness stage 3: regression-test before upgrading warn -> block.
        const regression = opts.skipRegression ? null : safeRegressionCheck(buildGateRule(group, 'block'), regressionOpts);
        if (regression && regression.falseBlocks > REGRESSION_FALSE_BLOCK_LIMIT) {
          // Would block prior safe actions — hold at warn instead of upgrading.
          promotions.push({ type: 'upgrade-quarantined', gateId, from: existing.action, occurrences: group.count, falseBlocks: regression.falseBlocks });
        } else {
          // Upgrade from warn to block
          data.gates[existingIdx] = { ...existing, action: 'block', severity: 'critical', occurrences: group.count, upgradedAt: new Date().toISOString() };
          promotions.push({ type: 'upgrade', gateId, from: existing.action, to: 'block', occurrences: group.count });
        }
      }
      // Update occurrence count even if no action change
      data.gates[existingIdx].occurrences = group.count;
      continue;
    }

    // New gate — respect explicit gateAction override (e.g. 'approve' for human-approval rules)
    const gate = buildGateRule(group, opts.gateAction);

    // Never persist a gate that cannot match the context that produced it. Such a
    // gate renders in the dashboard as an active blocking rule while enforcing
    // nothing, which reads as "the agent learned" when it did not.
    if (!gateMatchesOwnContext(gate, group.latestContext)) {
      promotions.push({
        type: 'skipped-unmatchable',
        gateId: gate.id,
        reason: 'derived pattern does not match originating context',
        occurrences: group.count,
      });
      continue;
    }

    // Self-Harness stage 3: before a feedback rule goes live as a hard block,
    // regression-test it against prior allowed actions. If it would have blocked
    // safe actions, quarantine it to `warn` instead of `block`.
    let regression = null;
    if (gate.action === 'block' && !opts.gateAction && !opts.skipRegression) {
      regression = safeRegressionCheck(gate, regressionOpts);
      if (regression && regression.falseBlocks > REGRESSION_FALSE_BLOCK_LIMIT) {
        gate.action = 'warn';
        gate.severity = 'medium';
        gate.quarantined = true;
        gate.regression = regression;
      }
    }

    // Enforce max limit — rotate oldest
    if (data.gates.length >= MAX_AUTO_GATES) {
      const removed = data.gates.shift();
      promotions.push({ type: 'rotated', removedGateId: removed.id });
    }

    data.gates.push(gate);
    promotions.push({
      type: gate.quarantined ? 'new-quarantined' : 'new',
      gateId: gate.id,
      action: gate.action,
      occurrences: group.count,
      ...(gate.quarantined ? { falseBlocks: regression.falseBlocks, allowSampleSize: regression.allowSampleSize } : {}),
    });
  }

  // Log promotions
  for (const p of promotions) {
    data.promotionLog = data.promotionLog || [];
    data.promotionLog.push({ ...p, timestamp: new Date().toISOString() });
  }

  saveAutoGates(data);

  return { promotions, totalGates: data.gates.length, data };
}

function runCli(argv = process.argv.slice(2)) {
  const forceContext = argv.find((arg) => arg.startsWith('--force-block='))?.split('=')[1];
  if (forceContext) {
    const result = forcePromote(forceContext, 'block');
    console.log(`Forced block gate created: ${result.gateId}`);
    console.log(`Total auto-promoted gates: ${result.totalGates}`);
    return 0;
  }

  const logPath = argv[0] && !argv[0].startsWith('--') ? argv[0] : undefined;
  const result = promote(logPath);
  if (result.promotions.length === 0) {
    console.log('No new promotions.');
  } else {
    for (const promotion of result.promotions) {
      if (promotion.type === 'new') {
        console.log(`NEW gate: ${promotion.gateId} (${promotion.action}, ${promotion.occurrences} occurrences)`);
      } else if (promotion.type === 'upgrade') {
        console.log(`UPGRADE: ${promotion.gateId} ${promotion.from} -> ${promotion.to} (${promotion.occurrences} occurrences)`);
      } else if (promotion.type === 'rotated') {
        console.log(`ROTATED out: ${promotion.removedGateId}`);
      }
    }
  }
  console.log(`Total auto-promoted gates: ${result.totalGates}`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = runCli();
  } catch (err) {
    console.error('auto-promote-gates error:', err.message);
    process.exit(1);
  }
}

module.exports = {
  promote,
  forcePromote,
  runCli,
  loadAutoGates,
  saveAutoGates,
  getAutoGatesPath,
  getGlobalAutoGatesPath,
  getAutoGatesPaths,
  groupNegativeFeedback,
  patternToGateId,
  buildGateRule,
  contextToPattern,
  gateMatchesOwnContext,
  regressionCheck,
  getAuditTrailPath,
  REGRESSION_FALSE_BLOCK_LIMIT,
  extractPatternKey,
  extractExecutableAction,
  normalizeCommandSignature,
  isNegative,
  expireGates,
  recordGateFire,
  getRuleTtlDays,
  getRuleTtlMs,
  MAX_AUTO_GATES,
  WARN_THRESHOLD,
  BLOCK_THRESHOLD,
  WINDOW_DAYS,
  DEFAULT_RULE_TTL_DAYS,
};
