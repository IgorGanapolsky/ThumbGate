#!/usr/bin/env node
'use strict';

/**
 * JIT harness compose doctor — JIT-Agent FORMAT steal.
 *
 * Maps arXiv:2608.25593 four-module harness (memory, planning, action,
 * capability) onto EXISTING ThumbGate rails:
 *   memory     → lesson-retrieval / feedback / contextfs
 *   planning   → bin/agent-loop Plan + GSD / harness-selector task class
 *   action     → PreToolUse gates + selected gate harness + switchyard steps
 *   capability → subagent-profiles + MCP profile + skills + model pool
 *
 * Does NOT train/download JIT-Agent-27B, emit free-form harness programs,
 * or clone HarnessFactory / bingreeky/JIT.
 *
 * Source inspiration (not affiliated):
 *   https://arxiv.org/abs/2608.25593
 *   https://github.com/bingreeky/JIT
 */

const fs = require('node:fs');
const path = require('node:path');

const {
  selectHarnessName,
  listHarnesses,
  HARNESSES,
} = require('./harness-selector');
const {
  routeAgentSteps,
  buildAlwaysOnAgentPlan,
  DEFAULT_POOL,
} = require('./switchyard-router');
const {
  listSubagentProfiles,
  getSubagentProfile,
  validateSubagentProfiles,
} = require('./subagent-profiles');

const SOURCE_URL = 'https://arxiv.org/abs/2608.25593';
const SOURCE_REPO = 'https://github.com/bingreeky/JIT';
const MODULES = Object.freeze(['memory', 'planning', 'action', 'capability']);

const MODULE_RAILS = Object.freeze({
  memory: {
    label: 'memory management',
    rails: [
      'lesson-retrieval (BM25F / hybrid RRF)',
      '.claude/memory/feedback',
      'contextfs packs',
      'capture-feedback.js',
    ],
    when: 'Prior mistakes, scoped lessons, and session context packs.',
  },
  planning: {
    label: 'planning strategy',
    rails: [
      'bin/agent-loop Plan stage',
      'GSD (Capture→Clarify→Organize→Execute→Review)',
      'harness-selector task class',
      'implementation-notes ledger',
    ],
    when: 'Multi-step work needs an explicit plan before tool calls.',
  },
  action: {
    label: 'action protocol',
    rails: [
      'PreToolUse / gates-engine',
      'config/gates/*.json harnesses',
      'switchyard-router step roles',
      'session-lease + worktree isolation',
    ],
    when: 'Every tool call must pass deterministic gates before execution.',
  },
  capability: {
    label: 'tool / skill orchestration',
    rails: [
      'config/subagent-profiles.json',
      'config/mcp-allowlists.json profiles',
      '.agents/skills + skills/thumbgate',
      'switchyard model pool / model-candidates',
    ],
    when: 'Bound which MCP profile, skills, and models this task may use.',
  },
});

const TASK_CLASSES = Object.freeze({
  code_edit: {
    label: 'code edit',
    memory: 'scoped_lessons',
    planning: 'agent_loop_plan',
    actionHarness: 'code-edit',
    subagentProfile: 'pr_workflow',
    switchyardRoles: ['code', 'gate'],
  },
  review: {
    label: 'review / risk analysis',
    memory: 'scoped_lessons',
    planning: 'gsd_clarify',
    actionHarness: null,
    subagentProfile: 'review_workflow',
    switchyardRoles: ['reason', 'summarize', 'gate'],
  },
  deploy: {
    label: 'deploy / publish',
    memory: 'deploy_lessons',
    planning: 'agent_loop_plan',
    actionHarness: 'deploy',
    subagentProfile: 'secure_runtime',
    switchyardRoles: ['gate', 'code'],
  },
  research: {
    label: 'research / deep search',
    memory: 'broad_hybrid',
    planning: 'gsd_full',
    actionHarness: null,
    subagentProfile: 'review_workflow',
    switchyardRoles: ['reason', 'summarize'],
  },
  secure: {
    label: 'secure / constrained runtime',
    memory: 'scoped_lessons',
    planning: 'single_shot',
    actionHarness: 'five-walls-governance',
    subagentProfile: 'secure_runtime',
    switchyardRoles: ['gate', 'private'],
  },
  routine: {
    label: 'routine / scheduled agent',
    memory: 'scoped_lessons',
    planning: 'single_shot',
    actionHarness: 'routine',
    subagentProfile: 'pr_workflow',
    switchyardRoles: ['intent', 'gate', 'bulk'],
  },
  db_write: {
    label: 'database write',
    memory: 'scoped_lessons',
    planning: 'agent_loop_plan',
    actionHarness: 'db-write',
    subagentProfile: 'secure_runtime',
    switchyardRoles: ['gate', 'code'],
  },
  default: {
    label: 'general task',
    memory: 'hybrid_default',
    planning: 'agent_loop_plan',
    actionHarness: null,
    subagentProfile: 'pr_workflow',
    switchyardRoles: ['intent', 'gate', 'code'],
  },
});

