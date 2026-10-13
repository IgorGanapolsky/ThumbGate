#!/usr/bin/env node
'use strict';

/**
 * omp.sh coordination FORMAT on the ThumbGate checkout lease.
 *
 * Sources:
 *   https://omp.sh/docs/sessions
 *   https://omp.sh/docs/subagents
 *   https://omp.sh/docs/collab
 *
 * Transfers:
 *   1. /new keeps the previous saved session. /clear only resets context.
 *   2. A handoff is current state and the next step, not a live shared prompt.
 *   3. A child does not inherit the parent transcript and writes disjoint files.
 *   4. Observation defaults to view-only. A full-control link can drive the host.
 *   5. Crash recovery must not invent a result for an interrupted tool call.
 *   6. The model is a named id. Auto and Fast are refused. One agent. No install.
 *
 * Does not run the omp installer. Does not install @oh-my-pi/pi-coding-agent.
 * Does not open wss://my.omp.sh. Orchestra OMP is a different system.
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_URL = 'https://omp.sh/docs/sessions';
const GATE_ID = 'refuse-omp-install-collab';

const INSTALL_RE = /curl\s+https:\/\/omp\.sh\/install|https:\/\/omp\.sh\/install|@oh-my-pi|pi-coding-agent/i;
const WRITE_LINK_RE = /wss:\/\/my\.omp\.sh|bearer write token|full-control collab|full-control link|share\s*[:=]\s*full-control/i;
const UNNAMED_RE = /^(auto|fast|default|balanced)$/i;
const NAMED_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}(?:\/[A-Za-z0-9][A-Za-z0-9._:-]{0,80})?$/;

const RAIL_MAP = Object.freeze([
  { omp: '/new keeps the old saved session; /clear resets context in place', thumbgate: 'A handoff session is new. clear fails closed.' },
  { omp: 'Handoff is current state and next steps (JSONL editable, HTML read-only)', thumbgate: 'Saved state-and-next file on the checkout lease.' },
  { omp: 'Children do not inherit the parent conversation; writes are file-disjoint', thumbgate: 'The parent integrates. Overlapping owner paths fail.' },
  { omp: 'Collab host stays authoritative; default share is view-only', thumbgate: 'Observation is view-only. Host stays local.' },
  { omp: 'Crash recovery continues completed entries and does not invent an interrupted result', thumbgate: 'An interrupted tool entry that also carries a result fails.' },
  { omp: 'Named provider/model-id; Auto and Fast are not a route', thumbgate: 'Named model. Fast off. Agents one. Install none.' },
  { omp: 'Diagnose failure composition before prompt bloat; named-model escalation at ceiling (arXiv:2610.11655)', thumbgate: 'When content failures dominate (>=80%) and process failures are low, escalate named model tier instead of bloating AGENTS.md/prompts.' },
]);

function normalizeBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function asArray(value) {
  if (value == null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function finding(id, message) {
  return { id, severity: 'fail', gateId: GATE_ID, message };
}

function dedupe(findings) {
  const seen = new Set();
  const out = [];
  for (const item of findings) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function isNamedModel(value) {
  const text = String(value || '').trim();
  if (!text || UNNAMED_RE.test(text)) return false;
  return NAMED_RE.test(text);
}

function agentsAllowed(value) {
  if (value === 1) return true;
  const text = String(value == null ? '' : value).trim().toLowerCase();
  return text === '1' || text === 'one';
}

function normPath(value, root) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const rootDir = (typeof root === 'string' && root) ? root : process.cwd();
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(rootDir, raw);
  const rel = path.relative(rootDir, resolved);
  const target = (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) ? rel : resolved;
  let text = target.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
  if (text.length > 1) text = text.replace(/\/$/, '');
  return text;
}

function pathsOverlap(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  return `${right}/`.startsWith(`${left}/`) || `${left}/`.startsWith(`${right}/`);
}

function collectOwners(writes) {
  const owners = [];
  for (const row of asArray(writes)) {
    if (typeof row === 'string') {
      const one = normPath(row);
      if (one) owners.push({ owner: 'unknown', paths: [one] });
      continue;
    }
    if (!row || typeof row !== 'object') continue;
    const paths = asArray(row.paths || row.path || row.files).map((p) => normPath(p)).filter(Boolean);
    owners.push({ owner: String(row.owner || row.agent || 'unknown'), paths });
  }
  return owners;
}

function firstOverlap(writes) {
  const owners = collectOwners(writes);
  for (let i = 0; i < owners.length; i += 1) {
    for (let j = i + 1; j < owners.length; j += 1) {
      if (owners[i].owner === owners[j].owner) continue;
      for (const left of owners[i].paths) {
        for (const right of owners[j].paths) {
          if (pathsOverlap(left, right)) {
            return { left: owners[i].owner, right: owners[j].owner, path: left === right ? left : `${left} ~ ${right}` };
          }
        }
      }
    }
  }
  return null;
}

function isInterrupted(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.interrupted === true) return true;
  const status = String(entry.status || entry.state || entry.phase || '').toLowerCase();
  return /interrupt|incomplete|crash|cancel|abort/.test(status);
}

function hasInventedResult(entry) {
  if (entry.invented === true) return true;
  const hasResult = Object.prototype.hasOwnProperty.call(entry, 'result') || entry.output != null;
  if (!hasResult) return false;
  const result = Object.prototype.hasOwnProperty.call(entry, 'result') ? entry.result : entry.output;
  return result != null && result !== '';
}

function parseMarkdownHandoff(text) {
  const doc = {};
  const keys = {
    model: 'model',
    route: 'route',
    fast: 'fast',
    session: 'session',
    think: 'think',
    agents: 'agents',
    install: 'install',
    host: 'host',
    share: 'share',
    state: 'state',
    next: 'next',
  };
  const writes = [];
  let inWrites = false;
  for (const line of String(text).split(/\r?\n/)) {
    if (/^writes:\s*$/i.test(line.trim())) {
      inWrites = true;
      continue;
    }
    if (inWrites) {
      if (!line.trim()) {
        if (writes.length) inWrites = false;
        continue;
      }
      if (!/^\s*[-*]/.test(line)) {
        inWrites = false;
      } else {
        const item = line.replace(/^\s*[-*]\s*/, '');
        const match = /^([^:]+):\s*(.+)$/.exec(item);
        if (match) {
          writes.push({
            owner: match[1].trim(),
            paths: match[2].split(',').map((part) => part.trim()).filter(Boolean),
          });
        }
        continue;
      }
    }
    const match = /^([A-Za-z][A-Za-z ]{0,40}):\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const key = match[1].toLowerCase().replace(/\s+/g, '');
    if (keys[key]) doc[keys[key]] = match[2].trim();
  }
  if (writes.length) doc.writes = writes;
  return doc;
}

