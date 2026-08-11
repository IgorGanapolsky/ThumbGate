const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  DEFAULT_CATALOG_PATH,
  DEFAULT_TOKENIZER_BRITTLENESS_CASES,
  buildBenchmarkPlan,
  buildModelCandidatesReport,
  buildTokenizerBrittlenessPlan,
  detectTokenizerBrittlenessSignals,
  evaluateTokenizerBrittlenessCases,
  getModelCandidatesReportPath,
  loadCatalog,
  recommendCandidates,
  renderModelCandidatesReport,
  writeModelCandidatesReport,
} = require('../scripts/model-candidates');

test('model candidate catalog includes Kimi K2.6 and Qwen3.6 variants', () => {
  const catalog = loadCatalog(DEFAULT_CATALOG_PATH);
  const ids = new Set(catalog.candidates.map((candidate) => candidate.id));

  assert.ok(ids.has('openai/gpt-5.5'));
  assert.ok(ids.has('tinker/kimi-k2.6-32k'));
  assert.ok(ids.has('tinker/kimi-k2.6-128k'));
  assert.ok(ids.has('tinker/qwen3.6-35b-a3b'));
  assert.ok(ids.has('tinker/qwen3.6-27b'));
  assert.ok(ids.has('self-hosted/deepseek-v4-flash-sglang'));
  assert.ok(ids.has('self-hosted/deepseek-v4-pro-sglang'));
  assert.ok(ids.has('research/fast-byte-latent-transformer'));
  assert.ok(ids.has('nousresearch/hermes-3-llama-3.1-70b'));
  assert.ok(ids.has('anthropic/claude-opus-4-8'));
  assert.ok(ids.has('google/gemini-3.1-pro-preview'));
  // vlt model candidates
  assert.ok(ids.has('vlt/vlt-registry-hosted'));
  assert.ok(ids.has('vlt/vlt-vsr-self-hosted'));
  // Hugging Face Context Course model candidate
  assert.ok(ids.has('huggingface/context-engineering-agent'));
  // NVIDIA Nemotron 3.5 Lightning + NeMo Switchyard
  assert.ok(ids.has('nvidia/nemotron-3.5-lightning'));
  assert.ok(ids.has('nvidia/nemo-switchyard'));
  // Alibaba Model Studio (Qwen role tiers + embeddings)
  assert.ok(ids.has('alibaba/qwen3.8-max'));
  assert.ok(ids.has('alibaba/qwen3.7-plus'));
  assert.ok(ids.has('alibaba/qwen3.6-flash'));
  assert.ok(ids.has('alibaba/text-embedding-v4'));
||||||| f1b48e78a
});

test('recommendCandidates prefers Nous Research Hermes for skill synthesis', () => {
  const report = recommendCandidates({
    workload: 'self-improving-agent-skill-synthesis',
    provider: 'openrouter',
    maxCandidates: 2,
  });

  assert.equal(report.recommended[0].id, 'nousresearch/hermes-3-llama-3.1-70b');
  assert.ok(report.recommended[0].matchedStrengths.includes('self-evolving'));
  assert.ok(report.recommended[0].matchedStrengths.includes('skill-synthesis'));
});

test('recommendCandidates prefers GPT-5.5 for dashboard analysis', () => {
  const report = recommendCandidates({
    workload: 'dashboard-analysis',
    provider: 'openai',
    maxCandidates: 2,
  });

  assert.equal(report.recommended[0].id, 'openai/gpt-5.5');
  assert.ok(report.recommended[0].matchedStrengths.includes('data-analysis'));
  assert.ok(report.recommended[0].matchedStrengths.includes('dashboard-creation'));
  assert.ok(report.recommended[0].benchmarkPlan.metrics.includes('chartSpecValidity'));
});

test('model candidate catalog includes js-package-registry-governance workload', () => {
  const catalog = loadCatalog(DEFAULT_CATALOG_PATH);
  const workload = catalog.workloads['js-package-registry-governance'];

  assert.ok(workload, 'js-package-registry-governance workload must exist');
  assert.ok(workload.desiredStrengths.includes('supply-chain-security'));
  assert.ok(workload.desiredStrengths.includes('audit-trail'));
  assert.ok(workload.metrics.includes('dependencyAuditRecall'));
  assert.ok(workload.metrics.includes('typosquattingDetectionRate'));
  assert.ok(workload.metrics.includes('registryOverrideBlockRate'));
  assert.ok(workload.metrics.includes('provenanceAttestationRate'));
});

