#!/usr/bin/env node
'use strict';

/**
 * Agent Security Central — free, local, centralized security posture for AI coding agents.
 *
 * Transferable GTM from Oracle Database Security Central (InfoWorld 2026-08-14):
 *   free time-boxed security posture product → experience-first wedge.
 * ThumbGate maps that onto agent control planes (not RDBMS):
 *   1. Central posture score (gates + hooks + MCP wiring)
 *   2. Configuration drift (settings hooks vs expected PreToolUse contract)
 *   3. Privileged-tool / access risk (missing high-blast-radius blocks)
 *   4. Sensitive-data + audit evidence (secret denials, audit trail presence)
 *   5. Policy variance (manual vs auto-promoted rules, empty block set)
 *
 * Local report is free forever (OSS). Hosted Pro remains optional self-serve.
 * No paid pilot / enterprise SOW language in this surface.
 */

const fs = require('fs');
const path = require('path');

const PKG_ROOT = path.resolve(__dirname, '..');
const PKG_VERSION = (() => {
  try {
    return require(path.join(PKG_ROOT, 'package.json')).version;
  } catch {
    return '0.0.0';
  }
})();

/** Expected PreToolUse command fragments that prove ThumbGate is on the wire. */
const EXPECTED_HOOK_MARKERS = [
  'gate-check',
  'thumbgate',
  'PreToolUse',
];

/**
 * Privileged / high-blast categories every agent security central should cover.
 * Matched case-insensitively against gate id, name, pattern, tags, category.
 */
const PRIVILEGED_COVERAGE = [
  {
    id: 'secret-exfil',
    label: 'Secret / credential exfiltration',
    match: /secret|exfil|credential|api.?key|token.?leak|password/i,
  },
  {
    id: 'destructive-shell',
    label: 'Destructive shell / force-push',
    match: /force.?push|rm\s*-rf|destructive|git.?clean|hard.?reset|sudo/i,
  },
  {
    id: 'branch-protection',
    label: 'Branch protection / admin merge bypass',
    match: /branch.?protect|admin.?merge|--admin|never-bypass|pr.?approve/i,
  },
  {
    id: 'spend-commerce',
    label: 'Spend / commerce / outbound money',
    match: /spend|commerce|stripe|payment|checkout|outbound.?email/i,
  },
  {
    id: 'production-deploy',
    label: 'Production deploy / live ship',
    match: /deploy|production|railway|prod.?ship|live.?claim/i,
  },
];

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return { __parseError: true, path: filePath };
  }
}

function readTextIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

/** How many trailing audit records the posture scan inspects. */
const AUDIT_TAIL_LINES = 500;
/** Read window for the tail scan: enough for AUDIT_TAIL_LINES typical records. */
const AUDIT_TAIL_BYTES = 1024 * 1024;

/**
 * Read the last `maxLines` non-empty lines of a JSONL file without
 * materializing the whole file. Audit logs grow without bound (a 101 MB /
 * 200k-line log previously allocated 200k split entries plus a 200k filtered
 * array just to inspect the final 500 records), so the scan reads at most
 * AUDIT_TAIL_BYTES from the end of the file.
 *
 * @returns {{lines: string[], totalLines: number, truncated: boolean}}
 *   `totalLines` is exact when the file fits in the window, otherwise it is a
 *   lower bound and `truncated` is true.
 */
function readTailLines(filePath, maxLines) {
  let fd;
  try {
    const { size } = fs.statSync(filePath);
    if (size === 0) return { lines: [], totalLines: 0, truncated: false };
    const readBytes = Math.min(size, AUDIT_TAIL_BYTES);
    const buf = Buffer.alloc(readBytes);
    fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, readBytes, size - readBytes);
    const truncated = readBytes < size;
    let chunk = buf.toString('utf8');
    // A partial leading record would be misparsed; drop it when truncated.
    if (truncated) {
      const nl = chunk.indexOf('\n');
      chunk = nl === -1 ? '' : chunk.slice(nl + 1);
    }
    const all = chunk.split('\n').filter(Boolean);
    return {
      lines: all.slice(-maxLines),
      totalLines: all.length,
      truncated,
    };
  } catch {
    return { lines: [], totalLines: 0, truncated: false };
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
}

function loadGatesFromFile(filePath) {
  const data = readJsonIfExists(filePath);
  if (!data || data.__parseError) return [];
  if (Array.isArray(data.gates)) return data.gates;
  if (Array.isArray(data)) return data;
  return [];
}