function loadHandoff(value) {
  if (value == null || value === '' || value === true) return null;
  if (typeof value === 'object') return value;
  const text = String(value).trim();
  if (!text) return null;
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? { crash: parsed } : parsed;
    } catch {
      return { parseError: true };
    }
  }
  if (!fs.existsSync(text)) return { missing: true };
  let body = '';
  try {
    body = fs.readFileSync(text, 'utf8');
  } catch {
    return { missing: true };
  }
  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? { crash: parsed, raw: body } : { ...parsed, raw: body };
    } catch {
      return { parseError: true, raw: body };
    }
  }
  return { ...parseMarkdownHandoff(body), raw: body };
}

function looksLikeHandoff(text) {
  return /(?:^|\n)\s*model\s*:/i.test(String(text || '')) && /(?:^|\n)\s*session\s*:/i.test(String(text || ''));
}

function scanText(text, findings) {
  const body = String(text || '');
  if (!body.trim()) return;
  if (INSTALL_RE.test(body)) {
    findings.push(finding('omp_install', 'Refused the omp installer, @oh-my-pi, and pi-coding-agent. Install stays none.'));
  }
  if (WRITE_LINK_RE.test(body)) {
    findings.push(finding('host_write_link', 'Refused a full-control collab link and wss://my.omp.sh. Share stays view-only on the local host.'));
  }
  if (/\b(?:model|route)\s*[:=]\s*(auto|fast|default|balanced)\b/i.test(body)) {
    findings.push(finding('unnamed_model', 'Model must be a named id such as grok-4.7 or provider/model-id. Auto, Fast, default, and balanced are refused.'));
  }
  if (/\bfast\s*[:=]\s*(on|true|yes|1)\b/i.test(body)) {
    findings.push(finding('fast_default', 'Fast stays off.'));
  }
  if (/(?:^|\s)\/clear\b|\bsession\s*[:=]\s*\/?clear\b/i.test(body)) {
    findings.push(finding('clear_discards_saved_session', 'A new session keeps the previous saved session. /clear only resets context and is refused on a handoff.'));
  }
  const agentsMatch = body.match(/\bagents\s*[:=]\s*([^\s,]+)/i);
  if (agentsMatch) {
    const token = agentsMatch[1].toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (token !== 'one' && token !== '1') {
      findings.push(finding('agent_fanout', 'Agents stays one. omp maxConcurrency 32 is refused.'));
    }
  }
  const concurrency = body.match(/\bmaxConcurrency\s*[:=]?\s*(\d+)/i);
  if (concurrency && Number(concurrency[1]) > 1) {
    findings.push(finding('agent_fanout', 'Agents stays one. omp maxConcurrency 32 is refused.'));
  }
  if (/\b(?:auto[- ]?rule|prompt[- ]?rule|add[- ]?rule)\b/i.test(body) && /\b(?:content[- ]?failure|reasoning[- ]?failure|harness[- ]?ceiling)\b/i.test(body) && !/model|weight|lora|distill/i.test(body)) {
    findings.push(finding('harness_ceiling_prompt_bloat', 'Harness ceiling reached: content/reasoning failures cannot be resolved with prompt rules. Escalate named model route or train weights (arXiv:2610.11655).'));
  }
}

