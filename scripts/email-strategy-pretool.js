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

function evaluateFiddlerAgentAutonomyAndDynamicEscalationSteal({
  autonomyLevel = 'autonomous',
  pillarsReady = { identity: true, data: true, tools: true, code: true, cost: true },
  isEdgeCasePayload = false,
  dynamicModelEscalatedInEnvironment = true,
  sessionTelemetry = { tamperingDetected: false, promptInjectionDetected: false, infiniteLoopDetected: false },
} = {}) {
  const blockers = [];
  const requiredPillars = ['identity', 'data', 'tools', 'code', 'cost'];
  const missingPillars = requiredPillars.filter((p) => !pillarsReady || !pillarsReady[p]);
  if (autonomyLevel !== 'supervised' && missingPillars.length > 0) {
    blockers.push(`fiddler_autonomy_missing_pillars:${missingPillars.join(',')}`);
  }
  if (isEdgeCasePayload && !dynamicModelEscalatedInEnvironment) {
    blockers.push('fiddler_centor_edge_case_missing_in_environment_escalation');
  }
  if (sessionTelemetry?.tamperingDetected) blockers.push('fiddler_coding_agent_tampering_detected');
  if (sessionTelemetry?.promptInjectionDetected) blockers.push('fiddler_coding_agent_prompt_injection_detected');
  if (sessionTelemetry?.infiniteLoopDetected) blockers.push('fiddler_coding_agent_loop_detected');
  return { ok: blockers.length === 0, blockers };
}

function evaluateFiddlerOct2026NewsletterSteal({
  requestedAutonomyLevel = 'autonomous',
  dimensionsVerified = { identity: true, data: true, tools: true, code: true, cost: true },
  sessionThreats = { tampering: false, injection: false, loops: false },
} = {}) {
  const blockers = [];
  const requiredDims = ['identity', 'data', 'tools', 'code', 'cost'];
  const missingDims = requiredDims.filter((d) => !dimensionsVerified || dimensionsVerified[d] !== true);
  if (requestedAutonomyLevel !== 'supervised' && missingDims.length > 0) {
    blockers.push(`fiddler_autonomy_level_missing_dimensions:${missingDims.join(',')}`);
  }
  if (sessionThreats?.tampering) blockers.push('fiddler_claude_code_session_tampering_detected');
  if (sessionThreats?.injection) blockers.push('fiddler_claude_code_session_injection_detected');
  if (sessionThreats?.loops) blockers.push('fiddler_claude_code_session_loop_detected');
  return { ok: blockers.length === 0, blockers };
}

function evaluateGlm53WorkersAiSglangKvCacheIsolationSteal({
  crossTenantKvCacheShared = false,
  prefixSaltBoundToTenant = true,
} = {}) {
  const blockers = [];
  if (crossTenantKvCacheShared || !prefixSaltBoundToTenant) {
    blockers.push('glm53_sglang_cross_tenant_kv_cache_bleed_blocked');
  }
  return { ok: blockers.length === 0, blockers };
}

function evaluateHermesGuideLinksAndProKeySteal({ proKeyPlaintextExposed = false } = {}) {
  const blockers = [];
  if (proKeyPlaintextExposed) blockers.push('hermes_pro_key_plaintext_exposure_blocked');
  return { ok: blockers.length === 0, blockers };
}

function evaluateOct28InboxSelfStrategyBatchSteal({ contextEntropyUnbounded = false } = {}) {
  const blockers = [];
  if (contextEntropyUnbounded) blockers.push('oct28_batch_unbounded_context_entropy_blocked');
  return { ok: blockers.length === 0, blockers };
}

function evaluateMablAgentSpeedAndEvidenceSteal({ unverifiedCompletionClaim = false } = {}) {
  const blockers = [];
  if (unverifiedCompletionClaim) blockers.push('mabl_unverified_completion_claim_blocked');
  return { ok: blockers.length === 0, blockers };
}

function evaluateStackOverflowAeoAndMonetizationSteal({ missingCanonicalUtmLink = false } = {}) {
  const blockers = [];
  if (missingCanonicalUtmLink) blockers.push('stackoverflow_aeo_missing_canonical_utm_blocked');
  return { ok: blockers.length === 0, blockers };
}