test('recommendCandidates supports js-package-registry-governance workload', () => {
  const report = recommendCandidates({
    workload: 'js-package-registry-governance',
    provider: 'vlt',
    maxCandidates: 2,
  });

  assert.equal(report.workloadId, 'js-package-registry-governance');
  assert.equal(report.recommended.length, 2);
  assert.ok(report.recommended.some((candidate) => candidate.id === 'vlt/vlt-registry-hosted'));
  assert.ok(report.recommended.some((candidate) => candidate.id === 'vlt/vlt-vsr-self-hosted'));
  assert.ok(report.recommended[0].matchedStrengths.includes('supply-chain-security'));
  assert.ok(report.recommended[0].benchmarkPlan.metrics.includes('dependencyAuditRecall'));
});

test('model candidate catalog includes context-engineering workload', () => {
  const catalog = loadCatalog(DEFAULT_CATALOG_PATH);
  const workload = catalog.workloads['context-engineering'];

  assert.ok(workload, 'context-engineering workload must exist');
  assert.ok(workload.desiredStrengths.includes('context-structuring'));
  assert.ok(workload.desiredStrengths.includes('skill-synthesis'));
  assert.ok(workload.desiredStrengths.includes('MCP-governance'));
  assert.ok(workload.metrics.includes('contextFreshnessRate'));
  assert.ok(workload.metrics.includes('skillValidationAccuracy'));
  assert.ok(workload.metrics.includes('mcpToolSafetyRate'));
});

test('recommendCandidates supports context-engineering workload with HuggingFace candidate', () => {
  const report = recommendCandidates({
    workload: 'context-engineering',
    provider: 'huggingface',
    maxCandidates: 1,
  });

  assert.equal(report.workloadId, 'context-engineering');
  assert.ok(report.recommended.length >= 1);
  assert.equal(report.recommended[0].id, 'huggingface/context-engineering-agent');
  assert.ok(report.recommended[0].matchedStrengths.includes('context-structuring'));
  assert.ok(report.recommended[0].matchedStrengths.includes('skill-synthesis'));
});

test('recommendCandidates prefers Qwen 3.6 35B A3B for pretool gating', () => {
  const report = recommendCandidates({
    workload: 'pretool-gating',
    provider: 'openai-compatible',
    gateway: 'tinker',
    maxCandidates: 2,
  });

  assert.equal(report.recommended[0].id, 'tinker/qwen3.6-35b-a3b');
  assert.ok(report.recommended[0].matchedStrengths.includes('agentic-coding'));
  assert.ok(report.recommended[0].matchedStrengths.includes('tool-use'));
});

test('recommendCandidates prefers Kimi K2.6 128k for long trace review', () => {
  const report = recommendCandidates({
    workload: 'long-trace-review',
    provider: 'openai-compatible',
    gateway: 'tinker',
    maxCandidates: 2,
  });

  assert.equal(report.recommended[0].id, 'tinker/kimi-k2.6-128k');
  assert.ok(report.recommended[0].matchedStrengths.includes('long-horizon-coding'));
  assert.ok(report.recommended[0].matchedStrengths.includes('multi-agent'));
});

test('recommendCandidates supports self-hosted DeepSeek-V4 for long-context review', () => {
  const report = recommendCandidates({
    workload: 'long-trace-review',
    provider: 'self-hosted',
    family: 'deepseek',
    maxCandidates: 2,
  });

  assert.equal(report.recommended[0].id, 'self-hosted/deepseek-v4-pro-sglang');
  assert.ok(report.recommended[0].matchedStrengths.includes('long-context'));
  assert.ok(report.recommended[0].benchmarkPlan.commands.some((entry) => entry.command.includes('deepseek-v4-runtime-guardrails')));
});

