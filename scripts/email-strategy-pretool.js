'use strict';

/**
 * Strategies taken from the 2026-10-28 self-sent ThumbGate notes.
 * The pre-tool hook calls evaluateEmailStrategyPretool before a tool runs.
 * A normal edit is allowed. A tool payload that matches a stolen rule is denied.
 */

function evaluateJellyfishClaudeCodeBillSteal({
  developerCount = 10,
  avgClaudeCodeMonthlyBillPerDevUsd = 252,
  loopAndCollisionWastePct = 42,
  thumbgateProMonthlyPerDevUsd = 19,
} = {}) {
  const devs = Math.max(1, Number(developerCount) || 10);
  const monthlyBill = Math.max(1, Number(avgClaudeCodeMonthlyBillPerDevUsd) || 252);
  const wasteRatio = Math.min(0.9, Math.max(0.05, (Number(loopAndCollisionWastePct) || 42) / 100));
  const proMonthly = Math.max(1, Number(thumbgateProMonthlyPerDevUsd) || 19);
  const savedPerDev = Number((monthlyBill * wasteRatio).toFixed(2));
  return {
    ok: true,
    blockers: [],
    monthlyTokenWasteSavedPerDevUsd: savedPerDev,
    monthlyRoiMultiple: Number((savedPerDev / proMonthly).toFixed(2)),
    developerCount: devs,
  };
}

function evaluateIbmAgentIdentityAndControlSteal({
  agentId = 'local-agent',
  delegatedHumanPrincipal = 'igor@igorganapolsky.com',
  sessionPassportVerified = true,
  requestedTool = 'Read',
  allowedToolScopes = ['Read', 'Edit', 'Bash', 'Grep'],
  crossBoundaryEscalationAttempted = false,
} = {}) {
  const blockers = [];
  if (!agentId || !String(agentId).trim()) blockers.push('missing_non_human_identity_agent_id');
  if (!delegatedHumanPrincipal || !String(delegatedHumanPrincipal).includes('@')) {
    blockers.push('missing_delegated_human_principal_binding');
  }
  if (!sessionPassportVerified) blockers.push('unverified_agent_session_passport');
  if (Array.isArray(allowedToolScopes) && requestedTool && !allowedToolScopes.includes(requestedTool)) {
    blockers.push(`tool_outside_least_privilege_allowlist:${requestedTool}`);
  }
  if (crossBoundaryEscalationAttempted) blockers.push('frontier_agent_privilege_escalation_blocked');
  return { ok: blockers.length === 0, blockers };
}

function evaluateGrokBotMemoryImportSteal({ containsRawSecrets = false } = {}) {
  const blockers = [];
  if (containsRawSecrets) blockers.push('raw_secret_detected_in_memory_import_pack');
  return { ok: blockers.length === 0, blockers };
}

function evaluateGenie4WorldModelCounterfactualSteal({
  reversibleState = true,
  collidesWithActiveActor = false,
  predictedBlastRadius = 'bounded_revision_rollout',
} = {}) {
  const blockers = [];
  if (!reversibleState) blockers.push('genie4_world_model_irreversible_state_transition');
  if (collidesWithActiveActor) blockers.push('genie4_world_model_multi_actor_collision');
  if (predictedBlastRadius === 'unbounded_destructive') blockers.push('genie4_world_model_unbounded_blast_radius');
  return { ok: blockers.length === 0, blockers };
}

function evaluateFiveFactorEvalDataCurationSteal({
  hasGdpValStructuredTaxonomy = true,
  sourcedFromRealWorldCursorBenchUsage = true,
  deterministicPassFailOracle = true,
  holdoutDecontaminated = true,
  difficultyCalibratedNonSaturated = true,
} = {}) {
  const factors = {
    diverseTaxonomyGdpVal: Boolean(hasGdpValStructuredTaxonomy),
    realisticRealWorldCursorBench: Boolean(sourcedFromRealWorldCursorBenchUsage),
    deterministicOracle: Boolean(deterministicPassFailOracle),
    holdoutDecontaminated: Boolean(holdoutDecontaminated),
    difficultyCalibrated: Boolean(difficultyCalibratedNonSaturated),
  };
  const blockers = Object.entries(factors)
    .filter(([, passed]) => !passed)
    .map(([name]) => `missing_eval_curation_factor:${name}`);
  return { ok: blockers.length === 0, blockers };
}

