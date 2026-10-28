#!/usr/bin/env node
'use strict';

/**
 * Apollo mail (2026-10-28) — FORMAT steal.
 *
 * A prospecting job is one typed action:
 *   free ICP preview, a reason on every row, a cost quote that waits,
 *   and a source label for maps or a directory.
 * Credit spend, lead save, sequence enroll, and email grab deny.
 *
 * Does not call Apollo, spend a credit, save a lead, install an MCP,
 * or fetch a map or a directory.
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCE = 'Apollo email, Connect any agent to Apollo for smarter GTM, 2026-10-28';

const ACTION_POINTS = Object.freeze([
  'preview.list',
  'icp.check',
  'cost.quote',
  'credit.spend',
  'lead.save',
  'sequence.enroll',
  'email.grab',
  'source.name',
]);

const SOURCE_LABELS = Object.freeze(['maps', 'directory', 'stated']);

const AUDIT_CLASS = Object.freeze({
  'preview.list': 'user',
  'icp.check': 'user',
  'source.name': 'user',
  'cost.quote': 'admin',
  'credit.spend': 'admin',
  'lead.save': 'admin',
  'sequence.enroll': 'admin',
  'email.grab': 'admin',
});

const REFUSES = Object.freeze([
  'Upgrade to Professional to grab emails',
  'Spend a credit before approval',
  'Save leads during a preview',
  'Install their MCP',
  'Treat their plan price as a ThumbGate price',
  'Grab an email address',
]);

const RAIL_MAP = Object.freeze([
  {
    apollo: 'Hand the prospecting job to an agent in plain English',
    thumbgate: 'The job is one action point decided before it runs.',
  },
  {
    apollo: 'Preview ten matches and say why each fits the ICP',
    thumbgate: 'preview.list allows only a capped list where every row has an ICP reason.',
  },
  {
    apollo: 'Show a free preview and do not spend a credit or save anything',
    thumbgate: 'creditsSpent must be 0 and saved must be false. lead.save denies.',
  },
  {
    apollo: 'Show the cost and wait for approval before one credit',
    thumbgate: 'cost.quote allows the waiting quote. credit.spend denies, including after approval.',
  },
  {
    apollo: 'Write an email and add the person to a sequence in one step',
    thumbgate: 'sequence.enroll and email.grab deny. A preview row cannot carry an email.',
  },
  {
    apollo: 'Look on maps and niche directories for leads other tools miss',
    thumbgate: 'source.name records maps, directory, or stated. fetch denies.',
  },
]);

function listed(policy, key) {
  const value = policy && policy[key];
  return Array.isArray(value) ? value.map((item) => String(item).trim().toLowerCase()) : [];
}

function hasEmail(value) {
  return String(value || '').includes('@');
}

function auditOf(point, decision, reason) {
  return {
    class: AUDIT_CLASS[point] || 'admin',
    exportable: true,
    trainingUse: false,
    point: point || '',
    decision,
    reason,
  };
}

function deny(point, reason) {
  return {
    decision: 'deny',
    reason,
    audit: auditOf(point, 'deny', reason),
  };
}

function allow(point) {
  return {
    decision: 'allow',
    reason: '',
    audit: auditOf(point, 'allow', ''),
  };
}

function previewCap(policy) {
  if (policy.previewLimit == null || policy.previewLimit === '') return 10;
  const cap = policy.previewLimit;
  if (typeof cap !== 'number' || !Number.isInteger(cap) || cap < 1 || cap > 10) return null;
  return cap;
}

function creditsAreFree(action) {
  if (!Object.prototype.hasOwnProperty.call(action, 'creditsSpent')) return true;
  return action.creditsSpent === 0;
}

function leadReason(lead) {
  if (!lead || typeof lead !== 'object' || Array.isArray(lead)) return 'missing-lead';
  const label = String(lead.label || '').trim();
  const reason = String(lead.icpReason || '').trim();
  if (!label) return 'missing-lead-label';
  if (!reason) return 'missing-icp-reason';
  if (hasEmail(label) || hasEmail(reason) || String(lead.email || '').trim()) return 'email-on-preview';
  return '';
}

function quoteIsWaiting(action) {
  if (typeof action.costCredits !== 'number' || !Number.isFinite(action.costCredits) || action.costCredits < 0) {
    return 'cost-not-shown';
  }
  if (action.costShown !== true) return 'cost-not-shown';
  if (action.approved === true) return 'quote-waits';
  if (!creditsAreFree(action)) return 'credits-before-preview';
  return '';
}

function evaluatePreview(policy, action) {
  const point = 'preview.list';
  const cap = previewCap(policy);
  if (cap == null) return deny(point, 'bad-preview-limit');
  if (action.saved) return deny(point, 'preview-does-not-save');
  if (action.enroll === true) return deny(point, 'sequence-stays-outside');
  if (action.fetch === true) return deny(point, 'no-fetch');
  if (!creditsAreFree(action)) return deny(point, 'credits-before-preview');
  if (!Array.isArray(action.leads) || action.leads.length < 1) return deny(point, 'missing-leads');
  if (action.leads.length > cap) return deny(point, 'preview-cap');
  for (const lead of action.leads) {
    const reason = leadReason(lead);
    if (reason) return deny(point, reason);
  }
  return allow(point);
}

function evaluateSource(policy, action) {
  const point = 'source.name';
  if (action.fetch === true) return deny(point, 'no-fetch');
  const sources = listed(policy, 'sources').filter((item) => SOURCE_LABELS.includes(item));
  if (sources.length === 0) return deny(point, 'unlisted-source');
  const source = String(action.source || '').trim().toLowerCase();
  if (!SOURCE_LABELS.includes(source)) return deny(point, 'unknown-source');
  if (!sources.includes(source)) return deny(point, 'unlisted-source');
  return allow(point);
}

function evaluateApolloGtmPreview(policy, action) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return deny(action && action.point, 'missing-policy');
  }
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    return deny('', 'missing-action');
  }
  const point = String(action.point || '');
  if (!ACTION_POINTS.includes(point)) return deny(point, 'unknown-action');
  if (!String(policy.org || '').trim()) return deny(point, 'missing-org');
  if (!String(policy.icp || '').trim()) return deny(point, 'missing-icp');

  if (point === 'preview.list') return evaluatePreview(policy, action);
  if (point === 'icp.check') {
    const reason = String(action.reason || '').trim();
    if (!reason) return deny(point, 'missing-icp-reason');
    if (hasEmail(reason) || String(action.email || '').trim()) return deny(point, 'email-on-preview');
    if (action.saved) return deny(point, 'preview-does-not-save');
    return allow(point);
  }
  if (point === 'cost.quote') {
    const reason = quoteIsWaiting(action);
    return reason ? deny(point, reason) : allow(point);
  }
  if (point === 'credit.spend') {
    const waiting = quoteIsWaiting({ ...action, approved: false });
    if (waiting || action.approved !== true) return deny(point, 'approval-required');
    return deny(point, 'spend-stays-outside');
  }
  if (point === 'lead.save') return deny(point, 'preview-does-not-save');
  if (point === 'sequence.enroll') return deny(point, 'sequence-stays-outside');
  if (point === 'email.grab') return deny(point, 'email-grab-refused');
  return evaluateSource(policy, action);
}

function triggeredRefusals(text) {
  const hits = [];
  const body = String(text || '');
  if (/\bupgrade to professional\b/i.test(body)) hits.push('Upgrade to Professional to grab emails');
  if (/\bspend (?:a |any )?credits?\b/i.test(body) && !/\b(?:do not|don't|dont) spend\b/i.test(body)) {
    hits.push('Spend a credit before approval');
  }
  if (/\bsave (?:the )?(?:leads?|contacts?)\b/i.test(body) && !/\b(?:do not|don't|dont) save\b/i.test(body)) {
    hits.push('Save leads during a preview');
  }
  if (/\binstall (?:their |the )?mcp\b/i.test(body)) hits.push('Install their MCP');
  if (/\btheir plan price\b/i.test(body) && /\bthumbgate\b/i.test(body)) {
    hits.push('Treat their plan price as a ThumbGate price');
  }
  if (/\bgrab (?:their |an )?emails?\b/i.test(body)) hits.push('Grab an email address');
  return [...new Set(hits)];
}

function parseJson(value, label, findings) {
  if (value == null || value === '') return null;
  try {
    return JSON.parse(value);
  } catch {
    findings.push({ gateId: 'apollo-gtm-preview', severity: 'fail', message: `${label} is not JSON` });
    return null;
  }
}

function readJsonFile(filePath, label, findings) {
  if (!filePath) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    findings.push({
      gateId: 'apollo-gtm-preview',
      severity: 'fail',
      message: `${label} is not readable JSON`,
    });
    return null;
  }
}

function buildApolloGtmPreviewReport(options = {}) {
  const mapOnly = options.mapOnly === true || options.mapOnly === 'true';
  const findings = [];
  const text = [options.claim, options.command, options.text].filter(Boolean).join('\n');
  if (!mapOnly && text) {
    for (const hit of triggeredRefusals(text)) {
      findings.push({ gateId: 'apollo-refuse', severity: 'fail', message: hit });
    }
  }

  let evaluation = null;
  if (!mapOnly) {
    const policy = options.policy
      || parseJson(options.policyJson, 'policy', findings)
      || readJsonFile(options.policyPath, 'policy', findings);
    const action = options.action
      || parseJson(options.actionJson, 'action', findings)
      || readJsonFile(options.actionPath, 'action', findings);
    if (policy || action) {
      evaluation = evaluateApolloGtmPreview(policy, action);
      if (evaluation.decision !== 'allow') {
        findings.push({
          gateId: 'apollo-gtm-preview',
          severity: 'fail',
          message: evaluation.reason,
        });
      }
    }
  }

  const failCount = findings.filter((item) => item.severity === 'fail').length;
  return {
    name: 'thumbgate-apollo-gtm-preview',
    ok: failCount === 0,
    status: failCount ? 'fail' : 'ready',
    source: SOURCE,
    refuses: REFUSES,
    actionPoints: ACTION_POINTS,
    sourceLabels: SOURCE_LABELS,
    map: RAIL_MAP,
    evaluation,
    findings,
    summary: { findingCount: findings.length, failCount },
    exampleCommand: 'npx thumbgate apollo-gtm-preview --json --map-only',
    disclaimer: 'FORMAT steal from the 2026-10-28 Apollo mail. Not affiliated. Does not call Apollo, spend a credit, save a lead, or grab an email.',
  };
}

function formatApolloGtmPreviewReport(report) {
  const lines = [
    'Apollo GTM Preview',
    `Status : ${report.status}`,
    `Source : ${report.source}`,
    `Findings: ${report.summary.findingCount} (fail=${report.summary.failCount})`,
    '',
    'Rail map:',
  ];
  for (const row of report.map) {
    lines.push(`- ${row.apollo}`);
    lines.push(`  ThumbGate: ${row.thumbgate}`);
  }
  if (report.evaluation) {
    lines.push('', `Decision: ${report.evaluation.decision} ${report.evaluation.reason}`.trim());
    lines.push(`Audit: ${report.evaluation.audit.class} exportable=${report.evaluation.audit.exportable} trainingUse=${report.evaluation.audit.trainingUse}`);
  }
  for (const finding of report.findings) {
    lines.push(`- [${finding.severity}] ${finding.gateId}: ${finding.message}`);
  }
  lines.push('', report.disclaimer, '');
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const [rawKey, inline] = arg.slice(2).split(/=(.*)/s, 2);
    const key = rawKey.replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (inline !== undefined) args[key] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      args[key] = argv[index + 1];
      index += 1;
    } else args[key] = true;
  }
  const report = buildApolloGtmPreviewReport({
    mapOnly: args.mapOnly === true,
    claim: args.claim || '',
    policyJson: args.policyJson || '',
    actionJson: args.actionJson || '',
    policyPath: args.policy || '',
    actionPath: args.action || '',
  });
  if (args.json === true) console.log(JSON.stringify(report, null, 2));
  else process.stdout.write(formatApolloGtmPreviewReport(report));
  if (report.status === 'fail') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}

module.exports = {
  ACTION_POINTS,
  RAIL_MAP,
  REFUSES,
  SOURCE_LABELS,
  buildApolloGtmPreviewReport,
  evaluateApolloGtmPreview,
  formatApolloGtmPreviewReport,
  triggeredRefusals,
};