function gateBlob(gate) {
  return [
    gate.id,
    gate.name,
    gate.pattern,
    gate.category,
    gate.description,
    Array.isArray(gate.tags) ? gate.tags.join(' ') : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function collectHooksFromSettings(settings) {
  if (!settings || typeof settings !== 'object' || settings.__parseError) return [];
  const hooks = settings.hooks || {};
  const pre = hooks.PreToolUse || hooks.preToolUse || [];
  const list = Array.isArray(pre) ? pre : [];
  const commands = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const hooksArr = Array.isArray(entry.hooks) ? entry.hooks : [entry];
    for (const h of hooksArr) {
      if (!h || typeof h !== 'object') continue;
      if (typeof h.command === 'string') commands.push(h.command);
      if (typeof h.script === 'string') commands.push(h.script);
    }
    if (typeof entry.command === 'string') commands.push(entry.command);
  }
  // Scan only the selected PreToolUse surface for command strings (Claude Code
  // formats vary). Serializing the whole `hooks` object would let a PostToolUse
  // `thumbgate gate-check` entry masquerade as PreToolUse wiring, hiding real
  // hook drift while tools still execute before the gate runs.
  const raw = JSON.stringify(pre);
  return { commands, raw };
}

function assessHookDrift(projectRoot, homeDir) {
  const candidates = [
    path.join(projectRoot, '.claude', 'settings.json'),
    path.join(projectRoot, '.claude', 'settings.local.json'),
    homeDir ? path.join(homeDir, '.claude', 'settings.json') : null,
    homeDir ? path.join(homeDir, '.claude', 'settings.local.json') : null,
  ].filter(Boolean);

  const surfaces = [];
  let anyThumbgateHook = false;
  let anyGateCheck = false;

  for (const filePath of candidates) {
    const settings = readJsonIfExists(filePath);
    if (!settings) {
      surfaces.push({ path: filePath, present: false, markers: [] });
      continue;
    }
    if (settings.__parseError) {
      surfaces.push({ path: filePath, present: true, parseError: true, markers: [] });
      continue;
    }
    const { commands, raw } = collectHooksFromSettings(settings);
    const blob = `${commands.join('\n')}\n${raw}`.toLowerCase();
    const markers = EXPECTED_HOOK_MARKERS.filter((m) => blob.includes(m.toLowerCase()));
    if (markers.includes('thumbgate') || markers.includes('gate-check')) {
      anyThumbgateHook = true;
    }
    if (markers.includes('gate-check')) anyGateCheck = true;
    surfaces.push({
      path: filePath,
      present: true,
      commandCount: commands.length,
      markers,
    });
  }

  const findings = [];
  if (!anyThumbgateHook) {
    findings.push({
      severity: 'high',
      id: 'hook-drift-missing-thumbgate',
      message:
        'No PreToolUse hook surface references thumbgate/gate-check — agent actions may run ungated (configuration drift from expected install).',
    });
  } else if (!anyGateCheck) {
    findings.push({
      severity: 'medium',
      id: 'hook-drift-weak-marker',
      message:
        'ThumbGate mentioned in settings but gate-check marker missing — verify PreToolUse actually invokes the gate runtime.',
    });
  }

  return {
    anyThumbgateHook,
    anyGateCheck,
    surfaces,
    findings,
    drifted: !anyThumbgateHook,
  };
}

function assessPrivilegedCoverage(gates) {
  const covered = [];
  const missing = [];
  for (const need of PRIVILEGED_COVERAGE) {
    const matching = gates.filter((g) => need.match.test(gateBlob(g)));
    // Only a block-action gate counts as coverage. A warn/log/approve gate is
    // advisory: the privileged operation still executes, so certifying it as
    // coverage would report enforcement that does not exist.
    const hit = matching.find((g) => g.action === 'block');
    if (hit) {
      covered.push({
        id: need.id,
        label: need.label,
        gateId: hit.id || hit.name || null,
        action: hit.action,
      });
    } else {
      missing.push({
        id: need.id,
        label: need.label,
        advisoryOnly: matching.length > 0,
        advisoryGates: matching.map((g) => g.id || g.name || null).filter(Boolean),
      });
    }
  }
  const findings = missing.map((m) => ({
    severity: 'medium',
    id: `privileged-gap-${m.id}`,
    message: m.advisoryOnly
      ? `No block-action gate covers privileged risk: ${m.label} — only advisory (warn/log/approve) gates matched: ${m.advisoryGates.join(', ') || 'unnamed'}. The operation is not prevented.`
      : `No active gate covers privileged risk: ${m.label}`,
  }));
  return { covered, missing, findings };
}

function assessPolicyVariance(manualGates, autoGates) {
  const blockManual = manualGates.filter((g) => g.action === 'block').length;
  const blockAuto = autoGates.filter((g) => g.action === 'block').length;
  const warnManual = manualGates.filter((g) => g.action === 'warn').length;
  const warnAuto = autoGates.filter((g) => g.action === 'warn').length;
  const findings = [];
  if (blockManual + blockAuto === 0) {
    findings.push({
      severity: 'critical',
      id: 'policy-no-blocks',
      message: 'Zero block-action gates configured — posture is allow-by-default (policy variance risk).',
    });
  }
  if (manualGates.length === 0 && autoGates.length === 0) {
    findings.push({
      severity: 'critical',
      id: 'policy-empty',
      message: 'No gates loaded from default or auto-promoted stores.',
    });
  }
  return {
    manualCount: manualGates.length,
    autoCount: autoGates.length,
    blockCount: blockManual + blockAuto,
    warnCount: warnManual + warnAuto,
    findings,
  };
}

function assessSensitiveAudit(projectRoot, homeDir, env = {}) {
  const candidates = [
    env.THUMBGATE_GATE_STATS,
    homeDir ? path.join(homeDir, '.thumbgate', 'gate-stats.json') : null,
    path.join(projectRoot, '.thumbgate', 'gate-stats.json'),
    env.THUMBGATE_AUDIT_LOG,
    homeDir ? path.join(homeDir, '.thumbgate', 'audit-trail.jsonl') : null,
    path.join(projectRoot, '.thumbgate', 'audit-trail.jsonl'),
    path.join(projectRoot, '.claude', 'memory', 'feedback', 'feedback-log.jsonl'),
  ].filter(Boolean);

  const present = [];
  let secretDenialSignals = 0;
  let auditEvents = 0;

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    // A path is only counted as evidence once usable content is established.
    // An empty JSONL file or malformed JSON is not evidence, and counting it
    // would suppress the `audit-missing` remediation with zero usable events.
    if (filePath.endsWith('.jsonl')) {
      const { lines, totalLines } = readTailLines(filePath, AUDIT_TAIL_LINES);
      if (totalLines === 0) continue;
      present.push(filePath);
      auditEvents += totalLines;
      for (const line of lines) {
        if (/secret|exfil|credential|deny|blocked|hard.?block/i.test(line)) {
          secretDenialSignals += 1;
        }
      }
    } else if (filePath.endsWith('.json')) {
      const text = readTextIfExists(filePath);
      if (!text) continue;
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        continue; // malformed JSON is not usable evidence
      }
      if (!data || typeof data !== 'object') continue;
      present.push(filePath);
      auditEvents += Number(data.totalBlocked || data.blocked || 0);
      if (/secret|exfil/i.test(text)) secretDenialSignals += 1;
    }
  }

  const findings = [];
  if (present.length === 0) {
    findings.push({
      severity: 'medium',
      id: 'audit-missing',
      message:
        'No local audit/gate-stats surface found — cannot produce sensitive-access evidence pack yet. Run agents with ThumbGate hooks to generate evidence.',
    });
  }

  return {
    surfaces: present,
    auditEvents,
    secretDenialSignals,
    findings,
    hasEvidence: present.length > 0,
  };
}