function validateHandoff(doc, findings) {
  if (!isNamedModel(doc.model)) {
    findings.push(finding('unnamed_model', 'Handoff model must be a named id such as grok-4.7 or provider/model-id.'));
  }
  if (doc.route != null && String(doc.route).trim().toLowerCase() !== 'named') {
    findings.push(finding('unnamed_model', 'Route stays named.'));
  }
  if (normalizeBoolean(doc.fast)) {
    findings.push(finding('fast_default', 'Fast stays off.'));
  }
  const session = String(doc.session || '').trim().toLowerCase();
  if (session !== 'new') {
    findings.push(finding('clear_discards_saved_session', 'Handoff session must be new so the previous saved session stays intact.'));
  }
  const think = doc.think == null || doc.think === '' ? 'off' : String(doc.think).trim().toLowerCase();
  if (think !== 'off' && think !== 'one-turn') {
    findings.push(finding('think_not_bounded', 'Think is off, or one-turn when a single expensive pass is required.'));
  }
  if (!agentsAllowed(doc.agents)) {
    findings.push(finding('agent_fanout', 'Agents stays one. A handoff that fans out above one agent fails closed.'));
  }
  if (String(doc.install == null ? '' : doc.install).trim().toLowerCase() !== 'none') {
    findings.push(finding('omp_install', 'Install must be none. The omp binary stays uninstalled.'));
  }
  const host = String(doc.host == null ? '' : doc.host).trim().toLowerCase();
  if (host !== 'local' || /my\.omp\.sh|relay/.test(host)) {
    findings.push(finding('relay_host', 'Host stays local. A relay or my.omp.sh room is refused.'));
  }
  const share = doc.share == null || doc.share === '' ? 'view-only' : String(doc.share).trim().toLowerCase();
  if (share !== 'view-only') {
    findings.push(finding('host_write_link', 'Share stays view-only. Full control would let a link drive the host.'));
  }
  if (!String(doc.state || '').trim() || !String(doc.next || '').trim()) {
    findings.push(finding('handoff_incomplete', 'Handoff needs state and next. It is a saved artifact, not a live channel.'));
  }
  const overlap = firstOverlap(doc.writes);
  if (overlap) {
    findings.push(finding('overlapping_writers', `Write paths overlap between ${overlap.left} and ${overlap.right} (${overlap.path}). The parent integrates disjoint files.`));
  }
  for (const entry of asArray(doc.crash)) {
    if (isInterrupted(entry) && hasInventedResult(entry)) {
      findings.push(finding('invented_interrupted_result', 'An interrupted tool call must not carry an invented result. Continue completed entries only.'));
      break;
    }
  }
  if (doc.failureComposition && typeof doc.failureComposition === 'object') {
    const p = Number(doc.failureComposition.processFailureRate || 0);
    const c = Number(doc.failureComposition.contentFailureRate || 0);
    if (c >= 0.8 && p <= 0.2 && doc.action === 'add_prompt_rule') {
      findings.push(finding('harness_ceiling_prompt_bloat', 'Content failures dominate (>=80%). Do not add prompt rules; escalate named model route or train weights (arXiv:2610.11655).'));
    }
  }
}

