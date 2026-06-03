'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildLoopRoutinePlan,
  buildSkillFirstAgentPlan,
  buildContinuousBatchingPlan,
  buildLegalAgentGovernancePlan,
  buildDynamicWorkflowReadinessPlan,
  buildOpenModelCustomizationPlan,
  buildDigitalPrCitationPlan,
  buildServerlessVectorPlan,
  buildMemoryModelPlan,
  buildSandboxManifestPlan,
  buildNetworkEgressFirewallPlan,
  buildSupplyChainVettingPlan,
  buildCodeQualityEnablementPlan,
  buildMediaAssetGovernancePlan,
  buildOutputFormatPlan,
  buildMarketingAgencyGtmPlan,
  buildBedrockAgentCorePlan,
} = require('../scripts/agent-operations-planner');

test('buildLoopRoutinePlan requires approval and receipts for risky recurring loops', () => {
  const plan = buildLoopRoutinePlan({
    tasks: ['monitor flaky CI', 'publish approved replies'],
    cadenceMinutes: 15,
    serverHosted: true,
  });

  assert.equal(plan.name, 'thumbgate-loop-routine-plan');
  assert.equal(plan.mode, 'routine');
  assert.equal(plan.approvalRequired, true);
  assert.ok(plan.highRiskTasks.includes('publish approved replies'));
  assert.ok(plan.gates.some((gate) => /run receipt/.test(gate)));
});

test('buildSkillFirstAgentPlan blocks write-capable skills when write permission is missing', () => {
  const plan = buildSkillFirstAgentPlan({
    skills: ['figma', 'azure-foundry'],
    allowedTools: ['read', 'edit', 'bash'],
    needsWrite: true,
  });

  assert.equal(plan.status, 'blocked');
  assert.deepEqual(plan.missingTools, ['write']);
  assert.ok(plan.instructionFiles.includes('clauded.md'));
  assert.ok(plan.autoLoadPaths.includes('.claude/skills'));
  assert.ok(plan.gates.some((gate) => /plugin auto-load/.test(gate)));
});

test('buildContinuousBatchingPlan adopts batching only when self-hosted concurrency warrants it', () => {
  const plan = buildContinuousBatchingPlan({
    concurrentUsers: 8,
    gpuHosted: true,
    averageDecodeTokens: 512,
  });

  assert.equal(plan.status, 'adopt-continuous-batching');
  assert.match(plan.scheduling, /iteration-level/);
  assert.ok(plan.guardrails.some((guardrail) => /PreToolUse hot path/.test(guardrail)));
});

test('buildLegalAgentGovernancePlan enforces matter scope, privilege, citations, and approvals', () => {
  const plan = buildLegalAgentGovernancePlan({
    matter: 'matter-2026-06-litigation-a',
    agents: ['contract-review', 'brief-drafter'],
    actions: ['draft client email', 'summarize deposition'],
    privileged: true,
  });

  assert.equal(plan.status, 'ready-for-pilot');
  assert.equal(plan.approvalRequired, true);
  assert.ok(plan.gates.some((gate) => /unsupported-citation/.test(gate)));
  assert.ok(plan.gates.some((gate) => /matter-scoped memory/.test(gate)));
  assert.ok(plan.externalActions.includes('draft client email'));
});

test('buildDynamicWorkflowReadinessPlan rejects expensive workflows without objective oracle and budget', () => {
  const plan = buildDynamicWorkflowReadinessPlan({
    task: 'make the homepage feel better',
    parallelAgents: 2,
  });

  assert.equal(plan.status, 'use-single-agent-or-subagent');
  assert.ok(plan.missingEvidence.includes('objective success criteria'));
  assert.ok(plan.missingEvidence.includes('token or cost budget'));
});

test('buildDynamicWorkflowReadinessPlan allows only measured high-scale verifier work', () => {
  const plan = buildDynamicWorkflowReadinessPlan({
    task: 'migrate API auth middleware',
    successCriteria: ['unit tests pass', 'auth e2e passes', 'security scan clean'],
    parallelAgents: 6,
    tokenBudget: 120000,
    needsVerifier: true,
  });

  assert.equal(plan.status, 'ready-for-human-plan-review');
  assert.deepEqual(plan.missingEvidence, []);
  assert.ok(plan.gates.some((gate) => /versioned script plan/.test(gate)));
});

test('buildOpenModelCustomizationPlan requires proprietary signals plus benchmark proof', () => {
  const plan = buildOpenModelCustomizationPlan({
    workload: 'visual policy evidence retrieval',
    signals: ['screenshot embeddings', 'dashboard metadata'],
    runtimeEncoding: true,
    baselineCost: 1200,
    hasBenchmark: true,
  });

  assert.equal(plan.status, 'customize-and-benchmark');
  assert.equal(plan.runtimeEncodingRisk, 'high-latency-runtime-encoding');
  assert.ok(plan.gates.some((gate) => /precompute proprietary embeddings/.test(gate)));
});

test('buildDigitalPrCitationPlan prioritizes proof assets and earned citation share', () => {
  const plan = buildDigitalPrCitationPlan({
    proofAssets: ['https://thumbgate.ai/llm-context.md'],
    earnedMentions: ['Agentic.ai listing'],
    audiences: ['legal innovation teams'],
  });

  assert.equal(plan.status, 'ready-for-outreach');
  assert.ok(plan.gates.some((gate) => /citation share of voice/.test(gate)));
});

test('buildServerlessVectorPlan keeps private hot-path enforcement local by default', () => {
  const plan = buildServerlessVectorPlan({
    bursty: true,
    idleHours: 12,
    managedEndpoint: true,
    sensitiveLocalData: true,
  });

  assert.equal(plan.status, 'keep-local-or-prove-managed-fit');
  assert.ok(plan.gates.some((gate) => /local SQLite\/FTS\/vector stores/.test(gate)));
});