function assessMcpThumbgate(projectRoot) {
  const mcpPath = path.join(projectRoot, '.mcp.json');
  const data = readJsonIfExists(mcpPath);
  if (!data) {
    return {
      present: false,
      thumbgate: false,
      findings: [
        {
          severity: 'high',
          id: 'mcp-missing',
          message: 'No project .mcp.json — MCP discovery cannot equal callables; unattended agents may skip recall/capture.',
        },
      ],
    };
  }
  if (data.__parseError) {
    return {
      present: true,
      parseError: true,
      thumbgate: false,
      findings: [
        {
          severity: 'high',
          id: 'mcp-parse-error',
          message: '.mcp.json is not valid JSON.',
        },
      ],
    };
  }
  const servers = data.mcpServers || data.servers || {};
  const blob = JSON.stringify(servers).toLowerCase();
  const thumbgate = Boolean(servers.thumbgate) || blob.includes('thumbgate') || blob.includes('server-stdio.js');
  const findings = [];
  if (!thumbgate) {
    findings.push({
      severity: 'high',
      id: 'mcp-no-thumbgate',
      message: 'Project .mcp.json has no thumbgate server entry.',
    });
  }
  return { present: true, thumbgate, findings };
}

function scorePosture(findings) {
  let score = 100;
  for (const f of findings) {
    if (f.severity === 'critical') score -= 25;
    else if (f.severity === 'high') score -= 15;
    else if (f.severity === 'medium') score -= 8;
    else score -= 3;
  }
  if (score < 0) score = 0;
  let band = 'healthy';
  if (score < 40) band = 'critical';
  else if (score < 60) band = 'at_risk';
  else if (score < 80) band = 'needs_attention';
  return { score, band };
}