function buildOmpCoordinationHonestyReport(rawOptions = {}) {
  const options = rawOptions || {};
  const mapOnly = normalizeBoolean(options['map-only'] || options.mapOnly);
  const claim = options.claim == null ? '' : String(options.claim);
  const handoffValue = options.handoff == null ? options['handoff-json'] : options.handoff;
  const findings = [];
  let handoff = null;

  if (handoffValue != null && handoffValue !== '' && handoffValue !== false) {
    handoff = loadHandoff(handoffValue);
    if (!handoff || handoff.parseError || handoff.missing) {
      findings.push(finding('handoff_unreadable', 'Handoff did not parse. Pass a JSON object, a markdown header, or a readable file path.'));
      handoff = null;
    }
  } else if (looksLikeHandoff(claim)) {
    handoff = parseMarkdownHandoff(claim);
  }

  if (handoff) {
    validateHandoff(handoff, findings);
    scanText(handoff.raw || '', findings);
    scanText(JSON.stringify(handoff), findings);
  }
  if (!handoff || claim !== (handoff && handoff.raw)) {
    scanText(claim, findings);
  }

  const deduped = dedupe(findings);
  const failCount = deduped.filter((item) => item.severity === 'fail').length;
  const status = failCount > 0 ? 'fail' : 'ready';
  return {
    name: 'thumbgate-omp-coordination-honesty',
    source: SOURCE_URL,
    sourceDocs: [
      'https://omp.sh/docs/sessions',
      'https://omp.sh/docs/subagents',
      'https://omp.sh/docs/collab',
    ],
    status,
    ok: status === 'ready',
    mapOnly,
    model: handoff && handoff.model ? handoff.model : null,
    session: handoff && handoff.session ? handoff.session : null,
    map: RAIL_MAP,
    findings: deduped,
    summary: { failCount, findingCount: deduped.length },
    recommendedGates: deduped.length ? [GATE_ID] : [],
    nextActions: [
      'Keep the checkout lease. A new session leaves the previous saved session in place.',
      'Write a handoff with state, next, a named model, agents one, install none, and host local.',
      'Give each child disjoint files. The parent integrates. Children do not receive the parent transcript.',
      'Share observation as view-only. Do not open a link that can prompt or interrupt the host.',
      'Do not install omp. Orchestra OMP is a different system and stays refused.',
    ],
    exampleCommand: 'npx thumbgate omp-coordination-honesty --json --map-only',
    disclaimer: 'omp.sh coordination FORMAT on the ThumbGate checkout lease. Does not install omp. Not an oh-my-pi runtime.',
  };
}

function formatOmpCoordinationHonestyReport(report) {
  const lines = [
    '',
    'ThumbGate omp Coordination-Honesty Doctor',
    '-'.repeat(48),
    `Status : ${report.status}`,
    `Model  : ${report.model || '(map only)'}`,
    `Session: ${report.session || '(none)'}`,
    `Source : ${report.source}`,
    `Findings: ${report.summary.findingCount} (fail=${report.summary.failCount})`,
    '',
    'Rail map:',
  ];
  for (const row of report.map) lines.push(`  - ${row.omp} → ${row.thumbgate}`);
  if (report.findings.length) {
    lines.push('', 'Findings:');
    for (const item of report.findings) {
      lines.push(`  - [${item.severity}] ${item.id} [${item.gateId}]`);
      lines.push(`    ${item.message}`);
    }
  }
  lines.push('', 'Next actions:');
  for (const action of report.nextActions) lines.push(`  - ${action}`);
  lines.push('', `Example: ${report.exampleCommand}`);
  lines.push(`Note: ${report.disclaimer}`, '');
  return `${lines.join('\n')}\n`;
}

function parseCliArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--json') { options.json = true; continue; }
    if (arg === '--strict') { options.strict = true; continue; }
    if (arg === '--map-only') { options['map-only'] = true; continue; }
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!match) continue;
    options[match[1]] = match[2] === undefined ? true : match[2];
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/omp-coordination-honesty.js [flags]

Flags:
  --claim=TEXT       Claim or markdown header to audit
  --handoff=PATH     JSON or markdown handoff file
  --map-only         Print the omp → ThumbGate rail map
  --json --strict

Source: ${SOURCE_URL}
Does not install omp.
`);
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  const report = buildOmpCoordinationHonestyReport(args);
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(formatOmpCoordinationHonestyReport(report));
  if (args.strict && report.status !== 'ready') return 1;
  if (report.status === 'fail') return 1;
  return 0;
}
function diagnoseFailureIntervention({ processFailures = 0, contentFailures = 0, totalFailures = 0 } = {}) {
  const total = totalFailures || (processFailures + contentFailures);
  if (total === 0) return { ceilingHit: false, intervention: 'none', rationale: 'No failures recorded.' };
  const pRate = processFailures / total;
  const cRate = contentFailures / total;
  if (total >= 3 && cRate >= 0.8 && pRate <= 0.2) {
    return {
      ceilingHit: true,
      intervention: 'model_tier_escalation_or_weight_training',
      rationale: `Content failures dominate (${(cRate * 100).toFixed(1)}%). Harness evolution ceiling hit per arXiv:2610.11655. Escalate named model or train weights instead of adding prompt rules.`,
    };
  }
  if (pRate >= 0.2) {
    return {
      ceilingHit: false,
      intervention: 'harness_evolution',
      rationale: `Process failures present (${(pRate * 100).toFixed(1)}%). Harness evolution has high ROI.`,
    };
  }
  return {
    ceilingHit: false,
    intervention: 'monitor',
    rationale: 'Failure distribution inconclusive.',
  };
}

module.exports = {
  SOURCE_URL,
  GATE_ID,
  RAIL_MAP,
  buildOmpCoordinationHonestyReport,
  formatOmpCoordinationHonestyReport,
  diagnoseFailureIntervention,
  runCli,
};

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  process.exitCode = runCli();
}