const MEMORY_CHOICES = Object.freeze({
  scoped_lessons: {
    id: 'scoped_lessons',
    rails: ['lesson-retrieval with entity/project/session scope', 'feedback promotion'],
    why: 'Prefer matchable lessons over raw transcript dumps.',
  },
  deploy_lessons: {
    id: 'deploy_lessons',
    rails: ['lesson-retrieval tagged deploy/railway', 'prevention-rules.md'],
    why: 'Deploy mistakes are high-cost; pull prior deploy denials first.',
  },
  broad_hybrid: {
    id: 'broad_hybrid',
    rails: ['pragmatic-hybrid-search RRF', 'graphify when architectural'],
    why: 'Research tasks need lexical + optional dense + graph hops.',
  },
  hybrid_default: {
    id: 'hybrid_default',
    rails: ['lesson-retrieval reciprocalRankFusion', 'contextfs'],
    why: 'Default: fuse lessons without shipping transcript blobs.',
  },
});

const PLANNING_CHOICES = Object.freeze({
  agent_loop_plan: {
    id: 'agent_loop_plan',
    rails: ['bin/agent-loop Plan→Observe→Act→Evaluate→Learn'],
    why: 'Multi-step coding stays inside the Recollect→Plan loop.',
  },
  gsd_clarify: {
    id: 'gsd_clarify',
    rails: ['GSD Clarify + Organize before Execute'],
    why: 'Review work needs acceptance criteria before patches.',
  },
  gsd_full: {
    id: 'gsd_full',
    rails: ['GSD Capture→Clarify→Organize→Execute→Review'],
    why: 'Research / long-horizon tasks need the full GSD spine.',
  },
  single_shot: {
    id: 'single_shot',
    rails: ['single bounded plan + evidence receipt'],
    why: 'Routine or locked profiles should not sprawl into multi-agent fan-out.',
  },
});

function normalizeBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  const s = String(value).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function detectTrainOrCloneAttempt(text) {
  const t = String(text || '');
  const hits = [];
  if (/\bjit-?agent-?27b\b/i.test(t) || /\bserve_meta_model\b/i.test(t)) {
    hits.push('jit_model_serve');
  }
  if (/\bhuggingface\.co\/JIT-Agent\b/i.test(t) || /\bpip install.*\bjit\b/i.test(t)) {
    hits.push('jit_model_download');
  }
  if (/\bHarnessFactory\b/.test(t) && /\bclone\b/i.test(t)) {
    hits.push('harness_factory_clone');
  }
  if (/\bemit\b.*\bfree-?form\b.*\bharness\b/i.test(t) || /\bgenerate executable harness code\b/i.test(t)) {
    hits.push('freeform_harness_emit');
  }
  return hits;
}

