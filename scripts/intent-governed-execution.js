#!/usr/bin/env node
'use strict';

/**
 * Intent → governed execution doctor — CyberStrikeAI FORMAT steal.
 *
 * Steals the process shape from Ed1s0nZ/CyberStrikeAI (via @tom_doerr):
 *   natural-language intent → risk class → required governance rails
 *   → HITL when high/critical → evidence back into memory
 *
 * Maps onto EXISTING ThumbGate rails:
 *   intent-router, harness-selector, PreToolUse/gates-engine,
 *   admin-override / protectedApprovals, subagent-profiles maxChars,
 *   lesson-retrieval / capture-feedback
 *
 * Does NOT clone CyberStrikeAI, CloudWeGo Eino, WebShell, C2, or a pentest SKU.
 * Offensive/cyber tooling stays fail-closed unless THUMBGATE_ALLOW_OFFENSIVE=1.
 *
 * Source inspiration (not affiliated):
 *   https://github.com/Ed1s0nZ/CyberStrikeAI
 *   https://x.com/tom_doerr/status/2094509419929174170
 */

const fs = require('node:fs');
const path = require('node:path');

const {
  selectHarnessName,
  HARNESSES,
} = require('./harness-selector');
const {
  listSubagentProfiles,
  getSubagentProfile,
} = require('./subagent-profiles');
const {
  RISK_LEVELS,
  evaluatePlanQuality,
  getRequiredApprovalRisks,
  loadPolicyBundle,
} = require('./intent-router');

const SOURCE_URL = 'https://github.com/Ed1s0nZ/CyberStrikeAI';
const SOURCE_POST = 'https://x.com/tom_doerr/status/2094509419929174170';

const RISK_ORDER = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
});

const INTENT_CLASSES = Object.freeze({
  code_edit: {
    label: 'code edit',
    risk: 'medium',
    harness: 'code-edit',
    profile: 'pr_workflow',
    hitl: false,
  },
  review: {
    label: 'review / read-only',
    risk: 'low',
    harness: null,
    profile: 'review_workflow',
    hitl: false,
  },
  deploy: {
    label: 'deploy / publish',
    risk: 'high',
    harness: 'deploy',
    profile: 'secure_runtime',
    hitl: true,
  },
  db_write: {
    label: 'database write',
    risk: 'high',
    harness: 'db-write',
    profile: 'secure_runtime',
    hitl: true,
  },
  secret_or_auth: {
    label: 'secrets / auth change',
    risk: 'critical',
    harness: 'five-walls-governance',
    profile: 'secure_runtime',
    hitl: true,
  },
  offensive_cyber: {
    label: 'offensive / pentest tooling',
    risk: 'critical',
    harness: 'radware-threat-defense',
    profile: 'secure_runtime',
    hitl: true,
    requiresOffensiveGrant: true,
  },
  recon_readonly: {
    label: 'authorized recon (read-only)',
    risk: 'medium',
    harness: null,
    profile: 'review_workflow',
    hitl: false,
  },
  default: {
    label: 'general intent',
    risk: 'medium',
    harness: null,
    profile: 'pr_workflow',
    hitl: false,
  },
});

const GOVERNANCE_STEPS = Object.freeze([
  {
    id: 'classify',
    label: 'Classify intent risk',
    rails: ['intent-router evaluatePlanQuality', 'harness-selector'],
  },
  {
    id: 'authorize',
    label: 'Authorization / scope',
    rails: ['session-lease', 'task-scope', 'THUMBGATE_ALLOW_OFFENSIVE for offensive'],
  },
  {
    id: 'gate',
    label: 'PreToolUse gates',
    rails: ['gates-engine', 'config/gates harness', 'MCP allowlist'],
  },
  {
    id: 'hitl',
    label: 'Human oversight when required',
    rails: ['admin-override grants', 'protectedApprovals', 'approve_protected_action'],
  },
  {
    id: 'execute',
    label: 'Bounded tool execution',
    rails: ['subagent-profiles', 'result maxChars / output caps'],
  },
  {
    id: 'evidence',
    label: 'Evidence → operational memory',
    rails: ['capture-feedback', 'lesson-retrieval', 'prevention-rules'],
  },
]);

function normalizeBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  const s = String(value).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function detectOffensiveGrant(env = process.env) {
  return normalizeBoolean(env.THUMBGATE_ALLOW_OFFENSIVE);
}

function detectCloneAttempt(text) {
  const t = String(text || '');
  const hits = [];
  if (/\b(clone|vendor|fork)\b/i.test(t) && /\b(CyberStrikeAI|cyberstrike)\b/i.test(t)) {
    hits.push('cyberstrike_clone');
  }
  if (/\b(webshell|c2 beacon|metasploit|msfvenom)\b/i.test(t) && /\b(install|enable|ship)\b/i.test(t)) {
    hits.push('offensive_sku_clone');
  }
  if (/\beino\b/i.test(t) && /\b(rebuild|vendor|cloudwego)\b/i.test(t)) {
    hits.push('eino_framework_clone');
  }
  return [...new Set(hits)];
}

function classifyIntent(intentText, options = {}) {
  const q = String(intentText || '').trim();
  const reasons = [];
  if (options.intentClass && INTENT_CLASSES[options.intentClass]) {
    return {
      intentClass: options.intentClass,
      confidence: 1,
      reasons: [`explicit intentClass=${options.intentClass}`],
      gateHarness: INTENT_CLASSES[options.intentClass].harness,
    };
  }
  if (!q) {
    return {
      intentClass: 'default',
      confidence: 0.35,
      reasons: ['empty intent → default'],
      gateHarness: null,
    };
  }

  const toolName = options.toolName || 'Bash';
  const gateHarness = selectHarnessName(toolName, { command: q, content: q });
  if (gateHarness && HARNESSES[gateHarness]) {
    reasons.push(`harness-selector → ${gateHarness}`);
  }

  if (
    /\b(nmap|nuclei|sqlmap|metasploit|msfvenom|hydra|hashcat|webshell|c2|bloodhound|mimikatz|exploit)\b/i.test(q)
    || /\b(pentest|penetration test|red.?team|offensive security|attack chain)\b/i.test(q)
  ) {
    reasons.push('offensive / pentest vocabulary');
    return {
      intentClass: 'offensive_cyber',
      confidence: 0.92,
      reasons,
      gateHarness: gateHarness || 'radware-threat-defense',
    };
  }
  if (/\b(recon|enumerate subdomain|httpx|read-only scan|authorized inventory)\b/i.test(q)) {
    reasons.push('authorized recon vocabulary');
    return { intentClass: 'recon_readonly', confidence: 0.8, reasons, gateHarness };
  }
  if (gateHarness === 'deploy' || /\b(deploy|railway|npm publish|docker push)\b/i.test(q)) {
    reasons.push('deploy vocabulary');
    return { intentClass: 'deploy', confidence: 0.9, reasons, gateHarness: 'deploy' };
  }
  if (gateHarness === 'db-write' || /\b(DROP TABLE|TRUNCATE|DELETE FROM|ALTER TABLE)\b/i.test(q)) {
    reasons.push('db-write vocabulary');
    return { intentClass: 'db_write', confidence: 0.9, reasons, gateHarness: 'db-write' };
  }
  if (/\b(secret|api[_-]?key|credential|rotate.?pat|chmod 777|\.pem|\.env)\b/i.test(q)) {
    reasons.push('secret / auth vocabulary');
    return {
      intentClass: 'secret_or_auth',
      confidence: 0.9,
      reasons,
      gateHarness: gateHarness || 'five-walls-governance',
    };
  }
  if (/\b(review|read-only|audit PR|risk analysis)\b/i.test(q)) {
    reasons.push('review vocabulary');
    return { intentClass: 'review', confidence: 0.85, reasons, gateHarness };
  }
  if (gateHarness === 'code-edit' || /\b(implement|fix|refactor|patch|edit file)\b/i.test(q)) {
    reasons.push('code-edit vocabulary');
    return {
      intentClass: 'code_edit',
      confidence: 0.86,
      reasons,
      gateHarness: gateHarness || 'code-edit',
    };
  }

  reasons.push('no strong class → default');
  return { intentClass: 'default', confidence: 0.5, reasons, gateHarness };
}

