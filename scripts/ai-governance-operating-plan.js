'use strict';

/**
 * AI Governance Operating Plan — ThumbGate steal of the AI-security episode
 * operating plan (source: music.youtube.com/watch?v=9aSJpOQGANM).
 *
 * The episode's core thesis for AI products and internal automation:
 *   start with low-risk, measurable use cases; establish visibility and
 *   ownership; then add continuous controls before expanding capability.
 *
 * This module encodes the plan's ten steps as deterministic enforcement
 * primitives ThumbGate can gate on:
 *
 *   1. Use-case register (CMDB for AI, not a slide deck) with risk tiering
 *   2. Data classification per workflow; sensitive data barred from
 *      unapproved models and unmanaged browser sessions
 *   3. Constrained pilot: summarization/extraction/classification first,
 *      one success metric, no production-modifying autonomy
 *   4. Threat model + blast radius; consequential actions require approval
 *   5. Least privilege for machine identities; no birthright permissions
 *   6. Event taxonomy with owner/severity/containment per event type
 *   7. Eval suite with adversarial and permission-boundary cases
 *   8. Release gates: no ship on eval regression, permission broadening,
 *      missing monitoring, or missing approval checkpoints
 *   9. Cross-functional review group (the "AI Kitchen")
 *  10. Incident tabletop: prompt-injection -> sensitive retrieval ->
 *      privileged tool call, with containment steps
 */

const DATA_CLASSES = Object.freeze([
  'public', 'internal', 'confidential', 'pii', 'financial', 'customer', 'credentials',
]);

const RISK_TIERS = Object.freeze(['low', 'medium', 'high', 'critical']);

const CONSEQUENTIAL_ACTIONS = Object.freeze([
  'external-communication', 'payment', 'production-change',
  'deletion', 'permission-change', 'code-deployment',
]);

/**
 * Step 1 — the AI use-case register. Refuses incomplete entries: the episode
 * names incomplete inventories as a core governance problem.
 */
function registerUseCase(entry) {
  const required = ['name', 'model', 'vendor', 'owner', 'userGroup', 'businessPurpose'];
  const missing = required.filter((k) => !entry || !entry[k]);
  if (missing.length > 0) {
    return { accepted: false, reason: `missing required fields: ${missing.join(', ')}` };
  }
  const tier = entry.riskTier;
  if (!RISK_TIERS.includes(tier)) {
    return { accepted: false, reason: `riskTier must be one of ${RISK_TIERS.join(', ')}` };
  }
  if (tier === 'critical' && !entry.regulatedDataExposure && !entry.takesActions) {
    // critical needs a documented reason; otherwise tier down
    return { accepted: false, reason: 'critical tier requires regulated-data exposure or action capability' };
  }
  return { accepted: true, entry: { ...entry, registeredAt: new Date().toISOString() } };
}

/**
 * Step 2 — data classification gate. Sensitive classes may not flow into
 * unapproved models or unmanaged browser sessions.
 */
function classifyFlow(flow) {
  const cls = DATA_CLASSES.includes(flow.dataClass) ? flow.dataClass : null;
  if (!cls) {
    return { allowed: false, reason: `unknown data class "${flow.dataClass}"` };
  }
  const sensitive = ['confidential', 'pii', 'financial', 'customer', 'credentials'];
  if (sensitive.includes(cls)) {
    if (!flow.modelApproved) {
      return { allowed: false, reason: `${cls} data cannot flow into an unapproved model` };
    }
    if (flow.viaUnmanagedBrowser) {
      return { allowed: false, reason: `${cls} data cannot flow through an unmanaged browser session` };
    }
  }
  return { allowed: true, dataClass: cls };
}

/**
 * Step 3 — pilot scope check. The pilot must be a constrained task type with
 * exactly one success metric, and must not take production-modifying actions.
 */
function checkPilotScope(pilot) {
  const allowedTypes = ['retrieval', 'extraction', 'classification', 'summarization'];
  if (!allowedTypes.includes(pilot.taskType)) {
    return {
      approved: false,
      reason: `pilot taskType "${pilot.taskType}" not allowed — start with ${allowedTypes.join('/')}, not autonomous reasoning`,
    };
  }
  if (!Array.isArray(pilot.successMetrics) || pilot.successMetrics.length !== 1) {
    return { approved: false, reason: 'define exactly one success metric for the pilot' };
  }
  if (pilot.canModifyProduction) {
    return { approved: false, reason: 'pilots must not modify production systems' };
  }
  return { approved: true, taskType: pilot.taskType, metric: pilot.successMetrics[0] };
}

/**
 * Step 4 — blast-radius assessment + approval requirements.
 */
function assessBlastRadius(workflow) {
  const surfaces = [];
  for (const s of ['systems', 'records', 'money', 'customerCommunications', 'privileges']) {
    if (workflow.exposes && workflow.exposes.includes(s)) surfaces.push(s);
  }
  const needsApproval = (workflow.actions || []).filter((a) =>
    CONSEQUENTIAL_ACTIONS.includes(a),
  );
  return {
    workflow: workflow.name || 'unnamed',
    blastRadius: surfaces.length === 0 ? 'none' : surfaces,
    consequentialActions: needsApproval,
    requiresApprovalGate: needsApproval.length > 0,
  };
}

/**
 * Step 5 — least privilege for machine identities. Birthright scopes are
 * refused; each identity declares exactly what it needs.
 */
