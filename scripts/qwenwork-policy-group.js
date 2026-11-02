#!/usr/bin/env node
'use strict';

/**
 * QwenWork Enterprise Premium newsletter (2026-10-28) — FORMAT steal.
 *
 * One org policy group decides at the action:
 *   model catalog, usage limit, marketplace installs (skill, connector, suite),
 *   trusted devices, trusted networks, sensitive words, and IM channels.
 * Audit is admin, user, or ai, and it is exportable.
 * Training use stays false unless the action is BYOK and the policy allows it.
 *
 * Does not buy seats, call Alibaba Cloud, install DingTalk, WeCom, or Feishu,
 * or ship a white-label app.
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCE = 'Alibaba Cloud newsletter, QwenWork Enterprise Premium, 2026-10-28';

const ACTION_POINTS = Object.freeze([
  'model.invoke',
  'skill.install',
  'connector.install',
  'suite.install',
  'device.join',
  'usage.record',
  'im.send',
  'brand.apply',
]);

const IDENTITY_SLOTS = Object.freeze(['entra', 'ldap', 'scim', 'saml', 'oidc']);

const REFUSED_DIRECTORIES = Object.freeze(['dingtalk', 'wecom', 'feishu']);

const AUDIT_CLASS = Object.freeze({
  'skill.install': 'admin',
  'connector.install': 'admin',
  'suite.install': 'admin',
  'brand.apply': 'admin',
  'device.join': 'user',
  'usage.record': 'user',
  'model.invoke': 'ai',
  'im.send': 'ai',
});

const REFUSES = Object.freeze([
  'Buy Enterprise Premium seats',
  'Buy Enterprise Premium credits',
  'Call Alibaba Cloud',
  'Install DingTalk, WeCom, or Feishu',
  'Treat their seat price as a ThumbGate price',
  'Ship a white-label standalone app',
]);

const RAIL_MAP = Object.freeze([
  {
    qwenwork: 'Policy at the action: trusted networks, trusted devices, sensitive words, IM channels',
    thumbgate: 'PreToolUse denies the action before it runs. Empty allowlists deny.',
  },
  {
    qwenwork: 'Dedicated org access, not a second Alibaba product',
    thumbgate: 'policy.org is required. No new vendor account.',
  },
  {
    qwenwork: 'Directory and SSO named as Entra, LDAP/AD, SCIM, SAML, and OIDC',
    thumbgate: 'directory slot is entra, ldap, scim, saml, or oidc',
  },
  {
    qwenwork: 'One policy group covers the model catalog, usage limits, and marketplace installs',
    thumbgate: 'models, usageLimit, skills, connectors, and suites are allowlists',
  },
  {
    qwenwork: 'Admin, user, and AI interaction logs, exportable, training off except BYOK',
    thumbgate: 'audit.class is admin, user, or ai. exportable is true. trainingUse requires BYOK plus allowByokTraining.',
  },
  {
    qwenwork: 'Custom branding is hosted configuration',
    thumbgate: 'brand.apply records a branding label. clone and packageApp deny.',
  },
]);

function listed(policy, key) {
  const value = policy && policy[key];
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function hasWord(text, words) {
  const hay = String(text || '').toLowerCase();
  for (const word of words) {
    const needle = String(word || '').trim().toLowerCase();
    if (needle && hay.includes(needle)) return needle;
  }
  return '';
}

function numberOrZero(value) {
  if (value == null || value === '') return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function trainingUse(policy, action, allowed) {
  return allowed === true
    && action
    && action.byok === true
    && policy
    && policy.allowByokTraining === true;
}

function auditOf(point, decision, reason, policy, action, allowed) {
  return {
    class: AUDIT_CLASS[point] || 'admin',
    exportable: true,
    trainingUse: trainingUse(policy, action, allowed),
    point: point || '',
    decision,
    reason,
  };
}

function deny(point, reason, policy, action) {
  return {
    decision: 'deny',
    reason,
    audit: auditOf(point, 'deny', reason, policy || {}, action || {}, false),
  };
}

function allow(point, policy, action) {
  return {
    decision: 'allow',
    reason: '',
    audit: auditOf(point, 'allow', '', policy, action, true),
  };
}

function deviceGate(policy, action) {
  const trusted = listed(policy, 'trustedDevices');
  const device = String(action.device || '');
  if (trusted.length === 0 || !device || !trusted.includes(device)) return 'untrusted-device';
  return '';
}

function networkGate(policy, action) {
  const trusted = listed(policy, 'trustedNetworks');
  const network = String(action.network || '');
  if (trusted.length === 0 || !network || !trusted.includes(network)) return 'untrusted-network';
  return '';
}

function overLimit(policy, action, recording) {
  const limit = policy.usageLimit;
  if (recording) {
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) return true;
    const used = numberOrZero(action.used);
    const units = action.units;
    if (used == null) return true;
    if (typeof units !== 'number' || !Number.isFinite(units) || units < 0) return true;
    return used + units > limit;
  }
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return false;
  const used = numberOrZero(action.used);
  if (used == null) return true;
  return used >= limit;
}

function membership(policy, action, point, field, listKey, reason) {
  const id = String(action[field] || '');
  if (!id || !listed(policy, listKey).includes(id)) return deny(point, reason, policy, action);
  const deviceReason = deviceGate(policy, action);
  if (deviceReason) return deny(point, deviceReason, policy, action);
  return allow(point, policy, action);
}

function directoryGate(policy, point, action) {
  if (policy.directory == null || policy.directory === '') return '';
  const directory = String(policy.directory).trim().toLowerCase();
  if (REFUSED_DIRECTORIES.includes(directory)) return 'refused-directory';
  if (!IDENTITY_SLOTS.includes(directory)) return 'unknown-directory';
  return '';
}

function evaluatePolicyGroup(policy, action) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return deny(action && action.point, 'missing-policy', {}, action);
  }
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    return deny('', 'missing-action', policy, {});
  }
  const point = String(action.point || '');
  if (!ACTION_POINTS.includes(point)) return deny(point, 'unknown-action', policy, action);
  if (!String(policy.org || '').trim()) return deny(point, 'missing-org', policy, action);
  const directoryReason = directoryGate(policy, point, action);
  if (directoryReason) return deny(point, directoryReason, policy, action);

  const sensitive = hasWord(action.text, listed(policy, 'sensitiveWords'));
  if (sensitive && (point === 'model.invoke' || point === 'im.send')) {
    return deny(point, 'sensitive-word', policy, action);
  }

  if (point === 'model.invoke') {
    const model = String(action.model || '');
    if (!model || !listed(policy, 'models').includes(model)) {
      return deny(point, 'unapproved-model', policy, action);
    }
    const deviceReason = deviceGate(policy, action);
    if (deviceReason) return deny(point, deviceReason, policy, action);
    const networkReason = networkGate(policy, action);
    if (networkReason) return deny(point, networkReason, policy, action);
    if (overLimit(policy, action, false)) return deny(point, 'usage-limit', policy, action);
    return allow(point, policy, action);
  }
  if (point === 'skill.install') {
    return membership(policy, action, point, 'skill', 'skills', 'unapproved-skill');
  }
  if (point === 'connector.install') {
    return membership(policy, action, point, 'connector', 'connectors', 'unapproved-connector');
  }
  if (point === 'suite.install') {
    return membership(policy, action, point, 'suite', 'suites', 'unapproved-suite');
  }
  if (point === 'device.join') {
    const device = String(action.device || '');
    if (!device || !listed(policy, 'trustedDevices').includes(device)) {
      return deny(point, 'untrusted-device', policy, action);
    }
    return allow(point, policy, action);
  }
  if (point === 'usage.record') {
    if (overLimit(policy, action, true)) return deny(point, 'usage-limit', policy, action);
    return allow(point, policy, action);
  }
  if (point === 'im.send') {
    const channel = String(action.channel || '');
    if (!channel || !listed(policy, 'imChannels').includes(channel)) {
      return deny(point, 'unknown-im-channel', policy, action);
    }
    const deviceReason = deviceGate(policy, action);
    if (deviceReason) return deny(point, deviceReason, policy, action);
    const networkReason = networkGate(policy, action);
    if (networkReason) return deny(point, networkReason, policy, action);
    return allow(point, policy, action);
  }
  if (action.clone === true || action.packageApp === true) {
    return deny(point, 'white-label-clone', policy, action);
  }
  if (!String(policy.branding || '').trim()) return deny(point, 'missing-branding', policy, action);
  return allow(point, policy, action);
}

function triggeredRefusals(text) {
  const hits = [];
  if (/\bbuy\b/i.test(text) && /\b(seat|seats|credits?\s+pack)\b/i.test(text)) {
    hits.push('Buy Enterprise Premium seats');
  }
  if (/\balibaba\s*cloud\b|\balibabacloud\b/i.test(text) && /\b(call|open|sign\s*in|account|api|fetch|request)\b/i.test(text)) {
    hits.push('Call Alibaba Cloud');
  }
  if (/\b(dingtalk|wecom|feishu)\b/i.test(text) && /\b(install|adopt|connect|sync)\b/i.test(text)) {
    hits.push('Install DingTalk, WeCom, or Feishu');
  }
  if (/\b(seat price|their price|credits pack)\b/i.test(text) && /\bthumbgate\b/i.test(text)) {
    hits.push('Treat their seat price as a ThumbGate price');
  }
  if (/\b(white-?label|standalone app)\b/i.test(text) && /\b(clone|package|ship)\b/i.test(text)) {
    hits.push('Ship a white-label standalone app');
  }
  return [...new Set(hits)];
}

function parseJson(value, label, findings) {
  if (value == null || value === '') return null;
  try {
    return JSON.parse(value);
  } catch {
    findings.push({
      gateId: 'policy-group',
      severity: 'fail',
      message: `${label} is not JSON`,
    });
    return null;
  }
}

function readJsonFile(filePath, label, findings) {
  if (!filePath) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    findings.push({
      gateId: 'policy-group',
      severity: 'fail',
      message: `${label} is not readable JSON`,
    });
    return null;
  }
}

function buildQwenWorkPolicyGroupReport(options = {}) {
  const mapOnly = options.mapOnly === true || options.mapOnly === 'true';
  const findings = [];
  const text = [options.claim, options.command, options.text].filter(Boolean).join('\n');
  if (!mapOnly && text) {
    for (const hit of triggeredRefusals(text)) {
      findings.push({ gateId: 'qwenwork-refuse', severity: 'fail', message: hit });
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
      evaluation = evaluatePolicyGroup(policy, action);
      if (evaluation.decision !== 'allow') {
        findings.push({
          gateId: 'policy-group',
          severity: 'fail',
          message: evaluation.reason,
        });
      }
    }
  }

  const failCount = findings.filter((item) => item.severity === 'fail').length;
  return {
    name: 'thumbgate-qwenwork-policy-group',
    ok: failCount === 0,
    status: failCount ? 'fail' : 'ready',
    source: SOURCE,
    refuses: REFUSES,
    actionPoints: ACTION_POINTS,
    identitySlots: IDENTITY_SLOTS,
    map: RAIL_MAP,
    evaluation,
    findings,
    summary: { findingCount: findings.length, failCount },
    exampleCommand: 'npx thumbgate qwenwork-policy-group --json --map-only',
    disclaimer: 'FORMAT steal from the 2026-10-28 QwenWork Enterprise Premium note. Not affiliated. Does not buy seats, call Alibaba Cloud, or install DingTalk, WeCom, or Feishu.',
  };
}

function formatQwenWorkPolicyGroupReport(report) {
  const lines = [
    'QwenWork Policy Group',
    `Status : ${report.status}`,
    `Source : ${report.source}`,
    `Findings: ${report.summary.findingCount} (fail=${report.summary.failCount})`,
    '',
    'Rail map:',
  ];
  for (const row of report.map) {
    lines.push(`- ${row.qwenwork}`);
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
  const report = buildQwenWorkPolicyGroupReport({
    mapOnly: args.mapOnly === true,
    claim: args.claim || '',
    policyJson: args.policyJson || '',
    actionJson: args.actionJson || '',
    policyPath: args.policy || '',
    actionPath: args.action || '',
  });
  if (args.json === true) console.log(JSON.stringify(report, null, 2));
  else process.stdout.write(formatQwenWorkPolicyGroupReport(report));
  if (report.status === 'fail') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}

module.exports = {
  ACTION_POINTS,
  IDENTITY_SLOTS,
  RAIL_MAP,
  REFUSES,
  buildQwenWorkPolicyGroupReport,
  evaluatePolicyGroup,
  formatQwenWorkPolicyGroupReport,
  triggeredRefusals,
};