test('tokenizer brittleness detector catches byte-sensitive ThumbGate inputs', () => {
  const signals = detectTokenizerBrittlenessSignals('OPENAI_API_KEY=sk-prоj-test\u200b\nat run (/repo/src/api/server.js:12:9)');

  assert.ok(signals.includes('secret-like'));
  assert.ok(signals.includes('unicode-confusable'));
  assert.ok(signals.includes('zero-width'));
  assert.ok(signals.includes('stack-trace'));
  assert.ok(signals.includes('file-path'));
});

test('tokenizer brittleness eval covers JSONL, Unicode, stack, SQL, and code fixtures', () => {
  const evaluation = evaluateTokenizerBrittlenessCases(DEFAULT_TOKENIZER_BRITTLENESS_CASES);

  assert.equal(evaluation.caseCount, 5);
  assert.equal(evaluation.passed, true);
  assert.ok(evaluation.coveredSignals.includes('malformed-json'));
  assert.ok(evaluation.coveredSignals.includes('unicode-confusable'));
  assert.ok(evaluation.coveredSignals.includes('stack-trace'));
  assert.ok(evaluation.coveredSignals.includes('sql'));
  assert.ok(evaluation.coveredSignals.includes('code-symbols'));
  assert.ok(evaluation.cases.some((entry) => entry.byteToCodePointRatio > 1));
});

test('recommendCandidates treats Fast BLT as a research-only tokenizer-brittleness benchmark target', () => {
  const report = recommendCandidates({
    workload: 'tokenizer-brittleness',
    provider: 'research',
    maxCandidates: 1,
  });

  assert.equal(report.recommended[0].id, 'research/fast-byte-latent-transformer');
  assert.ok(report.recommended[0].matchedStrengths.includes('tokenizer-free'));
  assert.ok(report.recommended[0].readinessNotes.some((note) => note.includes('research-only')));
  assert.ok(report.recommended[0].benchmarkPlan.metrics.includes('symbolPreservationRate'));
});

test('tokenizer brittleness report blocks production routing until benchmark evidence exists', () => {
  const report = buildModelCandidatesReport({
    workload: 'tokenizer-brittleness',
    provider: 'research',
    maxCandidates: 1,
  });

  assert.equal(report.tokenizerBrittleness.evaluation.passed, true);
  assert.equal(report.tokenizerBrittleness.routingPolicy.allowProductionRouting, false);
  assert.match(report.tokenizerBrittleness.routingPolicy.reason, /research direction/i);
});

test('buildTokenizerBrittlenessPlan keeps high-ROI recommendations dependency-free', () => {
  const plan = buildTokenizerBrittlenessPlan();

  assert.equal(plan.name, 'tokenizer-brittleness-readiness');
  assert.ok(plan.recommendations.some((item) => /Do not add a BLT runtime dependency/i.test(item)));
  assert.equal(plan.routingPolicy.productionDefault, 'existing-token-models-with-gates');
});

test('buildBenchmarkPlan anchors candidates to ThumbGate eval commands', () => {
  const catalog = loadCatalog(DEFAULT_CATALOG_PATH);
  const candidate = catalog.candidates.find((entry) => entry.id === 'tinker/qwen3.6-35b-a3b');
  const workload = { id: 'pretool-gating', ...catalog.workloads['pretool-gating'] };
  const plan = buildBenchmarkPlan(candidate, workload);

  assert.equal(plan.candidateId, 'tinker/qwen3.6-35b-a3b');
  assert.equal(plan.commands.length, 3);
  assert.ok(plan.commands.some((entry) => entry.command.includes('thumbgate bench')));
  assert.ok(plan.commands.some((entry) => entry.command.includes('gate-eval')));
  assert.ok(plan.metrics.includes('costPer1kActionsUsd'));
});