test('buildMemoryModelPlan upgrades behavior through sourced memory before retraining', () => {
  const plan = buildMemoryModelPlan({
    memories: ['lessons', 'matter facts'],
    sourcePointers: true,
  });

  assert.equal(plan.status, 'upgrade-with-memory-not-retraining');
  assert.ok(plan.gates.some((gate) => /outside the model weights/.test(gate)));
});

test('buildSandboxManifestPlan blocks long-running agents without safe manifest boundaries', () => {
  const plan = buildSandboxManifestPlan({
    manifestEntries: ['data'],
    outputDirs: ['out'],
    sandboxProvider: 'vercel',
    checkpointing: true,
  });

  assert.equal(plan.status, 'ready-for-sandboxed-agent-run');
  assert.deepEqual(plan.missingEvidence, []);
  assert.ok(plan.gates.some((gate) => /separate harness credentials/.test(gate)));
});

test('buildNetworkEgressFirewallPlan blocks unknown outbound agent targets', () => {
  const plan = buildNetworkEgressFirewallPlan({
    allowedDomains: ['api.github.com'],
    observedRequests: ['https://api.github.com/repos', 'https://unknown.example/upload'],
    liveDashboard: true,
  });

  assert.equal(plan.status, 'block-unknown-egress');
  assert.ok(plan.unknownRequests.includes('https://unknown.example/upload'));
  assert.match(plan.dashboard, /live request table/);
});

test('buildSupplyChainVettingPlan quarantines unvetted GitHub npm and PyPI artifacts', () => {
  const plan = buildSupplyChainVettingPlan({
    sources: ['npm:left-pad', 'pypi:some-lib'],
    sandbox: true,
    aiAudit: true,
    autoUpdatesDisabled: true,
    installScriptsDisabled: true,
    exfilTargets: ['GitHub Contents API', 'HuggingFace datasets'],
  });

  assert.equal(plan.status, 'ready-to-promote-dependency');
  assert.deepEqual(plan.missingEvidence, []);
  assert.ok(plan.exfilTargets.includes('HuggingFace datasets'));
  assert.ok(plan.gates.some((gate) => /disable auto-update/.test(gate)));
  assert.ok(plan.gates.some((gate) => /postinstall scripts/.test(gate)));
});

test('buildCodeQualityEnablementPlan describes the GitHub repository setup API', () => {
  const plan = buildCodeQualityEnablementPlan({
    owner: 'IgorGanapolsky',
    repo: 'ThumbGate',
    languages: ['javascript-typescript', 'python'],
  });

  assert.equal(plan.status, 'enable-or-confirm-code-quality');
  assert.ok(plan.endpoints.some((endpoint) => /code-quality\/setup/.test(endpoint)));
  assert.ok(plan.gates.some((gate) => /retrieve current GitHub Code Quality setup/.test(gate)));
});

test('buildMediaAssetGovernancePlan requires brand rights and claim review for generated ads', () => {
  const plan = buildMediaAssetGovernancePlan({
    assets: ['codex-plugin-launch-video'],
    assetTypes: ['product-mockup', 'ad-campaign', 'captioned-short'],
    brandKit: true,
    rightsProof: true,
    claimReview: true,
    dynamicSubtitles: true,
  });

  assert.equal(plan.status, 'ready-to-generate-assets');
  assert.ok(plan.assetTypes.includes('captioned-short'));
  assert.equal(plan.dynamicSubtitles, true);
  assert.ok(plan.gates.some((gate) => /rights proof/.test(gate)));
  assert.ok(plan.gates.some((gate) => /caption\/subtitle review/.test(gate)));
});

test('buildOutputFormatPlan chooses HTML for interactive reports and Markdown for repo-native docs', () => {
  const htmlPlan = buildOutputFormatPlan({ artifactType: 'pricing comparison', interactive: true });
  const markdownPlan = buildOutputFormatPlan({ artifactType: 'audit log', repoNative: true });

  assert.equal(htmlPlan.format, 'html');
  assert.equal(markdownPlan.format, 'markdown');
  assert.ok(htmlPlan.gates.some((gate) => /HTML for dense decision reports/.test(gate)));
});

test('buildMarketingAgencyGtmPlan packages ThumbGate as a proof-led lead-gen offer', () => {
  const plan = buildMarketingAgencyGtmPlan({
    channels: ['lead-generation', 'social', 'seo'],
    monthlyRetainer: 1000,
    proofAssets: ['https://thumbgate.ai/llm-context.md'],
    crmAutomation: true,
    scheduledContent: true,
    qualityReview: true,
  });

  assert.equal(plan.status, 'ready-to-sell-workflow-sprint');
  assert.equal(plan.offer, 'AI Agent Governance Workflow Hardening Sprint');
  assert.ok(plan.gates.some((gate) => /not generic AI automation/.test(gate)));
});

test('buildBedrockAgentCorePlan requires identity memory and observability before AWS multi-agent rollout', () => {
  const blocked = buildBedrockAgentCorePlan({ frameworks: ['LangGraph'], serverless: true });
  const ready = buildBedrockAgentCorePlan({
    frameworks: ['LangGraph'],
    serverless: true,
    memory: true,
    observability: true,
    identity: true,
  });

  assert.equal(blocked.status, 'missing-production-agent-controls');
  assert.ok(blocked.missingEvidence.includes('AgentCore Memory or equivalent checkpoint proof'));
  assert.equal(ready.status, 'ready-for-agentcore-pilot');
  assert.ok(ready.gates.some((gate) => /OpenTelemetry-compatible traces/.test(gate)));
});
