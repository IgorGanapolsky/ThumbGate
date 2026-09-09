#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { loadOptionalModule } = require('./private-core-boundary');

const { isProTier, isInTrialPeriod, FREE_TIER_MAX_GATES, FREE_TIER_DAILY_BLOCKS, todayKey } = require('./rate-limiter');
const {
  DEFAULT_BASE_BRANCH,
  evaluateOperationalIntegrity,
} = require('./operational-integrity');
const {
  evaluateWorkflowSentinel,
} = require('./workflow-sentinel');
const {
  evaluateFinancialControl,
} = require('./financial-control-plane');
const {
  evaluateBrokerReceiptGate,
} = require('./broker-execution-receipts');
const {
  buildCostControl,
  normalizeProviderAction,
} = require('./provider-action-normalizer');
const {
  recordDecisionEvaluation,
  recordDecisionOutcome,
} = require('./decision-journal');
const {
  actionFingerprint,
  sanitizeFeedbackText,
} = require('./feedback-sanitizer');

/**
 * Computes the SHA-256 hash of an executable binary to prevent path-based bypasses.
 * (Layer 5: Supply Chain / Layer 3: Execution)
 */
function computeExecutableHash(command) {
  try {
    if (!command) return null;
    const firstWord = command.trim().split(/\s+/)[0];
    if (!firstWord) return null;

    // Resolve absolute path using 'which'. Use execFileSync (no shell) and pass
    // firstWord as an argv element, never interpolated into a command string, so
    // a hostile `command` value cannot inject shell metacharacters here.
    let fullPath;
    try {
      fullPath = execFileSync('which', [firstWord], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch (e) {
      // If 'which' fails, it might be an absolute path or a non-existent command
      fullPath = path.isAbsolute(firstWord) ? firstWord : null;
    }
    
    if (!fullPath || !fs.existsSync(fullPath) || !fs.lstatSync(fullPath).isFile()) return null;

    const buffer = fs.readFileSync(fullPath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  } catch (e) {
    return null;
  }
}
const {
  scanHookInput,
  buildSafeSummary,
  redactText,
  isSafeSecretStorageWrite,
  SAFE_SECRET_STORAGE_DIRS,
} = require('./secret-scanner');
const {
  evaluateSecurityScan,
} = require('./security-scanner');
const { evaluatePlanGate } = require('./plan-gate');
const { evaluateStealthMemoryInjection } = require('./stealth-memory-injection-gate');
const { getTrajectoryScore } = require('./trajectory-scorer');
const { evaluateSequenceState } = loadOptionalModule('./sequence-guard', () => ({
  evaluateSequenceState: () => null,
}));
const { getAutoGatesPath } = require('./auto-promote-gates');
const { recordAuditEvent, auditToFeedback } = require('./audit-trail');
const { consumeVerifiedApproval, listEscalations, requestEscalation } = require('./human-escalation');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'gates', 'default.json');
const DEFAULT_CLAIM_GATES_PATH = path.join(__dirname, '..', 'config', 'gates', 'claim-verification.json');

function resolveThumbgateStateDir() {
  if (process.env.THUMBGATE_STATE_DIR) return process.env.THUMBGATE_STATE_DIR;

  if (process.env.XDG_STATE_HOME) {
    return path.join(process.env.XDG_STATE_HOME, 'thumbgate');
  }

  if (process.env.CODEX_SANDBOX) {
    return path.join(os.tmpdir(), 'thumbgate');
  }

  return path.join(process.env.HOME || os.tmpdir(), '.thumbgate');
}

const STATE_DIR = resolveThumbgateStateDir();
const STATE_PATH = path.join(STATE_DIR, 'gate-state.json');
const CONSTRAINTS_PATH = path.join(STATE_DIR, 'session-constraints.json');
const STATS_PATH = path.join(STATE_DIR, 'gate-stats.json');
const SESSION_ACTIONS_PATH = path.join(STATE_DIR, 'session-actions.json');
const CUSTOM_CLAIM_GATES_PATH = path.join(STATE_DIR, 'claim-verification.json');
const GOVERNANCE_STATE_PATH = path.join(STATE_DIR, 'governance-state.json');
const REMEDY_TOOL_NAMES = new Set([
  'satisfy_gate',
  'capture_feedback',
  'capture_memory_feedback',
  'record_task_outcome',
  'diagnose_failure',
  'set_task_scope',
  'approve_protected_action',
  'track_action',
  'verify_claim',
  'break_glass_emergency',
]);
const TTL_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_ACTION_TTL_MS = 60 * 60 * 1000; // 1 hour
const PROTECTED_APPROVAL_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_ADMIN_OVERRIDE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_PROTECTED_FILE_GLOBS = [
  'AGENTS.md',
  'CLAUDE.md',
  'CLAUDE.local.md',
  'GEMINI.md',
  'README.md',
  '.gitignore',
  '.husky/**',
  '.claude/**',
  'skills/**',
  'SKILL.md',
  'config/gates/**',
];
const EDIT_LIKE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
const HIGH_RISK_BASH_PATTERN = /\b(?:git\s+(?:add|commit|push)|gh\s+pr\s+(?:create|merge)|npm\s+publish|yarn\s+publish|pnpm\s+publish|rm\s+-rf)\b/i;
const REMOTE_SIDE_EFFECT_BASH_PATTERN = /\b(?:git\s+push\b|gh\s+pr\s+(?:create|merge|close|reopen|ready|edit)\b|gh\s+release\s+(?:create|delete|edit|upload)\b|npm\s+publish\b|yarn\s+publish\b|pnpm\s+publish\b)\b/i;
const MAX_COMMAND_SCAN_CHARS = 20000;
const BOOSTED_RISK_BLOCK_SCORE = 0.8;
const BOOSTED_RISK_MIN_EXAMPLES = 3;
const PR_THREAD_RESOLUTION_ACTION = 'pr_thread_resolution_verified_after_commit';
const HELPER_BYPASS_ACTION = 'helper_script_modified';
const KNOWLEDGE_ENTROPY_THRESHOLD = 0.7;
// Generous character bound: keeps every affected file for realistic actions while still
// preventing an unbounded haystack. Chosen over a file-count cap, which dropped targets.
const MEMORY_GUARD_MAX_SERIALIZED_CHARS = 200000;
const KNOWLEDGE_CONFLICT_STRICT_BASH_PATTERN = /\b(?:git\s+push\b|gh\s+pr\s+merge\b|gh\s+release\s+(?:create|delete|edit|upload)\b|(?:npm|yarn|pnpm)\s+publish\b|rm\s+-rf\b|git\s+reset\s+--hard\b|git\s+clean\s+-f[a-z]*|railway\s+(?:deploy|up)\b|gcloud\s+(?:run\s+deploy|app\s+deploy)\b|firebase\s+deploy\b|vercel\s+--prod\b|kubectl\s+(?:apply|delete)\b|terraform\s+(?:apply|destroy)\b)\b/i;
const HELPER_SCRIPT_FILE_PATTERN = /(?:^|\/)(?:scripts|bin|tools|tasks|\.githooks|\.github\/workflows)\/|(?:^|\/)(?:package\.json|Makefile|justfile|Taskfile\.ya?ml)$|\.(?:sh|bash|zsh|fish|js|mjs|cjs|ts|tsx|py|rb|pl|ps1|yml|yaml)$/i;
const PACKAGE_RUN_PATTERN = /\b(?:npm|yarn|pnpm)\s+run\s+([:@./\w-]+)\b/i;
const HELPER_EXEC_PATTERN = /(?:^|[;&|]\s*|\b(?:bash|sh|zsh|node|python3?|ruby|perl|tsx|ts-node)\s+)(?:(?:\.?\.?\/)?(?:scripts|bin|tools|tasks|tmp|build|dist|\.tmp|\.cache)\/[^\s;&|]+|\.\/[^\s;&|]+\.(?:sh|bash|zsh|js|mjs|cjs|ts|py|rb|pl|ps1))\b/i;
const HELPER_WRITE_PATTERN = /\b(?:cat|printf|echo|tee|npm\s+pkg\s+set|jq|node\s+-e|python3?\s+-c)\b[\s\S]{0,300}(?:>|--field|scripts\.|package\.json|(?:scripts|bin|tools|tasks|tmp|build|dist|\.tmp|\.cache)\/[^\s;&|]+|\.(?:sh|js|mjs|cjs|ts|py|rb|pl|ps1))\b/i;
const NETWORK_OR_PROCESS_BOUNDARY_PATTERN = /\b(?:curl|wget|nc|ncat|socat|ssh|scp|rsync|ftp|python3?\s+-m\s+http\.server|node\s+-e|python3?\s+-c|perl\s+-e|ruby\s+-e|bash\s+-c|sh\s+-c|osascript|open)\b/i;
const DOWNLOAD_EXEC_CHAIN_PATTERN = /\b(?:curl|wget)\b[\s\S]{0,400}(?:\|\s*(?:bash|sh|zsh)|&&[\s\S]{0,200}\bchmod\s+\+x\b[\s\S]{0,200}&&[\s\S]{0,120}(?:\.\/|bash|sh|node|python3?))/i;
const DESTRUCTIVE_OR_PRIVILEGE_BOUNDARY_PATTERN = /\b(?:rm\s+-rf|chmod\s+(?:\+x|777)|chown\b|sudo\b|dd\s+if=|mkfs|git\s+reset\s+--hard|git\s+clean\s+-f[a-z]*|kubectl\s+(?:apply|delete)|terraform\s+(?:apply|destroy)|railway\s+(?:deploy|up)|gcloud\s+(?:run\s+deploy|app\s+deploy)|vercel\s+--prod|firebase\s+deploy)\b/i;

// ---------------------------------------------------------------------------
// Enforcement posture (CEO decision 2026-06-04): WARN + AUDIT by default.
// Unconditional floors run before posture conversion: secret exfiltration, deny results
// from the security scanner, and the four canonical self-protection gates. Arbitrary
// destructive commands do not get a regex-based "catastrophic" floor; wrappers and
// obfuscation make that boundary misleading. Every other deny/approve becomes a warning
// unless the operator explicitly enables THUMBGATE_STRICT_ENFORCEMENT=1.
const SELF_PROTECT_HARD_FLOOR_GATE_IDS = new Set([
  'self-protect-config',
  'self-protect-kill',
  'self-protect-env-override',
  'self-protect-hooks-disable',
]);
// An expired task-scope lease gets its OWN gate id so it can be exempted from the two downgrade
// paths without touching ordinary task-scope denials. Without this the fail-closed guarantee is
// cosmetic: applyEnforcementPosture turns denials into warnings by default, and applyDailyBlockCap
// does the same for capped free-tier users — so an edit under a lapsed lease would execute anyway.
// A lease that stops binding when you are busy or over quota is not a lease.
const TASK_SCOPE_LEASE_EXPIRED_GATE_ID = 'task-scope-lease-expired';

const UNCONDITIONAL_HARD_FLOOR_GATE_IDS = new Set([
  'secret-exfiltration',
  'security-vuln-scan',
  'slopsquat-guard',
  // Money path: even if a refactor later routes financial denials through
  // applyEnforcementPosture, never demote spend blocks to warn-by-default.
  // Apollo $588 incident class (2026-08).
  'financial-control',
  // Outbound email: irreversible delivery. Keep the hard gate intact until a
  // separately authenticated admin override bound to the exact action digest
  // authorizes one retry (AGENT-259 / District Cyber 2026-08-04).
  'outbound-email-send',
  TASK_SCOPE_LEASE_EXPIRED_GATE_ID,
  ...SELF_PROTECT_HARD_FLOOR_GATE_IDS,
]);
// Issue #2782 (reported by Andy Martin, 2026-07-08): after the free-tier daily
// block cap is hit, applyDailyBlockCap() downgraded EVERY config-declared
// "block" gate to a warning — including these catastrophic, effectively
// irreversible commands — with no THUMBGATE_STRICT_ENFORCEMENT check at all.
// A free-tier user past their daily cap could have `rm -rf ~`, a force push,
// `git reset --hard`, or `git clean -f` silently allowed through. These four
// map directly to CLAUDE.md's own hard-block list and must never be subject
// to the daily cap discount, regardless of tier or strict-mode setting.
// financial-control is included for the same reason: a daily-cap discount on
// checkout/subscription spends would re-open the never-spend interlock.
const CATASTROPHIC_DECLARATIVE_GATE_IDS = new Set([
  TASK_SCOPE_LEASE_EXPIRED_GATE_ID,
  'force-push',
  'git-reset-hard',
  'git-clean-force',
  'rm-rf-home-or-root',
  'financial-control',
  // Never daily-cap discount a denied autonomous email send (same class as force-push).
  'outbound-email-send',
]);
const SELF_PROTECT_CONFIG_TARGET_PATTERN = /(?:^|\/)(?:config\/gates\/|config\/(?:budget|enforcement|mcp-allowlists)\.json$|\.thumbgate\/config\.json$|thumbgate\.json$)/i;
const SELF_PROTECT_HOOK_TARGET_PATTERN = /(?:^|\/)(?:\.claude\/settings(?:\.local)?\.json|\.codex\/config\.toml|scripts\/hook-[^/]+\.(?:js|sh))$/i;
const SELF_PROTECT_CONFIG_COMMAND_PATTERN = /(?:config\/gates\/|config\/(?:budget|enforcement|mcp-allowlists)\.json\b|\.thumbgate\/config\.json\b|thumbgate\.json\b)/i;
const SELF_PROTECT_HOOK_COMMAND_PATTERN = /(?:\.claude\/settings(?:\.local)?\.json|\.codex\/config\.toml|scripts\/hook-[^\s'";|]+\.(?:js|sh))\b/i;
const SHELL_FILE_MUTATION_PATTERN = /\b(?:sed\s+-i|perl\s+-pi|python\d*\s+-c|node\s+-e|ruby\s+-e|tee|truncate|rm|mv|cp|install|patch|jq)\b|(?:^|[\s;&|])>{1,2}\s*\S/i;

function isSelfProtectGate(gateId) {
  return SELF_PROTECT_HARD_FLOOR_GATE_IDS.has(gateId);
}

/**
 * Name the existing warn-by-default vs strict postures in Trustwise Control Tower
 * vocabulary (live / sidecar / simulation / batch) without cloning their product.
 * Default remains sidecar (= warn-by-default). Hard floors never demote.
 */
function resolveGovernanceMode(env = process.env) {
  // Strict opt-in wins over inherited simulation/batch. Hermes CLI sets
  // THUMBGATE_STRICT_ENFORCEMENT=1 internally; a leftover shadow mode in the
  // process env must not demote those denials.
  if (env.THUMBGATE_STRICT_ENFORCEMENT === '1') return 'live';
  const raw = String(env.THUMBGATE_GOVERNANCE_MODE || '').trim().toLowerCase();
  if (raw === 'simulation' || raw === 'batch') return raw;
  if (raw === 'live') return 'live';
  return 'sidecar';
}

function alignmentLayerForResult(result) {
  const gate = String(result && result.gate || '');
  if (
    UNCONDITIONAL_HARD_FLOOR_GATE_IDS.has(gate)
    || CATASTROPHIC_DECLARATIVE_GATE_IDS.has(gate)
    || /secret|self-protect|exfil/i.test(gate)
  ) {
    return 'safety';
  }
  if (/task-scope|local-only|pr_thread|sla/i.test(gate)) return 'sla';
  return 'business';
}

function applyEnforcementPosture(result) {
  if (!result || (result.decision !== 'deny' && result.decision !== 'approve')) return result;
  const mode = resolveGovernanceMode();
  const alignmentLayer = alignmentLayerForResult(result);
  // Defensive backstop: hard-floor results must never be posture-downgraded.
  if (UNCONDITIONAL_HARD_FLOOR_GATE_IDS.has(result.gate)) {
    return { ...result, governanceMode: mode, alignmentLayer };
  }
  // Simulation/batch shadow live traffic: record, do not block (except floors).
  // Only denials are shadowed — allow/approve stay as-is.
  if (mode === 'simulation' || mode === 'batch') {
    if (result.decision === 'deny') {
      return {
        ...result,
        decision: 'warn',
        warnByDefault: true,
        governanceMode: mode,
        alignmentLayer,
        simulated: true,
        message: `${result.message}\n\n⚠️ ThumbGate governance mode=${mode} — flagged and logged, not blocked.`,
      };
    }
    return { ...result, governanceMode: mode, alignmentLayer, simulated: true };
  }
  // Full hard enforcement opt-in: keep every deny.
  if (mode === 'live' || process.env.THUMBGATE_STRICT_ENFORCEMENT === '1') {
    return { ...result, governanceMode: 'live', alignmentLayer };
  }
  // Honor the explicit strict-knowledge-conflict opt-in for that gate.
  if (process.env.THUMBGATE_STRICT_KNOWLEDGE_CONFLICT === '1' && result.gate === 'knowledge-conflict-gate') {
    return { ...result, governanceMode: mode, alignmentLayer };
  }
  // Sidecar / warn-by-default: the gate still fired and is recorded; the action is allowed through
  // with the warning surfaced instead of hard-blocked, so legitimate work is never blocked.
  return {
    ...result,
    decision: 'warn',
    warnByDefault: true,
    governanceMode: 'sidecar',
    alignmentLayer,
    message: `${result.message}\n\n⚠️ ThumbGate is in warn-by-default mode (sidecar) — this was flagged and logged, not blocked. Set THUMBGATE_STRICT_ENFORCEMENT=1 or THUMBGATE_GOVERNANCE_MODE=live to hard-block other flagged actions.`,
  };
}
const BREAK_GLASS_CONDITION = 'thumbgate_break_glass';
const BREAK_GLASS_SETTINGS_GLOBS = [
  '.claude/settings.local.json',
  '.claude/settings.json',
  '**/.claude/settings.local.json',
  '**/.claude/settings.json',
  '.codex/config.toml',
  '**/.codex/config.toml',
];

function isRuntimePlanGateEnabled() {
  return process.env.THUMBGATE_PLAN_GATE === '1' || process.env.THUMBGATE_PLAN_GATE === 'true';
}
const PR_THREAD_RESOLUTION_CLAIM_PATTERN = '(?:thread|review|comment).*?(?:resolved|verified|checked|addressed|fixed)|(?:resolved|verified|checked|addressed|fixed).*?(?:thread|review|comment)';
const PR_THREAD_RESOLUTION_REQUIRED_ACTIONS = ['pr_threads_checked', 'thread_resolution_verified'];

function commandScanText(command) {
  return String(command || '').slice(0, MAX_COMMAND_SCAN_CHARS);
}

function commandWords(command) {
  return commandScanText(command).toLowerCase().split(/\s+/).filter(Boolean);
}

function commandContainsSequence(words, sequence) {
  if (!Array.isArray(words) || !Array.isArray(sequence) || sequence.length === 0) return false;
  for (let i = 0; i <= words.length - sequence.length; i += 1) {
    let matched = true;
    for (let j = 0; j < sequence.length; j += 1) {
      if (words[i + j] !== sequence[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

function commandHasPostMethod(words) {
  return ghApiHttpMethod(words) === 'post';
}

function ghApiHttpMethod(words) {
  const list = Array.isArray(words) ? words : [];
  for (let i = 0; i < list.length; i += 1) {
    const word = list[i];
    if ((word === '-x' || word === '--method') && list[i + 1]) return String(list[i + 1]).toLowerCase();
    if (word.startsWith('--method=')) return word.slice('--method='.length).toLowerCase();
    if (word.startsWith('-x') && word.length > 2 && !word.startsWith('-x=')) {
      return word.slice(2).toLowerCase();
    }
  }
  return null;
}

function ghApiEndpoint(words) {
  const list = Array.isArray(words) ? words : [];
  const apiIndex = list.findIndex((word, i) => word === 'api' && list[i - 1] === 'gh');
  if (apiIndex < 0) return null;
  const flagsWithValue = new Set([
    '-x', '--method', '-f', '--field', '-F', '--raw-field',
    '-h', '--header', '--hostname', '--jq', '--input', '--cache',
  ]);
  for (let i = apiIndex + 1; i < list.length; i += 1) {
    const word = list[i];
    if (word.startsWith('-')) {
      if (word.includes('=')) continue;
      if (flagsWithValue.has(word)) i += 1;
      continue;
    }
    return word;
  }
  return null;
}

function isGhApiPrCreateCommand(command) {
  const words = commandWords(command);
  if (!commandContainsSequence(words, ['gh', 'api'])) return false;
  const method = ghApiHttpMethod(words);
  if (method && method !== 'post') return false;
  const endpoint = ghApiEndpoint(words);
  if (!endpoint) return false;
  if (/\/pulls\/\d+/.test(endpoint)) return false;
  if (!(endpoint === '/pulls' || /\/pulls$/.test(endpoint))) return false;
  const fieldFlags = new Set(['-f', '--field', '--raw-field']);
  const hasFieldWrite = words.some((word) => (
    fieldFlags.has(word) ||
    word.startsWith('-f=') ||
    word.startsWith('--field=') ||
    word.startsWith('--raw-field=')
  ));
  return hasFieldWrite || commandHasPostMethod(words);
}

function isRecursiveChmodCommand(command) {
  const words = commandWords(command);
  const chmodIndex = words.indexOf('chmod');
  if (chmodIndex === -1) return false;
  return words.slice(chmodIndex + 1).includes('-r') || words.slice(chmodIndex + 1).some((word) => word.includes('r') && word.startsWith('-'));
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

function loadGatesConfig(configPath, harnessPath) {
  const primaryPath = configPath || process.env.THUMBGATE_GATES_CONFIG || DEFAULT_CONFIG_PATH;

  if (!fs.existsSync(primaryPath)) {
    throw new Error(`Gates config not found: ${primaryPath}`);
  }

  const mergedConfig = { version: 1, gates: [] };

  const loadOne = (p, isPrimary) => {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const config = JSON.parse(raw);
      if (!config || !Array.isArray(config.gates)) {
        if (isPrimary) throw new Error('Invalid gates config: missing "gates" array');
        return;
      }
      return config.gates;
    } catch (e) {
      if (isPrimary) throw e;
      console.error(`Warning: failed to load gates from ${p}: ${e.message}`);
      return [];
    }
  };

  const primaryGates = loadOne(primaryPath, true).map(g => ({ ...g, layer: g.layer || 'Execution' }));
  mergedConfig.gates.push(...primaryGates);

  // Always preserve the full primary/default safety policy. Free tier limits apply
  // only to auto-promoted add-on gates so core protections never disappear.
  const autoConfigPath = getAutoGatesPath();
  if (!configPath && fs.existsSync(autoConfigPath)) {
    const autoGates = loadOne(autoConfigPath, false).map(g => ({ ...g, layer: g.layer || 'Execution' }));
    const limitedAutoGates = isProTier()
      ? autoGates
      : autoGates.slice(0, FREE_TIER_MAX_GATES);
    mergedConfig.gates.push(...limitedAutoGates);
  }

  // Load workflow-specific harness gates (always additive, never replaces default).
  // Resolved by harness-selector based on tool name + command context.
  const resolvedHarness = harnessPath || process.env.THUMBGATE_HARNESS_CONFIG;
  if (resolvedHarness && fs.existsSync(resolvedHarness)) {
    const harnessGates = (loadOne(resolvedHarness, false) || [])
      .map(g => ({ ...g, layer: g.layer || 'Execution', source: g.source || 'harness' }));
    mergedConfig.gates.push(...harnessGates);
  }

  return mergedConfig;
}

// ---------------------------------------------------------------------------
// State and Constraints management
// ---------------------------------------------------------------------------

function loadJSON(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function saveJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function loadState() { return loadJSON(module.exports.STATE_PATH); }
function saveState(state) { saveJSON(module.exports.STATE_PATH, state); }

function loadConstraints() { return loadJSON(module.exports.CONSTRAINTS_PATH); }
function saveConstraints(constraints) { saveJSON(module.exports.CONSTRAINTS_PATH, constraints); }

function normalizePosix(filePath) {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .trim();
}

function normalizeGlob(glob) {
  return normalizePosix(glob).replace(/\/+$/, '');
}

function sanitizeGlobList(globs) {
  if (!Array.isArray(globs)) return [];
  return [...new Set(globs.map((glob) => normalizeGlob(glob)).filter(Boolean))];
}

// Affected files are compared as repo-relative paths (git --name-only output and
// inline paths are relative to the repo root). A caller who passes an ABSOLUTE
// allowedPath (e.g. "/Users/me/proj/src/**") therefore declares a glob that can never
// match — a silent no-op scope. When repoPath is known, rebase absolute globs that
// live under it to the repo-relative form so the scope actually applies. Globs already
// relative, or absolute but outside repoPath, are returned unchanged.
function rebaseGlobsToRepoRoot(globs, repoPath) {
  // normalizeGlob strips both leading AND trailing slashes, so a repoPath with a
  // trailing slash ("/Users/me/proj/") still matches the repo-relative globs.
  const repoRel = normalizeGlob(repoPath);
  if (!repoRel) return globs;
  return globs.map((glob) => {
    if (glob === repoRel) return '**';
    if (glob.startsWith(`${repoRel}/`)) {
      const rebased = glob.slice(repoRel.length + 1);
      return rebased || '**';
    }
    return glob;
  });
}

function globToRegExp(glob) {
  const normalized = normalizeGlob(glob);
  let pattern = '^';
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === '*') {
      if (next === '*') {
        pattern += '.*';
        i += 1;
      } else {
        pattern += '[^/]*';
      }
      continue;
    }
    if ('\\^$+?.()|{}[]'.includes(char)) {
      pattern += `\\${char}`;
      continue;
    }
    pattern += char;
  }
  pattern += '$';
  return new RegExp(pattern);
}

function matchesGlob(filePath, glob) {
  if (!glob) return false;
  try {
    return globToRegExp(glob).test(normalizePosix(filePath));
  } catch {
    return false;
  }
}

function matchesAnyGlob(filePath, globs) {
  return sanitizeGlobList(globs).some((glob) => matchesGlob(filePath, glob));
}

function clampTtlMs(value, fallbackMs) {
  const fallback = Number.isFinite(fallbackMs) ? fallbackMs : PROTECTED_APPROVAL_TTL_MS;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(Math.max(numeric, 60 * 1000), 24 * 60 * 60 * 1000);
}

// Default lease when a caller asks for one without saying how long. clampTtlMs floors at 60s.
const TASK_SCOPE_LEASE_MS = 15 * 60 * 1000;

/**
 * A task scope with no `expiresAt` is permanent — that is the historical contract and every
 * existing scope on disk has it. Only a scope that explicitly took a lease can expire.
 */
function isTaskScopeExpired(taskScope, nowMs = Date.now()) {
  if (!taskScope || typeof taskScope !== 'object') return false;
  // `expiresAt: null` means permanent, and it MUST be checked before the numeric coercion:
  // Number(null) is 0, not NaN, so a null deadline would otherwise read as "expired in 1970".
  // Combined with fail-closed enforcement that would revoke authority from every permanent
  // scope the moment this shipped. Caught by tests/task-scope-lease.test.js.
  if (taskScope.expiresAt == null) return false;
  const deadline = Number(taskScope.expiresAt);
  if (!Number.isFinite(deadline)) return false;
  return nowMs >= deadline;
}

function currentScopeSessionId(explicitSessionId = null) {
  if (explicitSessionId) return String(explicitSessionId).trim();
  const raw = String(
    process.env.THUMBGATE_SESSION_AGENT
    || process.env.THUMBGATE_SESSION_ID
    || process.env.CLAUDE_SESSION_ID
    || ''
  ).trim();
  return raw || null;
}

function sanitizeScopeSessionId(sessionId) {
  if (!sessionId) return '';
  const hash = crypto.createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 16);
  const prefix = String(sessionId).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 32);
  return prefix ? `${prefix}-${hash}` : hash;
}

// Sibling agents share ~/.thumbgate/governance-state.json today, so one
// set_task_scope rebinds every other live session (#3522). When a session id
// is present, persist a per-session file next to the legacy slot.
function governanceStatePath(explicitSessionId = null) {
  const base = module.exports.GOVERNANCE_STATE_PATH;
  const sessionId = currentScopeSessionId(explicitSessionId);
  if (!sessionId) return base;
  const safe = sanitizeScopeSessionId(sessionId);
  if (!safe) return base;
  const parsed = path.parse(base);
  return path.join(parsed.dir, `${parsed.name}.${safe}${parsed.ext}`);
}

function loadGovernanceState(explicitSessionId = null) {
  const raw = loadJSON(governanceStatePath(explicitSessionId));
  const state = {
    taskScope: raw && raw.taskScope && typeof raw.taskScope === 'object' ? raw.taskScope : null,
    protectedApprovals: Array.isArray(raw && raw.protectedApprovals) ? raw.protectedApprovals : [],
    branchGovernance: raw && raw.branchGovernance && typeof raw.branchGovernance === 'object'
      ? raw.branchGovernance
      : null,
    workflowContract: raw && raw.workflowContract && typeof raw.workflowContract === 'object'
      ? raw.workflowContract
      : null,
  };
  const now = Date.now();
  // Annotate rather than delete. A vanished scope is indistinguishable from one never set, and
  // the difference matters: "your lease lapsed, renew it" is a different instruction from
  // "you never declared a scope".
  if (state.taskScope) {
    state.taskScope = { ...state.taskScope, expired: isTaskScopeExpired(state.taskScope, now) };
  }
  const activeApprovals = state.protectedApprovals.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    if (!entry.timestamp || !entry.expiresAt) return false;
    return entry.expiresAt > now;
  });
  state.protectedApprovals = activeApprovals;
  return state;
}

function saveGovernanceState(state, explicitSessionId = null) {
  const next = {
    taskScope: state && state.taskScope ? state.taskScope : null,
    protectedApprovals: Array.isArray(state && state.protectedApprovals) ? state.protectedApprovals : [],
    branchGovernance: state && state.branchGovernance ? state.branchGovernance : null,
    workflowContract: state && state.workflowContract ? state.workflowContract : null,
  };
  saveJSON(governanceStatePath(explicitSessionId), next);
}

function stableCanonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableCanonicalStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableCanonicalStringify(value[key])}`
  )).join(',')}}`;
}

function actionApprovalDigest(toolName, toolInput) {
  return crypto.createHash('sha256').update(stableCanonicalStringify({
    toolInput: toolInput && typeof toolInput === 'object' ? toolInput : {},
    toolName: String(toolName || ''),
  })).digest('hex');
}

function adminOverrideTaskId(gateId, digest) {
  return `admin-override:${gateId}:${digest}`;
}

function selectAdminOverrideAttempt(baseTaskId) {
  const attempts = listEscalations().filter((entry) => (
    entry.taskId === baseTaskId || String(entry.taskId || '').startsWith(`${baseTaskId}:attempt:`)
  ));
  const latest = attempts[0] || null;
  if (!latest) return baseTaskId;
  const terminal = ['rejected', 'cancelled', 'expired'].includes(latest.status)
    || latest.eventType === 'consumed'
    || Date.parse(latest.expiresAt) <= Date.now();
  if (!terminal) return latest.taskId;
  const highestAttempt = attempts.reduce((highest, entry) => {
    const match = String(entry.taskId || '').match(/:attempt:(\d+)$/);
    return Math.max(highest, match ? Number(match[1]) : 1);
  }, 1);
  return `${baseTaskId}:attempt:${highestAttempt + 1}`;
}

function evaluateAdminOverride(gate, toolName, toolInput) {
  const policy = gate && gate.adminOverride;
  if (!policy || policy.required !== true) return null;

  const approvalContextDigest = actionApprovalDigest(toolName, toolInput);
  const baseTaskId = adminOverrideTaskId(gate.id, approvalContextDigest);
  let taskId;
  try {
    taskId = selectAdminOverrideAttempt(baseTaskId);
  } catch {
    return {
      authorized: false,
      approvalContextDigest,
      escalationId: null,
      taskId: baseTaskId,
      approvalUnavailable: true,
    };
  }
  const ttlMs = Math.min(
    60 * 60 * 1000,
    Math.max(60 * 1000, Number(policy.ttlMs) || DEFAULT_ADMIN_OVERRIDE_TTL_MS),
  );
  let escalation;
  try {
    escalation = requestEscalation({
      taskId,
      reason: `Admin override required for hard gate '${gate.id}'.`,
      severity: gate.severity || 'critical',
      requester: { id: 'thumbgate-gates-engine', kind: 'service' },
      evidence: [`sha256:${approvalContextDigest}`],
      ttlMs,
      idempotencyKey: taskId,
      approvalContextDigest,
      requiredReviewerRole: 'admin',
    });
  } catch {
    return {
      authorized: false,
      approvalContextDigest,
      escalationId: null,
      taskId,
      approvalUnavailable: true,
    };
  }
  const escalationId = escalation.escalation.escalationId;
  let consumption = null;
  try {
    consumption = consumeVerifiedApproval(escalationId, {
      consumer: { id: 'thumbgate-gates-engine', kind: 'service' },
    });
  } catch {
    consumption = null;
  }

  if (!consumption || !consumption.consumed) {
    return {
      authorized: false,
      approvalContextDigest,
      escalationId,
      taskId,
      replayed: consumption?.replayed === true,
    };
  }
  return {
    authorized: true,
    approvalContextDigest,
    escalationId,
    taskId,
    approver: consumption.approval.actor,
    consumptionReceipt: consumption.consumption.eventHash,
  };
}

function setTaskScope(scopeInput = {}) {
  const explicitSessionId = scopeInput && scopeInput.sessionId ? String(scopeInput.sessionId).trim() : null;
  if (scopeInput && scopeInput.clear === true) {
    const currentState = loadGovernanceState(explicitSessionId);
    const cleared = {
      taskScope: null,
      protectedApprovals: currentState.protectedApprovals,
      branchGovernance: currentState.branchGovernance,
      workflowContract: null,
    };
    saveGovernanceState(cleared, explicitSessionId);
    refreshLocalOnlyConstraint(cleared);
    return null;
  }

  const repoPath = String(scopeInput.repoPath || '').trim() || null;
  const allowedPaths = rebaseGlobsToRepoRoot(sanitizeGlobList(scopeInput.allowedPaths), repoPath);
  if (allowedPaths.length === 0) {
    throw new Error('allowedPaths must be a non-empty array');
  }

  const protectedPaths = rebaseGlobsToRepoRoot(sanitizeGlobList(
    Array.isArray(scopeInput.protectedPaths) && scopeInput.protectedPaths.length > 0
      ? scopeInput.protectedPaths
      : DEFAULT_PROTECTED_FILE_GLOBS
  ), repoPath);
  // Optional LEASE. Without ttlMs the scope is permanent, which is the historical behaviour
  // and stays byte-identical. With ttlMs the scope becomes time-bounded authority: "write under
  // ./src for 90 seconds" rather than a standing approval that never says when it stops.
  const scopeNow = Date.now();
  const leaseMs = scopeInput.ttlMs == null ? null : clampTtlMs(scopeInput.ttlMs, TASK_SCOPE_LEASE_MS);
  const taskScope = {
    taskId: String(scopeInput.taskId || '').trim() || null,
    sessionId: currentScopeSessionId(explicitSessionId),
    summary: String(scopeInput.summary || '').trim() || null,
    allowedPaths,
    protectedPaths,
    localOnly: scopeInput.localOnly === true,
    repoPath,
    createdAt: new Date().toISOString(),
    timestamp: scopeNow,
    leaseMs,
    expiresAt: leaseMs == null ? null : scopeNow + leaseMs,
  };
  const state = loadGovernanceState(explicitSessionId);
  state.taskScope = taskScope;
  state.workflowContract = scopeInput.workflowContract && typeof scopeInput.workflowContract === 'object'
    ? scopeInput.workflowContract
    : null;
  saveGovernanceState(state, explicitSessionId);
  if (taskScope.localOnly) {
    setConstraint('local_only', true);
  }
  return taskScope;
}

function approveProtectedAction(input = {}) {
  const pathGlobs = sanitizeGlobList(input.pathGlobs);
  if (pathGlobs.length === 0) {
    throw new Error('pathGlobs must be a non-empty array');
  }
  const reason = String(input.reason || '').trim();
  if (!reason) {
    throw new Error('reason is required');
  }

  const ttlMs = clampTtlMs(input.ttlMs, PROTECTED_APPROVAL_TTL_MS);
  const now = Date.now();
  const entry = {
    id: `approval_${now}_${Math.random().toString(36).slice(2, 8)}`,
    pathGlobs,
    reason,
    evidence: String(input.evidence || '').trim() || null,
    taskId: String(input.taskId || '').trim() || null,
    timestamp: now,
    expiresAt: now + ttlMs,
  };

  const state = loadGovernanceState();
  state.protectedApprovals.push(entry);
  saveGovernanceState(state);
  return entry;
}

function breakGlassEmergency(input = {}) {
  const reason = String(input.reason || '').trim();
  if (!reason) {
    throw new Error('reason is required');
  }

  const ttlMs = Math.min(clampTtlMs(input.ttlMs, TTL_MS), TTL_MS);
  const evidence = `BREAK GLASS: ${reason}`;
  const gates = ['pr_create_allowed', 'pr_threads_checked', BREAK_GLASS_CONDITION];
  const satisfied = {};
  for (const gateId of gates) {
    // Break glass is the highest-scrutiny unlock there is. Without an explicit
    // source these records defaulted to 'cli', hiding emergency overrides among
    // ordinary ones — the exact case an auditor looks for first.
    satisfied[gateId] = satisfyCondition(gateId, evidence, null, {
      source: 'break-glass',
      actor: input.actor || 'operator',
      reason,
    });
  }

  const approval = approveProtectedAction({
    pathGlobs: BREAK_GLASS_SETTINGS_GLOBS,
    reason: evidence,
    evidence,
    ttlMs,
  });

  return {
    ok: true,
    reason,
    ttlMs,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    satisfied,
    approval,
    settingsGlobs: BREAK_GLASS_SETTINGS_GLOBS.slice(),
  };
}

function setBranchGovernance(input = {}) {
  if (input && input.clear === true) {
    const state = loadGovernanceState();
    state.branchGovernance = null;
    saveGovernanceState(state);
    refreshLocalOnlyConstraint(state);
    return null;
  }

  const branchName = String(input.branchName || '').trim() || null;
  const baseBranch = String(input.baseBranch || '').trim() || DEFAULT_BASE_BRANCH;
  const releaseSensitiveGlobs = sanitizeGlobList(
    Array.isArray(input.releaseSensitiveGlobs) ? input.releaseSensitiveGlobs : []
  );
  const governance = {
    branchName,
    baseBranch,
    prRequired: input.prRequired !== false,
    prNumber: String(input.prNumber || '').trim() || null,
    prUrl: String(input.prUrl || '').trim() || null,
    queueRequired: input.queueRequired === true,
    localOnly: input.localOnly === true,
    releaseVersion: String(input.releaseVersion || '').trim() || null,
    releaseEvidence: String(input.releaseEvidence || '').trim() || null,
    releaseSensitiveGlobs,
    timestamp: Date.now(),
    createdAt: new Date().toISOString(),
  };

  const state = loadGovernanceState();
  state.branchGovernance = governance;
  saveGovernanceState(state);
  if (governance.localOnly) {
    setConstraint('local_only', true);
  }
  return governance;
}

function getScopeState(options = {}) {
  const sessionId = typeof options === 'string' ? options : (options?.sessionId || process.env.THUMBGATE_SESSION_AGENT || null);
  return loadGovernanceState(sessionId);
}

function getBranchGovernanceState() {
  return loadGovernanceState().branchGovernance;
}

function setConstraint(key, value) {
  const constraints = loadConstraints();
  constraints[key] = {
    value,
    timestamp: Date.now()
  };
  saveConstraints(constraints);
  return constraints[key];
}

function clearConstraint(key) {
  const constraints = loadConstraints();
  delete constraints[key];
  saveConstraints(constraints);
}

function refreshLocalOnlyConstraint(governanceState = loadGovernanceState()) {
  const localOnlyActive = Boolean(
    (governanceState.taskScope && governanceState.taskScope.localOnly) ||
    (governanceState.branchGovernance && governanceState.branchGovernance.localOnly)
  );
  if (localOnlyActive) {
    setConstraint('local_only', true);
  } else {
    clearConstraint('local_only');
  }
}

function isConditionSatisfied(conditionId) {
  const state = loadState();
  const entry = state[conditionId];
  if (!entry) return false;
  const age = Date.now() - entry.timestamp;
  return age < TTL_MS;
}

function satisfyCondition(conditionId, evidence, structuredReasoning, options = {}) {
  const state = loadState();
  const entry = {
    timestamp: Date.now(),
    evidence: evidence || '',
  };
  if (structuredReasoning && typeof structuredReasoning === 'object') {
    entry.structuredReasoning = {
      premise: structuredReasoning.premise || null,
      evidence: structuredReasoning.evidence || null,
      risk: structuredReasoning.risk || null,
      conclusion: structuredReasoning.conclusion || null,
    };
  }
  state[conditionId] = entry;
  saveState(state);

  // Satisfying a gate condition IS an override: it unlocks an action the gate
  // had blocked. Previously this wrote only to the state store, so an override
  // performed through the CLI left no trace in the audit trail at all — the
  // least-supervised path was also the least-recorded. Record it explicitly.
  // Never let an audit failure break the unlock the caller is relying on.
  try {
    // Lazy require: override-audit depends on audit-trail, which this module
    // already loads; requiring at call time avoids any circular-init surprise.
    const { recordOverride } = require('./override-audit');
    recordOverride({
      gateId: conditionId,
      source: options.source || 'cli',
      actor: options.actor,
      reason: options.reason,
      evidence: entry.evidence,
      structuredReasoning: entry.structuredReasoning,
    });
  } catch {
    /* audit is best-effort; the gate state is authoritative */
  }

  return entry;
}

// ---------------------------------------------------------------------------
// Stats tracking
// ---------------------------------------------------------------------------

function loadStats() {
  const stats = loadJSON(module.exports.STATS_PATH);
  if (Object.keys(stats).length === 0) return { blocked: 0, warned: 0, passed: 0, byGate: {} };
  return stats;
}

function saveStats(stats) { saveJSON(module.exports.STATS_PATH, stats); }

function buildGateActionFingerprint(gateId, options = {}) {
  if (options.actionFingerprint) return String(options.actionFingerprint);
  const toolName = options.toolName || options.tool_name || '';
  const toolInput = options.toolInput || options.tool_input || {};
  const parts = [toolName];
  if (typeof toolInput === 'string') {
    parts.push(toolInput);
  } else if (toolInput && typeof toolInput === 'object') {
    parts.push(
      toolInput.command || '',
      toolInput.cmd || '',
      toolInput.file_path || '',
      toolInput.path || '',
      toolInput.description || '',
      toolInput.prompt || '',
      toolInput.pattern || '',
    );
    if (Array.isArray(toolInput.affectedFiles)) parts.push(...toolInput.affectedFiles);
  }
  return actionFingerprint(parts);
}

function recordStat(gateId, action, gate, options = {}) {
  const stats = loadStats();
  if (action === 'block') stats.blocked = (stats.blocked || 0) + 1;
  else if (action === 'warn') stats.warned = (stats.warned || 0) + 1;
  else if (action === 'approve') stats.pendingApproval = (stats.pendingApproval || 0) + 1;
  else if (action === 'log') stats.logged = (stats.logged || 0) + 1;
  else stats.passed = (stats.passed || 0) + 1;
  if (!stats.byGate) stats.byGate = {};
  if (!stats.byGate[gateId]) stats.byGate[gateId] = { blocked: 0, warned: 0, pendingApproval: 0, logged: 0 };
  if (action === 'block') stats.byGate[gateId].blocked += 1;
  else if (action === 'warn') stats.byGate[gateId].warned += 1;
  else if (action === 'approve') stats.byGate[gateId].pendingApproval = (stats.byGate[gateId].pendingApproval || 0) + 1;
  else if (action === 'log') stats.byGate[gateId].logged = (stats.byGate[gateId].logged || 0) + 1;

  // Track same-action recurrence within a session for first-time fix rate.
  // Gate-only recurrence over-counts noisy gates; repeats require a stable,
  // sanitized action fingerprint.
  if (action === 'block' || action === 'warn') {
    if (!stats.sessionFiredGates) stats.sessionFiredGates = {};
    if (!stats.sessionFiredActions) stats.sessionFiredActions = {};
    const sessionKey = `session_${Math.floor(Date.now() / SESSION_ACTION_TTL_MS)}`;
    if (!stats.sessionFiredGates[sessionKey]) stats.sessionFiredGates[sessionKey] = {};
    stats.sessionFiredGates[sessionKey][gateId] = true;

    const fingerprint = buildGateActionFingerprint(gateId, options);
    if (fingerprint) {
      if (!stats.sessionFiredActions[sessionKey]) stats.sessionFiredActions[sessionKey] = {};
      if (!stats.sessionFiredActions[sessionKey][gateId]) stats.sessionFiredActions[sessionKey][gateId] = {};
      if (stats.sessionFiredActions[sessionKey][gateId][fingerprint]) {
        stats.recurringBlocks = (stats.recurringBlocks || 0) + 1;
      } else {
        stats.sessionFiredActions[sessionKey][gateId][fingerprint] = true;
      }
    }
  }

  saveStats(stats);
  // Track lesson freshness when an auto-promoted gate fires
  if (gate && gate.sourceLessonId) {
    try {
      const { recordTrigger } = require('./lesson-rotation');
      const { initDB } = require('./lesson-db');
      const db = initDB();
      recordTrigger(db, gate.sourceLessonId);
      db.close();
    } catch (_) { /* lesson DB may not be available */ }
  }
}

// ---------------------------------------------------------------------------
// Free-tier daily block cap
// ---------------------------------------------------------------------------

/**
 * Count today's gate blocks from stats. Free tier gets FREE_TIER_DAILY_BLOCKS
 * blocks/day. After the limit, deny → warn + upgrade CTA so the action proceeds
 * but the user sees they lost protection.
 */
function getTodayBlockCount() {
  const stats = loadStats();
  const today = todayKey();
  if (!stats.dailyBlocks || !stats.dailyBlocks[today]) return 0;
  return stats.dailyBlocks[today];
}

function incrementTodayBlockCount() {
  const stats = loadStats();
  const today = todayKey();
  if (!stats.dailyBlocks) stats.dailyBlocks = {};
  // Clean old dates (keep only last 7 days to prevent unbounded growth)
  const keys = Object.keys(stats.dailyBlocks);
  if (keys.length > 7) {
    keys.sort();
    for (const k of keys.slice(0, keys.length - 7)) {
      delete stats.dailyBlocks[k];
    }
  }
  stats.dailyBlocks[today] = (stats.dailyBlocks[today] || 0) + 1;
  saveStats(stats);
  return stats.dailyBlocks[today];
}

/**
 * If the user is free-tier and has exceeded daily block limit, downgrade
 * a deny result to a warn with an upgrade CTA. Returns null if no cap applies.
 */
function applyDailyBlockCap(denyResult) {
  // Catastrophic/irreversible commands (force-push, git reset --hard, git
  // clean -f, rm -rf on home/root) never get the free-tier daily-cap
  // discount — see issue #2782. Checked first, before any tier/CI shortcut,
  // so nothing can accidentally exempt a catastrophic gate from this floor.
  if (denyResult && CATASTROPHIC_DECLARATIVE_GATE_IDS.has(denyResult.gate)) return null;
  // Pro, trial, CI, and THUMBGATE_NO_RATE_LIMIT users are uncapped
  if (isProTier()) return null;
  if (process.env.CI || process.env.GITHUB_ACTIONS) return null;

  const todayCount = getTodayBlockCount();
  if (todayCount < FREE_TIER_DAILY_BLOCKS) {
    // Under limit: allow the block, increment counter
    incrementTodayBlockCount();
    return null;
  }

  // Over limit: downgrade deny → warn with upgrade CTA
  const remaining = 0;
  return {
    decision: 'warn',
    gate: denyResult.gate,
    message: `⚠️ ${denyResult.message}\n\n🔓 Daily protection limit reached (${FREE_TIER_DAILY_BLOCKS}/${FREE_TIER_DAILY_BLOCKS} blocks used). This action was allowed through. Upgrade for unlimited protection: https://thumbgate.ai/go/pro`,
    severity: denyResult.severity,
    reasoning: (denyResult.reasoning || []).concat([
      `Free-tier daily block limit (${FREE_TIER_DAILY_BLOCKS}) exceeded — deny downgraded to warn`,
    ]),
    dailyBlockCapApplied: true,
  };
}

// ---------------------------------------------------------------------------
// Reasoning chain builder
// ---------------------------------------------------------------------------

function getHybridFeedbackModule() {
  try {
    return require('./hybrid-feedback-context');
  } catch {
    return null;
  }
}

function safeExecFileLines(binary, args, cwd) {
  try {
    const output = execFileSync(binary, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!output) return [];
    return output.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function extractGitMinusCPaths(command) {
  const found = [];
  const segments = String(command || '').split(/\r?\n|&&|\|\||[;|&]/);
  for (const segment of segments) {
    const tokens = tokenizeShellWords(segment);
    const gitIdx = tokens.findIndex((token) => token === 'git' || /(?:^|\/)git$/.test(token));
    if (gitIdx === -1) continue;
    for (let i = gitIdx + 1; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token === '-C' && tokens[i + 1]) {
        found.push(tokens[i + 1]);
        i += 1;
        continue;
      }
      if (token === '--work-tree' && tokens[i + 1]) {
        found.push(tokens[i + 1]);
        i += 1;
        continue;
      }
      if (token.startsWith('--work-tree=')) {
        found.push(token.slice('--work-tree='.length));
        continue;
      }
      if (!token.startsWith('-')) break;
    }
  }
  return found;
}

function extractGitContextPair(command) {
  const segments = String(command || '').split(/\r?\n|&&|\|\||[;|&]/);
  for (const segment of segments) {
    const tokens = tokenizeShellWords(segment);
    const gitIdx = tokens.findIndex((token) => token === 'git' || /(?:^|\/)git$/.test(token));
    if (gitIdx === -1) continue;
    let gitDir = null;
    let workTree = null;
    for (let i = gitIdx + 1; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token === '--git-dir' && tokens[i + 1]) {
        gitDir = tokens[i + 1];
        i += 1;
        continue;
      }
      if (token.startsWith('--git-dir=')) {
        gitDir = token.slice('--git-dir='.length);
        continue;
      }
      if (token === '--work-tree' && tokens[i + 1]) {
        workTree = tokens[i + 1];
        i += 1;
        continue;
      }
      if (token.startsWith('--work-tree=')) {
        workTree = token.slice('--work-tree='.length);
        continue;
      }
      if (token === '-C' && tokens[i + 1]) {
        workTree = tokens[i + 1];
        i += 1;
        continue;
      }
      if (!token.startsWith('-')) break;
    }
    if (gitDir || workTree) return { gitDir, workTree };
  }
  return null;
}

function resolveRepoRoot(toolInput = {}) {
  const command = String(toolInput.command || '');
  const baseCwd = toolInput.cwd ? path.resolve(String(toolInput.cwd)) : process.cwd();
  const paired = extractGitContextPair(command);
  if (paired && paired.gitDir && paired.workTree) {
    try {
      const resolvedGitDir = path.resolve(baseCwd, paired.gitDir);
      const resolvedWorkTree = path.resolve(baseCwd, paired.workTree);
      const root = execFileSync('git', ['--git-dir', resolvedGitDir, '--work-tree', resolvedWorkTree, 'rev-parse', '--show-toplevel'], {
        cwd: resolvedWorkTree,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (root) return root;
    } catch {
      // Fall through to standard candidate probing
    }
  }

  const minusC = extractGitMinusCPaths(command).map((entry) => path.resolve(baseCwd, entry));
  const commandCwd = effectiveCommandCwd(command, toolInput);
  const candidates = [];
  const seen = new Set();
  for (const value of [
    ...minusC,
    commandCwd,
    toolInput.repoPath,
    toolInput.cwd,
    process.cwd(),
  ]) {
    if (!value) continue;
    const resolved = path.resolve(String(value));
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    candidates.push(resolved);
  }

  for (const cwd of candidates) {
    try {
      const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (root) return root;
    } catch {
      continue;
    }
  }

  return null;
}

function toRepoRelativePath(filePath, repoRoot) {
  const value = String(filePath || '').trim();
  if (!value) return '';
  if (repoRoot && path.isAbsolute(value)) {
    const candidates = [[path.resolve(repoRoot), path.resolve(value)]];
    try {
      const rootReal = fs.realpathSync.native(repoRoot);
      let valueReal = null;
      try {
        valueReal = fs.realpathSync.native(value);
      } catch {
        const parentReal = fs.realpathSync.native(path.dirname(value));
        valueReal = path.join(parentReal, path.basename(value));
      }
      candidates.push([rootReal, valueReal]);
    } catch {
      // Fall back to lexical path comparison below.
    }

    for (const [rootCandidate, valueCandidate] of candidates) {
      const relative = path.relative(rootCandidate, valueCandidate);
      if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
        return normalizePosix(relative);
      }
    }
  }
  return normalizePosix(value);
}

function collectInlineAffectedFiles(toolInput = {}, repoRoot) {
  const collected = [];
  const arrayFields = [
    toolInput.changed_files,
    toolInput.changedFiles,
    toolInput.files,
    toolInput.file_paths,
    toolInput.filePaths,
    toolInput.paths,
  ];

  for (const field of arrayFields) {
    if (!Array.isArray(field)) continue;
    for (const entry of field) {
      const normalized = toRepoRelativePath(entry, repoRoot);
      if (normalized) collected.push(normalized);
    }
  }

  const scalarFields = [
    toolInput.file_path,
    toolInput.filePath,
    toolInput.path,
  ];
  for (const field of scalarFields) {
    const normalized = toRepoRelativePath(field, repoRoot);
    if (normalized) collected.push(normalized);
  }

  return [...new Set(collected)];
}

function getUpstreamRef(repoRoot) {
  const upstream = safeExecFileLines('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], repoRoot)[0];
  if (upstream) return upstream;
  const remoteHead = safeExecFileLines('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], repoRoot)[0];
  if (remoteHead) return remoteHead.replace(/^refs\/remotes\//, '');
  return null;
}

function getBranchDiffFiles(repoRoot) {
  const upstream = getUpstreamRef(repoRoot);
  if (upstream) {
    return safeExecFileLines('git', ['diff', '--name-only', `${upstream}...HEAD`], repoRoot);
  }
  const headParent = safeExecFileLines('git', ['rev-parse', '--verify', 'HEAD~1'], repoRoot)[0];
  if (headParent) {
    return safeExecFileLines('git', ['diff', '--name-only', 'HEAD~1..HEAD'], repoRoot);
  }
  return safeExecFileLines('git', ['diff', '--name-only'], repoRoot);
}

// `git add`/`git commit` accept an explicit pathspec, and when one is present it — not the
// working tree — defines what the command actually touches. Scanning the whole tree here
// reported every dirty file as "affected", so in a repo with a large dirty tree (e.g. one
// shared by several agents) a correctly scoped `git add -- a.js b.js` was reported as
// thousands of affected files and tripped task-scope / protected-file gates that the command
// never actually violated. Only fall back to a full tree scan when the command really does
// stage broadly (`git add .`, `-A`, `-u`, or no pathspec at all).
const GIT_BROAD_ADD_FLAGS = new Set(['-A', '--all', '-u', '--update', '--no-ignore-removal', '--ignore-removal']);

// Minimal shell-word splitter: honours single/double quotes so a quoted path with spaces
// stays one token. Deliberately does not expand variables or globs — an unresolvable token
// is treated as "broad" by the callers below rather than guessed at.
function tokenizeShellWords(segment) {
  const tokens = [];
  let current = '';
  let quote = null;
  let hasContent = false;
  for (let i = 0; i < segment.length; i++) {
    const char = segment[i];
    // A backslash escapes the next character outside single quotes. Without this,
    // `git add my\ dir/file.js` split at the escaped space into two fictional paths
    // and the gates evaluated files git never touches.
    if (char === '\\' && quote !== "'" && i + 1 < segment.length) {
      current += segment[i + 1];
      hasContent = true;
      i += 1;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      hasContent = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (hasContent || current) tokens.push(current);
      current = '';
      hasContent = false;
      continue;
    }
    current += char;
  }
  if (hasContent || current) tokens.push(current);
  return tokens;
}

// Isolate the `git <sub>` run from a compound command so `git add a.js && git push` only
// contributes `a.js` to the add pathspec.
function extractGitSubcommandSegments(command, subcommand) {
  const segments = [];
  const pattern = new RegExp(`\\bgit\\s+${subcommand}\\b`, 'gi');
  let match;
  while ((match = pattern.exec(command)) !== null) {
    const rest = command.slice(match.index + match[0].length);
    const stop = rest.search(/(?:&&|\|\||[;|\n])/);
    segments.push(stop === -1 ? rest : rest.slice(0, stop));
  }
  return segments;
}

/**
 * Resolve the explicit pathspec of a git subcommand.
 *
 * @returns {{ broad: boolean, paths: string[] }} `broad` means "no usable pathspec — the
 *   command may touch anything", which keeps the previous full-tree-scan behaviour.
 */
function parseGitPathspec(command, subcommand, options = {}) {
  // `separatorOnly` is for subcommands whose bare arguments are usually flag VALUES rather
  // than paths (`git commit -m "msg"`), where only tokens after `--` are a real pathspec.
  const separatorOnly = options.separatorOnly === true;
  const segments = extractGitSubcommandSegments(command, subcommand);
  if (!segments.length) return { broad: true, paths: [] };

  const paths = [];
  for (const segment of segments) {
    const tokens = tokenizeShellWords(segment);
    let afterSeparator = false;
    let sawPath = false;
    for (const token of tokens) {
      if (!token) continue;
      if (token === '--') { afterSeparator = true; continue; }
      if (separatorOnly && !afterSeparator) continue;
      if (!afterSeparator && token.startsWith('-')) {
        if (GIT_BROAD_ADD_FLAGS.has(token)) return { broad: true, paths: [] };
        // `--pathspec-from-file` / interactive modes read paths we cannot resolve here.
        if (/^--pathspec-from-file/.test(token) || token === '-i' || token === '--interactive'
          || token === '-p' || token === '--patch') {
          return { broad: true, paths: [] };
        }
        continue;
      }
      // A shell metacharacter or unexpanded glob/variable means the real pathspec is
      // unknown at gate time — stay conservative rather than under-reporting.
      if (/[*?$`]|^~/.test(token)) return { broad: true, paths: [] };
      if (token === '.' || token === './') return { broad: true, paths: [] };
      // Git pathspec MAGIC (gitglossary(7)): `:(exclude)x`, `:!x`, `:(icase)x`, `:/`, `:(top)`.
      // These select a materially different set than the literal string — notably an
      // exclude-only pathspec behaves as if NO pathspec were given, staging everything else.
      // Treating them literally let them evade task-scope and protected-file checks entirely.
      if (token.startsWith(':')) return { broad: true, paths: [] };
      paths.push(token);
      sawPath = true;
    }
    if (!sawPath) return { broad: true, paths: [] };
  }

  return paths.length ? { broad: false, paths } : { broad: true, paths: [] };
}

// A pathspec is relative to the shell's working directory, NOT the repo root. With
// cwd=/repo/src, `git add a.js` stages src/a.js — reporting `a.js` made task-scope and
// protected-file gates evaluate the wrong path, so a protected src/a.js edit could pass.
// Track a leading `cd` too, since `cd src && git add a.js` is the common shape.
// Returns null when the working directory cannot be determined. A `cd` whose target is a
// glob or variable makes every later relative pathspec unresolvable — resolving it against
// the ORIGINAL directory would silently produce a wrong path, which is exactly the
// guess-instead-of-widen mistake that made pathspec magic evade scope checks. Callers treat
// null as "unknown" and fall back to broad.
function effectiveCommandCwd(command, toolInput) {
  let cwd = String(toolInput?.cwd || toolInput?.repoPath || process.cwd());
  const commandStr = String(command || '');
  const gitCMatch = commandStr.match(/(?:^|\s)git(?:\s+-[^\s]+)*\s+-C(?:\s+|=)(?:'([^']+)'|"([^"]+)"|([^\s'"]+))/i);
  const gitCDir = gitCMatch ? (gitCMatch[1] || gitCMatch[2] || gitCMatch[3] || '').trim() : '';
  if (gitCDir) {
    let target = gitCDir;
    if (target.startsWith('~/')) {
      target = path.join(os.homedir(), target.slice(2));
    }
    return path.resolve(cwd, target);
  }
  const segments = commandStr.split(/\r?\n|&&|\|\||[;|&]/);
  for (const segment of segments) {
    // Parsed without a regex: /^cd\s+(?:--\s+)?(.+)$/ has adjacent \s+ groups that backtrack
    // polynomially on input like `cd\t\t\t…` (js/polynomial-redos). The command comes
    // straight off the pending tool call, so stalling here stalls the gate.
    const trimmed = segment.trim();
    if (!trimmed.startsWith('cd')) break;    // only a LEADING cd chain applies
    const afterCd = trimmed.slice(2);
    if (afterCd && !/^[ \t]/.test(afterCd)) break;   // `cdfoo` is not `cd`
    let argText = afterCd.trim();
    if (argText === '--') argText = '';
    else if (argText.startsWith('--') && /^[ \t]/.test(argText.slice(2))) argText = argText.slice(2).trim();
    const target = tokenizeShellWords(argText)[0];
    if (!target) break;                      // bare `cd` -> home; leave scope resolution alone
    if (/[*?$`]/.test(target)) return null;
    let targetResolved = target;
    if (targetResolved.startsWith('~/')) {
      targetResolved = path.join(os.homedir(), targetResolved.slice(2));
    }
    cwd = path.resolve(cwd, targetResolved);
  }
  return cwd;
}

// Keep a tree-derived file only when it falls inside one of the declared pathspecs, so a
// directory pathspec (`git add src/`) still reports the files under it and nothing else.
function isExistingDirectory(relPath, repoRoot) {
  if (!repoRoot) return false;
  try {
    return fs.statSync(path.join(repoRoot, relPath)).isDirectory();
  } catch {
    return false;
  }
}

function isUnderPathspec(relPath, pathspecs) {
  return pathspecs.some((spec) => relPath === spec || relPath.startsWith(`${spec}/`));
}

// Linear trailing-slash strip. A regex like /\/+$/ backtracks polynomially on a long run of
// slashes (js/polynomial-redos), and the pathspec comes straight off the pending command —
// stalling the gate is itself a way to defeat it.
function stripTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

function applyPathspecScope(files, treeFiles, pathspec, repoRoot, commandCwd) {
  if (pathspec.broad) {
    for (const filePath of treeFiles) files.add(normalizePosix(filePath));
    return;
  }
  const specs = pathspec.paths
    .map((entry) => (path.isAbsolute(entry) ? entry : path.resolve(commandCwd || repoRoot || '.', entry)))
    .map((entry) => toRepoRelativePath(entry, repoRoot))
    .filter(Boolean)
    .map((entry) => stripTrailingSlashes(normalizePosix(entry)));
  if (!specs.length) {
    for (const filePath of treeFiles) files.add(normalizePosix(filePath));
    return;
  }
  const matchedSpecs = new Set();
  for (const filePath of treeFiles) {
    const normalized = normalizePosix(filePath);
    for (const spec of specs) {
      if (normalized === spec || normalized.startsWith(`${spec}/`)) {
        files.add(normalized);
        matchedSpecs.add(spec);
      }
    }
  }
  // An explicitly named file is in scope even when the tree scan does not list it (e.g. it
  // is already staged). A directory spec that matched tree files is not itself a file, and
  // an unmatched directory contributes nothing.
  for (const spec of matchedSpecs.size === specs.length ? [] : specs) {
    if (matchedSpecs.has(spec)) continue;
    if (isExistingDirectory(spec, repoRoot)) continue;
    files.add(spec);
  }
}

// Git accepts global options BETWEEN `git` and the subcommand: `git -C <dir> push`,
// `git -c k=v clean`, `git --git-dir=<p> reset`. Every command-pattern gate here is written
// against the plain `git <subcommand>` form, so inserting one option was enough to walk past
// force-push, git-reset-hard, git-clean-force and the local-only gates entirely — and to make
// extractAffectedFiles report nothing, which silently disarms the task-scope and
// protected-file gates too. Canonicalize the options away so the same command is recognised
// however it is spelled. Callers match the ORIGINAL and the canonical form, so this can only
// ever add a match, never remove one.
const GIT_GLOBAL_OPTION_AFTER_GIT = /\bgit\s+(?:-[cC]\s+\S+|--(?:git-dir|work-tree|namespace|exec-path|super-prefix)(?:=\S+|\s+\S+)|--(?:paginate|no-pager|bare|literal-pathspecs|glob-pathspecs|noglob-pathspecs|icase-pathspecs|no-replace-objects|no-optional-locks)|-[pP])\s+/g;

function canonicalizeGitCommand(command) {
  let out = String(command || '');
  // Bounded: a crafted command with many stacked options must not loop unboundedly.
  for (let i = 0; i < 12; i += 1) {
    const next = out.replace(GIT_GLOBAL_OPTION_AFTER_GIT, 'git ');
    if (next === out) break;
    out = next;
  }
  return out;
}

// The catastrophic gate patterns anchor the command position as `(?:^|[;&|]\s*)`, i.e. the
// command must sit at the very start of the string or immediately after ; & |. That anchor
// exists to avoid matching a command mentioned inside a quoted string, but it is far too
// narrow: it does not recognise a command on a NEW LINE, nor any of the ordinary ways a
// binary gets invoked. Each of the following defeated git-reset-hard and git-clean-force on
// shipped main — no gate matched at all:
//
//   sudo git reset --hard          GIT_DIR=… git reset --hard      /usr/bin/git reset --hard
//   command git reset --hard       "git" reset --hard              \git reset --hard
//   echo hi\ngit reset --hard
//
// Rather than complicate every gate's regex, canonicalize the command POSITION: split on
// separators (including newlines), strip env-assignment prefixes, wrapper binaries and any
// directory/quoting on the binary token, then rejoin with `; ` so the existing anchor sees a
// clean command. Callers match the original AND the canonical form, so this only ever adds.
const COMMAND_WRAPPERS = new Set([
  'sudo', 'doas', 'command', 'builtin', 'exec', 'nohup', 'time', 'env',
  'nice', 'ionice', 'setsid', 'stdbuf', 'xargs',
]);
const ENV_ASSIGNMENT_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]*)\s+/;
const WRAPPER_HEAD = /^([A-Za-z_][\w.-]*)\s+/;
const LITERAL_COMMAND_SUBSTITUTION_HEADS = [
  /^\$\(\s*printf\s+(?:(?:['"]?%s['"]?)\s+)?(['"]?)([A-Za-z_][\w.-]*)\1\s*\)\s+/,
  /^\$\(\s*echo\s+(['"]?)([A-Za-z_][\w.-]*)\1\s*\)\s+/,
  /^\$\(\s*(?:command\s+-v|which)\s+(['"]?)([A-Za-z_][\w.-]*)\1\s*\)\s+/,
];

function canonicalizeLiteralCommandSubstitutionHead(segment) {
  for (const pattern of LITERAL_COMMAND_SUBSTITUTION_HEADS) {
    const match = String(segment || '').match(pattern);
    if (match) return `${match[2]} ${String(segment).slice(match[0].length)}`;
  }
  return segment;
}

function canonicalizeSegmentHead(segment) {
  let text = String(segment || '').trim();
  for (let i = 0; i < 12; i += 1) {
    const before = text;
    // Resolve only literal, side-effect-free command-position substitutions.
    // Never execute or guess arbitrary shell; this closes common `$(printf git)`
    // and `$(command -v git)` spellings while keeping matching deterministic.
    text = canonicalizeLiteralCommandSubstitutionHead(text);
    text = text.replace(ENV_ASSIGNMENT_PREFIX, '');
    const wrapper = text.match(WRAPPER_HEAD);
    if (wrapper && COMMAND_WRAPPERS.has(wrapper[1].toLowerCase())) {
      text = text.slice(wrapper[0].length);
    }
    if (text === before) break;
  }
  // Unwrap quoting/escaping on the binary token: "git" / 'git' / \git
  text = text.replace(/^\\(?=[A-Za-z_])/, '');
  text = text.replace(/^(['"])([^'"\s]+)\1/, '$2');
  // Drop a leading directory on the binary token: /usr/bin/git, ./bin/git, ../git
  text = text.replace(/^((?:\.{1,2})?(?:\/[^\s/]+)*\/)([^\s/]+)/, '$2');
  return text;
}

function canonicalizeCommandPositions(command) {
  const text = String(command || '');
  if (!text) return '';
  return text
    .split(/\r?\n|&&|\|\||[;|&]/)
    .map((segment) => canonicalizeSegmentHead(segment))
    .filter((segment) => segment.length > 0)
    .join('; ');
}

// Full canonical form used for gate matching.
function canonicalizeCommandForGates(command) {
  return canonicalizeGitCommand(canonicalizeCommandPositions(command));
}

// Some gates anchor with a BARE `^` (local-only-git-writes, task-scope-required,
// branch-governance-required, release-readiness-required) rather than the
// `(?:^|[;&|]\s*)` form. A bare `^` only ever matches the FIRST command in the string, so
// `echo hi && git commit -m x` slipped past while `git commit -m x` was denied — and
// chaining is how agents normally work. Offer each canonicalized SEGMENT as its own
// candidate so a `^` anchor sees every command in the chain, not just the head.
//
// This stays additive: unanchored patterns already match anywhere, so per-segment testing
// adds nothing for them, and a `^` pattern matching a later segment is exactly the gate's
// intent. A command merely quoted inside another (`echo "git commit"`) is unaffected,
// because the segment head is still `echo`.
function gateMatchCandidates(matchText) {
  const canonical = canonicalizeCommandForGates(matchText);
  const candidates = [matchText];
  if (canonical && canonical !== matchText) candidates.push(canonical);
  for (const segment of canonical.split('; ')) {
    const trimmed = segment.trim();
    if (trimmed && trimmed !== canonical) candidates.push(trimmed);
  }
  return candidates;
}

function patternMatchesCommand(regex, matchText) {
  return gateMatchCandidates(matchText).some((candidate) => regex.test(candidate));
}

function extractAffectedFiles(toolName, toolInput = {}) {
  const repoRoot = resolveRepoRoot(toolInput);
  const files = new Set(collectInlineAffectedFiles(toolInput, repoRoot));
  // Full canonicalization, not just the git-option pass: `"git" add .` and `sudo git add .`
  // otherwise fail the `\bgit\s+add\b` probes below and yield ZERO affected files, which in
  // turn makes the scope gates (task-scope-required, protected-file-approval-required) find
  // no violation and fall through — the file-list half of the same bypass.
  const command = canonicalizeCommandForGates(String(toolInput.command || ''));

  const commandCwd = effectiveCommandCwd(command, toolInput);
  // An unresolvable `cd` makes every relative pathspec meaningless; widen rather than guess.
  const cwdUnknown = commandCwd === null;

  if (toolName === 'Bash' && repoRoot && command) {
    if (/\bgit\s+commit\b/i.test(command)) {
      // For commit only an explicit `-- <pathspec>` narrows the staged set; bare arguments
      // after `git commit` are almost always flag values (`-m "msg"`), so anything else
      // keeps the staged-diff behaviour.
      const commitSpec = /\bgit\s+commit\b[^;|&\n]*?\s--\s/i.test(command)
        ? parseGitPathspec(command, 'commit', { separatorOnly: true })
        : { broad: true, paths: [] };
      // `git commit -- <pathspec>` commits tracked files straight from the WORKING TREE, not
      // only what is staged. Filtering the cached diff alone dropped exactly those files, so
      // scope and protected-file gates missed changes the commit really carries.
      const candidates = commitSpec.broad
        ? safeExecFileLines('git', ['diff', '--cached', '--name-only'], repoRoot)
        : [
          ...safeExecFileLines('git', ['diff', '--cached', '--name-only'], repoRoot),
          ...safeExecFileLines('git', ['diff', '--name-only'], repoRoot),
        ];
      applyPathspecScope(files, candidates, cwdUnknown ? { broad: true, paths: [] } : commitSpec, repoRoot, commandCwd);
    }

    if (/\bgit\s+add\b/i.test(command)) {
      const treeFiles = [
        ...safeExecFileLines('git', ['diff', '--name-only'], repoRoot),
        ...safeExecFileLines('git', ['ls-files', '--others', '--exclude-standard'], repoRoot),
      ];
      const addSpec = cwdUnknown ? { broad: true, paths: [] } : parseGitPathspec(command, 'add');
      applyPathspecScope(files, treeFiles, addSpec, repoRoot, commandCwd);
    }

    if (/\bgit\s+push\b/i.test(command) || /\bgh\s+pr\s+(?:create|merge)\b/i.test(command) || isGhApiPrCreateCommand(command)) {
      if (files.size === 0) {
        for (const filePath of getBranchDiffFiles(repoRoot)) {
          files.add(normalizePosix(filePath));
        }
      }
    }
  }

  return {
    repoRoot,
    files: [...files].filter(Boolean),
  };
}

function isHighRiskAction(toolName, toolInput = {}, affectedFiles = []) {
  if (EDIT_LIKE_TOOLS.has(toolName)) return true;
  if (toolName !== 'Bash') return false;
  const command = String(toolInput.command || '');
  // Original high-risk pattern (git writes, publishes, destructive ops)
  if (HIGH_RISK_BASH_PATTERN.test(command)) return true;
  if (isGhApiPrCreateCommand(command)) return true;
  // Broadened: any Bash command that modifies files or has side effects.
  // Excludes pure read/analysis commands (node --test, cat, ls, echo, etc.)
  // to avoid false positives on benign operations.
  if (/\b(sed|awk|mv|cp|chmod|chown|truncate|tee|patch)\b/.test(command)) return true;
  if (/\b(npm\s+(?:run|exec|install)|yarn|pnpm)\b/.test(command)) return true;
  if (/\b(curl|wget)\b/.test(command)) return true;
  return false;
}

function normalizeRiskToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function singularizeRiskToken(token) {
  const value = String(token || '').trim();
  if (value.length > 3 && value.endsWith('ies')) return `${value.slice(0, -3)}y`;
  if (value.length > 3 && value.endsWith('s')) return value.slice(0, -1);
  return value;
}

function riskTokenVariants(token) {
  const normalized = singularizeRiskToken(token);
  const variants = new Set([token, normalized]);
  const synonyms = {
    comment: ['comment', 'comments', 'review', 'reviews', 'reply', 'replies', 'thread', 'threads'],
    thread: ['thread', 'threads', 'review', 'reviews', 'comment', 'comments'],
    bot: ['bot', 'bots', 'automation', 'automated', 'assistant', 'claude', 'codex'],
    pr: ['pr', 'pull', 'pullrequest', 'pullrequests'],
    file: ['file', 'files', 'path', 'paths'],
    test: ['test', 'tests', 'ci', 'coverage', 'verify', 'verification'],
  };
  for (const candidate of [token, normalized]) {
    for (const item of synonyms[candidate] || []) {
      variants.add(item);
      variants.add(singularizeRiskToken(item));
    }
  }
  return [...variants].filter(Boolean);
}

function normalizeRiskTagEntry(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') {
    return { tag: entry };
  }
  if (typeof entry !== 'object') return null;
  const tag = entry.tag || entry.key || entry.name || entry.domain || entry.label || entry.id;
  if (!tag) return null;
  return {
    tag: String(tag),
    count: Number(entry.count ?? entry.examples ?? entry.exampleCount ?? entry.total ?? entry.samples),
    failures: Number(entry.failures ?? entry.failureCount),
    riskRate: Number(entry.riskRate ?? entry.rate ?? entry.failureRate ?? entry.score ?? entry.riskScore),
  };
}

function collectBoostedRiskTags(toolInput = {}) {
  const boostedRisk = toolInput.boostedRisk && typeof toolInput.boostedRisk === 'object'
    ? toolInput.boostedRisk
    : {};
  const sources = [
    toolInput.highRiskTags,
    toolInput.riskTags,
    boostedRisk.highRiskTags,
    boostedRisk.tags,
    boostedRisk.highRiskDomains,
  ];
  const tags = [];
  for (const source of sources) {
    if (Array.isArray(source)) {
      tags.push(...source.map(normalizeRiskTagEntry).filter(Boolean));
    }
  }
  return tags;
}

function isBoostedRiskHigh(toolInput = {}) {
  const boostedRisk = toolInput.boostedRisk && typeof toolInput.boostedRisk === 'object'
    ? toolInput.boostedRisk
    : {};
  const level = String(boostedRisk.riskLevel || boostedRisk.level || boostedRisk.mode || '').toLowerCase();
  if (/\b(?:high|critical|block|deny)\b/.test(level)) return true;

  const riskScore = Number(boostedRisk.riskScore ?? boostedRisk.score ?? boostedRisk.riskRate ?? boostedRisk.failureRate ?? boostedRisk.baseRate);
  if (Number.isFinite(riskScore) && riskScore >= BOOSTED_RISK_BLOCK_SCORE) return true;

  const exampleCount = Number(boostedRisk.exampleCount ?? boostedRisk.count ?? boostedRisk.samples ?? boostedRisk.total);
  const failureCount = Number(boostedRisk.failureCount ?? boostedRisk.failures);
  if (
    Number.isFinite(exampleCount) &&
    exampleCount >= BOOSTED_RISK_MIN_EXAMPLES &&
    Number.isFinite(failureCount) &&
    failureCount / Math.max(exampleCount, 1) >= BOOSTED_RISK_BLOCK_SCORE
  ) {
    return true;
  }

  return collectBoostedRiskTags(toolInput).some((entry) => {
    if (Number.isFinite(entry.riskRate) && entry.riskRate >= BOOSTED_RISK_BLOCK_SCORE) return true;
    if (Number.isFinite(entry.count) && entry.count >= BOOSTED_RISK_MIN_EXAMPLES && !Number.isFinite(entry.riskRate)) return true;
    if (
      Number.isFinite(entry.count) &&
      entry.count >= BOOSTED_RISK_MIN_EXAMPLES &&
      Number.isFinite(entry.failures) &&
      entry.failures / Math.max(entry.count, 1) >= BOOSTED_RISK_BLOCK_SCORE
    ) {
      return true;
    }
    return false;
  });
}

function riskTagMatchesAction(tag, actionContext) {
  const normalizedTag = normalizeRiskToken(tag);
  const normalizedAction = normalizeRiskToken(actionContext);
  if (!normalizedTag || !normalizedAction) return false;
  const actionTokens = new Set(normalizedAction.split(/\s+/).filter(Boolean));
  const tagTokens = normalizedTag.split(/\s+/).filter(Boolean);
  return tagTokens.some((token) => riskTokenVariants(token).some((variant) => actionTokens.has(variant)));
}

function evaluateBoostedRiskTagGuard(toolName, toolInput = {}) {
  const tags = collectBoostedRiskTags(toolInput);
  if (tags.length === 0 || !isBoostedRiskHigh(toolInput)) return null;

  const actionContext = extractActionContext(toolName, toolInput);
  const matchedTag = tags.find((entry) => riskTagMatchesAction(entry.tag, actionContext));
  if (!matchedTag) return null;

  const matchText = toolInput.command || toolInput.file_path || toolInput.path || actionContext;
  const message = `Boosted-risk history matched this action (${matchedTag.tag}). This pattern is denied by default until explicit evidence lowers the risk.`;
  return {
    decision: 'deny',
    gate: 'boosted-risk-tag-default-deny',
    message,
    severity: 'critical',
    reasoning: [
      `High-risk tag "${matchedTag.tag}" matched "${String(matchText).slice(0, 120)}"`,
      `Risk threshold: score >= ${BOOSTED_RISK_BLOCK_SCORE} or at least ${BOOSTED_RISK_MIN_EXAMPLES} examples`,
      'Hook enforcement blocks this pre-tool call instead of relying on advisory recall',
    ],
  };
}

function isGitCommitCommand(toolName, toolInput = {}) {
  return toolName === 'Bash' && /\bgit\s+commit\b/i.test(String(toolInput.command || ''));
}

function isProtectedBranchName(branchName) {
  return /^(?:main|master|develop|dev|trunk|release)$/i.test(String(branchName || '').trim());
}

function detectBranchName(toolInput = {}, repoRoot = null) {
  const inline = toolInput.branchName || toolInput.currentBranch || toolInput.branch || toolInput.headRefName;
  if (inline) return String(inline).trim();
  if (!repoRoot) return '';
  return safeExecFileLines('git', ['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot)[0] || '';
}

function hasPrBranchContext(toolInput = {}, repoRoot = null) {
  if (toolInput.prNumber || toolInput.prUrl || toolInput.pullRequestNumber || toolInput.pullRequestUrl) {
    return true;
  }
  const branchName = detectBranchName(toolInput, repoRoot);
  return Boolean(branchName && !isProtectedBranchName(branchName));
}

function hasExplicitPrReference(toolInput = {}) {
  return Boolean(
    toolInput.prNumber || toolInput.prUrl || toolInput.pullRequestNumber || toolInput.pullRequestUrl
  );
}

const GH_BINARY_FIXED_PATH_DIRS = ['/usr/local/bin', '/usr/bin', '/bin', '/opt/homebrew/bin'];

// SonarCloud flags a bare `execFileSync('gh', ...)` as a PATH-injection hotspot
// (same reasoning as scripts/ci-cd-hygiene-audit.js resolveGhBinary). Resolve
// gh's absolute path from a fixed directory list — and ONLY that list. Never
// fall back to a PATH-resolved bare name: a workspace-controlled program
// earlier on $PATH would otherwise execute with this hook's privileges during
// a commit-time check, and could return crafted output to fake "merged" and
// bypass thread-resolution enforcement entirely (found by review on PR #3027).
function resolveGhBinaryForPrCheck() {
  for (const dir of GH_BINARY_FIXED_PATH_DIRS) {
    const candidate = path.join(dir, 'gh');
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // keep searching
    }
  }
  return null;
}

// 2026-07-24 self-lockout (issue #3025): a commit landing on a branch whose PR
// was already merged armed this gate forever — the premise ("verify PR
// threads") was checked purely by branch name, never against real GitHub PR
// state, so there was nothing left to satisfy it once the PR closed. This
// checks whether the branch's PR (if any) is already dormant — merged,
// closed, or nonexistent — in which case there is nothing to verify. Returns
// `{ dormant: true, reason }` when safe to skip the gate, `{ dormant: false }`
// when a real open PR exists (keep gating), or `null` when the check could
// not be completed (gh unavailable/unauthenticated/timed out) — callers must
// treat `null` as "cannot verify" and fall back to arming the gate as before,
// never as license to relax enforcement.
//
// Deliberately does NOT trust local git config (e.g. a missing
// `branch.<name>.remote`) as a signal that no PR exists: local config can be
// wrong or stale relative to GitHub (unset upstream, push under a different
// ref, etc.) while a real open PR with real unresolved threads still exists
// (found by review on PR #3027) — the live `gh` check is the only source of
// truth here.
function checkPrDormantForBranch(branchName, repoRoot, execFn = execFileSync) {
  if (!branchName || !repoRoot) return null;

  const ghBinary = resolveGhBinaryForPrCheck();
  if (!ghBinary) return null; // gh not found in a trusted location — cannot verify

  let raw;
  try {
    raw = execFn(ghBinary, ['pr', 'view', branchName, '--json', 'number,state'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });
  } catch (error) {
    const stderr = String((error && error.stderr) || (error && error.message) || '');
    if (/no pull requests found/i.test(stderr)) {
      return { dormant: true, reason: 'no-pr-for-branch' };
    }
    return null; // gh unauthenticated/network error/timed out — cannot verify
  }

  let pr;
  try {
    pr = JSON.parse(raw);
  } catch {
    return null;
  }

  if (pr && pr.state === 'MERGED') return { dormant: true, reason: 'pr-merged', prNumber: pr.number };
  if (pr && pr.state === 'CLOSED') return { dormant: true, reason: 'pr-closed', prNumber: pr.number };
  return { dormant: false, reason: 'pr-open', prNumber: pr && pr.number };
}

function registerPrThreadResolutionClaimGate(toolName, toolInput = {}, execOverride) {
  if (!isGitCommitCommand(toolName, toolInput)) return null;
  const repoRoot = resolveRepoRoot(toolInput);
  if (!hasPrBranchContext(toolInput, repoRoot)) return null;

  const branchName = detectBranchName(toolInput, repoRoot);

  // Only auto-detect dormant PRs when the branch name is the sole signal. An
  // explicit prNumber/prUrl is a direct claim from the caller that a specific
  // PR exists and matters here — trust it rather than re-deriving a possibly
  // different answer from the branch name.
  if (!hasExplicitPrReference(toolInput)) {
    const prState = checkPrDormantForBranch(branchName, repoRoot, execOverride || execFileSync);
    if (prState && prState.dormant) {
      // A dormant PR (merged/closed/nonexistent) means there is nothing to
      // verify for THIS commit — simply don't arm the gate. Deliberately does
      // NOT write to the shared pr_threads_checked/thread_resolution_verified
      // condition store: those keys are global, not scoped to a branch, so
      // writing to them here would leak satisfaction into a DIFFERENT
      // branch's pending gate if a commit on that branch arms it within the
      // same 5-minute TTL window — an agent could otherwise pre-satisfy the
      // gate by committing on an abandoned merged-PR branch first, then
      // switch to an active PR branch and skip real thread verification
      // (found by review on PR #3027).
      return null;
    }
  }

  const claimGate = registerClaimGate(
    PR_THREAD_RESOLUTION_CLAIM_PATTERN,
    PR_THREAD_RESOLUTION_REQUIRED_ACTIONS,
    'A PR-branch commit requires verified review-thread resolution before more tool calls or readiness claims.',
  );
  trackAction(PR_THREAD_RESOLUTION_ACTION, {
    branchName: branchName || null,
    repoRoot: repoRoot || null,
    commandHash: crypto.createHash('sha256').update(String(toolInput.command || '')).digest('hex'),
  });
  return claimGate;
}

function isThreadResolutionSatisfied() {
  return PR_THREAD_RESOLUTION_REQUIRED_ACTIONS.some((actionId) => (
    hasAction(actionId) || isConditionSatisfied(actionId)
  ));
}

// Hook payloads name MCP tools `mcp__<server>__<tool>` while exemption lists
// hold bare tool names. Exemptions must compare on the stripped name or they
// never fire for real hook traffic — 2026-08-05: the pending-thread gate
// blocked `mcp__thumbgate__satisfy_gate` itself, deadlocking its own
// documented escape hatch until the session-actions TTL expired.
function bareToolName(toolName) {
  return String(toolName || '').replace(/^mcp__.+?__/, '');
}

function isRemedyToolName(toolName) {
  return REMEDY_TOOL_NAMES.has(bareToolName(toolName));
}

// permission-change-approval used to regex the entire command string, so
// quoting `chmod 755` inside `gh issue create --body` was itself a deny (#3523).
function isCommandPositionPermissionChange(toolName, toolInput = {}) {
  if (toolName !== 'Bash') return false;
  const command = String(toolInput.command || '');
  if (!command) return false;
  const segments = canonicalizeCommandForGates(command).split('; ');
  for (const segment of segments) {
    const tokens = tokenizeShellWords(segment);
    if (tokens.length === 0) continue;
    const bin = tokens[0].toLowerCase();
    if (bin === 'chmod' || bin === 'chown' || bin === 'setfacl') return tokens.length >= 2;
    if (bin === 'busybox' && tokens[1] && ['chmod', 'chown', 'setfacl'].includes(tokens[1].toLowerCase())) {
      return tokens.length >= 3;
    }
    if (bin === 'grant' || bin === 'revoke') return tokens.length >= 2;
    const nextFew = tokens.slice(1, 6).map((token) => token.toLowerCase());
    if ((bin === 'pm' || bin === 'adb') && nextFew.includes('grant')) return true;
    if (
      (bin === 'aws' || bin === 'gcloud' || bin === 'az')
      && nextFew.some((token) => token === 'iam' || token === 'policy' || token === 'role'
        || token === 'grant' || token === 'revoke')
    ) {
      return true;
    }
  }
  return false;
}

function isThreadResolutionEvidenceAction(toolName, toolInput = {}) {
  if (isGitCommitCommand(toolName, toolInput)) return true;
  if (['recall', 'search_lessons', 'verify_claim', 'satisfy_gate', 'track_action'].includes(bareToolName(toolName))) return true;
  if (toolName !== 'Bash') return false;
  const command = String(toolInput.command || '');
  return /\b(?:gate-satisfy|satisfy_gate|track_action|gh\s+pr\s+(?:view|checks|status)|gh\s+api\b.*(?:reviewThreads|reviews|comments|threads)|git\s+(?:status|diff|show))\b/i.test(command);
}

// Read-only observability/metrics MCP tools must NEVER be blocked by the pending
// PR-thread-resolution gate. Reading revenue, the dashboard, gate stats, or a
// semantic entity cannot advance a "done" claim or mutate any state, so gating it
// only blinds the operator to their own numbers. This is the exact failure the CEO
// hit on 2026-06-30: `get_business_metrics` denied with "a git commit was made on a
// PR branch" — a governance gate eating the observability path. The exempt set is
// sourced from the canonical `readonly` MCP profile (config/mcp-allowlists.json) so
// it cannot drift from the product's own definition of "safe to read"; the hard-coded
// fallback guarantees the core observability tools stay readable even if that policy
// file is unreadable at runtime.
const READ_ONLY_TOOL_FALLBACK = new Set([
  'get_business_metrics', 'describe_semantic_entity', 'describe_reliability_entity',
  'get_reliability_rules', 'dashboard', 'org_dashboard', 'gate_stats', 'feedback_stats',
  'feedback_summary', 'session_report', 'generate_operator_artifact', 'settings_status',
  'get_scope_state', 'get_branch_governance', 'context_provenance', 'native_messaging_audit',
  'list_harnesses', 'list_intents', 'list_imported_documents', 'get_imported_document',
  'check_operational_integrity', 'workflow_sentinel', 'recall', 'search_lessons',
  'retrieve_lessons', 'search_thumbgate', 'unified_context', 'verify_claim',
]);
let readOnlyToolCache = null;
function getReadOnlyToolNames() {
  if (readOnlyToolCache) return readOnlyToolCache;
  const names = new Set(READ_ONLY_TOOL_FALLBACK);
  try {
    const { getAllowedTools } = require('./mcp-policy');
    for (const tool of getAllowedTools('readonly')) names.add(tool);
  } catch (_) {
    // Policy file missing/malformed — the fallback set still covers the core
    // observability tools, so the operator can always read state.
  }
  readOnlyToolCache = names;
  return names;
}
function isReadOnlyObservabilityTool(toolName) {
  if (!toolName) return false;
  const names = getReadOnlyToolNames();
  return names.has(toolName) || names.has(bareToolName(toolName));
}

function evaluatePendingPrThreadResolutionGate(toolName, toolInput = {}) {
  const pendingEntry = loadSessionActions()[PR_THREAD_RESOLUTION_ACTION];
  if (!pendingEntry) return null;

  // Scope to the repo that actually committed. Session-actions state lives in a
  // single global file (~/.thumbgate/session-actions.json), shared by every repo
  // on the machine. Without this check, a commit in repo A permanently locks out
  // every tool call in an unrelated repo B's session until the 1-hour TTL expires
  // (verified 2026-07-24: a commit in one repo/worktree blocked every Bash/Read/
  // Skill/ToolSearch call in a completely unrelated repo's session).
  const trackedRepoRoot = pendingEntry.metadata && pendingEntry.metadata.repoRoot;
  if (trackedRepoRoot) {
    const currentRepoRoot = resolveRepoRoot(toolInput);
    if (currentRepoRoot && currentRepoRoot !== trackedRepoRoot) return null;
  }

  if (isThreadResolutionSatisfied()) return null;
  if (isReadOnlyObservabilityTool(toolName)) return null;
  // Evidence actions (gh pr view/checks/status, gh api .../reviewThreads, git
  // status/diff/show, the satisfy_gate/track_action tools themselves) are exempt
  // from being blocked so an agent can actually gather evidence and call
  // satisfy_gate — but running them must NOT itself satisfy the gate. This is a
  // PreToolUse hook: it fires before the command executes, so at this point the
  // command hasn't run, could still fail, or could return UNFAVORABLE evidence
  // (N unresolved threads). Auto-satisfying on the mere shape of the request —
  // as an earlier version of this fix did — let `git status` (which proves
  // nothing about thread resolution) or a `gh pr view` that later errors clear
  // a critical gate before any real verification happened (caught in review,
  // PR #3030). The only sound way to clear this gate is the explicit,
  // agent-asserted `satisfy_gate` tool call, which records real evidence via
  // satisfyCondition() — never inferred from a pre-execution command guess.
  if (isThreadResolutionEvidenceAction(toolName, toolInput)) return null;

  const message = 'A git commit was made on a PR branch. Verify review threads are resolved before the next tool call.';
  return {
    decision: 'deny',
    gate: 'pr-thread-resolution-verified-required',
    message,
    severity: 'critical',
    reasoning: [
      `Tracked action ${PR_THREAD_RESOLUTION_ACTION} is pending`,
      'Check review threads (e.g. gh pr view --json reviewThreads), then call the satisfy_gate tool with gate="pr_threads_checked" (param name is gate, not gateId) and evidence — running a check command alone does not clear this gate',
    ],
  };
}

function getLocalOnlyScopeSources(governanceState = {}, constraints = {}) {
  const sources = [];
  if (governanceState.taskScope && governanceState.taskScope.localOnly) {
    sources.push('task scope');
  }
  if (governanceState.branchGovernance && governanceState.branchGovernance.localOnly) {
    sources.push('branch governance');
  }
  if (constraints.local_only && constraints.local_only.value === true) {
    sources.push('local_only constraint');
  }
  return sources;
}

function isRemoteSideEffectCommand(toolName, toolInput = {}) {
  if (toolName !== 'Bash') return false;
  const command = String(toolInput.command || '');
  return REMOTE_SIDE_EFFECT_BASH_PATTERN.test(command) || isGhApiPrCreateCommand(command);
}

function evaluateLocalOnlyRemoteSideEffectGate(toolName, toolInput = {}, governanceState = {}, constraints = {}) {
  if (!isRemoteSideEffectCommand(toolName, toolInput)) return null;
  const sources = getLocalOnlyScopeSources(governanceState, constraints);
  if (sources.length === 0) return null;

  const command = String(toolInput.command || '').trim();
  return {
    decision: 'deny',
    gate: 'local-only-remote-side-effect',
    message: 'Task scope is local-only; remote git, PR, release, and publish actions are blocked until the local-only scope is cleared or explicitly changed.',
    severity: 'critical',
    reasoning: [
      `Local-only source: ${sources.join(', ')}`,
      `Blocked command: ${command.slice(0, 160)}`,
      'Remote side effects are denied before configurable gates so wrapped commands cannot bypass local-only work boundaries',
    ],
  };
}

function helperRiskReasons(text) {
  const value = String(text || '');
  const reasons = [];
  if (DOWNLOAD_EXEC_CHAIN_PATTERN.test(value)) reasons.push('download-then-execute chain');
  if (NETWORK_OR_PROCESS_BOUNDARY_PATTERN.test(value)) reasons.push('network/process boundary');
  if (DESTRUCTIVE_OR_PRIVILEGE_BOUNDARY_PATTERN.test(value)) reasons.push('destructive/privileged side effect');
  if (/\b(?:child_process|spawn\(|exec\(|execFile\(|subprocess|ProcessBuilder)\b/i.test(value)) {
    reasons.push('process spawn');
  }
  return [...new Set(reasons)];
}

function readPackageScript(repoRoot, scriptName) {
  if (!repoRoot || !scriptName) return '';
  try {
    const packagePath = path.join(repoRoot, 'package.json');
    if (!fs.existsSync(packagePath)) return '';
    const { scripts = {} } = JSON.parse(fs.readFileSync(packagePath, 'utf8')) || {};
    return typeof scripts[scriptName] === 'string' ? scripts[scriptName] : '';
  } catch {
    return '';
  }
}

function recordHelperScriptWrite(toolName, toolInput = {}) {
  if (process.env.THUMBGATE_HELPER_BYPASS_GUARD === '0') return null;

  const affected = extractAffectedFiles(toolName, toolInput);
  const affectedFiles = affected.files || [];
  const command = String(toolInput.command || '');
  const actionContext = extractActionContext(toolName, toolInput);
  const helperFiles = affectedFiles.filter((filePath) => HELPER_SCRIPT_FILE_PATTERN.test(normalizePosix(filePath)));
  const packageScriptTouched = affectedFiles.some((filePath) => normalizePosix(filePath) === 'package.json') || /\bpackage\.json\b|\bscripts\./i.test(actionContext);
  const commandWrite = toolName === 'Bash' && HELPER_WRITE_PATTERN.test(command);

  if (helperFiles.length === 0 && !packageScriptTouched && !commandWrite) return null;

  const riskText = [
    actionContext,
    command,
    helperFiles.join(' '),
    packageScriptTouched ? 'package.json scripts' : '',
  ].filter(Boolean).join('\n');
  const reasons = helperRiskReasons(riskText);

  const metadata = {
    repoRoot: affected.repoRoot || resolveRepoRoot(toolInput) || null,
    helperFiles,
    packageScriptTouched,
    reasons,
  };
  trackAction(helperBypassActionKey(), metadata);
  return metadata;
}

function helperBypassActionKey() {
  const sessionId = currentScopeSessionId();
  return sessionId ? `${HELPER_BYPASS_ACTION}:${sessionId}` : HELPER_BYPASS_ACTION;
}

function evaluateStatefulHelperBypassGate(toolName, toolInput = {}) {
  if (process.env.THUMBGATE_HELPER_BYPASS_GUARD === '0') return null;
  if (toolName !== 'Bash') {
    recordHelperScriptWrite(toolName, toolInput);
    return null;
  }

  const command = String(toolInput.command || '').trim();
  if (!command) return null;

  if (DOWNLOAD_EXEC_CHAIN_PATTERN.test(command)) {
    return {
      decision: 'deny',
      gate: 'stateful-helper-script-bypass',
      message: 'Download-then-execute chains are blocked before the real action moves below the visible tool call.',
      severity: 'critical',
      reasoning: [
        `Command matched download/execute chain: ${command.slice(0, 180)}`,
        'PreToolUse must review the whole action chain, not only the first low-risk command',
      ],
    };
  }

  const writeMetadata = recordHelperScriptWrite(toolName, toolInput);
  const actions = listSessionActions();
  const recentWrite = actions[helperBypassActionKey()];
  const recentMetadata = recentWrite && recentWrite.metadata && typeof recentWrite.metadata === 'object'
    ? recentWrite.metadata
    : null;

  const scriptMatch = command.match(PACKAGE_RUN_PATTERN);
  const scriptName = scriptMatch ? scriptMatch[1] : '';
  const repoRoot = resolveRepoRoot(toolInput);
  const packageScript = scriptName ? readPackageScript(repoRoot, scriptName) : '';
  const commandBoundaryReasons = helperRiskReasons(`${command}\n${packageScript}`);
  const executesRecentHelper = HELPER_EXEC_PATTERN.test(command);
  const runsRecentPackageScript = Boolean(scriptName && recentMetadata && recentMetadata.packageScriptTouched);
  const recentReasons = recentMetadata && Array.isArray(recentMetadata.reasons) ? recentMetadata.reasons : [];
  const writeRiskReasons = writeMetadata && Array.isArray(writeMetadata.reasons) ? writeMetadata.reasons : [];
  const correlatedReasons = [...new Set([...recentReasons, ...writeRiskReasons, ...commandBoundaryReasons])];

  if (
    (executesRecentHelper || runsRecentPackageScript) &&
    (recentMetadata || writeMetadata) &&
    correlatedReasons.length > 0
  ) {
    const target = scriptName ? `package script "${scriptName}"` : 'recent helper script';
    return {
      decision: 'deny',
      gate: 'stateful-helper-script-bypass',
      message: `A recently modified ${target} now crosses a risky boundary. Review it or constrain cwd, network, process, and writable paths before execution.`,
      severity: 'critical',
      reasoning: [
        `Recent helper/package modification: ${(recentMetadata && recentMetadata.helperFiles || []).join(', ') || (recentMetadata && recentMetadata.packageScriptTouched ? 'package.json scripts' : 'current command write')}`,
        `Execution command: ${command.slice(0, 180)}`,
        `Risk reasons: ${correlatedReasons.join(', ')}`,
        'This blocks the helper-script/package-script bypass class raised in external review',
      ],
    };
  }

  return null;
}

function recordStructuralGateBlock(toolName, toolInput, result) {
  recordStat(result.gate, 'block', null, { toolName, toolInput });
  const auditRecord = recordAuditEvent({
    toolName,
    toolInput,
    decision: 'deny',
    gateId: result.gate,
    message: result.message,
    severity: result.severity,
    source: 'gates-engine',
  });
  auditToFeedback(auditRecord);
  return result;
}

/**
 * Resolve catastrophic declarative gates before the ordinary first-match loop.
 *
 * Config order is useful for normal policy routing, but it must not let a broad
 * rule mask a narrower irreversible-action rule. For example, the generic
 * `push-without-thread-check` gate also matches `git push --force`; selecting it
 * first allowed the free-tier daily cap to downgrade the action to a warning
 * before the exempt `force-push` gate was ever evaluated.
 *
 * Catastrophic gates are deliberately limited to the audited allowlist above.
 * Metric-backed gates are excluded because their condition is asynchronous and
 * none of the catastrophic command boundaries may depend on a remote metric.
 */
function evaluateCatastrophicDeclarativeGate(config, constraints, toolName, toolInput) {
  if (!config || !Array.isArray(config.gates)) return null;

  for (const gate of config.gates) {
    if (!CATASTROPHIC_DECLARATIVE_GATE_IDS.has(gate.id)) continue;
    if (gate.action !== 'block' || gate.metrics) continue;
    // Override-capable hard gates must reach the ordinary loop so it can
    // authenticate and consume the exact-action admin authorization. They are
    // still unconditional hard floors and cannot be posture/cap downgraded.
    if (gate.adminOverride && gate.adminOverride.required === true) continue;

    const matchDetails = matchGate(gate, toolName, toolInput);
    if (!matchDetails.matched) continue;
    if (gate.when && !checkWhenClause(gate.when, constraints)) continue;
    if (gate.unless && isConditionSatisfied(gate.unless)) continue;

    return {
      decision: 'deny',
      gate: gate.id,
      message: buildGateMessage(gate, matchDetails),
      severity: gate.severity,
      reasoning: buildReasoning(gate, toolName, toolInput, matchDetails),
    };
  }

  return null;
}

function isScopeEnforcedAction(toolName, toolInput = {}, affectedFiles = []) {
  if (EDIT_LIKE_TOOLS.has(toolName) && affectedFiles.length > 0) return true;
  if (toolName !== 'Bash') return false;
  const command = String(toolInput.command || '');
  if (!HIGH_RISK_BASH_PATTERN.test(command)) return false;
  return affectedFiles.length > 0;
}

function shouldEnforceTaskScope(gate, governanceState, toolName, toolInput = {}, affectedFiles = []) {
  if (gate.scopeMode === 'declared-only') {
    return Boolean(governanceState && governanceState.taskScope) &&
      EDIT_LIKE_TOOLS.has(toolName) &&
      affectedFiles.length > 0;
  }
  return isScopeEnforcedAction(toolName, toolInput, affectedFiles);
}

function isAgentHookSettingsFile(filePath) {
  return matchesAnyGlob(filePath, BREAK_GLASS_SETTINGS_GLOBS);
}

function isBreakGlassSettingsBypass(gate, affectedFiles) {
  if (!gate || !['task-scope-edit-boundary', 'protected-file-approval-required'].includes(gate.id)) {
    return false;
  }
  if (!isConditionSatisfied(BREAK_GLASS_CONDITION)) return false;
  return Array.isArray(affectedFiles) && affectedFiles.length > 0 && affectedFiles.every(isAgentHookSettingsFile);
}

function isBreakGlassSettingsRecoveryAction(toolName, toolInput = {}) {
  if (!EDIT_LIKE_TOOLS.has(toolName)) return false;
  if (!isConditionSatisfied(BREAK_GLASS_CONDITION)) return false;
  const affectedFiles = extractAffectedFiles(toolName, toolInput).files;
  return affectedFiles.length > 0 && affectedFiles.every(isAgentHookSettingsFile);
}

function formatFileList(files, limit = 5) {
  const items = Array.isArray(files) ? files.filter(Boolean) : [];
  if (items.length === 0) return 'none';
  if (items.length <= limit) return items.join(', ');
  return `${items.slice(0, limit).join(', ')} (+${items.length - limit} more)`;
}

function buildTaskScopeViolation(taskScope, affectedFiles, nowMs = Date.now()) {
  if (!Array.isArray(affectedFiles) || affectedFiles.length === 0) return null;
  // EXPIRY FAILS CLOSED, and that direction is the whole point.
  //
  // A task scope is a restriction, so simply dropping it on expiry would make the agent MORE
  // powerful the moment its lease ran out — expiry would remove a boundary instead of removing
  // authority. A lease has to mean the opposite: while it is live you may work in these paths,
  // and when it lapses the authority is gone until it is renewed.
  if (taskScope && isTaskScopeExpired(taskScope, nowMs)) {
    return {
      reasonCode: 'expired_task_scope',
      outsideFiles: affectedFiles.slice(),
      allowedPaths: Array.isArray(taskScope.allowedPaths) ? taskScope.allowedPaths.slice() : [],
      summary: taskScope.summary || null,
      expiresAt: taskScope.expiresAt || null,
    };
  }
  if (!taskScope || !Array.isArray(taskScope.allowedPaths) || taskScope.allowedPaths.length === 0) {
    return {
      reasonCode: 'missing_task_scope',
      outsideFiles: affectedFiles.slice(),
      allowedPaths: [],
      summary: null,
    };
  }
  const outsideFiles = affectedFiles.filter((filePath) => !matchesAnyGlob(filePath, taskScope.allowedPaths));
  if (outsideFiles.length === 0) return null;
  return {
    reasonCode: 'outside_declared_scope',
    outsideFiles,
    allowedPaths: taskScope.allowedPaths.slice(),
    summary: taskScope.summary || null,
  };
}

function buildProtectedApprovalViolation(protectedGlobs, approvals, affectedFiles) {
  const normalizedProtected = sanitizeGlobList(protectedGlobs);
  if (normalizedProtected.length === 0 || !Array.isArray(affectedFiles) || affectedFiles.length === 0) {
    return null;
  }
  const protectedFiles = affectedFiles.filter((filePath) => matchesAnyGlob(filePath, normalizedProtected));
  if (protectedFiles.length === 0) return null;

  const activeApprovals = Array.isArray(approvals) ? approvals : [];
  const missingApprovalFiles = protectedFiles.filter((filePath) => {
    return !activeApprovals.some((entry) => matchesAnyGlob(filePath, entry.pathGlobs || []));
  });
  if (missingApprovalFiles.length === 0) return null;

  return {
    protectedFiles,
    missingApprovalFiles,
    protectedGlobs: normalizedProtected,
  };
}

function buildBranchGovernanceViolation(governanceState, toolInput = {}, affectedFiles = [], repoRoot = null, requireReleaseReadiness = false) {
  // Canonicalized: this helper runs its OWN command analysis downstream of the gate's
  // pattern test, so passing the raw text let `"npm" publish` / `sudo gh release create`
  // through even once the pattern matched. Canonicalizing here keeps that second analysis
  // consistent with the first.
  const command = canonicalizeCommandForGates(String(toolInput.command || '').trim());
  if (!command) return null;

  const integrity = evaluateOperationalIntegrity({
    repoPath: repoRoot || (governanceState && governanceState.taskScope && governanceState.taskScope.repoPath) || process.cwd(),
    branchGovernance: governanceState ? governanceState.branchGovernance : null,
    changedFiles: affectedFiles,
    command,
    requireVersionNotBehindBase: requireReleaseReadiness,
  });

  if (!integrity || integrity.blockers.length === 0) {
    return null;
  }

  return {
    blockers: integrity.blockers,
    currentBranch: integrity.currentBranch,
    baseBranch: integrity.baseBranch,
    releaseSensitiveFiles: integrity.releaseSensitiveFiles,
    packageVersion: integrity.packageVersion,
    baseVersion: integrity.baseVersion,
  };
}

function buildGateMessage(gate, matchDetails) {
  if (matchDetails && matchDetails.taskScopeViolation) {
    const violation = matchDetails.taskScopeViolation;
    if (violation.reasonCode === 'expired_task_scope') {
      const lapsed = violation.expiresAt ? new Date(violation.expiresAt).toISOString() : 'unknown time';
      return `The task-scope lease expired at ${lapsed}, so its authority no longer applies. `
        + `Renew it with set_task_scope (allowed paths were: ${formatFileList(violation.allowedPaths)}).`;
    }
    if (violation.reasonCode === 'missing_task_scope') {
      return `No task scope is declared for this high-risk action. Affected files: ${formatFileList(violation.outsideFiles)}.`;
    }
    return `Action touches files outside the declared task scope: ${formatFileList(violation.outsideFiles)}. Allowed paths: ${formatFileList(violation.allowedPaths)}.`;
  }

  if (matchDetails && matchDetails.protectedApprovalViolation) {
    const violation = matchDetails.protectedApprovalViolation;
    return `Protected files require explicit approval before editing or publishing. Missing approval for: ${formatFileList(violation.missingApprovalFiles)}.`;
  }

  if (matchDetails && matchDetails.branchGovernanceViolation) {
    const [firstBlocker] = matchDetails.branchGovernanceViolation.blockers || [];
    if (firstBlocker && firstBlocker.message) {
      return firstBlocker.message;
    }
  }

  return gate.message;
}

/**
 * Build a human-readable reasoning chain explaining WHY a gate decision was made.
 * Returns an array of evidence steps — each a short sentence a developer can scan.
 *
 * @param {Object} gate - The matched gate definition
 * @param {string} toolName - The tool that was evaluated
 * @param {Object} toolInput - The tool input that was evaluated
 * @param {Object} [extras] - Optional extra context (metrics, constraints)
 * @returns {string[]} Array of reasoning steps
 */
function buildReasoning(gate, toolName, toolInput, extras = {}) {
  const steps = [];
  const text = extras.matchText || toolInput.command || toolInput.file_path || toolInput.path || '';

  // 1. What matched
  if (gate.pattern) {
    steps.push(`Pattern /${gate.pattern}/ matched "${text.length > 80 ? text.slice(0, 80) + '…' : text}"`);
  } else {
    steps.push(`Structural gate ${gate.id} matched requested action on "${text.length > 80 ? text.slice(0, 80) + '…' : text}"`);
  }

  // 2. Gate identity
  steps.push(`Gate ${gate.id} [${gate.action}] — layer: ${gate.layer || 'Execution'}, severity: ${gate.severity || 'medium'}`);

  // 3. Source (manual vs auto-promoted)
  if (gate.promotedAt || gate.source === 'auto-promote' || gate.source === 'force-promote') {
    const occText = gate.occurrences ? ` after ${gate.occurrences} failures` : '';
    steps.push(`Auto-promoted from feedback${occText} (${gate.promotedAt || 'unknown date'})`);
  } else {
    steps.push('Manual policy rule (default.json)');
  }

  // 4. Constraint context
  if (gate.when && gate.when.constraints) {
    const keys = Object.entries(gate.when.constraints).map(([k, v]) => `${k}=${v}`).join(', ');
    steps.push(`Active because constraint ${keys} is set`);
  }

  if (extras.affectedFiles && extras.affectedFiles.length > 0) {
    steps.push(`Affected files: ${formatFileList(extras.affectedFiles)}`);
  }

  if (extras.taskScopeViolation) {
    if (extras.taskScopeViolation.reasonCode === 'missing_task_scope') {
      steps.push('No active task scope is declared for this high-risk action');
    } else {
      steps.push(`Outside declared task scope: ${formatFileList(extras.taskScopeViolation.outsideFiles)}`);
      steps.push(`Declared scope: ${formatFileList(extras.taskScopeViolation.allowedPaths)}`);
    }
  }

  if (extras.protectedApprovalViolation) {
    steps.push(`Protected files without approval: ${formatFileList(extras.protectedApprovalViolation.missingApprovalFiles)}`);
  }

  if (extras.branchGovernanceViolation) {
    if (extras.branchGovernanceViolation.currentBranch || extras.branchGovernanceViolation.baseBranch) {
      steps.push(`Branch governance context: ${extras.branchGovernanceViolation.currentBranch || 'unknown'} -> ${extras.branchGovernanceViolation.baseBranch || 'unknown'}`);
    }
    if (extras.branchGovernanceViolation.releaseSensitiveFiles && extras.branchGovernanceViolation.releaseSensitiveFiles.length > 0) {
      steps.push(`Release-sensitive files: ${formatFileList(extras.branchGovernanceViolation.releaseSensitiveFiles)}`);
    }
    for (const blocker of extras.branchGovernanceViolation.blockers || []) {
      steps.push(`Branch governance blocker: ${blocker.code} — ${blocker.message}`);
    }
  }

  if (extras.memoryGuard && extras.memoryGuard.reason) {
    steps.push(`Memory guard matched (${extras.memoryGuard.source}): ${extras.memoryGuard.reason}`);
  }

  if (extras.workflowSentinel) {
    steps.push(`Workflow sentinel risk: ${extras.workflowSentinel.band} (${extras.workflowSentinel.riskScore})`);
    if (extras.workflowSentinel.blastRadius && extras.workflowSentinel.blastRadius.summary) {
      steps.push(`Workflow sentinel blast radius: ${extras.workflowSentinel.blastRadius.summary}`);
    }
    for (const remediation of (extras.workflowSentinel.remediations || []).slice(0, 3)) {
      steps.push(`Workflow sentinel remediation: ${remediation.title} — ${remediation.action}`);
    }
  }

  // 5. Unless condition status
  if (gate.unless) {
    steps.push(`Bypassable via satisfy_gate("${gate.unless}") — not currently satisfied`);
  }

  // 6. Metric condition
  if (extras.metricFailed) {
    const m = gate.metrics;
    steps.push(`Business metric "${m.name}" outside bounds [${m.min ?? '-∞'}, ${m.max ?? '∞'}]`);
  }

  // 7. Historical fire count
  const stats = loadStats();
  const gateStats = stats.byGate && stats.byGate[gate.id];
  if (gateStats) {
    steps.push(`History: blocked ${gateStats.blocked || 0}×, warned ${gateStats.warned || 0}×`);
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Matching engine
// ---------------------------------------------------------------------------

function checkWhenClause(when, constraints) {
  if (!when || !when.constraints) return true;
  
  for (const [key, expectedValue] of Object.entries(when.constraints)) {
    let value;
    if (key === 'careful_mode') {
      const isEnvTrue = process.env.THUMBGATE_CAREFUL_MODE === '1' || 
                       String(process.env.THUMBGATE_CAREFUL_MODE).toLowerCase() === 'true';
      value = isEnvTrue || (constraints[key] && constraints[key].value === expectedValue);
    } else if (key === 'freeze_mode') {
      value = Boolean(process.env.THUMBGATE_FREEZE_PATHS) || 
              (constraints[key] && constraints[key].value !== false && constraints[key].value !== null && constraints[key].value !== undefined);
    } else {
      const constraint = constraints[key];
      value = constraint && constraint.value === expectedValue;
    }
    if (!value) {
      return false;
    }
  }
  return true;
}


/**
 * Surfaces a gate pattern can match against.
 *
 * Historically only `toolInput.command|file_path|path` was considered. That
 * made every MCP / non-Bash tool call invisible to pattern gates — including
 * Gmail `send_message`, Apollo emailer send, and any auto-promoted rule that
 * mentioned a tool by name. Those gates rendered as "active" with
 * lastFiredAt:null forever (AGENT-259).
 *
 * Surfaces, in order:
 *   1. Bash/command text (preserves existing `^` anchor behavior)
 *   2. bare tool name (MCP tools)
 *   3. tool name + command
 *   4. common URL/endpoint/action fields (HTTP-shaped tool inputs)
 *
 * Body/content is intentionally excluded to avoid false blocks when an agent
 * *edits code that mentions* a send endpoint.
 */
function buildMatchSurfaces(toolName, toolInput = {}) {
  const name = String(toolName || '').trim();
  const command = String(toolInput.command || '').trim();
  const filePath = String(toolInput.file_path || toolInput.path || '').trim();
  const surfaces = [];
  const push = (s) => {
    const v = String(s || '').trim();
    if (v && !surfaces.includes(v)) surfaces.push(v);
  };
  push(command);
  push(filePath);
  push(name);
  if (name && command) push(`${name} ${command}`);
  if (name && filePath) push(`${name} ${filePath}`);
  for (const key of ['url', 'endpoint', 'method', 'action', 'path']) {
    if (toolInput[key] == null) continue;
    const v = String(toolInput[key]).slice(0, 400);
    push(v);
    if (name) push(`${name} ${v}`);
  }
  return surfaces;
}

function matchGate(gate, toolName, toolInput = {}) {
  // Primary text for audit/reasoning: prefer command, then tool name (MCP).
  const matchSurfaces = buildMatchSurfaces(toolName, toolInput);
  let matchText = matchSurfaces[0] || String(toolName || '');

  // Claw/hybrid support: enrich matchText with claw metadata (for EnterpriseClaw/OpenShell/Perplexity hybrid agents)
  const clawCtx = toolInput.clawContext || toolInput._claw || (toolInput.agentId ? {
    actionType: toolInput.actionType || 'unknown',
    agentId: toolInput.agentId || 'unknown',
    hybridRoute: toolInput.hybridRoute || 'unknown',
    screenInteraction: !!toolInput.screenInteraction,
    fileAccess: !!toolInput.fileAccess,
  } : null);

  if (clawCtx) {
    const actionType = clawCtx.actionType || clawCtx.claw_action_type || 'unknown';
    const parts = [
      matchText,
      `claw_style: true`,
      `agent_identity: ${clawCtx.agentId || 'unknown'}`,
      `claw_action_type: ${actionType}`,
      `hybrid_route: ${clawCtx.hybridRoute || 'unknown'}`,
    ];

    if (clawCtx.screenInteraction || actionType.includes('screen')) {
      parts.push('screen_interaction');
      parts.push('interact screen');
    }
    if (clawCtx.fileAccess || actionType.includes('file') || actionType.includes('fs')) {
      parts.push('file_system_access');
      parts.push('local device file system access');
    }
    if (actionType === 'dynamic-tool-creation' || actionType.includes('create-tool') || actionType.includes('define-tool')) {
      parts.push('create tool');
    }

    matchText = parts.filter(Boolean).join(' | ');
    if (!matchSurfaces.includes(matchText)) matchSurfaces.push(matchText);
  }

  const affected = extractAffectedFiles(toolName, toolInput);
  const affectedFiles = affected.files;
  const repoRoot = affected.repoRoot;
  const governanceState = loadGovernanceState();
  const constraints = loadConstraints();

  if (isSelfProtectGate(gate.id) && hasActiveProtectedApproval(governanceState, affectedFiles)) {
    return { matched: false, matchText, affectedFiles };
  }

  if (gate.id === 'on-demand-freeze-mode' || (gate.when && gate.when.constraints && gate.when.constraints.freeze_mode)) {
    let freezePaths = [];
    if (process.env.THUMBGATE_FREEZE_PATHS) {
      freezePaths = process.env.THUMBGATE_FREEZE_PATHS.split(',').map(p => p.trim()).filter(Boolean);
    } else if (constraints.freeze_mode && typeof constraints.freeze_mode.value === 'string') {
      freezePaths = constraints.freeze_mode.value.split(',').map(p => p.trim()).filter(Boolean);
    } else if (constraints.freeze_mode && Array.isArray(constraints.freeze_mode.value)) {
      freezePaths = constraints.freeze_mode.value;
    } else if (governanceState.taskScope && Array.isArray(governanceState.taskScope.allowedPaths)) {
      freezePaths = governanceState.taskScope.allowedPaths;
    }

    if (freezePaths.length > 0) {
      const outsideFiles = affectedFiles.filter((filePath) => !matchesAnyGlob(filePath, freezePaths));
      if (outsideFiles.length > 0) {
        return { matched: true, matchText, affectedFiles };
      } else {
        return { matched: false, matchText, affectedFiles };
      }
    }
  }

  if (Array.isArray(gate.toolNames) && gate.toolNames.length > 0 && !gate.toolNames.includes(toolName)) {
    return { matched: false, matchText, affectedFiles };
  }

  if (gate.pattern) {
    try {
      if (gate.id === 'permission-change-approval') {
        if (isRemedyToolName(toolName) || !isCommandPositionPermissionChange(toolName, toolInput)) {
          return { matched: false, matchText, affectedFiles };
        }
        if (isSafeLocalCredentialHardeningCommand(toolName, toolInput)) {
          return { matched: false, matchText, affectedFiles };
        }
      } else if (gate.id === 'gh-api-pr-create-restricted') {
        if (!isGhApiPrCreateCommand(String(toolInput.command || ''))) {
          return { matched: false, matchText, affectedFiles };
        }
      } else {
        const regex = new RegExp(gate.pattern);
        // Match command text, tool name, and light payload surfaces. MCP tools
        // (e.g. Gmail send_message) have no `command` field — without multi-surface
        // matching, every pattern gate against them is permanently inert.
        const surfaces = matchSurfaces.length > 0 ? matchSurfaces : [matchText];
        const anySurfaceMatch = surfaces.some((surface) => patternMatchesCommand(regex, surface));
        if (!anySurfaceMatch) {
          return { matched: false, matchText, affectedFiles };
        }
      }
      if (isBreakGlassSettingsBypass(gate, affectedFiles)) {
        return { matched: false, matchText, affectedFiles };
      }
    } catch {
      return { matched: false, matchText, affectedFiles };
    }
  }

  if (gate.executable_hash && toolInput.command) {
    const actualHash = computeExecutableHash(toolInput.command);
    if (actualHash !== gate.executable_hash) return { matched: false, matchText, affectedFiles };
  }

  if (Array.isArray(gate.fileGlobs) && gate.fileGlobs.length > 0) {
    const scopedFiles = affectedFiles.filter((filePath) => matchesAnyGlob(filePath, gate.fileGlobs));
    if (scopedFiles.length === 0) return { matched: false, matchText, affectedFiles };
  }

  let taskScopeViolation = null;
  if (gate.requireTaskScope) {
    if (isBreakGlassSettingsBypass(gate, affectedFiles)) {
      return { matched: false, matchText, affectedFiles };
    }
    if (!shouldEnforceTaskScope(gate, governanceState, toolName, toolInput, affectedFiles)) {
      return { matched: false, matchText, affectedFiles };
    }
    taskScopeViolation = buildTaskScopeViolation(governanceState.taskScope, affectedFiles);
    if (!taskScopeViolation) return { matched: false, matchText, affectedFiles };
  }

  let protectedApprovalViolation = null;
  if (gate.requireProtectedApproval) {
    if (isBreakGlassSettingsBypass(gate, affectedFiles)) {
      return { matched: false, matchText, affectedFiles };
    }
    const protectedGlobs = sanitizeGlobList(
      Array.isArray(gate.protectedGlobs) && gate.protectedGlobs.length > 0
        ? gate.protectedGlobs
        : (governanceState.taskScope && governanceState.taskScope.protectedPaths) || DEFAULT_PROTECTED_FILE_GLOBS
    );
    protectedApprovalViolation = buildProtectedApprovalViolation(
      protectedGlobs,
      governanceState.protectedApprovals,
      affectedFiles,
    );
    if (!protectedApprovalViolation) return { matched: false, matchText, affectedFiles };
  }

  let branchGovernanceViolation = null;
  if (gate.requireBranchGovernance || gate.requireReleaseReadiness) {
    branchGovernanceViolation = buildBranchGovernanceViolation(
      governanceState,
      toolInput,
      affectedFiles,
      repoRoot,
      gate.requireReleaseReadiness === true,
    );
    if (!branchGovernanceViolation) return { matched: false, matchText, affectedFiles };
  }

  return {
    matched: true,
    matchText,
    affectedFiles,
    taskScopeViolation,
    branchGovernanceViolation,
  };
}

function matchesGate(gate, toolName, toolInput) {
  return matchGate(gate, toolName, toolInput).matched;
}

function hasActiveProtectedApproval(governanceState, affectedFiles) {
  if (!Array.isArray(affectedFiles) || affectedFiles.length === 0) return false;
  const approvals = Array.isArray(governanceState && governanceState.protectedApprovals)
    ? governanceState.protectedApprovals
    : [];
  return affectedFiles.every((filePath) => approvals.some((entry) => {
    return matchesAnyGlob(filePath, sanitizeGlobList(entry && entry.pathGlobs));
  }));
}

function matchSelfProtectHardFloor(gate, toolName, toolInput = {}) {
  const affected = extractAffectedFiles(toolName, toolInput);
  const affectedFiles = affected.files;
  if (hasActiveProtectedApproval(loadGovernanceState(), affectedFiles)) return null;

  const command = String(toolInput.command || '');
  let matchText = command;

  if (gate.id === 'self-protect-config' || gate.id === 'self-protect-hooks-disable') {
    const targetPattern = gate.id === 'self-protect-config'
      ? SELF_PROTECT_CONFIG_TARGET_PATTERN
      : SELF_PROTECT_HOOK_TARGET_PATTERN;
    if (EDIT_LIKE_TOOLS.has(toolName)) {
      matchText = affectedFiles.join(' ');
      if (!targetPattern.test(matchText)) return null;
    } else if (toolName === 'Bash') {
      const commandTargetPattern = gate.id === 'self-protect-config'
        ? SELF_PROTECT_CONFIG_COMMAND_PATTERN
        : SELF_PROTECT_HOOK_COMMAND_PATTERN;

      // Inspect every shell redirection destination (optional fd, optional/no
      // spaces, attached forms like printf x>file, multiple redirects).
      const redirectPattern = /(?:^|[\s;&|]|[^\s;&|<>])(?:\d*)>{1,2}\s*([^\s;&|<>]+)/g;
      const redirectTargets = [];
      let redirectMatch = redirectPattern.exec(command);
      while (redirectMatch) {
        if (redirectMatch[1]) redirectTargets.push(redirectMatch[1]);
        redirectMatch = redirectPattern.exec(command);
      }
      if (redirectTargets.length > 0) {
        // Deny when any redirect destination is protected.
        if (redirectTargets.some((target) => commandTargetPattern.test(target))) {
          // fall through to deny
        } else if (!SHELL_FILE_MUTATION_PATTERN.test(command) || !commandTargetPattern.test(command)) {
          // Benign redirects and no other protected mutation → allow.
          return null;
        }
        // Benign redirects but command still mutates a protected path another way → deny.
      } else {
        if (!SHELL_FILE_MUTATION_PATTERN.test(command) || !commandTargetPattern.test(command)) return null;
      }
    } else {
      return null;
    }
  } else {
    if (!Array.isArray(gate.toolNames) || !gate.toolNames.includes(toolName)) return null;
    if (!matchText || !gate.pattern) return null;
    try {
      const regex = new RegExp(gate.pattern);
      if (!patternMatchesCommand(regex, matchText)) return null;
    } catch {
      return null;
    }
  }

  return {
    matched: true,
    matchText,
    affectedFiles,
  };
}

function evaluateSelfProtectHardFloor(input = {}) {
  const toolName = input.tool_name || input.toolName || '';
  const toolInput = input.tool_input || input.toolInput || {};
  const config = loadGatesConfig(DEFAULT_CONFIG_PATH);

  for (const gate of config.gates) {
    if (!isSelfProtectGate(gate.id)) continue;
    const matchDetails = matchSelfProtectHardFloor(gate, toolName, toolInput);
    if (!matchDetails) continue;

    const result = {
      decision: 'deny',
      gate: gate.id,
      message: buildGateMessage(gate, matchDetails),
      severity: gate.severity,
      reasoning: buildReasoning(gate, toolName, toolInput, matchDetails),
    };
    return recordStructuralGateBlock(toolName, toolInput, result);
  }

  return null;
}

function isSafeLocalCredentialHardeningCommand(toolName, toolInput = {}) {
  if (toolName !== 'Bash') return false;
  const command = String(toolInput.command || '').trim();
  if (!command || isRecursiveChmodCommand(command)) return false;
  if (/[;&|`$()<>*?[\]{}]/.test(command)) return false;

  const match = command.match(/(?:^|\s)chmod\s+(?:-[fv]\s+)?0?([46]00)\s+(['"]?)(\S+)\2\s*$/i);
  if (!match) return false;

  const target = match[3];
  if (!target || target === '/' || target === '~') return false;
  if (target.includes('..')) return false;

  const normalized = target.replace(/^['"]|['"]$/g, '').toLowerCase();
  const looksLikeCredentialPath = /(?:^|\/)(?:\.config|\.ssh|\.gnupg|\.aws|\.gcloud|\.gemini|\.resume_secrets|\.thumbgate|secrets?|credentials?)(?:\/|$)/.test(normalized)
    || /(?:key|secret|token|credential|gemini|gcloud|google|operator).*\.(?:json|pem|key|env)$/i.test(normalized)
    || /\.(?:pem|key)$/i.test(normalized);

  return looksLikeCredentialPath;
}

function evaluateMemoryGuard(toolName, toolInput = {}) {
  const affected = extractAffectedFiles(toolName, toolInput);
  const affectedFiles = affected.files;
  if (isSafeSecretStorageWrite(toolName, toolInput, process.cwd())) {
    return null;
  }
  // Hardening a credential file's permissions (chmod 600 on a key/secret path) is
  // a safety action, not a risk. The same exemption already guards the
  // permission-change-approval gate; without it here, `chmod 600 ~/.resume_secrets/key`
  // gets hard-denied by recurring-negative-memory matching — the opposite of intent.
  if (isSafeLocalCredentialHardeningCommand(toolName, toolInput)) {
    return null;
  }
  if (!isHighRiskAction(toolName, toolInput, affectedFiles)) {
    return null;
  }
  const governanceState = loadGovernanceState();

  if (isScopeEnforcedAction(toolName, toolInput, affectedFiles)) {
    const scopeViolation = buildTaskScopeViolation(governanceState.taskScope, affectedFiles);
    if (!scopeViolation) {
      return null;
    }
  }

  const command = String(toolInput.command || '');
  const isPrCreateCommand = toolName === 'Bash' && (
    /\bgh\s+pr\s+create\b/i.test(command) || isGhApiPrCreateCommand(command)
  );
  if (isPrCreateCommand && isConditionSatisfied('pr_create_allowed')) {
    const branchGovernanceViolation = buildBranchGovernanceViolation(
      governanceState,
      toolInput,
      affectedFiles,
      affected.repoRoot,
      /\b(?:npm|yarn|pnpm)\s+publish\b|\bgh\s+release\s+create\b|\bgit\s+tag\b/i.test(command),
    );
    if (!branchGovernanceViolation) {
      return null;
    }
  }

  if (toolName === 'Bash' && (
    /\b(?:gh\s+pr\s+(?:create|merge)|gh\s+release\s+create|git\s+tag\b|(?:npm|yarn|pnpm)\s+publish\b)\b/i.test(command) ||
    isGhApiPrCreateCommand(command)
  )) {
    const branchGovernanceViolation = buildBranchGovernanceViolation(
      governanceState,
      toolInput,
      affectedFiles,
      affected.repoRoot,
      /\b(?:npm|yarn|pnpm)\s+publish\b|\bgh\s+release\s+create\b|\bgit\s+tag\b/i.test(command),
    );
    if (!branchGovernanceViolation) {
      return null;
    }
  }

  const protectedGlobs = sanitizeGlobList(
    (governanceState.taskScope && governanceState.taskScope.protectedPaths) || DEFAULT_PROTECTED_FILE_GLOBS
  );
  if (affectedFiles.length > 0 && protectedGlobs.length > 0) {
    const protectedApprovalViolation = buildProtectedApprovalViolation(
      protectedGlobs,
      governanceState.protectedApprovals,
      affectedFiles,
    );
    if (!protectedApprovalViolation && affectedFiles.some((filePath) => matchesAnyGlob(filePath, protectedGlobs))) {
      return null;
    }
  }

  const hybrid = getHybridFeedbackModule();
  if (!hybrid || typeof hybrid.evaluatePretool !== 'function') {
    return null;
  }

  // The memory guard keyword-matches against this string. The false positives that motivated
  // a cap here came from the JSON envelope's own KEY names polluting the haystack, which is
  // fixed at the matcher (buildMatchHaystack). Truncating the file list instead silently
  // dropped action targets: for a broad action, a guard whose keywords appear only in a later
  // filename could no longer match, so a learned prevention rule was bypassable purely by
  // filename ordering. Keep every target and bound the SIZE instead.
  const serializedInput = JSON.stringify({
    toolName,
    command: toolInput.command || null,
    filePath: toolInput.file_path || toolInput.path || null,
    affectedFiles,
  }).slice(0, MEMORY_GUARD_MAX_SERIALIZED_CHARS);
  // Claw/hybrid support: pass context if agent provides claw metadata (for EnterpriseClaw/OpenShell/Perplexity hybrid agents)
  let guard;
  if (toolInput && (toolInput.clawContext || toolInput._claw || toolInput.hybridRoute || toolInput.agentId)) {
    const clawCtx = toolInput.clawContext || toolInput._claw || { actionType: toolInput.actionType || 'unknown', agentId: toolInput.agentId || 'unknown', hybridRoute: toolInput.hybridRoute || 'unknown' };
    guard = hybrid.evaluateClawPretool ? hybrid.evaluateClawPretool(toolName, serializedInput, clawCtx) : hybrid.evaluatePretool(toolName, serializedInput);
  } else {
    guard = hybrid.evaluatePretool(toolName, serializedInput);
  }
  if (!guard || guard.mode !== 'block') {
    return null;
  }
  const guardReason = String(guard.reason || '');
  const contextualMatch = /^(?:Matched guard pattern|Recurring negative pattern)\b/i.test(guardReason);
  if (!contextualMatch) {
    return null;
  }

  const message = `Recurring negative memory matched a high-risk action. Denied by default until scope/approval is made explicit. ${guard.reason}`;
  return {
    decision: 'deny',
    gate: 'memory-high-risk-default-deny',
    message,
    severity: 'critical',
    reasoning: buildReasoning({
      id: 'memory-high-risk-default-deny',
      action: 'block',
      layer: 'Memory',
      severity: 'critical',
      message,
    }, toolName, toolInput, {
      matchText: toolInput.command || toolInput.file_path || toolInput.path || '',
      affectedFiles,
      memoryGuard: guard,
    }),
  };
}

function buildSentinelGateResult(report) {
  return {
    decision: report.decision,
    gate: 'workflow-sentinel',
    message: `${report.summary} ${report.blastRadius.summary}`,
    severity: report.decision === 'deny' ? 'critical' : 'high',
    reasoning: Array.isArray(report.reasoning) ? report.reasoning.slice() : [],
    sentinel: report,
  };
}

function recordSentinelDecision(report, toolName, toolInput) {
  if (!report) return null;
  const entry = recordDecisionEvaluation(report, {
    source: 'gates-engine',
    toolName,
    toolInput,
    changedFiles: report && report.blastRadius && Array.isArray(report.blastRadius.affectedFiles)
      ? report.blastRadius.affectedFiles
      : [],
  });
  report.actionId = entry.actionId;
  if (report.decisionControl && !report.decisionControl.actionId) {
    report.decisionControl.actionId = entry.actionId;
  }
  return entry;
}

function recordMemoryGuardDecision(sentinelDecision, enrichedMemoryGuard) {
  if (!sentinelDecision) return;
  recordDecisionOutcome({
    actionId: sentinelDecision.actionId,
    outcome: 'blocked',
    actualDecision: 'deny',
    actor: 'system',
    source: 'gates-engine',
    notes: enrichedMemoryGuard.message,
  });
}

function recordSentinelBlockDecision(sentinelDecision, sentinelResult) {
  if (!sentinelDecision) return;
  recordDecisionOutcome({
    actionId: sentinelDecision.actionId,
    outcome: sentinelResult.decision === 'deny' ? 'blocked' : 'warned',
    actualDecision: sentinelResult.decision,
    actor: 'system',
    source: 'workflow-sentinel',
    notes: sentinelResult.message,
  });
}

function enrichResultWithSentinel(result, report) {
  if (!result || !report || report.decision === 'allow') {
    return result;
  }

  const next = {
    ...result,
    reasoning: Array.isArray(result.reasoning) ? result.reasoning.slice() : [],
    sentinel: report,
  };

  if (report.blastRadius && report.blastRadius.summary) {
    next.message = `${result.message} Workflow sentinel: ${report.blastRadius.summary}`;
  }

  next.reasoning = next.reasoning.concat(
    Array.isArray(report.reasoning) ? report.reasoning : []
  );

  return next;
}

async function checkMetricCondition(metricCondition) {
  if (!metricCondition) return true;
  const { getBusinessMetrics } = require('./semantic-layer');
  const metrics = await getBusinessMetrics({ window: metricCondition.window || '30d' });
  const value = metrics.metrics[metricCondition.name];
  
  if (value === undefined) return true;

  if (metricCondition.min !== undefined && value < metricCondition.min) return false;
  if (metricCondition.max !== undefined && value > metricCondition.max) return false;
  
  return true;
}

/**
 * Whether this run is autonomous — i.e. no human is present to resolve an
 * `approve` (human-in-the-loop) gate. Opt-in ONLY via THUMBGATE_AUTONOMOUS=1
 * (or "true"); interactive and existing CI behavior is unchanged unless an
 * operator explicitly sets it. In an autonomous agent loop an approval gate has
 * nobody to sign off, so it must fail CLOSED (deny) rather than defer forever or
 * slip through — a guardrail has to guard precisely when it is unattended.
 */
function isAutonomousRun() {
  const raw = String(process.env.THUMBGATE_AUTONOMOUS || '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

async function evaluateGatesAsyncInner(toolName, toolInput, configPath) {
  let config;
  try {
    let harnessPath;
    try {
      const { selectHarness } = require('./harness-selector');
      harnessPath = selectHarness(toolName, toolInput);
      try {
        // Opt-in RateBurst only (THUMBGATE_RADWARE_RATE=1). Never persist in tests/CI.
        if (process.env.THUMBGATE_RADWARE_RATE === '1') {
          const radware = require('./radware-threat-defense.js');
          const inTest = Boolean(process.env.NODE_TEST || process.env.NODE_TEST_CONTEXT || process.env.CI || process.env.GITHUB_ACTIONS || process.env.VITEST || process.argv.some((a) => a.includes('node:test') || a.endsWith('.test.js')));
          if (!inTest) {
            radware.persistCallTimestamp();
            const burst = radware.checkRateBurst(radware.loadCallTimestamps());
            if (burst.tripped) {
              return recordStructuralGateBlock(toolName, toolInput, {
                decision: 'deny',
                gate: 'algorithmic-token-drain-circuit-breaker',
                action: 'block',
                severity: 'high',
                message: burst.message,
                receipt: 'threat_defense_interdicted=true:type=RateBurst:action=block',
              });
            }
          }
        }
      } catch { /* optional */ }
    } catch { /* harness-selector is optional */ }
    config = loadGatesConfig(configPath, harnessPath);
  } catch {
    return null;
  }

  const constraints = loadConstraints();
  const governanceState = loadGovernanceState();
  registerPrThreadResolutionClaimGate(toolName, toolInput);
  const localOnlyRemoteSideEffectGate = evaluateLocalOnlyRemoteSideEffectGate(
    toolName,
    toolInput,
    governanceState,
    constraints,
  );
  if (localOnlyRemoteSideEffectGate) {
    return recordStructuralGateBlock(toolName, toolInput, localOnlyRemoteSideEffectGate);
  }
  const statefulHelperBypassGate = evaluateStatefulHelperBypassGate(toolName, toolInput);
  if (statefulHelperBypassGate) {
    return recordStructuralGateBlock(toolName, toolInput, statefulHelperBypassGate);
  }
  const stealthMemoryInjectionGate = evaluateStealthMemoryInjection(toolName, toolInput);
  if (stealthMemoryInjectionGate) {
    return recordStructuralGateBlock(toolName, toolInput, stealthMemoryInjectionGate);
  }
  if (isBreakGlassSettingsRecoveryAction(toolName, toolInput)) {
    recordAuditEvent({
      toolName,
      toolInput,
      decision: 'allow',
      gateId: BREAK_GLASS_CONDITION,
      message: 'Break-glass recovery allowed hook settings edit',
      severity: 'high',
      source: 'gates-engine',
    });
    return null;
  }

  const agentIdentityLifecycleGate = evaluateAgentIdentityLifecycleGate(toolName, toolInput);
  if (agentIdentityLifecycleGate) {
    recordStat(agentIdentityLifecycleGate.gate, 'block', null, { toolName, toolInput });
    const identityAuditRecord = recordAuditEvent({
      toolName,
      toolInput,
      decision: 'deny',
      gateId: agentIdentityLifecycleGate.gate,
      message: agentIdentityLifecycleGate.message,
      severity: agentIdentityLifecycleGate.severity,
      source: 'gates-engine',
    });
    auditToFeedback(identityAuditRecord);
    return agentIdentityLifecycleGate;
  }

  const pendingThreadResolutionGate = evaluatePendingPrThreadResolutionGate(toolName, toolInput);
  if (pendingThreadResolutionGate) {
    recordStat(pendingThreadResolutionGate.gate, 'block', null, { toolName, toolInput });
    const auditRecord = recordAuditEvent({
      toolName,
      toolInput,
      decision: 'deny',
      gateId: pendingThreadResolutionGate.gate,
      message: pendingThreadResolutionGate.message,
      severity: pendingThreadResolutionGate.severity,
      source: 'gates-engine',
    });
    auditToFeedback(auditRecord);
    return pendingThreadResolutionGate;
  }

  const boostedRiskGuard = evaluateBoostedRiskTagGuard(toolName, toolInput);
  if (boostedRiskGuard) {
    recordStat(boostedRiskGuard.gate, 'block', null, { toolName, toolInput });
    const auditRecord = recordAuditEvent({
      toolName,
      toolInput,
      decision: 'deny',
      gateId: boostedRiskGuard.gate,
      message: boostedRiskGuard.message,
      severity: boostedRiskGuard.severity,
      source: 'gates-engine',
    });
    auditToFeedback(auditRecord);
    return boostedRiskGuard;
  }

  const catastrophicDeclarativeGate = evaluateCatastrophicDeclarativeGate(
    config,
    constraints,
    toolName,
    toolInput,
  );
  if (catastrophicDeclarativeGate) {
    return recordStructuralGateBlock(toolName, toolInput, catastrophicDeclarativeGate);
  }

  // Tier 1b: Planning and Trajectory (v1.26.0 - CodeRabbit Pattern).
  // Keep runtime enforcement explicit so advisory planning checks do not mask
  // higher-priority deny/approve gates in established workflows.
  if (isRuntimePlanGateEnabled()) {
    const planGate = evaluatePlanGate(toolName, toolInput);
    if (planGate) {
      recordStat(planGate.gate, planGate.decision === 'deny' ? 'block' : 'warn', null, { toolName, toolInput });
      return planGate;
    }

    const trajectory = getTrajectoryScore();
    if (trajectory.isDrifting) {
      recordStat('strategic-drift', 'block', null, { toolName, toolInput });
      return { decision: 'deny', gate: 'strategic-drift', message: trajectory.message, severity: 'high' };
    }
  }

  // Fast-path: feedback/recall tools skip metric gates entirely (avoids Stripe API calls)
  const METRIC_SKIP_TOOLS = ['capture_feedback', 'feedback_stats', 'recall', 'feedback_summary', 'prevention_rules'];
  const skipMetrics = METRIC_SKIP_TOOLS.includes(toolName);

  for (const gate of config.gates) {
    const matchDetails = matchGate(gate, toolName, toolInput);
    if (!matchDetails.matched) continue;

    // EvoSkill Hardening: check contextual 'when' clause
    if (gate.when && !checkWhenClause(gate.when, constraints)) {
      continue;
    }

    // Metric-aware gates: check business metrics from Semantic Layer
    let metricFailed = false;
    if (gate.metrics) {
      if (skipMetrics) {
        // Fast path: skip metric gates for feedback/recall tools
        continue;
      }
      const metricResult = await Promise.race([
        checkMetricCondition(gate.metrics),
        new Promise(resolve => setTimeout(() => resolve({ pass: true, reason: 'metric-timeout' }), 3000))
      ]);
      // checkMetricCondition returns a boolean; Promise.race timeout returns an object
      const metricsPassed = typeof metricResult === 'object' ? metricResult.pass : metricResult;
      if (!metricsPassed) {
        metricFailed = true;
      } else {
        continue;
      }
    }

    // Check unless condition
    if (gate.unless && isConditionSatisfied(gate.unless)) {
      continue;
    }

    const message = buildGateMessage(gate, matchDetails);
    const reasoning = buildReasoning(gate, toolName, toolInput, {
      metricFailed,
      ...matchDetails,
    });

    if (gate.action === 'block') {
      const adminOverride = evaluateAdminOverride(gate, toolName, toolInput);
      if (adminOverride && adminOverride.authorized) {
        recordStat(gate.id, 'approve', gate, { toolName, toolInput });
        const auditRecord = recordAuditEvent({
          toolName,
          toolInput,
          decision: 'allow',
          gateId: gate.id,
          message: `Single-use admin override consumed for sha256:${adminOverride.approvalContextDigest}.`,
          severity: gate.severity,
          source: 'gates-engine-admin-override',
        });
        auditToFeedback(auditRecord);
        return {
          decision: 'allow',
          gate: gate.id,
          message: `Single-use admin override consumed for sha256:${adminOverride.approvalContextDigest}.`,
          severity: gate.severity,
          reasoning,
          adminOverride,
        };
      }
      // Expired leases report under their own gate id so neither the enforcement posture nor
      // the daily block cap can quietly turn this denial into a warning.
      const gateId = matchDetails && matchDetails.taskScopeViolation
        && matchDetails.taskScopeViolation.reasonCode === 'expired_task_scope'
        ? TASK_SCOPE_LEASE_EXPIRED_GATE_ID
        : gate.id;
      const overrideMessage = adminOverride
        ? `${message} Approval request: ${adminOverride.escalationId}. Action digest: sha256:${adminOverride.approvalContextDigest}.${adminOverride.replayed ? ' The approved override was already consumed.' : ''}`
        : message;
      const denyResult = {
        decision: 'deny',
        gate: gateId,
        message: overrideMessage,
        severity: gate.severity,
        reasoning,
        ...(adminOverride ? { requiresAdminOverride: true, adminOverride } : {}),
      };
      // Free-tier daily block cap: after N blocks/day, deny → warn + upgrade CTA
      const cappedResult = applyDailyBlockCap(denyResult);
      if (cappedResult) {
        recordStat(gate.id, 'warn', gate, { toolName, toolInput });
        const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'warn', gateId: gate.id, message: cappedResult.message, severity: gate.severity, source: 'gates-engine', dailyBlockCapApplied: true });
        auditToFeedback(auditRecord);
        return cappedResult;
      }
      recordStat(gate.id, 'block', gate, { toolName, toolInput });
      const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'deny', gateId: gate.id, message: overrideMessage, severity: gate.severity, source: 'gates-engine' });
      auditToFeedback(auditRecord);
      return denyResult;
    }

    if (gate.action === 'approve') {
      const approvalEnabled = process.env.THUMBGATE_APPROVAL_GATES !== '0';
      if (approvalEnabled) {
        if (isAutonomousRun()) {
          // Autonomous run: no human to approve. Fail CLOSED so the actions that
          // most need sign-off cannot slip through unattended.
          const failClosedMessage = `[autonomous run — no approver present, failing closed] ${message}`;
          recordStat(gate.id, 'block', gate, { toolName, toolInput });
          const failClosedAudit = recordAuditEvent({ toolName, toolInput, decision: 'deny', gateId: gate.id, message: failClosedMessage, severity: gate.severity, source: 'gates-engine', autonomousFailClosed: true });
          auditToFeedback(failClosedAudit);
          return { decision: 'deny', gate: gate.id, message: failClosedMessage, severity: gate.severity, reasoning, requiresApproval: true, failedClosed: true };
        }
        recordStat(gate.id, 'approve', gate, { toolName, toolInput });
        const result = { decision: 'approve', gate: gate.id, message, severity: gate.severity, reasoning, requiresApproval: true };
        const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'approve', gateId: gate.id, message, severity: gate.severity, source: 'gates-engine' });
        auditToFeedback(auditRecord);
        return result;
      }
      recordStat(gate.id, 'warn', gate, { toolName, toolInput });
      const result = { decision: 'warn', gate: gate.id, message: `[approval gate disabled] ${message}`, severity: gate.severity, reasoning };
      const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'warn', gateId: gate.id, message, severity: gate.severity, source: 'gates-engine' });
      auditToFeedback(auditRecord);
      return result;
    }

    if (gate.action === 'log') {
      recordStat(gate.id, 'log', gate, { toolName, toolInput });
      const result = { decision: 'log', gate: gate.id, message, severity: gate.severity, reasoning, logged: true };
      const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'log', gateId: gate.id, message, severity: gate.severity, source: 'gates-engine' });
      auditToFeedback(auditRecord);
      // 'log' action allows the tool call to proceed — do not return early, continue to next gate
      continue;
    }

    if (gate.action === 'warn') {
      recordStat(gate.id, 'warn', gate, { toolName, toolInput });
      const result = { decision: 'warn', gate: gate.id, message, severity: gate.severity, reasoning };
      const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'warn', gateId: gate.id, message, severity: gate.severity, source: 'gates-engine' });
      auditToFeedback(auditRecord);
      return result;
    }
  }

  const skipAdvisoryGuards = isSafeSecretStorageWrite(toolName, toolInput, process.cwd());
  const sentinelReport = skipAdvisoryGuards ? null : evaluateWorkflowSentinel(toolName, toolInput, {
    governanceState,
  });
  const sentinelDecision = recordSentinelDecision(sentinelReport, toolName, toolInput);
  const memoryGuard = evaluateMemoryGuard(toolName, toolInput);
  if (memoryGuard) {
    const enrichedMemoryGuard = enrichResultWithSentinel(memoryGuard, sentinelReport);
    recordStat(enrichedMemoryGuard.gate, 'block', null, { toolName, toolInput });
    recordMemoryGuardDecision(sentinelDecision, enrichedMemoryGuard);
    const auditRecord = recordAuditEvent({
      toolName,
      toolInput,
      decision: 'deny',
      gateId: enrichedMemoryGuard.gate,
      message: enrichedMemoryGuard.message,
      severity: enrichedMemoryGuard.severity,
      source: 'gates-engine',
    });
    auditToFeedback(auditRecord);
    return enrichedMemoryGuard;
  }

  if (sentinelReport && sentinelReport.decision !== 'allow') {
    const sentinelResult = buildSentinelGateResult(sentinelReport);
    recordStat(sentinelResult.gate, sentinelResult.decision === 'deny' ? 'block' : 'warn', null, { toolName, toolInput });
    recordSentinelBlockDecision(sentinelDecision, sentinelResult);
    const auditRecord = recordAuditEvent({
      toolName,
      toolInput,
      decision: sentinelResult.decision,
      gateId: sentinelResult.gate,
      message: sentinelResult.message,
      severity: sentinelResult.severity,
      source: 'workflow-sentinel',
    });
    auditToFeedback(auditRecord);
    return sentinelResult;
  }

  const brokerReceiptResultAsync = evaluateBrokerReceiptGate(toolName, toolInput);
  if (brokerReceiptResultAsync && brokerReceiptResultAsync.decision === 'deny') {
    recordStat(brokerReceiptResultAsync.gate, 'block', null, { toolName, toolInput });
    const auditRecord = recordAuditEvent({
      toolName,
      toolInput,
      decision: 'deny',
      gateId: brokerReceiptResultAsync.gate,
      message: brokerReceiptResultAsync.message,
      severity: brokerReceiptResultAsync.severity,
      source: 'broker-execution-receipts',
    });
    auditToFeedback(auditRecord);
    return brokerReceiptResultAsync;
  }

  // Audit trail: record allow (no gate matched)
  recordAuditEvent({ toolName, toolInput, decision: 'allow', source: 'gates-engine' });
  return null;
}

function evaluateGatesInner(toolName, toolInput, configPath) {
  let config;
  try {
    let harnessPath;
    try {
      const { selectHarness } = require('./harness-selector');
      harnessPath = selectHarness(toolName, toolInput);
      try {
        // Opt-in RateBurst only (THUMBGATE_RADWARE_RATE=1). Never persist in tests/CI.
        if (process.env.THUMBGATE_RADWARE_RATE === '1') {
          const radware = require('./radware-threat-defense.js');
          const inTest = Boolean(process.env.NODE_TEST || process.env.NODE_TEST_CONTEXT || process.env.CI || process.env.GITHUB_ACTIONS || process.env.VITEST || process.argv.some((a) => a.includes('node:test') || a.endsWith('.test.js')));
          if (!inTest) {
            radware.persistCallTimestamp();
            const burst = radware.checkRateBurst(radware.loadCallTimestamps());
            if (burst.tripped) {
              return recordStructuralGateBlock(toolName, toolInput, {
                decision: 'deny',
                gate: 'algorithmic-token-drain-circuit-breaker',
                action: 'block',
                severity: 'high',
                message: burst.message,
                receipt: 'threat_defense_interdicted=true:type=RateBurst:action=block',
              });
            }
          }
        }
      } catch { /* optional */ }
    } catch { /* harness-selector is optional */ }
    config = loadGatesConfig(configPath, harnessPath);
  } catch {
    // If config can't be loaded, pass through
    return null;
  }

  const constraints = loadConstraints();
  const governanceState = loadGovernanceState();
  registerPrThreadResolutionClaimGate(toolName, toolInput);
  const localOnlyRemoteSideEffectGate = evaluateLocalOnlyRemoteSideEffectGate(
    toolName,
    toolInput,
    governanceState,
    constraints,
  );
  if (localOnlyRemoteSideEffectGate) {
    return recordStructuralGateBlock(toolName, toolInput, localOnlyRemoteSideEffectGate);
  }
  const statefulHelperBypassGate = evaluateStatefulHelperBypassGate(toolName, toolInput);
  if (statefulHelperBypassGate) {
    return recordStructuralGateBlock(toolName, toolInput, statefulHelperBypassGate);
  }
  const stealthMemoryInjectionGate = evaluateStealthMemoryInjection(toolName, toolInput);
  if (stealthMemoryInjectionGate) {
    return recordStructuralGateBlock(toolName, toolInput, stealthMemoryInjectionGate);
  }
  if (isBreakGlassSettingsRecoveryAction(toolName, toolInput)) {
    recordAuditEvent({
      toolName,
      toolInput,
      decision: 'allow',
      gateId: BREAK_GLASS_CONDITION,
      message: 'Break-glass recovery allowed hook settings edit',
      severity: 'high',
      source: 'gates-engine',
    });
    return null;
  }

  const agentIdentityLifecycleGate = evaluateAgentIdentityLifecycleGate(toolName, toolInput);
  if (agentIdentityLifecycleGate) {
    recordStat(agentIdentityLifecycleGate.gate, 'block', null, { toolName, toolInput });
    const identityAuditRecord = recordAuditEvent({
      toolName,
      toolInput,
      decision: 'deny',
      gateId: agentIdentityLifecycleGate.gate,
      message: agentIdentityLifecycleGate.message,
      severity: agentIdentityLifecycleGate.severity,
      source: 'gates-engine',
    });
    auditToFeedback(identityAuditRecord);
    return agentIdentityLifecycleGate;
  }

  const pendingThreadResolutionGate = evaluatePendingPrThreadResolutionGate(toolName, toolInput);
  if (pendingThreadResolutionGate) {
    recordStat(pendingThreadResolutionGate.gate, 'block', null, { toolName, toolInput });
    const auditRecord = recordAuditEvent({
      toolName,
      toolInput,
      decision: 'deny',
      gateId: pendingThreadResolutionGate.gate,
      message: pendingThreadResolutionGate.message,
      severity: pendingThreadResolutionGate.severity,
      source: 'gates-engine',
    });
    auditToFeedback(auditRecord);
    return pendingThreadResolutionGate;
  }

  const boostedRiskGuard = evaluateBoostedRiskTagGuard(toolName, toolInput);
  if (boostedRiskGuard) {
    recordStat(boostedRiskGuard.gate, 'block', null, { toolName, toolInput });
    const auditRecord = recordAuditEvent({
      toolName,
      toolInput,
      decision: 'deny',
      gateId: boostedRiskGuard.gate,
      message: boostedRiskGuard.message,
      severity: boostedRiskGuard.severity,
      source: 'gates-engine',
    });
    auditToFeedback(auditRecord);
    return boostedRiskGuard;
  }

  const catastrophicDeclarativeGate = evaluateCatastrophicDeclarativeGate(
    config,
    constraints,
    toolName,
    toolInput,
  );
  if (catastrophicDeclarativeGate) {
    return recordStructuralGateBlock(toolName, toolInput, catastrophicDeclarativeGate);
  }

  // Tier 1b: Planning and Trajectory (v1.26.0 - CodeRabbit Pattern).
  // Keep runtime enforcement explicit so advisory planning checks do not mask
  // higher-priority deny/approve gates in established workflows.
  if (isRuntimePlanGateEnabled()) {
    const planGate = evaluatePlanGate(toolName, toolInput);
    if (planGate) {
      recordStat(planGate.gate, planGate.decision === 'deny' ? 'block' : 'warn', null, { toolName, toolInput });
      return planGate;
    }

    const trajectory = getTrajectoryScore();
    if (trajectory.isDrifting) {
      recordStat('strategic-drift', 'block', null, { toolName, toolInput });
      return { decision: 'deny', gate: 'strategic-drift', message: trajectory.message, severity: 'high' };
    }
  }

  for (const gate of config.gates) {
    const matchDetails = matchGate(gate, toolName, toolInput);
    if (!matchDetails.matched) continue;

    // EvoSkill Hardening: check contextual 'when' clause
    if (gate.when && !checkWhenClause(gate.when, constraints)) {
      continue;
    }

    // Check unless condition
    if (gate.unless && isConditionSatisfied(gate.unless)) {
      continue;
    }

    const message = buildGateMessage(gate, matchDetails);
    const reasoning = buildReasoning(gate, toolName, toolInput, matchDetails);

    if (gate.action === 'block') {
      const adminOverride = evaluateAdminOverride(gate, toolName, toolInput);
      if (adminOverride && adminOverride.authorized) {
        recordStat(gate.id, 'approve', gate, { toolName, toolInput });
        const auditRecord = recordAuditEvent({
          toolName,
          toolInput,
          decision: 'allow',
          gateId: gate.id,
          message: `Single-use admin override consumed for sha256:${adminOverride.approvalContextDigest}.`,
          severity: gate.severity,
          source: 'gates-engine-admin-override',
        });
        auditToFeedback(auditRecord);
        return {
          decision: 'allow',
          gate: gate.id,
          message: `Single-use admin override consumed for sha256:${adminOverride.approvalContextDigest}.`,
          severity: gate.severity,
          reasoning,
          adminOverride,
        };
      }
      // Expired leases report under their own gate id so neither the enforcement posture nor
      // the daily block cap can quietly turn this denial into a warning.
      const gateId = matchDetails && matchDetails.taskScopeViolation
        && matchDetails.taskScopeViolation.reasonCode === 'expired_task_scope'
        ? TASK_SCOPE_LEASE_EXPIRED_GATE_ID
        : gate.id;
      const overrideMessage = adminOverride
        ? `${message} Approval request: ${adminOverride.escalationId}. Action digest: sha256:${adminOverride.approvalContextDigest}.${adminOverride.replayed ? ' The approved override was already consumed.' : ''}`
        : message;
      const denyResult = {
        decision: 'deny',
        gate: gateId,
        message: overrideMessage,
        severity: gate.severity,
        reasoning,
        ...(adminOverride ? { requiresAdminOverride: true, adminOverride } : {}),
      };
      // Free-tier daily block cap: after N blocks/day, deny → warn + upgrade CTA
      const cappedResult = applyDailyBlockCap(denyResult);
      if (cappedResult) {
        recordStat(gate.id, 'warn', gate, { toolName, toolInput });
        const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'warn', gateId: gate.id, message: cappedResult.message, severity: gate.severity, source: 'gates-engine', dailyBlockCapApplied: true });
        auditToFeedback(auditRecord);
        return cappedResult;
      }
      recordStat(gate.id, 'block', gate, { toolName, toolInput });
      const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'deny', gateId: gate.id, message: overrideMessage, severity: gate.severity, source: 'gates-engine' });
      auditToFeedback(auditRecord);
      return denyResult;
    }

    if (gate.action === 'approve') {
      const approvalEnabled = process.env.THUMBGATE_APPROVAL_GATES !== '0';
      if (approvalEnabled) {
        if (isAutonomousRun()) {
          // Autonomous run: no human to approve. Fail CLOSED so the actions that
          // most need sign-off cannot slip through unattended.
          const failClosedMessage = `[autonomous run — no approver present, failing closed] ${message}`;
          recordStat(gate.id, 'block', gate, { toolName, toolInput });
          const failClosedAudit = recordAuditEvent({ toolName, toolInput, decision: 'deny', gateId: gate.id, message: failClosedMessage, severity: gate.severity, source: 'gates-engine', autonomousFailClosed: true });
          auditToFeedback(failClosedAudit);
          return { decision: 'deny', gate: gate.id, message: failClosedMessage, severity: gate.severity, reasoning, requiresApproval: true, failedClosed: true };
        }
        recordStat(gate.id, 'approve', gate, { toolName, toolInput });
        const result = { decision: 'approve', gate: gate.id, message, severity: gate.severity, reasoning, requiresApproval: true };
        const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'approve', gateId: gate.id, message, severity: gate.severity, source: 'gates-engine' });
        auditToFeedback(auditRecord);
        return result;
      }
      recordStat(gate.id, 'warn', gate, { toolName, toolInput });
      const result = { decision: 'warn', gate: gate.id, message: `[approval gate disabled] ${message}`, severity: gate.severity, reasoning };
      const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'warn', gateId: gate.id, message, severity: gate.severity, source: 'gates-engine' });
      auditToFeedback(auditRecord);
      return result;
    }

    if (gate.action === 'log') {
      recordStat(gate.id, 'log', gate, { toolName, toolInput });
      const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'log', gateId: gate.id, message, severity: gate.severity, source: 'gates-engine' });
      auditToFeedback(auditRecord);
      // 'log' action allows the tool call to proceed — continue to next gate
      continue;
    }

    if (gate.action === 'warn') {
      recordStat(gate.id, 'warn', gate, { toolName, toolInput });
      const result = { decision: 'warn', gate: gate.id, message, severity: gate.severity, reasoning };
      const auditRecord = recordAuditEvent({ toolName, toolInput, decision: 'warn', gateId: gate.id, message, severity: gate.severity, source: 'gates-engine' });
      auditToFeedback(auditRecord);
      return result;
    }
  }

  const skipAdvisoryGuards = isSafeSecretStorageWrite(toolName, toolInput, process.cwd());
  const sentinelReport = skipAdvisoryGuards ? null : evaluateWorkflowSentinel(toolName, toolInput, {
    governanceState,
  });
  const sentinelDecision = recordSentinelDecision(sentinelReport, toolName, toolInput);
  const memoryGuard = evaluateMemoryGuard(toolName, toolInput);
  if (memoryGuard) {
    const enrichedMemoryGuard = enrichResultWithSentinel(memoryGuard, sentinelReport);
    recordStat(enrichedMemoryGuard.gate, 'block', null, { toolName, toolInput });
    recordMemoryGuardDecision(sentinelDecision, enrichedMemoryGuard);
    const auditRecord = recordAuditEvent({
      toolName,
      toolInput,
      decision: 'deny',
      gateId: enrichedMemoryGuard.gate,
      message: enrichedMemoryGuard.message,
      severity: enrichedMemoryGuard.severity,
      source: 'gates-engine',
    });
    auditToFeedback(auditRecord);
    return enrichedMemoryGuard;
  }

  if (sentinelReport && sentinelReport.decision !== 'allow') {
    const sentinelResult = buildSentinelGateResult(sentinelReport);
    recordStat(sentinelResult.gate, sentinelResult.decision === 'deny' ? 'block' : 'warn', null, { toolName, toolInput });
    recordSentinelBlockDecision(sentinelDecision, sentinelResult);
    const auditRecord = recordAuditEvent({
      toolName,
      toolInput,
      decision: sentinelResult.decision,
      gateId: sentinelResult.gate,
      message: sentinelResult.message,
      severity: sentinelResult.severity,
      source: 'workflow-sentinel',
    });
    auditToFeedback(auditRecord);
    return sentinelResult;
  }

  // Broker-signed execution receipts: verify attached proof; optionally require
  // for high-risk provider side effects (THUMBGATE_BROKER_RECEIPT_MODE=enforce).
  const brokerReceiptResult = evaluateBrokerReceiptGate(toolName, toolInput);
  if (brokerReceiptResult && brokerReceiptResult.decision === 'deny') {
    recordStat(brokerReceiptResult.gate, 'block', null, { toolName, toolInput });
    const auditRecord = recordAuditEvent({
      toolName,
      toolInput,
      decision: 'deny',
      gateId: brokerReceiptResult.gate,
      message: brokerReceiptResult.message,
      severity: brokerReceiptResult.severity,
      source: 'broker-execution-receipts',
    });
    auditToFeedback(auditRecord);
    return brokerReceiptResult;
  }

  // Audit trail: record allow
  recordAuditEvent({ toolName, toolInput, decision: 'allow', source: 'gates-engine' });
  return null;
}

// Turn a secret-exfiltration block into actionable guidance that names the
// safe path, instead of a dead-end that drives agents toward brittle
// workarounds (e.g. writing secrets to /tmp). The vault dirs referenced here
// are the SAME constant the scanner whitelists, so the hint can never drift
// from enforcement.
function buildSecretRemediation(toolName = '', toolInput = {}) {
  const vaultDirs = (SAFE_SECRET_STORAGE_DIRS || []).map((dir) => `~/${dir}`);
  const primaryVault = vaultDirs[0] || '~/.resume_secrets';
  const vaultList = vaultDirs.join(', ') || primaryVault;

  if (EDIT_LIKE_TOOLS && EDIT_LIKE_TOOLS.has(toolName)) {
    const target = toolInput.file_path || toolInput.path || toolInput.filePath || toolInput.target_path;
    const where = target ? ` (you targeted ${redactText(String(target))})` : '';
    return `To store this secret safely, write it with the Write/Edit tool to a file under ${vaultList}${where}. `
      + `Those locations are whitelisted for secret storage and will NOT be blocked. `
      + `Do not route around this by writing to /tmp or another path — that leaves the secret in a world-readable location and does not make it safe.`;
  }

  if (toolName === 'Bash') {
    return `Do not inline a live secret literal into a shell command — it leaks into shell history and process args. `
      + `Instead, store the value with the Write tool to a file under ${vaultList}, then reference it via an environment variable or by reading that file at runtime.`;
  }

  return `Store secrets in the whitelisted vault (${vaultList}) using the Write tool rather than passing the literal through this action.`;
}

function buildSecretGuardResult(scanResult, context = {}) {
  const remediation = buildSecretRemediation(context.toolName, context.toolInput || {});
  const summary = buildSafeSummary(
    scanResult.findings,
    'Blocked because the action appears to expose secret material'
  );
  return {
    decision: 'deny',
    gate: 'secret-exfiltration',
    message: `${summary}. ${remediation}`,
    remediation,
    severity: 'critical',
    secretScan: {
      provider: scanResult.provider,
      findings: scanResult.findings.map((finding) => ({
        id: finding.id,
        label: finding.label,
        line: finding.line || null,
        path: finding.path || null,
        source: finding.source || null,
        reason: finding.reason || null,
      })),
    },
  };
}

function getFeedbackLoopModule() {
  try {
    return require('./feedback-loop');
  } catch {
    return null;
  }
}

function recordSecretViolation(input, scanResult) {
  const feedbackLoop = getFeedbackLoopModule();
  if (!feedbackLoop || typeof feedbackLoop.appendDiagnosticRecord !== 'function') {
    return;
  }

  const toolName = input.tool_name || input.toolName || 'unknown';
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const filePath = toolInput.file_path || toolInput.path || toolInput.filePath || null;
  const command = typeof toolInput.command === 'string' ? toolInput.command : '';
  const safeContext = redactText(
    filePath
      ? `${toolName} requested ${filePath}`
      : command
        ? `${toolName} requested command ${command}`
        : `${toolName} requested protected content`
  ).slice(0, 400);

  feedbackLoop.appendDiagnosticRecord({
    source: 'secret_guard',
    step: 'pre_tool_use',
    context: safeContext,
    metadata: {
      toolName,
      provider: scanResult.provider,
      filePath,
      commandHash: scanResult.commandHash || null,
      fileHashes: scanResult.fileHashes || [],
    },
    diagnosis: {
      diagnosed: true,
      rootCauseCategory: 'guardrail_triggered',
      criticalFailureStep: 'pre_tool_use',
      violations: scanResult.findings.map((finding) => ({
        constraintId: `security:${finding.id || 'secret_exfiltration'}`,
        description: finding.reason || finding.label || 'Secret exposure blocked',
        metadata: {
          label: finding.label || finding.id || 'secret',
          path: finding.path || null,
          line: finding.line || null,
          source: finding.source || null,
        },
      })),
      evidence: scanResult.findings.map((finding) => (
        `${finding.label || finding.id}${finding.path ? ` in ${finding.path}` : ''}${finding.line ? ` line ${finding.line}` : ''}`
      )),
    },
  });
}

function evaluateSecretGuard(input = {}) {
  const scanResult = scanHookInput(input);
  if (!scanResult.detected) {
    return null;
  }
  recordStat('secret-exfiltration', 'block', null, {
    toolName: input.tool_name || input.toolName || 'unknown',
    toolInput: input.tool_input || {},
  });
  recordSecretViolation(input, scanResult);
  const result = buildSecretGuardResult(scanResult, {
    toolName: input.tool_name || input.toolName,
    toolInput: input.tool_input || {},
  });
  // Audit trail: record secret guard denial
  const auditRecord = recordAuditEvent({
    toolName: input.tool_name || input.toolName || 'unknown',
    toolInput: input.tool_input || {},
    decision: 'deny',
    gateId: 'secret-exfiltration',
    message: 'Secret material detected in tool input',
    severity: 'critical',
    source: 'secret-guard',
  });
  auditToFeedback(auditRecord);
  return result;
}

function evaluateUnconditionalHardFloor(input = {}, options = {}) {
  const secretGuard = evaluateSecretGuard(input);
  if (secretGuard) return { hardFloor: secretGuard, securityScan: null };

  const securityScan = evaluateSecurityScan(input);
  if (securityScan && securityScan.decision === 'deny') {
    return { hardFloor: securityScan, securityScan };
  }

  const financialHardFloor = evaluateFinancialHardFloor(input, false, options);
  if (financialHardFloor) return { hardFloor: financialHardFloor, securityScan };

  return {
    hardFloor: evaluateSelfProtectHardFloor(input),
    securityScan,
  };
}

function evaluateFinancialHardFloor(input = {}, consumeReservation = false, options = {}) {
  const toolName = input.tool_name || input.toolName || 'unknown';
  if (isRemedyToolName(toolName)) return null;
  const rawToolInput = input.tool_input ?? input.toolInput;
  const toolInput = rawToolInput && typeof rawToolInput === 'object'
    ? rawToolInput
    : {};
  const normalizedAction = normalizeProviderAction({
    toolName,
    toolInput,
    usage: input.usage || toolInput.usage,
    costUsd: input.costUsd ?? toolInput.costUsd,
    budget: input.budget || toolInput.budget,
  });
  const costControl = buildCostControl(
    normalizedAction,
    input.budget || toolInput.budget || {}
  );
  const financialControl = evaluateFinancialControl({
    toolName,
    toolInput,
    actionProfile: {
      economicAction: undefined,
    },
    costControl,
  }, { ...options, consumeReservation });
  if (financialControl.mode === 'block') {
    const result = {
      decision: 'deny',
      gate: 'financial-control',
      message: financialControl.reasons.join(' '),
      severity: 'critical',
      financialControl,
      reasoning: [
        'Economic actions default to deny at the pre-tool boundary.',
        'Learned policy and advisory memories cannot override this deterministic control.',
      ],
    };
    recordStat('financial-control', 'block', null, { toolName, toolInput });
    const auditRecord = recordAuditEvent({
      toolName,
      toolInput,
      decision: 'deny',
      gateId: 'financial-control',
      message: result.message,
      severity: result.severity,
      source: 'financial-control',
    });
    auditToFeedback(auditRecord);
    return result;
  }
  return null;
}

// Reservations are single-use. They are consumed only after every other gate
// has reached its final allow/warn boundary, never during the preliminary hard
// floor preview. This prevents a later workflow or learned-risk denial from
// burning an approval for an action that did not execute.
function finalizeFinancialAuthorization(input = {}, options = {}) {
  return evaluateFinancialHardFloor(input, true, options);
}

function isBlockingDecision(result) {
  return result?.decision === 'deny' || result?.decision === 'approve';
}

function runHardFloor(input, options = {}) {
  const { hardFloor } = evaluateUnconditionalHardFloor(input, options);
  return hardFloor ? formatOutput(hardFloor) : null;
}

// ---------------------------------------------------------------------------
function isApprovalGatesEnabled() {
  return process.env.THUMBGATE_APPROVAL_GATES !== '0';
}

// PreToolUse hook interface (stdin/stdout JSON)
// ---------------------------------------------------------------------------

function buildPreToolUseOutput(fields = {}) {
  return {
    hookEventName: 'PreToolUse',
    ...fields,
  };
}

function buildReminderOutput(context) {
  return buildPreToolUseOutput({
    additionalContext: context,
    systemReminder: context,
    thumbgateSystemReminder: context,
  });
}

// ---------------------------------------------------------------------------
// Upgrade nudge: surfaces Pro value at usage milestones and trial expiry.
// Block-action Pro CTA: brief upgrade mention after a deny/warn decision.
// Highest-intent moment — user just saw ThumbGate save them from a mistake.
// ---------------------------------------------------------------------------

function buildBlockActionProCta() {
  try {
    if (process.env.THUMBGATE_NO_NUDGE === '1') return null;
    if (process.env.CI || process.env.GITHUB_ACTIONS) return null;
    if (isProTier()) return null;
    if (isInTrialPeriod()) return null; // Already have full access

    const stats = loadStats();
    const totalBlocks = stats.blocked || 0;
    if (totalBlocks < 5) return null; // Too early — let them experience the product

    if (totalBlocks < 25) {
      return '\n\n💡 Pro: keep this rule searchable, exportable, and visible → thumbgate.ai/go/pro';
    }
    if (totalBlocks < 100) {
      return `\n\n💡 ${totalBlocks} actions blocked. Pro adds recall, dashboard proof, and exports → thumbgate.ai/go/pro ($19/mo)`;
    }
    return `\n\n💡 ${totalBlocks} mistakes caught. Your team could use Enterprise shared hosted enforcement → thumbgate.ai/go/pro`;
  } catch (_) {
    return null;
  }
}

function formatOutput(result, behavioralContext) {
  if (!result) {
    // No gate matched — inject behavioral context if available
    if (behavioralContext) {
      return JSON.stringify({
        hookSpecificOutput: buildReminderOutput(behavioralContext),
      });
    }
    return JSON.stringify({});
  }

  const reasoningSuffix = Array.isArray(result.reasoning) && result.reasoning.length
    ? '\n  Reasoning:\n  • ' + result.reasoning.join('\n  • ')
    : '';

  if (result.decision === 'deny') {
    const reminder = behavioralContext ? buildReminderOutput(behavioralContext) : {};
    const reminderSuffix = behavioralContext ? `\n\nSystem reminder:\n${behavioralContext}` : '';
    const proCta = result.gate === 'financial-control' ? '' : (buildBlockActionProCta() || '');
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        ...reminder,
        permissionDecision: 'deny',
        permissionDecisionReason: `[GATE:${result.gate}] ${result.message}${reasoningSuffix}${reminderSuffix}${proCta}`,
      },
    });
  }

  if (result.decision === 'approve') {
    const reminder = behavioralContext ? buildReminderOutput(behavioralContext) : {};
    const reminderSuffix = behavioralContext ? `\n\nSystem reminder:\n${behavioralContext}` : '';
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        ...reminder,
        permissionDecision: 'deny',
        permissionDecisionReason: `[GATE:${result.gate}] APPROVAL REQUIRED: ${result.message} — Ask the human to confirm this action before proceeding.${reasoningSuffix}${reminderSuffix}`,
      },
    });
  }

  if (result.decision === 'warn') {
    const extra = behavioralContext ? `\n${behavioralContext}` : '';
    const context = `[GATE:${result.gate}] WARNING: ${result.message}${reasoningSuffix}${extra}`;
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: context,
        ...(behavioralContext ? {
          systemReminder: behavioralContext,
          thumbgateSystemReminder: behavioralContext,
        } : {}),
      },
    });
  }

  return JSON.stringify({});
}

/**
 * Build behavioral context string from recurring feedback patterns.
 * Injected as additionalContext on EVERY tool call so the AI constantly
 * sees its failure patterns — even when no gate blocks.
 */
function buildBehavioralContext() {
  const hybrid = getHybridFeedbackModule();
  if (!hybrid || typeof hybrid.buildHybridState !== 'function') return null;

  try {
    const state = hybrid.buildHybridState({});
    if (!state || !state.recurringNegativePatterns || state.recurringNegativePatterns.length === 0) {
      return null;
    }

    const constraints = hybrid.deriveConstraints(state, 3);
    if (constraints.length === 0) return null;

    return `[ThumbGate] Recurring failure patterns (enforce these):\n${constraints.map(c => `  - ${c}`).join('\n')}`;
  } catch {
    return null;
  }
}

/**
 * Build "recent mistakes" context by reading the tail of memory-log.jsonl.
 * Surfaces the 3 most recent negative-signal memories (captured via
 * capture_feedback) as a reminder on EVERY tool call — even when semantic
 * retrieval returns nothing and there are no recurring patterns yet.
 *
 * This plugs the cold-start gap: a mistake captured seconds ago should
 * surface on the very next tool call, not wait for the recurring-pattern
 * threshold (≥2 occurrences) that buildBehavioralContext requires.
 *
 * @param {Object} [options]
 * @param {number} [options.maxAgeMs=86400000] - Only include memories from the last 24h by default
 * @param {number} [options.limit=3]
 * @returns {string|null}
 */
function buildRecentCorrectiveActionsContext(options = {}) {
  const maxAgeMs = typeof options.maxAgeMs === 'number' ? options.maxAgeMs : 24 * 60 * 60 * 1000;
  const limit = typeof options.limit === 'number' ? options.limit : 3;

  let resolveFeedbackDir;
  try {
    ({ resolveFeedbackDir } = require('./feedback-paths'));
  } catch {
    return null;
  }

  let feedbackDir;
  try {
    feedbackDir = resolveFeedbackDir({});
  } catch {
    return null;
  }

  const memoryLogPath = path.join(feedbackDir, 'memory-log.jsonl');
  if (!fs.existsSync(memoryLogPath)) return null;

  let raw;
  try {
    raw = fs.readFileSync(memoryLogPath, 'utf8');
  } catch {
    return null;
  }

  const lines = raw.split('\n').filter(Boolean);
  if (lines.length === 0) return null;

  const cutoff = Date.now() - maxAgeMs;
  const recent = [];

  // Walk from the tail backwards so we get the newest entries first
  for (let i = lines.length - 1; i >= 0 && recent.length < limit; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.category !== 'error' && entry.category !== 'learning') continue;
      const ts = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
      if (!Number.isFinite(ts) || ts < cutoff) continue;
      recent.push(entry);
    } catch {
      // skip malformed line
    }
  }

  if (recent.length === 0) return null;

  const formatted = recent.map((m) => {
    const title = String(m.title || '').replace(/^MISTAKE:\s*/, '').slice(0, 140);
    const content = String(m.content || '');
    const avoidMatch = content.match(/How to avoid:\s*([^\n]+)/i);
    const advice = avoidMatch ? avoidMatch[1].trim().slice(0, 220) : null;
    return advice ? `  • ${title}\n    → ${advice}` : `  • ${title}`;
  });

  return `[ThumbGate] Recent mistakes (last 24h) — do NOT repeat:\n${formatted.join('\n')}`;
}

/**
 * Build per-action lesson context: retrieve semantically-relevant lessons for this
 * specific tool call and inject the top negative ones into hook output so the agent
 * sees its past mistakes BEFORE executing the action (not after).
 *
 * This is the enforcement mechanism that turns ThumbGate from a passive log into an
 * active governor. Without this, lessons stay in the DB and never get surfaced at
 * decision time — so the agent repeats mistakes.
 */
function buildRelevantLessonContext(toolName, toolInput) {
  if (!toolName) return null;

  const { retrieveRelevantLessons, calculateRetrievalEntropy } = loadOptionalModule("./lesson-retrieval", () => ({ retrieveRelevantLessons: () => [], calculateRetrievalEntropy: () => 0 }));

  // Extract a searchable action context from the tool input
  const actionContext = extractActionContext(toolName, toolInput);
  if (!actionContext) return null;

  try {
    const lessons = retrieveRelevantLessons(toolName, actionContext, { maxResults: 3 });

    const entropy = calculateRetrievalEntropy(lessons);
    if (entropy > KNOWLEDGE_ENTROPY_THRESHOLD) {
      return buildKnowledgeConflictContext(toolName, toolInput, lessons, entropy);
    }
    return formatNegativeLessonContext(lessons);
  } catch {
    return null;
  }
}

/**
 * Async counterpart of buildRelevantLessonContext: uses HYBRID (dense embeddings +
 * lexical) retrieval so the agent is warned about semantically-related past mistakes
 * even when they share no keywords with the current action. Wired into runAsync.
 * Degrades to the lexical result automatically when no embedder is available.
 */
async function buildRelevantLessonContextAsync(toolName, toolInput) {
  if (!toolName) return null;

  const { retrieveRelevantLessonsAsync, retrieveRelevantLessons, calculateRetrievalEntropy } = loadOptionalModule(
    './lesson-retrieval',
    () => ({ retrieveRelevantLessonsAsync: null, retrieveRelevantLessons: () => [], calculateRetrievalEntropy: () => 0 }),
  );

  const actionContext = extractActionContext(toolName, toolInput);
  if (!actionContext) return null;

  try {
    const lessons = retrieveRelevantLessonsAsync
      ? await retrieveRelevantLessonsAsync(toolName, actionContext, { maxResults: 3 })
      : retrieveRelevantLessons(toolName, actionContext, { maxResults: 3 });
    
    // Knowledge Conflict Detection: if retrieved lessons have high sentiment entropy,
    // it indicates conflicting past evidence. Warn by default; hard-block only in
    // strict mode for external/destructive side-effect commands.
    const entropy = calculateRetrievalEntropy(lessons);
    if (entropy > KNOWLEDGE_ENTROPY_THRESHOLD) {
      return buildKnowledgeConflictContext(toolName, toolInput, lessons, entropy);
    }

    return formatNegativeLessonContext(lessons);
  } catch {
    return null;
  }
}

/**
 * Shared formatter: render the negative (mistake) lessons that survived retrieval
 * into the PreToolUse warning block. Retrieval already filters by relevance, so any
 * negative lesson present is relevant enough to surface.
 */
function formatNegativeLessonContext(lessons) {
  const negative = (lessons || []).filter((l) => l.signal === 'negative');
  if (negative.length === 0) return null;

  const formatted = negative.map((l) => {
    const title = (l.title || '').replace(/^MISTAKE:\s*/, '').slice(0, 140);
    const advice = extractAvoidanceAdvice(l.content);
    return advice ? `  • ${title}\n    → ${advice}` : `  • ${title}`;
  });

  return `[ThumbGate] Past mistakes relevant to this action — read before proceeding:\n${formatted.join('\n')}`;
}

function isStrictKnowledgeConflictMode() {
  return process.env.THUMBGATE_STRICT_KNOWLEDGE_CONFLICT === '1'
    || process.env.THUMBGATE_STRICT_KNOWLEDGE_CONFLICT === 'true';
}

function isKnowledgeConflictHardBlockAction(toolName, toolInput = {}) {
  if (!isStrictKnowledgeConflictMode()) return false;
  if (EDIT_LIKE_TOOLS.has(toolName)) return true;
  if (toolName !== 'Bash') return false;
  return KNOWLEDGE_CONFLICT_STRICT_BASH_PATTERN.test(String(toolInput.command || ''));
}

function buildKnowledgeConflictContext(toolName, toolInput, lessons, entropy) {
  const lessonContext = formatNegativeLessonContext(lessons);
  const message = `Knowledge conflict warning: retrieved lessons disagree for this action (entropy ${entropy}). Treat the reminders below as cautionary context, but do not stop unrelated work solely because memory is noisy.`;

  if (isKnowledgeConflictHardBlockAction(toolName, toolInput)) {
    recordStat('retrieval_entropy_high', 'block', null, { toolName, toolInput });
    return {
      decision: 'deny',
      gate: 'knowledge-conflict-gate',
      message: `✗ THUMBGATE: ${message} Strict mode is enabled for destructive or external side-effect actions; verify intent or narrow the task before proceeding.`,
      severity: 'high',
    };
  }

  recordStat('retrieval_entropy_high', 'warn', null, { toolName, toolInput });
  return mergeContextStrings(`[ThumbGate] ${message}`, lessonContext);
}

function extractActionContext(toolName, toolInput) {
  if (!toolInput) return toolName;
  const parts = [toolName];
  if (toolInput.command) parts.push(String(toolInput.command).slice(0, 400));
  if (toolInput.file_path) parts.push(String(toolInput.file_path));
  if (toolInput.content) parts.push(String(toolInput.content).slice(0, 600));
  if (toolInput.new_string) parts.push(String(toolInput.new_string).slice(0, 600));
  if (toolInput.old_string) parts.push(String(toolInput.old_string).slice(0, 240));
  if (toolInput.description) parts.push(String(toolInput.description).slice(0, 200));
  if (toolInput.prompt) parts.push(String(toolInput.prompt).slice(0, 400));
  if (toolInput.pattern) parts.push(String(toolInput.pattern).slice(0, 200));
  return sanitizeFeedbackText(parts.filter(Boolean).join(' ')) || toolName;
}

function extractAvoidanceAdvice(content) {
  if (!content) return null;
  // Extract the "How to avoid:" section if present
  const match = content.match(/How to avoid:\s*([^\n]+)/i);
  if (match) return match[1].trim().slice(0, 220);
  return null;
}

function mergeContextStrings(...ctxs) {
  return ctxs.filter((c) => typeof c === 'string' && c.length > 0).join('\n\n') || null;
}

async function runAsync(input) {
  const { hardFloor, securityScan } = evaluateUnconditionalHardFloor(input);
  if (hardFloor) return formatOutput(hardFloor);

  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const safeSecretStorageWrite = isSafeSecretStorageWrite(toolName, toolInput, process.cwd());

  const sequenceGuard = evaluateSequenceState(toolName, toolInput);
  if (sequenceGuard && sequenceGuard.decision === 'deny') {
    return formatOutput(applyEnforcementPosture(sequenceGuard));
  }

  const result = await evaluateGatesAsync(toolName, toolInput);

  // Attach security warnings to allow/warn results
  if (securityScan && securityScan.decision === 'warn') {
    if (result) {
      result.securityWarnings = securityScan.securityScan.findings;
      result.reasoning = (result.reasoning || []).concat(securityScan.reasoning);
    } else {
      return formatOutput(securityScan);
    }
  }

  
  const behavioralContext = safeSecretStorageWrite ? null : buildBehavioralContext();
  const lessonContext = safeSecretStorageWrite ? null : await buildRelevantLessonContextAsync(toolName, toolInput);
  
  if (lessonContext && lessonContext.decision === "deny") {
    return formatOutput(applyEnforcementPosture(lessonContext));
  }

  const posturedResult = applyEnforcementPosture(result);
  if (isBlockingDecision(posturedResult)) {
    return formatOutput(posturedResult);
  }

  const financialAuthorization = finalizeFinancialAuthorization(input);
  if (financialAuthorization) return formatOutput(financialAuthorization);
  
  const recentContext = buildRecentCorrectiveActionsContext();
  const combinedContext = mergeContextStrings(lessonContext, recentContext, behavioralContext);
  return formatOutput(posturedResult, combinedContext);

}

function run(input) {
  const { hardFloor, securityScan } = evaluateUnconditionalHardFloor(input);
  if (hardFloor) return formatOutput(hardFloor);

  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const safeSecretStorageWrite = isSafeSecretStorageWrite(toolName, toolInput, process.cwd());

  const sequenceGuard = evaluateSequenceState(toolName, toolInput);
  if (sequenceGuard && sequenceGuard.decision === 'deny') {
    return formatOutput(applyEnforcementPosture(sequenceGuard));
  }

  const result = evaluateGates(toolName, toolInput);

  // Attach security warnings to allow/warn results
  if (securityScan && securityScan.decision === 'warn') {
    if (result) {
      result.securityWarnings = securityScan.securityScan.findings;
      result.reasoning = (result.reasoning || []).concat(securityScan.reasoning);
    } else {
      return formatOutput(securityScan);
    }
  }

  
  const behavioralContext = safeSecretStorageWrite ? null : buildBehavioralContext();
  const lessonContext = safeSecretStorageWrite ? null : buildRelevantLessonContext(toolName, toolInput);
  
  if (lessonContext && lessonContext.decision === "deny") {
    return formatOutput(applyEnforcementPosture(lessonContext));
  }

  const posturedResult = applyEnforcementPosture(result);
  if (isBlockingDecision(posturedResult)) {
    return formatOutput(posturedResult);
  }

  const financialAuthorization = finalizeFinancialAuthorization(input);
  if (financialAuthorization) return formatOutput(financialAuthorization);
  
  const recentContext = buildRecentCorrectiveActionsContext();
  const combinedContext = mergeContextStrings(lessonContext, recentContext, behavioralContext);
  return formatOutput(posturedResult, combinedContext);

}


// A command can be spelled many ways without changing what it does: `sudo git …`,
// `"git" …`, `/usr/bin/git …`, `GIT_DIR=… git …`, a chained `echo hi && git …`, or a git
// global option before the subcommand. Roughly fifteen helpers below read
// `toolInput.command` and run their own analysis on it, so patching each one individually
// is how a spelling gets missed — that happened twice while fixing this.
//
// Instead: evaluate normally, and ONLY IF nothing matched, evaluate once more against the
// canonicalized command. Every helper is covered without touching any of them, and it is
// strictly additive — a command that already matched never reaches the second pass, so no
// existing verdict changes and no stat is recorded twice.
function canonicalRetryInput(toolName, toolInput) {
  if (toolName !== 'Bash') return null;
  const original = String((toolInput && toolInput.command) || '');
  if (!original) return null;
  const canonical = canonicalizeCommandForGates(original);
  if (!canonical || canonical === original) return null;
  return { ...toolInput, command: canonical, originalCommand: original };
}

async function evaluateGatesAsync(toolName, toolInput, configPath) {
  const direct = await evaluateGatesAsyncInner(toolName, toolInput, configPath);
  if (direct) return direct;
  const retry = canonicalRetryInput(toolName, toolInput);
  if (!retry) return null;
  return evaluateGatesAsyncInner(toolName, retry, configPath);
}

function evaluateGates(toolName, toolInput, configPath) {
  const direct = evaluateGatesInner(toolName, toolInput, configPath);
  if (direct) return direct;
  const retry = canonicalRetryInput(toolName, toolInput);
  if (!retry) return null;
  return evaluateGatesInner(toolName, retry, configPath);
}

// ---------------------------------------------------------------------------
// Session action tracking and claim verification
// ---------------------------------------------------------------------------

function loadSessionActions() {
  const actions = loadJSON(module.exports.SESSION_ACTIONS_PATH);
  const now = Date.now();
  const valid = {};

  for (const [key, entry] of Object.entries(actions)) {
    if (!entry || typeof entry !== 'object') continue;
    if (!entry.timestamp || (now - entry.timestamp) >= SESSION_ACTION_TTL_MS) continue;
    valid[key] = entry;
  }

  if (Object.keys(valid).length !== Object.keys(actions).length) {
    saveSessionActions(valid);
  }

  return valid;
}

function saveSessionActions(actions) {
  saveJSON(module.exports.SESSION_ACTIONS_PATH, actions);
}

function trackAction(actionId, metadata = {}) {
  const normalizedActionId = String(actionId || '').trim();
  if (!normalizedActionId) {
    throw new Error('actionId is required');
  }
  if (metadata !== null && typeof metadata !== 'object') {
    throw new Error('metadata must be an object when provided');
  }

  const actions = loadSessionActions();
  actions[normalizedActionId] = {
    timestamp: Date.now(),
    metadata: metadata || {},
  };
  saveSessionActions(actions);
  return actions[normalizedActionId];
}

function hasAction(actionId) {
  const normalizedActionId = String(actionId || '').trim();
  if (!normalizedActionId) return false;
  const actions = loadSessionActions();
  return Boolean(actions[normalizedActionId]);
}

function listSessionActions() {
  return loadSessionActions();
}

function clearSessionActions() {
  saveSessionActions({});
}

function loadClaimGateFile(filePath, { allowMissing = true } = {}) {
  if (!fs.existsSync(filePath)) {
    if (allowMissing) return { claims: [] };
    throw new Error(`Claim gates config not found: ${filePath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!parsed || !Array.isArray(parsed.claims)) {
    throw new Error(`Invalid claim gates config: ${filePath}`);
  }
  return parsed;
}

function saveCustomClaimGates(config) {
  fs.mkdirSync(path.dirname(module.exports.CUSTOM_CLAIM_GATES_PATH), { recursive: true });
  fs.writeFileSync(module.exports.CUSTOM_CLAIM_GATES_PATH, JSON.stringify(config, null, 2) + '\n');
}

function loadClaimGates() {
  const defaults = loadClaimGateFile(module.exports.DEFAULT_CLAIM_GATES_PATH, { allowMissing: false });
  const custom = loadClaimGateFile(module.exports.CUSTOM_CLAIM_GATES_PATH);
  const mergedByPattern = new Map();

  for (const claim of defaults.claims) {
    mergedByPattern.set(claim.pattern, claim);
  }
  for (const claim of custom.claims) {
    mergedByPattern.set(claim.pattern, claim);
  }

  return {
    version: Math.max(defaults.version || 1, custom.version || 1),
    claims: Array.from(mergedByPattern.values()),
  };
}

function registerClaimGate(claimPattern, requiredActions, blockMessage) {
  const normalizedPattern = String(claimPattern || '').trim();
  if (!normalizedPattern) {
    throw new Error('claimPattern is required');
  }
  if (!Array.isArray(requiredActions) || requiredActions.length === 0) {
    throw new Error('requiredActions must be a non-empty array');
  }

  const normalizedActions = requiredActions
    .map((actionId) => String(actionId || '').trim())
    .filter(Boolean);
  if (normalizedActions.length === 0) {
    throw new Error('requiredActions must contain at least one non-empty action id');
  }

  const custom = loadClaimGateFile(module.exports.CUSTOM_CLAIM_GATES_PATH);
  const existingIndex = custom.claims.findIndex((claim) => claim.pattern === normalizedPattern);
  const entry = {
    pattern: normalizedPattern,
    requiredActions: normalizedActions,
    message: blockMessage || `Claim "${normalizedPattern}" requires evidence: ${normalizedActions.join(', ')}`,
    createdAt: Date.now(),
  };

  if (existingIndex >= 0) {
    custom.claims[existingIndex] = entry;
  } else {
    custom.claims.push(entry);
  }

  saveCustomClaimGates(custom);
  return entry;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));
}

function normalizeGoalContract(goalContract) {
  if (!goalContract || typeof goalContract !== 'object' || Array.isArray(goalContract)) {
    return null;
  }

  const goal = String(goalContract.goal || '').trim();
  const doneWhen = normalizeStringArray(goalContract.doneWhen);
  const requiredActions = normalizeStringArray(goalContract.proveBy);
  const mustNotChange = normalizeStringArray(goalContract.mustNotChange);
  const handoff = {
    workerAgent: String(goalContract.workerAgent || '').trim() || null,
    reviewerAgent: String(goalContract.reviewerAgent || '').trim() || null,
    orchestratorAgent: String(goalContract.orchestratorAgent || '').trim() || null,
  };

  const matched = Boolean(
    goal ||
    doneWhen.length > 0 ||
    requiredActions.length > 0 ||
    mustNotChange.length > 0 ||
    handoff.workerAgent ||
    handoff.reviewerAgent ||
    handoff.orchestratorAgent
  );

  if (!matched) return null;

  return {
    goal: goal || null,
    doneWhen,
    requiredActions,
    mustNotChange,
    handoff,
  };
}

function evaluateGoalContract(goalContract, actions = loadSessionActions()) {
  const normalized = normalizeGoalContract(goalContract);
  if (!normalized) {
    return {
      matched: false,
      passed: true,
      goal: null,
      doneWhen: [],
      requiredActions: [],
      missingActions: [],
      mustNotChange: [],
      handoff: {
        workerAgent: null,
        reviewerAgent: null,
        orchestratorAgent: null,
      },
    };
  }

  const missingActions = normalized.requiredActions.filter((actionId) => !actions[actionId]);
  return {
    matched: true,
    passed: missingActions.length === 0,
    goal: normalized.goal,
    doneWhen: normalized.doneWhen,
    requiredActions: normalized.requiredActions,
    missingActions,
    mustNotChange: normalized.mustNotChange,
    handoff: normalized.handoff,
  };
}

function verifyClaimEvidence(claimText, options = {}) {
  const normalizedClaimText = String(claimText || '').trim();
  if (!normalizedClaimText) {
    throw new Error('claimText is required');
  }

  const config = loadClaimGates();
  const actions = loadSessionActions();
  const checks = [];

  for (const claim of config.claims) {
    let regex;
    try {
      regex = new RegExp(claim.pattern, 'i');
    } catch {
      continue;
    }
    if (!regex.test(normalizedClaimText)) continue;

    const missing = (claim.requiredActions || []).filter((actionId) => !actions[actionId]);
    checks.push({
      claim: claim.pattern,
      passed: missing.length === 0,
      missing,
      message: missing.length > 0 ? claim.message : 'All evidence present',
    });
  }

  const goalContract = evaluateGoalContract(options.goalContract, actions);
  if (goalContract.matched) {
    checks.push({
      claim: 'goal_contract',
      passed: goalContract.passed,
      missing: goalContract.missingActions,
      message: goalContract.passed
        ? 'Goal contract evidence present'
        : `Goal contract requires evidence: ${goalContract.missingActions.join(', ')}`,
      goalContract,
    });
  }

  // Universal factual claims (row counts, file lines/bytes/existence, version values)
  // recheck the configured source of truth. Fail-closed on mismatch or missing verifier.
  let universal = null;
  if (options.skipUniversal !== true) {
    try {
      const {
        evaluateUniversalClaimsAsGateChecks,
      } = require('./universal-claim-evaluator');
      universal = evaluateUniversalClaimsAsGateChecks(normalizedClaimText, {
        cwd: options.cwd,
        verifiers: options.verifiers,
        configPath: options.claimVerifiersPath,
        config: options.claimVerifiers,
        feedbackDir: options.feedbackDir,
        failUnconfigured: options.failUnconfigured,
      });
      for (const check of universal.checks) {
        checks.push(check);
      }
    } catch (error) {
      checks.push({
        claim: 'universal_evaluator',
        passed: false,
        missing: ['universal_claim_evaluator'],
        message: `Universal claim evaluator failed closed: ${error && error.message ? error.message : 'unknown error'}`,
      });
    }
  }

  return {
    verified: checks.length === 0 ? true : checks.every((check) => check.passed),
    checks,
    goalContract,
    universal,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Agent identity plane (Okta AI-identity checklist: shadow AI + lifecycle)
// ---------------------------------------------------------------------------

// Warn-dedup per process: one shadow/lifecycle warning per agent id, so the
// audit log records the finding without spamming every tool call.
const AGENT_IDENTITY_WARNED = new Set();

function resolveActingAgentId() {
  return process.env.THUMBGATE_SESSION_AGENT
    || process.env.THUMBGATE_AGENT_ID
    || null;
}

/**
 * Identity gate for the enforced evaluation path. Every attributed tool call
 * is recorded as an observation (the producer side of shadow-AI detection).
 * An observed-but-unregistered agent is a shadow agent: warn-only on every
 * mode — a strict-mode deny here would brick sessions on repos where nothing
 * registers agents yet. A registry-retired or disabled agent that keeps
 * acting is denied under THUMBGATE_STRICT_ENFORCEMENT=1 and warned otherwise:
 * retirement is an explicit operator action, so enforcing it cannot surprise
 * a healthy session. Fails open on any registry error — identity tracking
 * must never break the hook path.
 */
function evaluateAgentIdentityLifecycleGate(toolName, toolInput) {
  try {
    const agentId = resolveActingAgentId();
    if (!agentId) return null;
    const identityStore = require('./audit-trail');
    try {
      identityStore.recordObservedAgent(agentId);
    } catch {
      // Observation is best-effort.
    }
    const registryRow = identityStore.loadAgentRegistry()
      .filter((agent) => agent && agent.id === agentId)
      .pop();
    const strict = process.env.THUMBGATE_STRICT_ENFORCEMENT === '1';
    const lifecycleStatus = registryRow?.metadata?.lifecycleStatus;
    if (registryRow && (lifecycleStatus === 'retired' || lifecycleStatus === 'disabled')) {
      const message = `Agent identity "${agentId}" is ${lifecycleStatus} in the agent registry but is still acting. `
        + 'Re-activate it via registerAgent with lifecycleStatus "active", or stop the agent.';
      if (strict) {
        return { gate: 'agent-identity-lifecycle', decision: 'deny', message, severity: 'critical' };
      }
      if (!AGENT_IDENTITY_WARNED.has(`retired:${agentId}`)) {
        AGENT_IDENTITY_WARNED.add(`retired:${agentId}`);
        recordAuditEvent({
          toolName,
          toolInput,
          decision: 'warn',
          gateId: 'agent-identity-lifecycle',
          message,
          severity: 'high',
          source: 'gates-engine',
        });
      }
      return null;
    }
    if (!registryRow && !AGENT_IDENTITY_WARNED.has(`shadow:${agentId}`)) {
      AGENT_IDENTITY_WARNED.add(`shadow:${agentId}`);
      recordAuditEvent({
        toolName,
        toolInput,
        decision: 'warn',
        gateId: 'agent-identity-shadow',
        message: `Shadow agent: "${agentId}" is acting but has never been registered in the agent registry. `
          + 'Register it via registerAgent so identity, lifecycle, and audit attribution are explicit.',
        severity: 'medium',
        source: 'gates-engine',
      });
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = {
  evaluateAgentIdentityLifecycleGate,
  loadGatesConfig,
  loadState,
  saveState,
  loadConstraints,
  saveConstraints,
  setConstraint,
  loadGovernanceState,
  saveGovernanceState,
  setTaskScope,
  isTaskScopeExpired,
  TASK_SCOPE_LEASE_EXPIRED_GATE_ID,
  applyEnforcementPosture,
  resolveGovernanceMode,
  alignmentLayerForResult,
  buildTaskScopeViolation,
  setBranchGovernance,
  approveProtectedAction,
  breakGlassEmergency,
  getScopeState,
  getBranchGovernanceState,
  isConditionSatisfied,
  satisfyCondition,
  loadStats,
  saveStats,
  recordStat,
  evaluateSecretGuard,
  evaluateSecurityScan,
  buildSecretGuardResult,
  buildReasoning,
  matchesGate,
  evaluateGates,
  evaluateGatesAsync,
  actionApprovalDigest,
  buildMatchSurfaces,
  extractAffectedFiles,
  extractGitMinusCPaths,
  resolveRepoRoot,
  governanceStatePath,
  currentScopeSessionId,
  isRemedyToolName,
  isCommandPositionPermissionChange,
  isGhApiPrCreateCommand,
  helperBypassActionKey,
  parseGitPathspec,
  canonicalizeGitCommand,
  canonicalizeCommandForGates,
  canonicalizeCommandPositions,
  patternMatchesCommand,
  isAutonomousRun,
  computeExecutableHash,
  formatOutput,
  finalizeFinancialAuthorization,
  isApprovalGatesEnabled,
  runHardFloor,
  run,
  runAsync,
  trackAction,
  hasAction,
  listSessionActions,
  clearSessionActions,
  loadClaimGates,
  registerClaimGate,
  normalizeGoalContract,
  evaluateGoalContract,
  verifyClaimEvidence,
  DEFAULT_CONFIG_PATH,
  DEFAULT_CLAIM_GATES_PATH,
  STATE_PATH,
  CONSTRAINTS_PATH,
  STATS_PATH,
  SESSION_ACTIONS_PATH,
  CUSTOM_CLAIM_GATES_PATH,
  GOVERNANCE_STATE_PATH,
  TTL_MS,
  SESSION_ACTION_TTL_MS,
  PROTECTED_APPROVAL_TTL_MS,
  DEFAULT_PROTECTED_FILE_GLOBS,
  buildBehavioralContext,
  buildRecentCorrectiveActionsContext,
  buildRelevantLessonContext,
  buildRelevantLessonContextAsync,
  extractActionContext,
  extractAvoidanceAdvice,
  mergeContextStrings,
  buildReminderOutput,
  isHighRiskAction,
  collectBoostedRiskTags,
  isBoostedRiskHigh,
  riskTagMatchesAction,
  evaluateBoostedRiskTagGuard,
  registerPrThreadResolutionClaimGate,
  evaluatePendingPrThreadResolutionGate,
  checkPrDormantForBranch,
  resolveGhBinaryForPrCheck,
  isReadOnlyObservabilityTool,
  getLocalOnlyScopeSources,
  isRemoteSideEffectCommand,
  evaluateLocalOnlyRemoteSideEffectGate,
  recordHelperScriptWrite,
  evaluateStatefulHelperBypassGate,
  evaluateStealthMemoryInjection,
  isAgentHookSettingsFile,
  isBreakGlassSettingsRecoveryAction,
  PR_THREAD_RESOLUTION_ACTION,
  HELPER_BYPASS_ACTION,
  buildBlockActionProCta,
  applyDailyBlockCap,
  getTodayBlockCount,
  incrementTodayBlockCount,
  effectiveCommandCwd,
  resolveRepoRoot,
};

// ---------------------------------------------------------------------------
// CLI: reads PreToolUse hook JSON from stdin
// ---------------------------------------------------------------------------

if (require.main === module) {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { data += chunk; });
  process.stdin.on('end', async () => {
    try {
      const input = JSON.parse(data);
      const output = await runAsync(input);
      process.stdout.write(output + '\n');
      process.exit(0);
    } catch (err) {
      process.stderr.write(`gates-engine error: ${err.message}\n`);
      process.stdout.write(JSON.stringify({}) + '\n');
      process.exit(0);
    }
  });
}