function checkMachineIdentity(identity) {
  const problems = [];
  if (!identity.scopes || identity.scopes.length === 0) {
    problems.push('identity declares no scopes — refuse by default');
  }
  if (identity.scopes && identity.scopes.includes('*')) {
    problems.push('wildcard scope is a birthright permission — refused');
  }
  if (identity.capabilities && identity.capabilities.includes('action') && identity.readOnlyResearch) {
    problems.push('research agent must be read-only; action capability requires a separate identity');
  }
  if (!identity.credentialRotationDays || identity.credentialRotationDays > 90) {
    problems.push('credentials must rotate within 90 days');
  }
  return { compliant: problems.length === 0, problems };
}

/**
 * Step 6 — event taxonomy. Every reportable event type carries an owner,
 * severity, and containment action.
 */
function eventTaxonomy() {
  return [
    { event: 'hallucinated-high-impact-output', severity: 'high', owner: 'model-owner', containment: 'suspend workflow; re-run eval suite' },
    { event: 'unsafe-tool-call', severity: 'critical', owner: 'tool-owner', containment: 'revoke tool credentials; disable tool' },
    { event: 'data-leakage', severity: 'critical', owner: 'data-owner', containment: 'revoke credentials; preserve logs; notify stakeholders' },
    { event: 'prompt-injection', severity: 'high', owner: 'security', containment: 'quarantine input source; audit retrieval' },
    { event: 'unauthorized-retrieval', severity: 'high', owner: 'data-owner', containment: 'tighten retrieval scopes; audit access' },
    { event: 'abnormal-cost', severity: 'medium', owner: 'platform-owner', containment: 'cap spend; review token usage' },
    { event: 'output-drift', severity: 'medium', owner: 'model-owner', containment: 'run scheduled eval sample; compare baseline' },
  ];
}

/**
 * Step 7/8 — release gates. A release is blocked if critical evals regress,
 * permissions broaden, monitoring is absent, or a consequential action lacks
 * an approval checkpoint.
 */
function releaseGate(checklist) {
  const blockers = [];
  if (!checklist.evalsPass) blockers.push('eval suite must pass');
  if (!checklist.noEvalRegression) blockers.push('critical eval regression blocks release');
  if (!checklist.noPermissionBroadening) blockers.push('permission broadening blocks release');
  if (!checklist.monitoringPresent) blockers.push('monitoring must be present');
  if (!checklist.approvalCheckpointsCoverConsequential) {
    blockers.push('every consequential action needs a human approval checkpoint');
  }
  return {
    ship: blockers.length === 0,
    blockers,
    rollbackPaths: [
      'disable tool access', 'switch to known-good model/prompt',
      'revert retrieval index version', 'suspend the workflow',
    ],
  };
}

/**
 * Step 9 — the AI Kitchen. Minimal cross-functional membership; the episode
 * is explicit that no single function owns the full AI risk surface.
 */
function checkKitchen(members) {
  const required = ['engineering', 'security', 'legal-privacy', 'data-owner', 'business-sponsor'];
  const present = new Set((members || []).map((m) => m.function));
  const missing = required.filter((f) => !present.has(f));
  return {
    formed: missing.length === 0,
    missing,
    cadence: { activeHighRisk: 'weekly', portfolioReview: 'monthly' },
  };
}

/**
 * Step 10 — incident tabletop scenario + containment checklist.
 */
function tabletopScenario() {
  return {
    scenario: 'An agent was prompt-injected through a document, retrieved sensitive content, and attempted a privileged tool call.',
    containment: [
      'revoke credentials',
      'disable tools',
      'preserve logs',
      'identify affected data and actions',
      'notify relevant stakeholders',
      'fix the root cause',
    ],
    participants: ['SOC', 'CSIRT', 'AI team', 'data owner'],
  };
}

function isCliEntrypoint() {
  return require.main === module;
}

function main() {
  const report = {
    honesty: 'deterministic enforcement primitives modeling the episode operating plan',
    source: 'https://music.youtube.com/watch?v=9aSJpOQGANM',
    register: registerUseCase({
      name: 'ticket-summary', model: 'local-llm', vendor: 'ollama',
      owner: 'support-lead', userGroup: 'support', businessPurpose: 'ticket triage',
      riskTier: 'low', takesActions: false,
    }),
    dataGate: classifyFlow({ dataClass: 'pii', modelApproved: false }),
    pilot: checkPilotScope({
      taskType: 'summarization',
      successMetrics: ['reduce ticket-summary time 60% at >=95% factual accuracy'],
      canModifyProduction: false,
    }),
    blast: assessBlastRadius({
      name: 'ticket-summary', exposes: ['records', 'customerCommunications'],
      actions: ['external-communication'],
    }),
    identity: checkMachineIdentity({ scopes: ['tickets:read'], credentialRotationDays: 30, readOnlyResearch: true }),
    taxonomy: eventTaxonomy().length,
    gate: releaseGate({
      evalsPass: true, noEvalRegression: true, noPermissionBroadening: true,
      monitoringPresent: true, approvalCheckpointsCoverConsequential: false,
    }),
    kitchen: checkKitchen([{ function: 'engineering' }]),
    tabletop: tabletopScenario().scenario,
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

if (isCliEntrypoint()) main();

module.exports = {
  DATA_CLASSES,
  RISK_TIERS,
  CONSEQUENTIAL_ACTIONS,
  registerUseCase,
  classifyFlow,
  checkPilotScope,
  assessBlastRadius,
  checkMachineIdentity,
  eventTaxonomy,
  releaseGate,
  checkKitchen,
  tabletopScenario,
  isCliEntrypoint,
};