function composeGovernance(classification, options = {}) {
  const preset = INTENT_CLASSES[classification.intentClass] || INTENT_CLASSES.default;
  const risk = options.risk && RISK_LEVELS.includes(options.risk)
    ? options.risk
    : preset.risk;
  const harness = options.harness || classification.gateHarness || preset.harness;
  const profiles = listSubagentProfiles();
  let profileName = options.profile || preset.profile;
  if (!profiles.includes(profileName)) {
    profileName = profiles.includes('pr_workflow') ? 'pr_workflow' : profiles[0] || null;
  }
  let profile = null;
  if (profileName) {
    try {
      profile = getSubagentProfile(profileName);
    } catch {
      profile = null;
    }
  }

  let requiredApprovalRisks = ['high', 'critical'];
  try {
    const bundle = loadPolicyBundle(options.bundleId);
    requiredApprovalRisks = getRequiredApprovalRisks(
      bundle,
      profile?.mcpProfile || options.mcpProfile || 'default'
    );
  } catch {
    // bundle optional for doctor map-only paths
  }

  const hitlRequired = Boolean(
    preset.hitl
    || requiredApprovalRisks.includes(risk)
    || RISK_ORDER[risk] >= RISK_ORDER.high
  );
  const approved = normalizeBoolean(options.approved);
  const offensiveGrant = detectOffensiveGrant(options.env || process.env);
  const needsOffensiveGrant = Boolean(preset.requiresOffensiveGrant);

  const planQuality = evaluatePlanQuality({
    intentId: classification.intentClass,
    intent: { id: classification.intentClass, risk, description: preset.label },
    context: String(options.intent || options.task || ''),
  });

  const steps = GOVERNANCE_STEPS.map((step) => {
    const copy = { ...step, status: 'pending' };
    if (step.id === 'classify') copy.status = 'ready';
    if (step.id === 'authorize') {
      if (needsOffensiveGrant && !offensiveGrant) copy.status = 'blocked';
      else copy.status = 'ready';
    }
    if (step.id === 'gate') {
      copy.status = 'ready';
      copy.harness = harness || 'default-gates-only';
    }
    if (step.id === 'hitl') {
      copy.status = hitlRequired ? (approved ? 'satisfied' : 'required') : 'not_required';
    }
    if (step.id === 'execute') {
      copy.status = (needsOffensiveGrant && !offensiveGrant) || (hitlRequired && !approved)
        ? 'blocked'
        : 'ready';
      copy.maxChars = profile?.context?.maxChars || null;
    }
    if (step.id === 'evidence') copy.status = 'after_execute';
    return copy;
  });

  return {
    risk,
    harness: harness || null,
    subagentProfile: profileName,
    mcpProfile: profile?.mcpProfile || null,
    maxChars: profile?.context?.maxChars || null,
    hitlRequired,
    approved,
    needsOffensiveGrant,
    offensiveGrant,
    requiredApprovalRisks,
    planQuality,
    steps,
    nextActions: buildNextActions({
      hitlRequired,
      approved,
      needsOffensiveGrant,
      offensiveGrant,
      harness,
      profileName,
    }),
  };
}

function buildNextActions({
  hitlRequired,
  approved,
  needsOffensiveGrant,
  offensiveGrant,
  harness,
  profileName,
}) {
  const actions = [];
  if (needsOffensiveGrant && !offensiveGrant) {
    actions.push({
      id: 'set_offensive_grant',
      command: 'export THUMBGATE_ALLOW_OFFENSIVE=1  # only for authorized systems you own',
      why: 'Offensive/cyber intents are fail-closed without an explicit grant.',
    });
  }
  if (hitlRequired && !approved) {
    actions.push({
      id: 'obtain_hitl',
      command: 'npx thumbgate protect  # or admin-override for a single gate id',
      why: 'High/critical risk requires human oversight before tool execution.',
    });
  }
  if (harness) {
    actions.push({
      id: 'load_harness',
      command: `THUMBGATE_HARNESS=${harness}  # additive on default.json`,
      why: 'Specialized gate harness for this intent class.',
    });
  }
  actions.push({
    id: 'bound_profile',
    command: `use subagent profile ${profileName || 'pr_workflow'}`,
    why: 'Bound MCP tools + context maxChars (result governance).',
  });
  actions.push({
    id: 'capture_evidence',
    command: 'node .claude/scripts/feedback/capture-feedback.js --feedback=up|down --context="..."',
    why: 'Evidence becomes operational memory (lessons → prevention rules).',
  });
  return actions;
}