function evaluateTailscaleOct2026NewsletterSteal({ publicPortExposed = false } = {}) {
  const blockers = [];
  if (publicPortExposed) blockers.push('tailscale_oct2026_public_port_exposure_blocked');
  return { ok: blockers.length === 0, blockers };
}

function evaluateSpotifyConfidenceFlagsAndShadowSteal({ unguardedActiveRollout = false } = {}) {
  const blockers = [];
  if (unguardedActiveRollout) blockers.push('spotify_confidence_unguarded_rollout_blocked');
  return { ok: blockers.length === 0, blockers };
}

function evaluateGitLabTenAiPromptsAndNurtureSteal({ treatAllowlistAsTrustBoundary = false } = {}) {
  const blockers = [];
  if (treatAllowlistAsTrustBoundary) blockers.push('gitlab_allowlist_treated_as_trust_boundary');
  return { ok: blockers.length === 0, blockers };
}

function evaluateWabiCollaborativeSalesOperationsSteal({
  outboundCashSpendUsd = 0,
  prospectEmail = 'blas@wabi.ai',
} = {}) {
  const blockers = [];
  if (Number(outboundCashSpendUsd) > 0) blockers.push('wabi_sales_ops_nonzero_outbound_spend_refused');
  if (/@(?:ecisolutions|ecinexus|eci)\.com\b/i.test(String(prospectEmail || ''))) {
    blockers.push('wabi_sales_ops_eci_domain_isolation_violation');
  }
  return { ok: blockers.length === 0, blockers };
}

function evaluateVibeTrendBadgeAndZeroSpendPartnerFlipSteal({ outboundCashSpendUsd = 0 } = {}) {
  const blockers = [];
  if (Number(outboundCashSpendUsd) > 0) blockers.push('vibetrend_paid_spotlight_outbound_spend_refused');
  return { ok: blockers.length === 0, blockers };
}

function evaluateGcpConversationalCommerceSwarmSteal({ recoveryCacUsd = 0, contributionPerSaleUsd = 19 } = {}) {
  const blockers = [];
  if (Number(recoveryCacUsd) >= Number(contributionPerSaleUsd)) {
    blockers.push('gcp_conversational_commerce_cac_exceeds_contribution');
  }
  return { ok: blockers.length === 0, blockers };
}

function evaluateGitHubProjectsCommunityBoardAutomationSteal({ manualApprovalBypassAttempted = false } = {}) {
  const blockers = [];
  if (manualApprovalBypassAttempted) blockers.push('github_projects_branch_protection_bypass_refused');
  return { ok: blockers.length === 0, blockers };
}

function evaluateAddyOsmaniAiEngineeringDisciplineSteal({ unreviewedAiDebtDump = false } = {}) {
  const blockers = [];
  if (unreviewedAiDebtDump) blockers.push('addy_osmani_70pct_problem_tech_debt_blocked');
  return { ok: blockers.length === 0, blockers };
}

function evaluateGregIsenbergSaasIsDeadServiceAsSoftwareSteal({ hasFourTierOutcomeLadder = true } = {}) {
  const blockers = [];
  if (!hasFourTierOutcomeLadder) blockers.push('greg_isenberg_outcome_ladder_incomplete');
  return { ok: blockers.length === 0, blockers };
}

function evaluateRyanDoserDontReplaceSaasWithoutDeterministicGatesSteal({ replacedBillingOrAuthWithRawPrompt = false } = {}) {
  const blockers = [];
  if (replacedBillingOrAuthWithRawPrompt) blockers.push('ryan_doser_raw_prompt_replacing_deterministic_saas_blocked');
  return { ok: blockers.length === 0, blockers };
}

function evaluateSevenFigureBookLeadMagnetSalesFunnelSteal({ outboundColdSalesSpendUsd = 0 } = {}) {
  const blockers = [];
  if (Number(outboundColdSalesSpendUsd) > 0) blockers.push('seven_figure_book_nonzero_outbound_spend_blocked');
  return { ok: blockers.length === 0, blockers };
}

