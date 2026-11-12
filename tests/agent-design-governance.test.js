'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAgentDesignGovernancePlan,
  normalizeOptions,
  scoreToolRisk,
} = require('../scripts/agent-design-governance');

test('agent design governance keeps simple workflows single-agent while requiring evals', () => {
  const plan = buildAgentDesignGovernancePlan({
    workflow: 'lesson recall before PR review',
    tools: ['search_lessons', 'prevention_rules', 'dashboard'],
    docs: true,
    examples: true,
    'edge-cases': true,
    'exit-condition': true,
  });

  assert.equal(plan.recommendation.architecture, 'single_agent');
  assert.equal(plan.instructionQuality.score, 100);
  assert.equal(plan.status, 'needs_work');
  assert.ok(plan.blockers.some((blocker) => blocker.id === 'baseline_evals_required'));
});

test('agent design governance recommends manager pattern for tool overload', () => {
  const plan = buildAgentDesignGovernancePlan({
    workflow: 'support automation',
    'tool-count': 14,
    'similar-tool-count': 5,
    'conditional-branches': 10,
    'baseline-evals': true,
    docs: true,
    examples: true,
    'edge-cases': true,
    'exit-condition': true,
    'tool-approvals': true,
    'reversible-actions': true,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.recommendation.architecture, 'manager');
  assert.ok(plan.recommendation.triggers.includes('tool_overload'));
  assert.ok(plan.recommendation.triggers.includes('instruction_complexity'));
});

test('agent design governance blocks high-risk tools without approvals', () => {
  const options = normalizeOptions({
    tools: ['stripe_refund', 'send_email'],
    'write-tools': 'stripe_refund,send_email',
  });
  const risk = scoreToolRisk(options);
  const plan = buildAgentDesignGovernancePlan({
    workflow: 'billing recovery agent',
    tools: ['stripe_refund', 'send_email'],
    'write-tools': 'stripe_refund,send_email',
    'baseline-evals': true,
  });

  assert.equal(risk.risk, 'high');
  assert.equal(plan.status, 'blocked');
  assert.ok(plan.blockers.some((blocker) => blocker.id === 'tool_approval_required'));
});

test('Adobe Creative MCP & GenStudio Brand Intelligence block destructive layer flatten and cross-brand RealEstate conflation', () => {
  const {
    verifyNonDestructiveProjectEdit,
    evaluateBrandAdherence,
  } = require('../src/openshell-lovable-engine');

  const blockedPsd = verifyNonDestructiveProjectEdit({
    targetPath: 'brand/hero-banner.psd',
    operation: 'flatten_visible_layers',
  });
  assert.equal(blockedPsd.allowed, false);
  assert.equal(blockedPsd.reason, 'destructive_layer_flatten_blocked');
  assert.equal(blockedPsd.suggestedPatch.outputPath, 'brand/hero-banner.export.psd');

  const safePsd = verifyNonDestructiveProjectEdit({
    targetPath: 'brand/hero-banner.psd',
    outputPath: 'brand/hero-banner.flat.psd',
    operation: 'flatten_visible_layers',
  });
  assert.equal(safePsd.allowed, true);

  const conflatedPost = evaluateBrandAdherence(
    'Ship safer Claude Code hooks with ThumbGate — and grab our Miami-Dade F.S. 197.552 5-Folio tax-deed packet at https://deals.igorganapolsky.com!',
    { disallowedClaims: ['7-day refund guarantee', '1,000 hosted gate credits'], requireDisclosure: true },
  );
  assert.equal(conflatedPost.compliant, false);
  assert.ok(conflatedPost.violations.some((v) => v.id === 'other_business_conflation'));
  assert.ok(conflatedPost.violations.some((v) => v.id === 'missing_builder_disclosure'));

  const cleanPost = evaluateBrandAdherence(
    'Block destructive AI tool calls in <0.5ms with npx thumbgate init (https://thumbgate.ai). Disclosure: I build it.',
    { disallowedClaims: ['7-day refund guarantee'], requireDisclosure: true },
  );
  assert.equal(cleanPost.compliant, true);
});

test('Lovable AST self-correcting design engine inherits ancestor bg, mutates JSX style={{}}, and converts visual-model findings into inline edits + CSS + Tailwind', () => {
  const { execFileSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { parseDesignAst, inspectAndPatchDesignSource, remediateVisualFindings, computeContrastRatio } = require('../src/openshell-lovable-engine');

  const brokenMarkup = [
    '<section id="hero" className="w-[640px] bg-slate-950">',
    '  <div className="card-shell">',
    '    <p className="hero-sub text-slate-600">Low contrast inherited from ancestor</p>',
    '    <span id="jsx-pill" style={{ color: \'#475569\', width: 520, height: 28 }} role="button">JSX Style AST</span>',
    '    <button className="cta-btn h-6 p-1 outline-none text-slate-500">Save</button>',
    '  </div>',
    '</section>',
  ].join('\n');

  const ast = parseDesignAst(brokenMarkup, '#ffffff');
  assert.equal(ast.nodes.find((n) => n.tagName === 'p').inheritedBgHex, '#020617');

  const report = inspectAndPatchDesignSource(brokenMarkup, { defaultBgHex: '#ffffff' });
  assert.equal(report.changed, true);
  assert.ok(report.inlineEdits.length >= 4);
  assert.ok(report.cssOverrides.length >= 4);
  assert.match(report.stylesheetOverride, /p\.hero-sub \{ color: #[0-9a-f]{6}; \}/i);
  assert.match(report.patchedSource, /\bw-full\b[\s\S]*max-w-\[640px\]/);
  assert.match(report.patchedSource, /min-h-11 min-w-11 px-4 py-2\.5/);
  assert.match(report.patchedSource, /focus-visible:ring-2/);
  assert.match(report.patchedSource, /maxWidth: '520px'/);
  assert.match(report.patchedSource, /minHeight: '44px'/);
  assert.doesNotMatch(report.patchedSource, /text-slate-600/);
  assert.ok(computeContrastRatio('#cbd5e1', '#020617') >= 4.5);

  const visualFixed = remediateVisualFindings(
    '<div className="bg-slate-900"><p className="caption">Passive visual finding</p><button id="buy">Buy</button></div>',
    ['The text contrast is too low on .caption', { selector: '#buy', issue: 'tap_target_too_small' }],
  );
  assert.equal(visualFixed.changed, true);
  assert.match(visualFixed.patchedSource, /caption text-slate-300/);
  assert.match(visualFixed.patchedSource, /id="buy" className="min-h-11 min-w-11 px-4 py-2\.5"/);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-openshell-cli-'));
  try {
    const candPath = path.join(tmpDir, 'cand.json');
    const boundPath = path.join(tmpDir, 'bound.json');
    const uiPath = path.join(tmpDir, 'card.tsx');
    fs.writeFileSync(candPath, JSON.stringify({ filesystem_policy: { read_only: ['/usr'] } }));
    fs.writeFileSync(boundPath, JSON.stringify({ filesystem_policy: { read_only: ['/usr', '/etc'] } }));
    fs.writeFileSync(uiPath, '<div className="bg-slate-900"><p className="sub">Hello</p></div>');
    const proveOut = execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'cli.js'), 'policy-prove', candPath, '--boundary', boundPath, '--json'], { encoding: 'utf8' });
    assert.equal(JSON.parse(proveOut).result, 'within_boundary');
    execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'cli.js'), 'design-fix', uiPath, '--findings', 'The text contrast is too low on .sub', '--write'], { encoding: 'utf8' });
    assert.match(fs.readFileSync(uiPath, 'utf8'), /text-slate-300/);
    fs.writeFileSync(uiPath, '<button style={{ minHeight: "20px" }}>Click</button>');
    execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'cli.js'), 'design-fix', uiPath, '--write'], { encoding: 'utf8' });
    assert.match(fs.readFileSync(uiPath, 'utf8'), /minHeight: '44px'/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ThumbGate pipeline outputs active AST inline edits, CSS overrides, and Tailwind adjustments across JSX {...}, CSS, PreToolUse, MCP, guardrails, and /v1/design/self-correct', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { runDesignSelfCorrectionPipeline } = require('../src/openshell-lovable-engine');
  const { evaluateSidewaysEnterpriseGuardrails } = require('../src/mckinsey-top-company-ai-coding');
  const gatesEngine = require('../scripts/gates-engine');
  const { callTool } = require('../adapters/mcp/server-stdio');

  // 1. Real JSX balanced-brace AST (with `>` inside arrow fn + `{...rest}`) + HSL hue preservation + CSS <style> AST
  const realJsx = [
    '<style>.card-wrap { background-color: #0f172a; } .tiny-btn { height: 28px; color: #475569; }</style>',
    '<div className="card-wrap" {...restProps}>',
    '  <button id="act" onClick={() => setCount(count > 0 ? count + 1 : 1)} className="h-6 text-blue-700 outline-none">Run</button>',
    '</div>',
  ].join('\n');
  const jsxPipeline = runDesignSelfCorrectionPipeline({ sourceCode: realJsx });
  assert.equal(jsxPipeline.ok, true);
  assert.equal(jsxPipeline.verification.remainingIssueCount, 0);
  assert.match(jsxPipeline.patchedSource, /min-h-11 min-w-11 px-4 py-2\.5/);
  assert.match(jsxPipeline.patchedSource, /text-blue-(?:200|300|400)/);
  assert.match(jsxPipeline.patchedSource, /focus-visible:ring-2/);
  assert.match(jsxPipeline.patchedSource, /\.tiny-btn \{[^}]*min-height: 44px;/);
  assert.ok(jsxPipeline.inlineEdits.every((e) => typeof e.expectedChunkHash === 'string' && e.expectedChunkHash.length === 16));

  // 2. Enterprise guardrails emit active remediation instead of passive text
  const guard = evaluateSidewaysEnterpriseGuardrails({
    upstreamSignals: ['posthog'],
    releaseChecklistComplete: true,
    complianceTags: ['pretool_diode_verified'],
    uiPalette: {
      selector: '.status-badge',
      foregroundHex: '#475569',
      backgroundHex: '#0f172a',
      reliesOnRedGreenOnly: true,
      hasNonColorShapeOrLabel: false,
      layoutSource: '<span className="status-badge text-slate-600">Failing</span>',
    },
  });
  const contrastFinding = guard.findings.find((f) => f.code === 'accessibility_contrast_violation');
  const cbFinding = guard.findings.find((f) => f.code === 'colorblind_accessibility_violation');
  assert.ok(contrastFinding.remediation.cssOverrides.cssRule.includes('color:'));
  assert.ok(contrastFinding.remediation.tailwindAdjustments.add.length > 0);
  assert.ok(contrastFinding.remediation.inlineCodeEdit.after.includes('status-badge'));
  assert.ok(cbFinding.remediation.cssOverrides.cssRule.includes('underline'));
  assert.match(guard.selfCorrection.patchedSource, /underline decoration-2/);

  // 3. PreToolUse hook pipeline (`gates-engine.runAsync`) + MCP `gate_check` and `suggest_fix`
  const rawHook = await gatesEngine.runAsync({
    tool_name: 'Write',
    tool_input: { file_path: 'src/Hero.tsx', content: '<div className="bg-slate-950"><p className="sub text-slate-600">Low</p></div>' },
  });
  const parsedHook = JSON.parse(rawHook);
  assert.match(parsedHook.hookSpecificOutput.additionalContext, /\[ThumbGate Active Design Engine\]/);
  assert.match(parsedHook.hookSpecificOutput.additionalContext, /Tailwind \+\[text-slate-300\]/);

  const mcpGate = JSON.parse((await callTool('gate_check', {
    tool_name: 'Write',
    tool_input: { file_path: 'src/Button.tsx', content: '<button className="h-5">Tap</button>' },
  })).content[0].text);
  assert.ok(mcpGate.designSelfCorrection.issueCount >= 1);
  assert.match(mcpGate.designSelfCorrection.patchedSource, /min-h-11/);

  const mcpFix = JSON.parse((await callTool('suggest_fix', {
    context: 'The text contrast is too low on .caption',
  })).content[0].text);
  assert.equal(mcpFix.suggestions[0].source, 'lovable-ast-design-engine');
  assert.ok(mcpFix.designSelfCorrection.cssOverrides.length >= 1);

  // 4. Hosted API (`POST /v1/design/self-correct` & `/v1/gates/decide`) + live `public/index.html` >= 44px tap targets
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-design-http-'));
  const savedKey = process.env.THUMBGATE_API_KEY;
  const savedFb = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_API_KEY = 'tg-test-design-key';
  process.env.THUMBGATE_FEEDBACK_DIR = tmpRoot;
  const { startServer } = require('../src/api/server');
  const handle = await startServer({ port: 0, host: '127.0.0.1' });
  try {
    const origin = `http://127.0.0.1:${handle.server.address().port}`;
    const scRes = await fetch(`${origin}/v1/design/self-correct`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceCode: '<div className="bg-slate-900"><p className="lead">Text</p></div>',
        visualFindings: ['The text contrast is too low on .lead'],
      }),
    });
    assert.equal(scRes.status, 200);
    const scJson = await scRes.json();
    assert.equal(scJson.ok, true);
    assert.equal(scJson.mode, 'active_self_correcting_design_engine');
    assert.match(scJson.patchedSource, /lead text-slate-300/);

    const gdRes = await fetch(`${origin}/v1/gates/decide`, {
      method: 'POST',
      headers: { authorization: 'Bearer tg-test-design-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        toolName: 'Write',
        toolArgs: { file_path: 'public/card.html', content: '<button style="min-height: 24px">Go</button>' },
      }),
    });
    assert.equal(gdRes.status, 200);
    const gdJson = await gdRes.json();
    assert.match(gdJson.designSelfCorrection.patchedSource, /min-height: 44px/);

    const nullFindingsRes = await fetch(`${origin}/v1/gates/decide`, {
      method: 'POST',
      headers: { authorization: 'Bearer tg-test-design-key', 'content-type': 'application/json' },
      body: JSON.stringify({ toolName: 'Write', toolArgs: { file_path: 'public/card.html', content: '<div>ok</div>' }, visualFindings: [null, 42] }),
    });
    assert.equal(nullFindingsRes.status, 200);

    // Arbitrary filePath without allowDiskRead must never read host files
    const noDiskLeak = runDesignSelfCorrectionPipeline({ filePath: __filename, visualFindings: ['low contrast on .x'] });
    assert.equal(noDiskLeak.patchedSource, '');

    // Unitless JSX props + spreads + data-class attributes + @tailwind CSS rules remain intact
    const edgeJsx = runDesignSelfCorrectionPipeline({
      sourceCode: '<style>@tailwind base; @media (min-width:640px){ .btn { height: 26px; } }</style><button data-class="keep-me" style={{ ...baseStyle, opacity: 0.8, minHeight: 24 }} className="btn">Tap</button>',
    });
    assert.match(edgeJsx.patchedSource, /data-class="keep-me"/);
    assert.match(edgeJsx.patchedSource, /\.\.\.baseStyle,\s*opacity:\s*0\.8/);
    assert.match(edgeJsx.patchedSource, /minHeight:\s*'44px'/);
    assert.match(edgeJsx.patchedSource, /\.btn \{[^}]*min-height: 44px;/);

    const homeHtml = await (await fetch(`${origin}/`)).text();
    assert.doesNotMatch(homeHtml, /id="(?:navPaidLoginBtn|navPaidDashboardLink|paidLoginKeyInput|paidLoginSubmitBtn|googleCloudLoginLink)"[^>]*min-height:\s*(?:36|38)px/);
  } finally {
    if (typeof handle.server.closeAllConnections === 'function') handle.server.closeAllConnections();
    await new Promise((resolve) => handle.server.close(() => resolve()));
    if (savedKey === undefined) delete process.env.THUMBGATE_API_KEY; else process.env.THUMBGATE_API_KEY = savedKey;
    if (savedFb === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR; else process.env.THUMBGATE_FEEDBACK_DIR = savedFb;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