/**
 * Build the free Agent Security Central report for a project root.
 * @param {object} [options]
 * @param {string} [options.projectRoot]
 * @param {string} [options.homeDir]
 * @param {object} [options.env]
 * @param {string} [options.manualGatesPath]
 * @param {string} [options.autoGatesPath]
 */
function buildSecurityCentralReport(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const homeDir = options.homeDir || process.env.HOME || null;
  const env = options.env || process.env;

  const manualGatesPath =
    options.manualGatesPath || path.join(PKG_ROOT, 'config', 'gates', 'default.json');
  // Pick the first store that actually EXISTS, not the first non-empty string.
  // A plain `||` chain always selects the HOME filename when homeDir is set,
  // so an absent ~/.thumbgate/auto-promoted-gates.json would silently hide the
  // project's real auto-promoted gates from every policy count.
  const projectAutoGatesPath = path.join(projectRoot, '.thumbgate', 'auto-promoted-gates.json');
  const homeAutoGatesPath = homeDir
    ? path.join(homeDir, '.thumbgate', 'auto-promoted-gates.json')
    : null;
  const autoGatesPath =
    options.autoGatesPath ||
    env.THUMBGATE_AUTO_GATES ||
    [homeAutoGatesPath, projectAutoGatesPath].find((p) => p && fs.existsSync(p)) ||
    projectAutoGatesPath;

  const manualGates = loadGatesFromFile(manualGatesPath);
  const autoGates = loadGatesFromFile(autoGatesPath);
  const allGates = [...manualGates, ...autoGates];

  const hooks = assessHookDrift(projectRoot, homeDir);
  const privileged = assessPrivilegedCoverage(allGates);
  const policy = assessPolicyVariance(manualGates, autoGates);
  const audit = assessSensitiveAudit(projectRoot, homeDir, env);
  const mcp = assessMcpThumbgate(projectRoot);

  const findings = [
    ...hooks.findings,
    ...privileged.findings,
    ...policy.findings,
    ...audit.findings,
    ...mcp.findings,
  ];

  const posture = scorePosture(findings);

  return {
    product: 'ThumbGate Agent Security Central',
    free: true,
    freemiumNote:
      'Local posture report is free forever (open source). Optional self-serve Pro is separate and not required for this report.',
    version: PKG_VERSION,
    generatedAt: new Date().toISOString(),
    projectRoot,
    posture,
    dimensions: {
      configurationDrift: {
        drifted: hooks.drifted,
        anyThumbgateHook: hooks.anyThumbgateHook,
        anyGateCheck: hooks.anyGateCheck,
        surfaces: hooks.surfaces,
      },
      privilegedAccess: {
        coveredCount: privileged.covered.length,
        missingCount: privileged.missing.length,
        covered: privileged.covered,
        missing: privileged.missing,
      },
      policyVariance: {
        manualCount: policy.manualCount,
        autoCount: policy.autoCount,
        blockCount: policy.blockCount,
        warnCount: policy.warnCount,
      },
      sensitiveDataAudit: {
        hasEvidence: audit.hasEvidence,
        surfaces: audit.surfaces,
        auditEvents: audit.auditEvents,
        secretDenialSignals: audit.secretDenialSignals,
      },
      mcpWiring: {
        present: mcp.present,
        thumbgate: mcp.thumbgate,
        parseError: Boolean(mcp.parseError),
      },
    },
    findings,
    remediation: buildRemediation(findings),
    commercialCta: {
      // Soft self-serve only — no $499 pilot language (ECI-safe)
      free: 'npx thumbgate init && npx thumbgate security-central',
      softPro: 'https://thumbgate.ai/?utm_source=security_central&utm_medium=cli&utm_campaign=oracle_free_posture&cta_id=security_central_free',
    },
  };
}