function evaluateYouTubeDiscoveryAndMarketerViewShiftSteal({ utmTaggedDescriptionLinks = true } = {}) {
  const blockers = [];
  if (!utmTaggedDescriptionLinks) blockers.push('youtube_view_shift_missing_utm_checkout_links');
  return { ok: blockers.length === 0, blockers };
}

function evaluateThinkMediaYouTubeToPayingClientsConversionSteal({ directCheckoutLinkInFirstThreeLines = true } = {}) {
  const blockers = [];
  if (!directCheckoutLinkInFirstThreeLines) blockers.push('think_media_checkout_link_buried');
  return { ok: blockers.length === 0, blockers };
}

function evaluateServalJakeStauchServiceNowItCodingAgentsSteal({ unscopedRootAccessRequested = false } = {}) {
  const blockers = [];
  if (unscopedRootAccessRequested) blockers.push('serval_it_agent_unscoped_root_access_denied');
  return { ok: blockers.length === 0, blockers };
}

function evaluateAiAgentsExpertJudgmentCalibrationSteal({ sycophanticRubberStampDetected = false } = {}) {
  const blockers = [];
  if (sycophanticRubberStampDetected) blockers.push('anthropic_expert_judgment_automation_bias_rubber_stamp_blocked');
  return { ok: blockers.length === 0, blockers };
}

function evaluateElvisSaraviaContextAndAgentEngineeringSteal({ toolOutputShuntedBelow350Lines = true } = {}) {
  const blockers = [];
  if (!toolOutputShuntedBelow350Lines) blockers.push('omarsar0_unshunted_tool_output_above_350_lines');
  return { ok: blockers.length === 0, blockers };
}

function evaluateOct29SelfSentInboxStrategyBatchSteal({ lessonPersisted = true } = {}) {
  const blockers = [];
  if (!lessonPersisted) blockers.push('oct29_inbox_batch_missing_lesson');
  return { ok: blockers.length === 0, blockers };
}

function evaluateGoogleAiModeCompetitorMonetizationSteal({ freeLocalMitEnginePreserved = true } = {}) {
  const blockers = [];
  if (!freeLocalMitEnginePreserved) blockers.push('google_aimode_free_local_mit_engine_removed');
  return { ok: blockers.length === 0, blockers };
}

function evaluateUltramarine1FlashOpenWeightsAndRoutingSteal({ contextWindowTokens = 1000000 } = {}) {
  const blockers = [];
  if (Number(contextWindowTokens) < 1000000) blockers.push('ultramarine_1_flash_context_window_below_1m');
  return { ok: blockers.length === 0, blockers };
}

function evaluateRianDorisResponsiveVsResponsibleFlowBlockSteal({
  dailyUnreachableFlowMinutes = 180,
  duplicateReactiveAutoRepliesSent = 0,
} = {}) {
  const blockers = [];
  if (Number(dailyUnreachableFlowMinutes) < 180) {
    blockers.push('rian_doris_daily_unreachable_flow_block_below_180_minutes');
  }
  if (Number(duplicateReactiveAutoRepliesSent) > 0) {
    blockers.push('rian_doris_duplicate_reactive_ping_pong_detected');
  }
  return { ok: blockers.length === 0, blockers };
}

function evaluateWorkOsAirlockAtlasPassportPipesSteal({
  policyCompliant = true,
  agentHandoffTokenScoped = true,
  handoffAllowedToolsCount = 4,
} = {}) {
  const blockers = [];
  if (!policyCompliant) blockers.push('workos_airlock_policy_violation_blocked');
  if (!agentHandoffTokenScoped || Number(handoffAllowedToolsCount) > 4) {
    blockers.push('workos_cyber60_unscoped_agent_to_agent_handoff_token');
  }
  return { ok: blockers.length === 0, blockers };
}

function evaluateDeepSeekSuperAgentArchitectureSteal({
  routerHasBashOrExecTools = false,
  subscriptionPassThroughEnabled = true,
  externalSemanticWatchdogEnabled = true,
} = {}) {
  const blockers = [];
  if (routerHasBashOrExecTools) blockers.push('deepseek_superagent_router_must_not_mount_bash_or_execution_tools');
  if (!subscriptionPassThroughEnabled) blockers.push('deepseek_superagent_missing_subscription_passthrough_wastes_37pct_cache_tokens');
  if (!externalSemanticWatchdogEnabled) blockers.push('deepseek_superagent_missing_storage_compute_separation_or_external_watchdog');
  return { ok: blockers.length === 0, blockers };
}