function classifyTask(taskText, options = {}) {
  const q = String(taskText || '').trim();
  const reasons = [];
  if (options.taskClass && TASK_CLASSES[options.taskClass]) {
    return {
      taskClass: options.taskClass,
      confidence: 1,
      reasons: [`explicit taskClass=${options.taskClass}`],
      gateHarness: TASK_CLASSES[options.taskClass].actionHarness,
    };
  }
  if (!q) {
    return {
      taskClass: 'default',
      confidence: 0.4,
      reasons: ['empty task → default four-module compose'],
      gateHarness: null,
    };
  }

  const toolName = options.toolName || (/\b(edit|write|patch|refactor)\b/i.test(q) ? 'Edit' : 'Bash');
  const gateHarness = selectHarnessName(toolName, { command: q, content: q });
  if (gateHarness && HARNESSES[gateHarness]) {
    reasons.push(`harness-selector → ${gateHarness}`);
  }

  if (gateHarness === 'deploy' || /\b(deploy|railway|npm publish|docker push)\b/i.test(q)) {
    reasons.push('deploy / publish vocabulary');
    return { taskClass: 'deploy', confidence: 0.9, reasons, gateHarness: gateHarness || 'deploy' };
  }
  if (gateHarness === 'db-write' || /\b(DROP TABLE|TRUNCATE|DELETE FROM|ALTER TABLE)\b/i.test(q)) {
    reasons.push('database-write vocabulary');
    return { taskClass: 'db_write', confidence: 0.9, reasons, gateHarness: 'db-write' };
  }
  if (gateHarness === 'routine' || /\b(nightly|scheduled|cron|routine agent)\b/i.test(q)) {
    reasons.push('routine / scheduled vocabulary');
    return { taskClass: 'routine', confidence: 0.85, reasons, gateHarness: 'routine' };
  }
  if (
    gateHarness === 'five-walls-governance'
    || /\b(secure_runtime|locked mcp|five.?walls|hard_deny|secret|pii)\b/i.test(q)
  ) {
    reasons.push('secure / constrained vocabulary');
    return {
      taskClass: 'secure',
      confidence: 0.88,
      reasons,
      gateHarness: gateHarness || 'five-walls-governance',
    };
  }
  if (/\b(review|code review|risk analysis|audit PR|read-only review)\b/i.test(q)) {
    reasons.push('review vocabulary');
    return { taskClass: 'review', confidence: 0.86, reasons, gateHarness };
  }
  if (/\b(research|deep search|investigate|survey|literature|arxiv)\b/i.test(q)) {
    reasons.push('research vocabulary');
    return { taskClass: 'research', confidence: 0.84, reasons, gateHarness };
  }
  if (gateHarness === 'code-edit' || /\b(implement|fix|refactor|patch|edit file|write code)\b/i.test(q)) {
    reasons.push('code-edit vocabulary');
    return { taskClass: 'code_edit', confidence: 0.87, reasons, gateHarness: gateHarness || 'code-edit' };
  }

  reasons.push('no strong class → default');
  return { taskClass: 'default', confidence: 0.55, reasons, gateHarness };
}

function composeModules(classification, options = {}) {
  const preset = TASK_CLASSES[classification.taskClass] || TASK_CLASSES.default;
  const memory = MEMORY_CHOICES[preset.memory] || MEMORY_CHOICES.hybrid_default;
  const planning = PLANNING_CHOICES[preset.planning] || PLANNING_CHOICES.agent_loop_plan;

  let actionHarness = options.harness || classification.gateHarness || preset.actionHarness;
  if (actionHarness && !HARNESSES[actionHarness]) {
    actionHarness = preset.actionHarness;
  }

  const availableProfiles = listSubagentProfiles();
  let subagentProfile = options.profile || preset.subagentProfile;
  if (!availableProfiles.includes(subagentProfile)) {
    subagentProfile = availableProfiles.includes('pr_workflow')
      ? 'pr_workflow'
      : availableProfiles[0] || null;
  }

  let profile = null;
  if (subagentProfile) {
    try {
      profile = getSubagentProfile(subagentProfile);
    } catch {
      profile = null;
    }
  }

  const roles = Array.isArray(options.roles) && options.roles.length
    ? options.roles
    : preset.switchyardRoles;
  const plan = {
    steps: roles.map((role, index) => ({
      id: `m${index + 1}-${role}`,
      type: role,
      tags: [classification.taskClass, 'jit-compose'],
      riskLevel: classification.taskClass === 'secure' || classification.taskClass === 'deploy'
        ? 'high'
        : 'medium',
      sensitive: classification.taskClass === 'secure',
    })),
  };
  const routed = routeAgentSteps(plan);

  return {
    memory: {
      module: 'memory',
      choice: memory.id,
      rails: memory.rails,
      why: memory.why,
      catalog: MODULE_RAILS.memory,
    },
    planning: {
      module: 'planning',
      choice: planning.id,
      rails: planning.rails,
      why: planning.why,
      catalog: MODULE_RAILS.planning,
    },
    action: {
      module: 'action',
      choice: actionHarness || 'default-gates-only',
      gateHarness: actionHarness,
      rails: [
        ...(actionHarness ? [`config/gates/${actionHarness}.json`] : ['default.json + auto-promoted gates']),
        'PreToolUse / gates-engine',
        'switchyard step roles: ' + roles.join(', '),
      ],
      why: actionHarness
        ? `Load specialized ${actionHarness} harness additively on top of default gates.`
        : 'No specialized harness; default gates still apply.',
      catalog: MODULE_RAILS.action,
      switchyard: {
        distinctModels: routed.distinctModels,
        steps: routed.steps.map((s) => ({
          id: s.id,
          role: s.role,
          modelId: s.modelId,
          reason: s.reason,
        })),
      },
    },
    capability: {
      module: 'capability',
      choice: subagentProfile || 'none',
      subagentProfile,
      mcpProfile: profile?.mcpProfile || null,
      skills: profile?.skills || [],
      context: profile?.context || null,
      rails: [
        subagentProfile ? `subagent-profiles:${subagentProfile}` : 'no subagent profile',
        profile?.mcpProfile ? `mcp-allowlists:${profile.mcpProfile}` : 'mcp default',
        'skills registry + model pool',
      ],
      why: profile
        ? `Bound tools/skills via ${subagentProfile} (mcp=${profile.mcpProfile}).`
        : 'No matching subagent profile; keep MCP allowlist fail-closed.',
      catalog: MODULE_RAILS.capability,
      modelPoolSample: DEFAULT_POOL.slice(0, 3).map((m) => m.id),
    },
  };
}