function buildRemediation(findings) {
  const steps = [];
  const ids = new Set(findings.map((f) => f.id));
  if (ids.has('hook-drift-missing-thumbgate') || ids.has('hook-drift-weak-marker')) {
    steps.push('Run `npx thumbgate init` (or re-wire PreToolUse hooks) so gate-check runs before every tool call.');
  }
  if (ids.has('mcp-missing') || ids.has('mcp-no-thumbgate')) {
    steps.push('Add a `thumbgate` entry to project `.mcp.json` so discovery matches callable tools.');
  }
  if (ids.has('policy-no-blocks') || ids.has('policy-empty')) {
    steps.push('Load default gates (`config/gates/default.json`) and promote feedback to block rules.');
  }
  if ([...ids].some((id) => id.startsWith('privileged-gap-'))) {
    steps.push('Enable privileged-coverage gates (secret exfil, force-push, spend, deploy) for high-blast tools.');
  }
  if (ids.has('audit-missing')) {
    steps.push('Keep hooks on for a few sessions so gate-stats / audit surfaces accumulate denial evidence.');
  }
  if (steps.length === 0) {
    steps.push('Posture looks solid. Re-run security-central after dependency or hook changes to catch drift.');
  }
  return steps;
}

function formatSecurityCentralReport(report) {
  const lines = [];
  lines.push(`ThumbGate Agent Security Central v${report.version} (FREE local report)`);
  lines.push(`Project: ${report.projectRoot}`);
  lines.push(`Posture: ${report.posture.band} · score ${report.posture.score}/100`);
  lines.push('');
  lines.push('Dimensions (Oracle Security Central → agent control plane):');
  lines.push(
    `  · config drift: ${report.dimensions.configurationDrift.drifted ? 'DRIFTED' : 'ok'} (hooks=${report.dimensions.configurationDrift.anyThumbgateHook ? 'yes' : 'no'})`,
  );
  lines.push(
    `  · privileged coverage: ${report.dimensions.privilegedAccess.coveredCount}/${report.dimensions.privilegedAccess.coveredCount + report.dimensions.privilegedAccess.missingCount}`,
  );
  lines.push(
    `  · policy: ${report.dimensions.policyVariance.blockCount} block / ${report.dimensions.policyVariance.warnCount} warn · manual ${report.dimensions.policyVariance.manualCount} · auto ${report.dimensions.policyVariance.autoCount}`,
  );
  lines.push(
    `  · audit evidence: ${report.dimensions.sensitiveDataAudit.hasEvidence ? 'present' : 'missing'} (events≈${report.dimensions.sensitiveDataAudit.auditEvents})`,
  );
  lines.push(
    `  · MCP thumbgate: ${report.dimensions.mcpWiring.thumbgate ? 'wired' : 'missing'}`,
  );
  if (report.findings.length) {
    lines.push('');
    lines.push(`Findings (${report.findings.length}):`);
    for (const f of report.findings) {
      lines.push(`  [${f.severity}] ${f.id}: ${f.message}`);
    }
  }
  lines.push('');
  lines.push('Remediation:');
  for (const step of report.remediation) {
    lines.push(`  · ${step}`);
  }
  lines.push('');
  lines.push(`Free forever: ${report.commercialCta.free}`);
  lines.push(`Soft product link: ${report.commercialCta.softPro}`);
  return lines.join('\n');
}

function parseArgs(argv) {
  const out = { json: false, projectRoot: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--project' || a === '--cwd') {
      out.projectRoot = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const report = buildSecurityCentralReport({
    projectRoot: args.projectRoot || process.cwd(),
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatSecurityCentralReport(report)}\n`);
  }
  // Exit non-zero only when posture is critically broken — free tool should not scream on warnings alone
  if (report.posture.band === 'critical') process.exitCode = 2;
  else if (report.posture.band === 'at_risk') process.exitCode = 1;
  else process.exitCode = 0;
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  main();
}

module.exports = {
  buildSecurityCentralReport,
  formatSecurityCentralReport,
  assessHookDrift,
  assessPrivilegedCoverage,
  assessPolicyVariance,
  assessSensitiveAudit,
  assessMcpThumbgate,
  scorePosture,
  PRIVILEGED_COVERAGE,
  EXPECTED_HOOK_MARKERS,
  main,
  parseArgs,
};