function buildIntentGovernedExecutionReport(options = {}) {
  const root = options.root
    ? path.resolve(String(options.root))
    : path.resolve(__dirname, '..');
  const intent = options.intent || options.task || options.query || '';
  const findings = [];
  const cloneHits = detectCloneAttempt(intent);
  for (const arg of options.argv || []) {
    cloneHits.push(...detectCloneAttempt(arg));
  }
  const uniqueCloneHits = [...new Set(cloneHits)];
  if (uniqueCloneHits.length) {
    findings.push({
      severity: 'fail',
      id: 'cyberstrike_clone_refused',
      message: `Refusing CyberStrike/Eino/offensive SKU clone (${uniqueCloneHits.join(', ')}). Compose existing ThumbGate rails only.`,
    });
  }

  const classification = classifyIntent(intent, {
    intentClass: options.class || options.intentClass || null,
    toolName: options.toolName || options.tool || null,
  });
  const governance = composeGovernance(classification, {
    ...options,
    intent,
  });

  if (governance.needsOffensiveGrant && !governance.offensiveGrant) {
    findings.push({
      severity: 'fail',
      id: 'offensive_ungranted',
      message: 'Offensive/cyber intent blocked: set THUMBGATE_ALLOW_OFFENSIVE=1 only for systems you own or are authorized to test.',
    });
  }
  if (governance.hitlRequired && !governance.approved) {
    findings.push({
      severity: 'warn',
      id: 'hitl_required',
      message: 'Human oversight required before execute (high/critical). Pass --approved only after a real human grant.',
    });
  }
  if (governance.planQuality?.gate === 'block') {
    findings.push({
      severity: 'warn',
      id: 'plan_quality_block',
      message: `Plan quality blocked: missing context [${(governance.planQuality.missingContext || []).join(', ')}]`,
    });
  }

  const probes = [
    { id: 'intent_router', path: path.join(root, 'scripts', 'intent-router.js') },
    { id: 'harness_selector', path: path.join(root, 'scripts', 'harness-selector.js') },
    { id: 'gates_engine', path: path.join(root, 'scripts', 'gates-engine.js') },
    { id: 'admin_override', path: path.join(root, 'scripts', 'admin-override.js') },
    { id: 'subagent_profiles', path: path.join(root, 'config', 'subagent-profiles.json') },
  ].map((p) => ({ ...p, exists: fs.existsSync(p.path) }));

  for (const p of probes.filter((x) => !x.exists)) {
    findings.push({
      severity: 'warn',
      id: `missing_rail_${p.id}`,
      message: `Expected rail missing: ${p.path}`,
    });
  }

  let status = 'ready';
  if (findings.some((f) => f.severity === 'fail')) status = 'fail';
  else if (findings.some((f) => f.severity === 'warn')) status = 'checkpoint_required';
  else if (governance.steps.some((s) => s.status === 'blocked' || s.status === 'required')) {
    status = 'checkpoint_required';
  }

  const mapOnly = normalizeBoolean(options.map || options['map-only']);
  const report = {
    name: 'thumbgate-intent-governed-execution',
    status,
    intent: intent || null,
    intentClass: classification.intentClass,
    intentLabel: (INTENT_CLASSES[classification.intentClass] || INTENT_CLASSES.default).label,
    confidence: classification.confidence,
    reasons: classification.reasons,
    governance,
    railProbes: probes,
    compareNotClone: true,
    never: [
      'clone CyberStrikeAI / Ed1s0nZ product',
      'vendor CloudWeGo Eino as a ThumbGate SKU',
      'ship WebShell / C2 / metasploit recipes',
      'invent ROI percentages (70% automation theater)',
      'execute offensive tools without authorization grant',
    ],
    source: SOURCE_URL,
    sourcePost: SOURCE_POST,
    disclaimer:
      'FORMAT steal from CyberStrikeAI (intent→governed execution + HITL + evidence memory). Not affiliated. Does not install CyberStrikeAI or Eino.',
    findings,
  };

  if (mapOnly) {
    report.map = GOVERNANCE_STEPS;
    report.intentClasses = Object.keys(INTENT_CLASSES);
  }

  return report;
}