function probeRails(rootDir) {
  const root = rootDir || path.resolve(__dirname, '..');
  const checks = [
    { id: 'agent_loop', path: path.join(root, 'bin', 'agent-loop') },
    { id: 'harness_selector', path: path.join(root, 'scripts', 'harness-selector.js') },
    { id: 'switchyard_router', path: path.join(root, 'scripts', 'switchyard-router.js') },
    { id: 'subagent_profiles', path: path.join(root, 'config', 'subagent-profiles.json') },
    { id: 'mcp_allowlists', path: path.join(root, 'config', 'mcp-allowlists.json') },
    { id: 'gates_dir', path: path.join(root, 'config', 'gates') },
  ];
  return checks.map((c) => ({
    id: c.id,
    path: c.path,
    exists: fs.existsSync(c.path),
  }));
}

function buildJitHarnessComposeReport(options = {}) {
  const root = options.root
    ? path.resolve(String(options.root))
    : path.resolve(__dirname, '..');
  const task = options.task || options.query || options._ || '';
  const findings = [];
  const cloneHits = detectTrainOrCloneAttempt(task);
  for (const hit of options.argv || []) {
    cloneHits.push(...detectTrainOrCloneAttempt(hit));
  }
  const uniqueCloneHits = [...new Set(cloneHits)];
  if (uniqueCloneHits.length) {
    findings.push({
      severity: 'fail',
      id: 'jit_clone_refused',
      message: `Refusing JIT model/HarnessFactory clone path (${uniqueCloneHits.join(', ')}). Compose existing rails only.`,
    });
  }

  const classification = classifyTask(task, {
    taskClass: options.taskClass || options.class || null,
    toolName: options.toolName || options.tool || null,
  });
  const modules = composeModules(classification, {
    harness: options.harness || null,
    profile: options.profile || null,
    roles: options.roles
      ? String(options.roles).split(',').map((s) => s.trim()).filter(Boolean)
      : null,
  });

  const probes = probeRails(root);
  const missing = probes.filter((p) => !p.exists);
  for (const m of missing) {
    findings.push({
      severity: 'warn',
      id: `missing_rail_${m.id}`,
      message: `Expected rail missing: ${m.path}`,
    });
  }

  let profileValidation = null;
  try {
    profileValidation = validateSubagentProfiles();
    if (!profileValidation.valid) {
      findings.push({
        severity: 'warn',
        id: 'subagent_profile_invalid',
        message: profileValidation.issues.slice(0, 5).join('; '),
      });
    }
  } catch (err) {
    findings.push({
      severity: 'warn',
      id: 'subagent_profile_load_error',
      message: err.message,
    });
  }

  const alwaysOn = buildAlwaysOnAgentPlan({ includeBulk: false });
  const mapOnly = normalizeBoolean(options.map || options['map-only']);

  let status = 'ready';
  if (findings.some((f) => f.severity === 'fail')) status = 'fail';
  else if (findings.some((f) => f.severity === 'warn')) status = 'ready_with_warnings';

  const report = {
    name: 'thumbgate-jit-harness-compose',
    status,
    task: task || null,
    taskClass: classification.taskClass,
    taskLabel: (TASK_CLASSES[classification.taskClass] || TASK_CLASSES.default).label,
    confidence: classification.confidence,
    reasons: classification.reasons,
    modules,
    moduleOrder: MODULES,
    availableGateHarnesses: listHarnesses(),
    availableSubagentProfiles: listSubagentProfiles(),
    railProbes: probes,
    profileValidation,
    alwaysOnPlanSteps: alwaysOn.steps?.length || 0,
    compareNotClone: true,
    never: [
      'train or download JIT-Agent-27B',
      'clone bingreeky/JIT HarnessFactory',
      'emit free-form harness programs',
      'claim ThumbGate is JIT-Agent',
    ],
    source: SOURCE_URL,
    sourceRepo: SOURCE_REPO,
    disclaimer: 'FORMAT steal only. Not affiliated with JIT-Agent / bingreeky/JIT. Composes existing ThumbGate rails; does not train a harness model.',
    findings,
  };

  if (mapOnly) {
    report.map = MODULES.map((id) => ({ id, ...MODULE_RAILS[id] }));
    report.taskClasses = Object.keys(TASK_CLASSES);
  }

  return report;
}