test('writeModelCandidatesReport writes a machine-readable report', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-model-candidates-'));
  try {
    const { reportPath, report } = writeModelCandidatesReport(tmpDir, {
      workload: 'cheap-fast-path',
      provider: 'openai-compatible',
      gateway: 'tinker',
    });
    assert.equal(report.recommended[0].id, 'tinker/qwen3.6-35b-a3b');
    assert.equal(reportPath, getModelCandidatesReportPath(tmpDir));
    assert.ok(fs.existsSync(reportPath));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('renderModelCandidatesReport emits readable workload summary', () => {
  const report = buildModelCandidatesReport({
    workload: 'pretool-gating',
    provider: 'openai-compatible',
    gateway: 'tinker',
    maxCandidates: 1,
  });
  const markdown = renderModelCandidatesReport(report);

  assert.match(markdown, /Managed Model Candidates/);
  assert.match(markdown, /tinker\/qwen3.6-35b-a3b/);
  assert.match(markdown, /thumbgate bench/);
});

test('renderModelCandidatesReport includes tokenizer brittleness readiness for byte-level workload', () => {
  const report = buildModelCandidatesReport({
    workload: 'tokenizer-brittleness',
    provider: 'research',
    maxCandidates: 1,
  });
  const markdown = renderModelCandidatesReport(report);

  assert.match(markdown, /Tokenizer brittleness readiness/);
  assert.match(markdown, /research-only/);
  assert.match(markdown, /blocked until benchmarked/);
});

test('model-candidates CLI prints JSON report when requested', () => {
  const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-model-candidates-cli-'));
  const feedbackDir = path.join(isolatedDir, 'feedback');
  try {
    const stdout = execFileSync(
      process.execPath,
      ['bin/cli.js', 'model-candidates', '--workload=long-trace-review', '--provider=openai-compatible', '--gateway=tinker', '--json'],
      {
        cwd: path.join(__dirname, '..'),
        env: {
          ...process.env,
          THUMBGATE_FEEDBACK_DIR: feedbackDir,
          THUMBGATE_NO_NUDGE: '1',
        },
        encoding: 'utf8',
      },
    );
    const payload = JSON.parse(stdout);

    assert.equal(payload.report.recommended[0].id, 'tinker/kimi-k2.6-128k');
    assert.ok(fs.existsSync(payload.reportPath));
  } finally {
    fs.rmSync(isolatedDir, { recursive: true, force: true });
  }
});

test('model-candidates CLI supports dashboard analysis workload', () => {
  const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-model-dashboard-cli-'));
  const feedbackDir = path.join(isolatedDir, 'feedback');
  try {
    const stdout = execFileSync(
      process.execPath,
      ['bin/cli.js', 'model-candidates', '--workload=dashboard-analysis', '--provider=openai', '--json'],
      {
        cwd: path.join(__dirname, '..'),
        env: {
          ...process.env,
          THUMBGATE_FEEDBACK_DIR: feedbackDir,
          THUMBGATE_NO_NUDGE: '1',
        },
        encoding: 'utf8',
      },
    );
    const payload = JSON.parse(stdout);

    assert.equal(payload.report.workload.id, 'dashboard-analysis');
    assert.equal(payload.report.recommended[0].id, 'openai/gpt-5.5');
    assert.match(payload.report.summary, /gpt-5\.5/i);
  } finally {
    fs.rmSync(isolatedDir, { recursive: true, force: true });
  }
});

test('model-candidates CLI supports tokenizer brittleness workload', () => {
  const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-model-tokenizer-cli-'));
  const feedbackDir = path.join(isolatedDir, 'feedback');
  try {
    const stdout = execFileSync(
      process.execPath,
      ['bin/cli.js', 'model-candidates', '--workload=tokenizer-brittleness', '--provider=research', '--json'],
      {
        cwd: path.join(__dirname, '..'),
        env: {
          ...process.env,
          THUMBGATE_FEEDBACK_DIR: feedbackDir,
          THUMBGATE_NO_NUDGE: '1',
        },
        encoding: 'utf8',
      },
    );
    const payload = JSON.parse(stdout);

    assert.equal(payload.report.workload.id, 'tokenizer-brittleness');
    assert.equal(payload.report.recommended[0].id, 'research/fast-byte-latent-transformer');
    assert.equal(payload.report.tokenizerBrittleness.routingPolicy.allowProductionRouting, false);
    assert.ok(fs.existsSync(payload.reportPath));
  } finally {
    fs.rmSync(isolatedDir, { recursive: true, force: true });
  }
});

test('recommendCandidates supports custom workload file', () => {
  const tmpWorkloadPath = path.join(os.tmpdir(), `custom-workload-${Date.now()}.json`);
  const customWorkload = {
    id: 'custom-data-analysis',
    label: 'Custom Data Analysis Workload',
    summary: 'A custom rubric focused on data-analysis and charting.',
    desiredStrengths: ['data-analysis', 'charting'],
    targetContextWindow: 128000,
    benchmarkCommands: ['npx thumbgate bench --custom'],
    metrics: ['chartSpecValidity']
  };

  fs.writeFileSync(tmpWorkloadPath, JSON.stringify(customWorkload, null, 2));

  try {
    const report = recommendCandidates({
      workloadFile: tmpWorkloadPath,
      provider: 'openai',
      maxCandidates: 1
    });

    assert.equal(report.workloadId, 'custom-data-analysis');
    assert.equal(report.recommended[0].id, 'openai/gpt-5.5');
    assert.ok(report.recommended[0].matchedStrengths.includes('data-analysis'));
    assert.equal(report.recommended[0].benchmarkPlan.commands[0].command, 'npx thumbgate bench --custom');
  } finally {
    fs.rmSync(tmpWorkloadPath, { force: true });
  }
});

test('model-candidates CLI supports custom workload file via --workload-file', () => {
  const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-model-custom-cli-'));
  const feedbackDir = path.join(isolatedDir, 'feedback');
  const tmpWorkloadPath = path.join(isolatedDir, 'custom-workload.json');

  const customWorkload = {
    id: 'custom-tool-gating',
    label: 'Custom Tool Gating Workload',
    summary: 'Custom rubric for pretool gating.',
    desiredStrengths: ['agentic-coding', 'tool-use'],
    targetContextWindow: 64000,
    benchmarkCommands: ['npx thumbgate bench --custom-gating'],
    metrics: ['passRate']
  };

  fs.writeFileSync(tmpWorkloadPath, JSON.stringify(customWorkload, null, 2));

  try {
    const stdout = execFileSync(
      process.execPath,
      ['bin/cli.js', 'model-candidates', `--workload-file=${tmpWorkloadPath}`, '--provider=openai-compatible', '--gateway=tinker', '--json'],
      {
        cwd: path.join(__dirname, '..'),
        env: {
          ...process.env,
          THUMBGATE_FEEDBACK_DIR: feedbackDir,
          THUMBGATE_NO_NUDGE: '1',
        },
        encoding: 'utf8',
      },
    );
    const payload = JSON.parse(stdout);

    assert.equal(payload.report.workload.id, 'custom-tool-gating');
    assert.equal(payload.report.recommended[0].id, 'tinker/qwen3.6-35b-a3b');
    assert.ok(payload.report.recommended[0].matchedStrengths.includes('agentic-coding'));
    assert.equal(payload.report.recommended[0].benchmarkPlan.commands[0].command, 'npx thumbgate bench --custom-gating');
  } finally {
    fs.rmSync(isolatedDir, { recursive: true, force: true });
  }
});

test('model-candidates CLI supports custom workload file via --workloadFile', () => {
  const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-model-custom-cli-camel-'));
  const feedbackDir = path.join(isolatedDir, 'feedback');
  const tmpWorkloadPath = path.join(isolatedDir, 'custom-workload.json');

  const customWorkload = {
    id: 'custom-tool-gating-camel',
    label: 'Custom Tool Gating Camel Workload',
    summary: 'Custom rubric for pretool gating.',
    desiredStrengths: ['agentic-coding', 'tool-use'],
    targetContextWindow: 64000,
    benchmarkCommands: ['npx thumbgate bench --custom-gating-camel'],
    metrics: ['passRate']
  };

  fs.writeFileSync(tmpWorkloadPath, JSON.stringify(customWorkload, null, 2));

  try {
    const stdout = execFileSync(
      process.execPath,
      ['bin/cli.js', 'model-candidates', '--workloadFile', tmpWorkloadPath, '--provider=openai-compatible', '--gateway=tinker', '--json'],
      {
        cwd: path.join(__dirname, '..'),
        env: {
          ...process.env,
          THUMBGATE_FEEDBACK_DIR: feedbackDir,
          THUMBGATE_NO_NUDGE: '1',
        },
        encoding: 'utf8',
      },
    );
    const payload = JSON.parse(stdout);

    assert.equal(payload.report.workload.id, 'custom-tool-gating-camel');
    assert.equal(payload.report.recommended[0].id, 'tinker/qwen3.6-35b-a3b');
  } finally {
    fs.rmSync(isolatedDir, { recursive: true, force: true });
  }
});