function formatIntentGovernedExecutionReport(report) {
  const g = report.governance || {};
  const lines = [
    'ThumbGate Intent → Governed Execution (CyberStrike FORMAT steal)',
    `Status   : ${report.status}`,
    `Intent   : ${report.intent || '(none)'}`,
    `Class    : ${report.intentClass} (${report.intentLabel}) confidence=${report.confidence}`,
    `Risk     : ${g.risk}  HITL=${g.hitlRequired ? (g.approved ? 'approved' : 'REQUIRED') : 'not required'}`,
    `Harness  : ${g.harness || 'default-gates-only'}`,
    `Profile  : ${g.subagentProfile || 'none'} mcp=${g.mcpProfile || 'n/a'} maxChars=${g.maxChars || 'n/a'}`,
    `Offensive grant: ${g.offensiveGrant ? 'yes' : 'no'}${g.needsOffensiveGrant ? ' (required)' : ''}`,
    'Steps    :',
  ];
  for (const step of g.steps || []) {
    lines.push(`  [${step.status}] ${step.id}: ${step.label}`);
    lines.push(`         rails=${(step.rails || []).join(' · ')}`);
  }
  if (g.nextActions?.length) {
    lines.push('Next     :');
    for (const a of g.nextActions) {
      lines.push(`  - ${a.id}: ${a.command}`);
      lines.push(`    why: ${a.why}`);
    }
  }
  if (report.findings?.length) {
    lines.push('Findings:');
    for (const f of report.findings) {
      lines.push(`  [${f.severity}] ${f.id}: ${f.message}`);
    }
  }
  lines.push(`Never    : ${(report.never || []).join('; ')}`);
  lines.push(`Source   : ${report.source}`);
  lines.push(report.disclaimer);
  return `${lines.join('\n')}\n`;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/intent-governed-execution.js [options]

CyberStrikeAI FORMAT steal — NL intent → governed execution on existing rails.
Does not clone CyberStrikeAI / Eino / WebShell / C2.

Options:
  --intent=<text>            Natural-language intent
  --class=<intentClass>      Force class (${Object.keys(INTENT_CLASSES).join('|')})
  --risk=low|medium|high|critical
  --harness=<name>           Force gate harness
  --profile=<name>           Force subagent profile
  --approved                 Mark HITL already satisfied (human grant only)
  --map-only                 Print governance step map
  --json
  --strict                   Exit 1 unless status=ready
  --root=<dir>
`);
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return 0;
  }
  const options = { argv };
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--map' || arg === '--map-only') options.map = true;
    else if (arg === '--approved') options.approved = true;
    else if (arg.startsWith('--intent=')) options.intent = arg.slice('--intent='.length);
    else if (arg.startsWith('--task=')) options.intent = arg.slice('--task='.length);
    else if (arg.startsWith('--query=')) options.intent = arg.slice('--query='.length);
    else if (arg.startsWith('--class=')) options.intentClass = arg.slice('--class='.length);
    else if (arg.startsWith('--risk=')) options.risk = arg.slice('--risk='.length);
    else if (arg.startsWith('--harness=')) options.harness = arg.slice('--harness='.length);
    else if (arg.startsWith('--profile=')) options.profile = arg.slice('--profile='.length);
    else if (arg.startsWith('--toolName=')) options.toolName = arg.slice('--toolName='.length);
    else if (arg.startsWith('--root=')) options.root = arg.slice('--root='.length);
    else if (!arg.startsWith('-') && !options.intent) options.intent = arg;
  }

  const report = buildIntentGovernedExecutionReport(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatIntentGovernedExecutionReport(report));
  }
  if (options.strict && report.status !== 'ready') return 1;
  if (report.status === 'fail') return 1;
  return 0;
}

if (require.main === module || (
  process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(__filename)
)) {
  process.exitCode = main();
}

module.exports = {
  INTENT_CLASSES,
  GOVERNANCE_STEPS,
  RISK_ORDER,
  classifyIntent,
  composeGovernance,
  detectOffensiveGrant,
  detectCloneAttempt,
  buildIntentGovernedExecutionReport,
  formatIntentGovernedExecutionReport,
  main,
  SOURCE_URL,
  SOURCE_POST,
};
