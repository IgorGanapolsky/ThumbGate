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
  assert.ok(conflatedPost.violations.some((v) => v.id === 'realestate_conflation'));
  assert.ok(conflatedPost.violations.some((v) => v.id === 'missing_builder_disclosure'));

  const cleanPost = evaluateBrandAdherence(
    'Block destructive AI tool calls in <0.5ms with npx thumbgate init (https://thumbgate.ai). Disclosure: I build it.',
    { disallowedClaims: ['7-day refund guarantee'], requireDisclosure: true },
  );
  assert.equal(cleanPost.compliant, true);
});

test('Lovable self-correcting design engine emits inline AST/JSX edits, CSS overrides, and Tailwind patches + CLI commands work end-to-end', () => {
  const { execFileSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { inspectAndPatchDesignSource, computeContrastRatio } = require('../src/openshell-lovable-engine');

  const brokenMarkup = [
    '<div className="w-[640px] bg-slate-900">',
    '  <p className="text-slate-600">Low contrast subtitle</p>',
    '  <button className="h-6 p-1 outline-none bg-slate-900 text-slate-500">Save</button>',
    '</div>',
  ].join('\n');

  const report = inspectAndPatchDesignSource(brokenMarkup, { defaultBgHex: '#0f172a' });
  assert.equal(report.changed, true);
  assert.ok(report.patches.some((p) => p.type === 'low_contrast' && p.fixedRatio >= 4.5));
  assert.ok(report.patches.some((p) => p.type === 'undersized_tap_target'));
  assert.ok(report.patches.some((p) => p.type === 'missing_focus_ring'));
  assert.ok(report.patches.some((p) => p.type === 'fixed_width_mobile_overflow'));
  assert.match(report.patchedSource, /w-full/);
  assert.match(report.patchedSource, /max-w-\[640px\]/);
  assert.match(report.patchedSource, /min-h-11 min-w-11 px-4 py-2\.5/);
  assert.match(report.patchedSource, /focus-visible:ring-2/);
  assert.doesNotMatch(report.patchedSource, /text-slate-600/);
  assert.ok(computeContrastRatio('#cbd5e1', '#0f172a') >= 4.5);

  // Verify CLI `policy-prove` and `design-fix --write`
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-openshell-cli-'));
  try {
    const candPath = path.join(tmpDir, 'cand.json');
    const boundPath = path.join(tmpDir, 'bound.json');
    const uiPath = path.join(tmpDir, 'card.tsx');
    fs.writeFileSync(candPath, JSON.stringify({ filesystem_policy: { read_only: ['/usr'] } }));
    fs.writeFileSync(boundPath, JSON.stringify({ filesystem_policy: { read_only: ['/usr', '/etc'] } }));
    fs.writeFileSync(uiPath, brokenMarkup);

    const proveOut = execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'cli.js'), 'policy-prove', candPath, '--boundary', boundPath, '--json'], { encoding: 'utf8' });
    assert.equal(JSON.parse(proveOut).result, 'within_boundary');

    execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'cli.js'), 'design-fix', uiPath, '--write'], { encoding: 'utf8' });
    const rewritten = fs.readFileSync(uiPath, 'utf8');
    assert.match(rewritten, /min-h-11/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