function evaluateSupabaseAgentDatabaseSteal({
  isProductionBranchDdl = false,
  ephemeralBranchCreated = true,
  rlsEnabledOnAllPublicTables = true,
  serviceRoleKeyExposedInClient = false,
} = {}) {
  const blockers = [];
  if (isProductionBranchDdl && !ephemeralBranchCreated) {
    blockers.push('supabase_agent_ddl_on_production_without_ephemeral_branch');
  }
  if (!rlsEnabledOnAllPublicTables) blockers.push('supabase_public_table_missing_row_level_security');
  if (serviceRoleKeyExposedInClient) blockers.push('supabase_service_role_key_exposed_to_agent_client');
  return { ok: blockers.length === 0, blockers };
}

const SECRET_RE = /(?:sk_live_[A-Za-z0-9]+|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----|xox[baprs]-[A-Za-z0-9-]+)/;
const DESTRUCTIVE_RE = /\brm\s+-rf\s+\/(?:\s|$)|DROP\s+DATABASE\b|git\s+push\b[^\n]*--force\b[^\n]*\bmain\b|git\s+reset\s+--hard\b/i;

function payloadText(toolName, toolInput) {
  const command = toolInput && (toolInput.command || toolInput.cmd) ? String(toolInput.command || toolInput.cmd) : '';
  let encoded = '';
  try {
    encoded = JSON.stringify(toolInput || {});
  } catch {
    encoded = '';
  }
  return `${toolName || ''}\n${command}\n${encoded}`;
}

function evaluateEmailStrategyPretool({ toolName = '', toolInput = {} } = {}) {
  const blob = payloadText(toolName, toolInput);
  const destructive = DESTRUCTIVE_RE.test(blob);
  const productionDdl = /\b(ALTER|DROP|CREATE)\s+TABLE\b/i.test(blob) && /\bprod(?:uction)?\b/i.test(blob);
  const ephemeral = /ephemeral|preview branch/i.test(blob);
  const escalation = /\bassume-role\b|\bprivilege escalation\b/i.test(blob);

  const grok = evaluateGrokBotMemoryImportSteal({ containsRawSecrets: SECRET_RE.test(blob) });
  const supabase = evaluateSupabaseAgentDatabaseSteal({
    isProductionBranchDdl: productionDdl,
    ephemeralBranchCreated: ephemeral || !productionDdl,
    rlsEnabledOnAllPublicTables: !/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(blob),
    serviceRoleKeyExposedInClient: /service_role/i.test(blob),
  });
  const genie = evaluateGenie4WorldModelCounterfactualSteal({
    reversibleState: !destructive,
    collidesWithActiveActor: false,
    predictedBlastRadius: destructive ? 'unbounded_destructive' : 'bounded_revision_rollout',
  });
  const ibm = evaluateIbmAgentIdentityAndControlSteal({
    agentId: 'local-agent',
    delegatedHumanPrincipal: escalation ? '' : 'igor@igorganapolsky.com',
    sessionPassportVerified: !escalation,
    requestedTool: toolName || 'Read',
    allowedToolScopes: [toolName || 'Read', 'Read', 'Edit', 'Bash', 'Grep'],
    crossBoundaryEscalationAttempted: escalation,
  });
  const jellyfish = evaluateJellyfishClaudeCodeBillSteal({});
  const evalCuration = evaluateFiveFactorEvalDataCurationSteal({});
  const blockers = [grok, supabase, genie, ibm, jellyfish, evalCuration]
    .flatMap((row) => row.blockers || []);
  return {
    ok: blockers.length === 0,
    blockers,
    called: [
      'evaluateGrokBotMemoryImportSteal',
      'evaluateSupabaseAgentDatabaseSteal',
      'evaluateGenie4WorldModelCounterfactualSteal',
      'evaluateIbmAgentIdentityAndControlSteal',
      'evaluateJellyfishClaudeCodeBillSteal',
      'evaluateFiveFactorEvalDataCurationSteal',
    ],
  };
}

module.exports = {
  evaluateJellyfishClaudeCodeBillSteal,
  evaluateIbmAgentIdentityAndControlSteal,
  evaluateGrokBotMemoryImportSteal,
  evaluateGenie4WorldModelCounterfactualSteal,
  evaluateFiveFactorEvalDataCurationSteal,
  evaluateSupabaseAgentDatabaseSteal,
  evaluateEmailStrategyPretool,
};
