'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');

const PAGES = [
  {
    file: 'architecture.html',
    mustInclude: [
      'Architecture diagrams',
      '/assets/diagrams/thumbgate-architecture.png',
      '/assets/diagrams/feedback-pipeline.png',
      '/assets/diagrams/pre-action-gate-loop.svg',
      'What each layer is for',
      'Why it exists:',
      'How we know:',
      'Deterministic orchestration around agents',
      'MCP instead of direct integrations',
      'Loop limits',
      'raw policy decision and effective execution disposition',
    ],
  },
  {
    file: 'whitepaper.html',
    mustInclude: [
      'How we know ThumbGate works',
      'Golden evaluation dataset',
      'Tool-call correctness',
      'unsafeActionRate',
      'Human review',
      'Production monitoring',
    ],
  },
  {
    file: 'case-studies.html',
    mustInclude: [
      'Case studies',
      '62 evasion holes',
      'fail open',
      'No fabricated logos',
      'THUMBGATE-CASE-STUDIES.md',
    ],
  },
  {
    file: 'evaluations.html',
    mustInclude: [
      'How We Evaluate',
      'held-out',
      'majority baseline',
    ],
  },
  {
    file: 'eval-scorecard.html',
    mustInclude: [
      'Eval scorecard',
      'task success',
      'Unsafe allowed',
      'thumbgate:bench',
    ],
  },
];

const DIAGRAMS = [
  'thumbgate-architecture.png',
  'feedback-pipeline.png',
  'agent-integration.png',
  'pre-action-gate-loop.svg',
  'plugin-topology.png',
];

describe('eval proof pack public pages', () => {
  for (const page of PAGES) {
    it(`${page.file} exists with required buyer proof copy`, () => {
      const full = path.join(publicDir, page.file);
      assert.ok(fs.existsSync(full), `${page.file} must exist`);
      const html = fs.readFileSync(full, 'utf8');
      for (const snippet of page.mustInclude) {
        assert.ok(
          html.toLowerCase().includes(snippet.toLowerCase()),
          `${page.file} missing snippet: ${snippet}`,
        );
      }
    });
  }

  it('mirrors core architecture diagrams under public/assets/diagrams', () => {
    for (const name of DIAGRAMS) {
      const full = path.join(publicDir, 'assets', 'diagrams', name);
      assert.ok(fs.existsSync(full), `missing diagram ${name}`);
      assert.ok(fs.statSync(full).size > 500, `${name} looks empty`);
    }
  });

  it('docs/HOW-WE-KNOW-IT-WORKS.md covers all seven dimensions', () => {
    const doc = fs.readFileSync(path.join(root, 'docs', 'HOW-WE-KNOW-IT-WORKS.md'), 'utf8');
    for (const heading of [
      'Golden evaluation dataset',
      'Offline regression',
      'Tool-call correctness',
      'Latency',
      'Cost',
      'Human review',
      'Production monitoring',
    ]) {
      assert.ok(doc.includes(heading), `white paper missing ${heading}`);
    }
  });
});

describe('generate-eval-scorecard renderer', () => {
  it('renders fixture metrics without running the full gate suite', () => {
    const { renderScorecard } = require('../scripts/generate-eval-scorecard');
    const html = renderScorecard({
      version: '1.99.0',
      nowIso: '2026-07-29T12:00:00.000Z',
      nowDate: '2026-07-29',
      metrics: {
        score: 100,
        taskSuccessRate: 1,
        unsafeActionRate: 0,
        blockedUnsafeRate: 1,
        capabilityRate: 1,
        falseBlockRate: 0,
        replayStability: 1,
      },
      passed: true,
      scenarios: [
        {
          id: 'github-force-push-main',
          service: 'github',
          unsafe: true,
          expectedDecision: 'deny',
          actualDecision: 'deny',
          passed: true,
        },
      ],
      sourcePath: 'bench/thumbgate-bench.json',
    });
    assert.ok(html.includes('Updated: 2026-07-29'));
    assert.ok(html.includes('100.0%'));
    assert.ok(html.includes('github-force-push-main'));
    assert.ok(html.includes('PASSED'));
  });
});

describe('server routes for proof pack', () => {
  it('registers architecture, whitepaper, scorecard, evaluations, case-studies paths', () => {
    const server = fs.readFileSync(path.join(root, 'src', 'api', 'server.js'), 'utf8');
    for (const route of [
      "pathname === '/architecture'",
      "pathname === '/whitepaper'",
      "pathname === '/eval-scorecard'",
      "pathname === '/evaluations'",
      "pathname === '/case-studies'",
      'CASE_STUDIES_PAGE_PATH',
      'ARCHITECTURE_PAGE_PATH',
      'WHITEPAPER_PAGE_PATH',
      'EVAL_SCORECARD_PAGE_PATH',
      'EVALUATIONS_PAGE_PATH',
    ]) {
      assert.ok(server.includes(route), `server.js missing ${route}`);
    }
    // Empty "coming soon" placeholder must not remain as the only case-studies body.
    assert.doesNotMatch(
      server,
      /New case studies for individual Pro operators coming soon/,
    );
  });
});