function formatJitHarnessComposeReport(report) {
  const lines = [
    'ThumbGate JIT Harness Compose (JIT-Agent FORMAT steal)',
    `Status   : ${report.status}`,
    `Task     : ${report.task || '(none)'}`,
    `Class    : ${report.taskClass} (${report.taskLabel}) confidence=${report.confidence}`,
    `Reasons  : ${(report.reasons || []).join('; ')}`,
    'Modules  :',
  ];
  for (const id of report.moduleOrder || MODULES) {
    const m = report.modules?.[id];
    if (!m) continue;
    lines.push(`  [${id}] choice=${m.choice}`);
    lines.push(`         rails=${(m.rails || []).join(' · ')}`);
    lines.push(`         why=${m.why}`);
  }
  if (report.modules?.action?.switchyard?.distinctModels?.length) {
    lines.push(`Models   : ${report.modules.action.switchyard.distinctModels.join(', ')}`);
  }
  if (report.modules?.capability?.subagentProfile) {
    lines.push(
      `Capability profile: ${report.modules.capability.subagentProfile}`
      + ` mcp=${report.modules.capability.mcpProfile}`
      + ` skills=${(report.modules.capability.skills || []).join(',') || '(none)'}`
    );
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
  process.stdout.write(`Usage: node scripts/jit-harness-compose.js [options]

JIT-Agent FORMAT steal — compose memory/planning/action/capability onto
existing ThumbGate rails. Does not train or download JIT-Agent.

Options:
  --task=<text>              Task to classify / compose
  --class=<taskClass>        Force task class (${Object.keys(TASK_CLASSES).join('|')})
  --harness=<name>           Force gate harness
  --profile=<name>           Force subagent profile
  --roles=a,b,c              Switchyard roles override
  --toolName=Bash|Edit       Hint for harness-selector
  --map-only                 Print four-module rail map
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
    else if (arg.startsWith('--task=')) options.task = arg.slice('--task='.length);
    else if (arg.startsWith('--query=')) options.task = arg.slice('--query='.length);
    else if (arg.startsWith('--class=')) options.taskClass = arg.slice('--class='.length);
    else if (arg.startsWith('--taskClass=')) options.taskClass = arg.slice('--taskClass='.length);
    else if (arg.startsWith('--harness=')) options.harness = arg.slice('--harness='.length);
    else if (arg.startsWith('--profile=')) options.profile = arg.slice('--profile='.length);
    else if (arg.startsWith('--roles=')) options.roles = arg.slice('--roles='.length);
    else if (arg.startsWith('--toolName=')) options.toolName = arg.slice('--toolName='.length);
    else if (arg.startsWith('--tool=')) options.toolName = arg.slice('--tool='.length);
    else if (arg.startsWith('--root=')) options.root = arg.slice('--root='.length);
    else if (!arg.startsWith('-') && !options.task) options.task = arg;
  }

  const report = buildJitHarnessComposeReport(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatJitHarnessComposeReport(report));
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
  MODULES,
  MODULE_RAILS,
  TASK_CLASSES,
  MEMORY_CHOICES,
  PLANNING_CHOICES,
  classifyTask,
  composeModules,
  detectTrainOrCloneAttempt,
  probeRails,
  buildJitHarnessComposeReport,
  formatJitHarnessComposeReport,
  main,
  SOURCE_URL,
  SOURCE_REPO,
};