function evaluateDynamicEmailStrategySteal({
  messageId = 'pretool-live',
  slug = 'dynamic-email-strategy',
  stolenStrategy = 'Enforce internalized email strategy rules at PreToolUse boundary',
  lessonId = 'lesson_live',
  obsidianPath = 'Email-Triage-Archive',
} = {}) {
  const blockers = [];
  if (!messageId && !slug) blockers.push('missing_email_identifier');
  if (!stolenStrategy || String(stolenStrategy).trim().length < 20) {
    blockers.push('insufficient_strategy_substance');
  }
  if (!lessonId) blockers.push('missing_persisted_lesson_id');
  if (!obsidianPath) blockers.push('missing_obsidian_dossier_path');
  return { ok: blockers.length === 0, blockers };
}

function evaluateInboxDeleteBeforeSynthesisFirewall({ commandText = '' } = {}) {
  const blockers = [];
  const cmd = String(commandText || '');
  const isAuthorizedDaemonInvocation = /^\s*bash\n\/usr\/bin\/python3\s+\/Users\/iganapolsky\/\.local\/bin\/fo-thumbgate-inbox-cron\.py\b/i.test(cmd);
  const touchesGmailImapOrMail = /imap\.gmail\.com|imaplib|Application\(["']Mail["']\)/i.test(cmd);
  const mutatesTrashOrDelete = /\\Trash|\\Deleted|\bexpunge\s*\(|\bdelete\b|\+X-GM-LABELS[^\n]*Trash/i.test(cmd);
  if (!isAuthorizedDaemonInvocation && touchesGmailImapOrMail && mutatesTrashOrDelete) {
    blockers.push('inbox_direct_imap_trash_bypass_blocked');
  }
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

function isFileEditTool(toolName) {
  return /^(?:Edit|Write|MultiEdit|NotebookEdit|NotebookEditCell|patch|write_file)$/i.test(String(toolName || '').trim());
}

function isTestOrFixtureFile(toolInput) {
  const filePath = String((toolInput && (toolInput.file_path || toolInput.path || toolInput.filePath)) || '').trim();
  if (!filePath) return false;
  return /(?:^|\/)(?:tests?|__tests__|fixtures?)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(filePath);
}

function evaluateEmailStrategyPretool({ toolName = '', toolInput = {} } = {}) {
  const blob = payloadText(toolName, toolInput);
  const commandOnly = toolInput && (toolInput.command || toolInput.cmd)
    ? `${toolName || ''}\n${String(toolInput.command || toolInput.cmd)}`
    : '';
  const fileEdit = isFileEditTool(toolName);
  const testFile = isTestOrFixtureFile(toolInput);
  const commandSurface = fileEdit ? commandOnly : blob;
  const contentSurface = testFile ? commandOnly : blob;
  const destructive = DESTRUCTIVE_RE.test(commandSurface);
  const productionDdl = /\b(ALTER|DROP|CREATE)\s+TABLE\b/i.test(commandSurface) && /\bprod(?:uction)?\b/i.test(commandSurface);
  const ephemeral = /ephemeral|preview branch/i.test(commandSurface);
  const escalation = /\bassume-role\b|\bprivilege escalation\b/i.test(commandSurface);

  const grok = evaluateGrokBotMemoryImportSteal({ containsRawSecrets: SECRET_RE.test(contentSurface) });
  const supabase = evaluateSupabaseAgentDatabaseSteal({
    isProductionBranchDdl: productionDdl,
    ephemeralBranchCreated: ephemeral || !productionDdl,
    rlsEnabledOnAllPublicTables: !/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(contentSurface),
    serviceRoleKeyExposedInClient: /service_role/i.test(contentSurface),
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
  const fiddler = evaluateFiddlerAgentAutonomyAndDynamicEscalationSteal({});
  const fiddlerOct = evaluateFiddlerOct2026NewsletterSteal({});
  const glm53 = evaluateGlm53WorkersAiSglangKvCacheIsolationSteal({});
  const hermesGuide = evaluateHermesGuideLinksAndProKeySteal({});
  const oct28Batch = evaluateOct28InboxSelfStrategyBatchSteal({});
  const mabl = evaluateMablAgentSpeedAndEvidenceSteal({});
  const stackoverflow = evaluateStackOverflowAeoAndMonetizationSteal({});
  const tailscaleOct = evaluateTailscaleOct2026NewsletterSteal({});
  const spotifyConf = evaluateSpotifyConfidenceFlagsAndShadowSteal({});
  const gitlabPrompts = evaluateGitLabTenAiPromptsAndNurtureSteal({});
  const wabiSales = evaluateWabiCollaborativeSalesOperationsSteal({});
  const vibetrend = evaluateVibeTrendBadgeAndZeroSpendPartnerFlipSteal({});
  const gcpCommerce = evaluateGcpConversationalCommerceSwarmSteal({});
  const ghProjects = evaluateGitHubProjectsCommunityBoardAutomationSteal({});
  const addyOsmani = evaluateAddyOsmaniAiEngineeringDisciplineSteal({});
  const gregIsenberg = evaluateGregIsenbergSaasIsDeadServiceAsSoftwareSteal({});
  const ryanDoser = evaluateRyanDoserDontReplaceSaasWithoutDeterministicGatesSteal({});
  const sevenFigBook = evaluateSevenFigureBookLeadMagnetSalesFunnelSteal({});
  const ytViews = evaluateYouTubeDiscoveryAndMarketerViewShiftSteal({});
  const thinkMedia = evaluateThinkMediaYouTubeToPayingClientsConversionSteal({});
  const servalIt = evaluateServalJakeStauchServiceNowItCodingAgentsSteal({});
  const expertJudgment = evaluateAiAgentsExpertJudgmentCalibrationSteal({});
  const elvisContext = evaluateElvisSaraviaContextAndAgentEngineeringSteal({});
  const oct29Batch = evaluateOct29SelfSentInboxStrategyBatchSteal({});
  const googleAiModeComp = evaluateGoogleAiModeCompetitorMonetizationSteal({});
  const ultramarineFlash = evaluateUltramarine1FlashOpenWeightsAndRoutingSteal({});
  const dynamicEmail = evaluateDynamicEmailStrategySteal({});
  const rianFlow = evaluateRianDorisResponsiveVsResponsibleFlowBlockSteal({});
  const workosAirlock = evaluateWorkOsAirlockAtlasPassportPipesSteal({});
  const deepseekSuperAgent = evaluateDeepSeekSuperAgentArchitectureSteal({});
  const inboxDeleteFirewall = evaluateInboxDeleteBeforeSynthesisFirewall({ commandText: commandSurface });
  const blockers = [
    grok,
    supabase,
    genie,
    ibm,
    jellyfish,
    evalCuration,
    fiddler,
    fiddlerOct,
    glm53,
    hermesGuide,
    oct28Batch,
    mabl,
    stackoverflow,
    tailscaleOct,
    spotifyConf,
    gitlabPrompts,
    wabiSales,
    vibetrend,
    gcpCommerce,
    ghProjects,
    addyOsmani,
    gregIsenberg,
    ryanDoser,
    sevenFigBook,
    ytViews,
    thinkMedia,
    servalIt,
    expertJudgment,
    elvisContext,
    oct29Batch,
    googleAiModeComp,
    ultramarineFlash,
    dynamicEmail,
    rianFlow,
    workosAirlock,
    inboxDeleteFirewall,
    deepseekSuperAgent,
  ].flatMap((row) => row.blockers || []);
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
      'evaluateFiddlerAgentAutonomyAndDynamicEscalationSteal',
      'evaluateFiddlerOct2026NewsletterSteal',
      'evaluateGlm53WorkersAiSglangKvCacheIsolationSteal',
      'evaluateHermesGuideLinksAndProKeySteal',
      'evaluateOct28InboxSelfStrategyBatchSteal',
      'evaluateMablAgentSpeedAndEvidenceSteal',
      'evaluateStackOverflowAeoAndMonetizationSteal',
      'evaluateTailscaleOct2026NewsletterSteal',
      'evaluateSpotifyConfidenceFlagsAndShadowSteal',
      'evaluateGitLabTenAiPromptsAndNurtureSteal',
      'evaluateWabiCollaborativeSalesOperationsSteal',
      'evaluateVibeTrendBadgeAndZeroSpendPartnerFlipSteal',
      'evaluateGcpConversationalCommerceSwarmSteal',
      'evaluateGitHubProjectsCommunityBoardAutomationSteal',
      'evaluateAddyOsmaniAiEngineeringDisciplineSteal',
      'evaluateGregIsenbergSaasIsDeadServiceAsSoftwareSteal',
      'evaluateRyanDoserDontReplaceSaasWithoutDeterministicGatesSteal',
      'evaluateSevenFigureBookLeadMagnetSalesFunnelSteal',
      'evaluateYouTubeDiscoveryAndMarketerViewShiftSteal',
      'evaluateThinkMediaYouTubeToPayingClientsConversionSteal',
      'evaluateServalJakeStauchServiceNowItCodingAgentsSteal',
      'evaluateAiAgentsExpertJudgmentCalibrationSteal',
      'evaluateElvisSaraviaContextAndAgentEngineeringSteal',
      'evaluateOct29SelfSentInboxStrategyBatchSteal',
      'evaluateGoogleAiModeCompetitorMonetizationSteal',
      'evaluateUltramarine1FlashOpenWeightsAndRoutingSteal',
      'evaluateDynamicEmailStrategySteal',
      'evaluateRianDorisResponsiveVsResponsibleFlowBlockSteal',
      'evaluateWorkOsAirlockAtlasPassportPipesSteal',
      'evaluateDeepSeekSuperAgentArchitectureSteal',
      'evaluateInboxDeleteBeforeSynthesisFirewall',
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
  evaluateFiddlerAgentAutonomyAndDynamicEscalationSteal,
  evaluateFiddlerOct2026NewsletterSteal,
  evaluateGlm53WorkersAiSglangKvCacheIsolationSteal,
  evaluateHermesGuideLinksAndProKeySteal,
  evaluateOct28InboxSelfStrategyBatchSteal,
  evaluateMablAgentSpeedAndEvidenceSteal,
  evaluateStackOverflowAeoAndMonetizationSteal,
  evaluateTailscaleOct2026NewsletterSteal,
  evaluateSpotifyConfidenceFlagsAndShadowSteal,
  evaluateGitLabTenAiPromptsAndNurtureSteal,
  evaluateWabiCollaborativeSalesOperationsSteal,
  evaluateVibeTrendBadgeAndZeroSpendPartnerFlipSteal,
  evaluateGcpConversationalCommerceSwarmSteal,
  evaluateGitHubProjectsCommunityBoardAutomationSteal,
  evaluateAddyOsmaniAiEngineeringDisciplineSteal,
  evaluateGregIsenbergSaasIsDeadServiceAsSoftwareSteal,
  evaluateRyanDoserDontReplaceSaasWithoutDeterministicGatesSteal,
  evaluateSevenFigureBookLeadMagnetSalesFunnelSteal,
  evaluateYouTubeDiscoveryAndMarketerViewShiftSteal,
  evaluateThinkMediaYouTubeToPayingClientsConversionSteal,
  evaluateServalJakeStauchServiceNowItCodingAgentsSteal,
  evaluateAiAgentsExpertJudgmentCalibrationSteal,
  evaluateElvisSaraviaContextAndAgentEngineeringSteal,
  evaluateOct29SelfSentInboxStrategyBatchSteal,
  evaluateGoogleAiModeCompetitorMonetizationSteal,
  evaluateUltramarine1FlashOpenWeightsAndRoutingSteal,
  evaluateRianDorisResponsiveVsResponsibleFlowBlockSteal,
  evaluateWorkOsAirlockAtlasPassportPipesSteal,
  evaluateDeepSeekSuperAgentArchitectureSteal,
  evaluateDynamicEmailStrategySteal,
  evaluateInboxDeleteBeforeSynthesisFirewall,
  evaluateEmailStrategyPretool,
};

