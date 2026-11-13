'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  computeContrastRatio,
  solveAccessibleForegroundHex,
  parseLayoutAst,
  runDesignSelfCorrectionPipeline,
} = require('../src/design-self-correction-engine');
const {
  evaluateSidewaysEnterpriseGuardrails,
} = require('../src/mckinsey-top-company-ai-coding');
const { startServer } = require('../src/api/server');

test('solveAccessibleForegroundHex computes minimal WCAG AA lightness shift preserving hue', () => {
  // Slate-500 (#64748b) on Slate-900 (#0f172a) is ~3.75:1 (< 4.5:1)
  const before = computeContrastRatio('#64748b', '#0f172a');
  assert.ok(before < 4.5);

  const solved = solveAccessibleForegroundHex('#64748b', '#0f172a', 4.5);
  assert.equal(solved.adjusted, true);
  assert.ok(solved.ratio >= 4.5, `expected >= 4.5:1, got ${solved.ratio}`);
  assert.notEqual(solved.hex, '#ffffff', 'should preserve slate tint rather than jumping to pure white');
});

test('CSS AST pipeline transforms passive low-contrast, tap-target, and overflow issues into inline CSS edits', () => {
  const cssSource = [
    '.hero-subtitle {',
    '  color: #64748b;',
    '  background-color: #0f172a;',
    '  width: 1200px;',
    '}',
    '',
    'button.cta-chip {',
    '  height: 24px;',
    '  color: #f8fafc;',
    '  background-color: #0f172a;',
    '}',
  ].join('\n');

  const report = runDesignSelfCorrectionPipeline({
    sourceCode: cssSource,
    language: 'css',
  });

  assert.equal(report.ok, true);
  assert.equal(report.mode, 'active_self_correcting_design_engine');
  assert.equal(report.issueCount, 3);
  assert.equal(report.verification.changed, true);
  assert.equal(report.verification.remainingIssueCount, 0);

  const contrastFix = report.remediations.find((r) => r.issueType === 'contrast_too_low');
  assert.ok(contrastFix);
  assert.equal(contrastFix.cssOverrides.selector, '.hero-subtitle');
  assert.equal(contrastFix.cssOverrides.declarations[0].property, 'color');
  assert.ok(contrastFix.resolvedMetrics.resolvedContrastRatio >= 4.5);
  assert.equal(contrastFix.inlineCodeEdit.nodeType, 'CssRule');
  assert.equal(contrastFix.inlineCodeEdit.startLine, 1);

  assert.match(report.patchedSource, /max-width: 1200px;/);
  assert.match(report.patchedSource, /min-height: 44px;/);
  assert.doesNotMatch(report.patchedSource, /color: #64748b;/);
});

test('JSX AST pipeline generates exact Tailwind utility swaps and inline style edits in real time', () => {
  const jsxSource = [
    'export function PricingBanner() {',
    '  return (',
    '    <div className="flex w-[1280px] whitespace-nowrap bg-slate-900">',
    '      <p className="text-sm text-slate-500 bg-slate-900"> Enterprise guardrails </p>',
    '      <button className="h-6 px-1 text-white bg-blue-600">Upgrade</button>',
    '    </div>',
    '  );',
    '}',
  ].join('\n');

  const ast = parseLayoutAst(jsxSource, { language: 'jsx' });
  assert.equal(ast.language, 'jsx');
  assert.equal(ast.elements.length, 3);

  const report = runDesignSelfCorrectionPipeline({
    sourceCode: jsxSource,
    language: 'jsx',
    preferTailwind: true,
  });

  assert.equal(report.ok, true);
  assert.equal(report.verification.remainingIssueCount, 0);

  // Overflow container swaps w-[1280px] whitespace-nowrap -> w-full max-w-[1280px] flex-wrap
  assert.match(report.patchedSource, /w-full max-w-\[1280px\] flex-wrap/);
  assert.doesNotMatch(report.patchedSource, /whitespace-nowrap/);

  // Low-contrast text-slate-500 on bg-slate-900 upgrades to a compliant slate utility
  assert.doesNotMatch(report.patchedSource, /\btext-slate-500\b/);
  assert.match(report.patchedSource, /\btext-slate-(?:50|100|200|300|400)\b/);

  // Undersized h-6 px-1 button upgrades to min-h-11 min-w-11 px-4 py-2.5
  assert.match(report.patchedSource, /\bmin-h-11\b/);
  assert.match(report.patchedSource, /\bpx-4\b/);
  assert.doesNotMatch(report.patchedSource, /\bh-6\b/);
});

test('evaluateSidewaysEnterpriseGuardrails upgrades passive contrast/colorblind findings with active AST remediation', () => {
  const htmlSnippet = '<span class="tg-surface tg-status" style="color: #777777; background-color: #888888;">Degraded</span>';
  const res = evaluateSidewaysEnterpriseGuardrails({
    upstreamSignals: ['otel:span-1'],
    releaseChecklistComplete: true,
    uiPalette: {
      foregroundHex: '#777777',
      backgroundHex: '#888888',
      reliesOnRedGreenOnly: true,
      hasNonColorShapeOrLabel: false,
      layoutSource: htmlSnippet,
    },
    codeSnippet: 'const safe = true;',
    complianceTags: ['pretool_diode_verified'],
  });

  assert.equal(res.ok, false);
  const contrastFinding = res.findings.find((f) => f.code === 'accessibility_contrast_violation');
  assert.ok(contrastFinding.remediation);
  assert.ok(contrastFinding.remediation.resolvedMetrics.resolvedContrastRatio >= 4.5);
  assert.equal(contrastFinding.remediation.cssOverrides.declarations[0].property, 'color');
  assert.ok(contrastFinding.remediation.tailwindAdjustments.add.length > 0);

  assert.ok(res.designSelfCorrection);
  assert.equal(res.designSelfCorrection.mode, 'active_self_correcting_design_engine');
  assert.match(res.designSelfCorrection.patchedSource, /text-decoration: underline/);
  assert.doesNotMatch(res.designSelfCorrection.patchedSource, /color: #777777/);
});

test('CLI design-fix --write applies hash-anchored AST edits in place and HTTP /v1/design/self-correct returns edits', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-lovable-design-'));
  const htmlPath = path.join(tmpDir, 'card.html');
  fs.writeFileSync(
    htmlPath,
    '<style>.card-note { color: #666666; background-color: #555555; }</style><p class="card-note">Low contrast</p>\n',
    'utf8',
  );

  try {
    const cliOut = execFileSync(
      process.execPath,
      [path.join(__dirname, '..', 'bin', 'cli.js'), 'design-fix', htmlPath, '--write', '--json'],
      {
        encoding: 'utf8',
        env: { ...process.env, THUMBGATE_NO_NUDGE: '1' },
      },
    );
    const parsedCli = JSON.parse(cliOut);
    assert.equal(parsedCli.ok, true);
    assert.equal(parsedCli.appliedInPlace, true);
    assert.equal(parsedCli.guardReceipt.allowed, true);

    const diskAfter = fs.readFileSync(htmlPath, 'utf8');
    assert.doesNotMatch(diskAfter, /#666666/);

    if (!process.env.CODEX_SANDBOX) {
      const prevKey = process.env.THUMBGATE_API_KEY;
      const prevFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
      process.env.THUMBGATE_API_KEY = 'design-test-key';
      process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
      const handle = await startServer({ port: 0, host: '127.0.0.1' });
      try {
        const apiRes = await fetch(`http://127.0.0.1:${handle.port}/v1/design/self-correct`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer design-test-key',
          },
          body: JSON.stringify({
            sourceCode: '<button className="h-5 px-1 text-slate-500 bg-slate-950">Fix</button>',
            language: 'jsx',
            preferTailwind: true,
            visualFindings: [
              { type: 'line_length_unreadable', selector: 'p.hero-copy' },
            ],
          }),
        });
        assert.equal(apiRes.status, 200);
        const payload = await apiRes.json();
        assert.equal(payload.mode, 'active_self_correcting_design_engine');
        assert.ok(payload.inlineEdits.length >= 2);
        assert.match(payload.patchedSource, /\bmin-h-11\b/);
      } finally {
        handle.server.closeAllConnections?.();
        await new Promise((resolve) => handle.server.close(resolve));
        if (prevKey === undefined) delete process.env.THUMBGATE_API_KEY;
        else process.env.THUMBGATE_API_KEY = prevKey;
        if (prevFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
        else process.env.THUMBGATE_FEEDBACK_DIR = prevFeedbackDir;
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
