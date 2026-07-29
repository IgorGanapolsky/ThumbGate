'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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

// Live-boot coverage for the #3072 route registrations in src/api/server.js.
// SonarCloud flagged the /architecture, /whitepaper, /case-studies, and
// /eval-scorecard handlers (and their 404 error fallbacks) as uncovered:
// the static string assertions above never execute the handlers. Boot the
// real server once on an ephemeral port and fetch each route.
describe('proof pack routes served live by src/api/server', () => {
  const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-proof-pack-feedback-'));
  const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-proof-pack-proof-'));
  const savedEnv = {
    THUMBGATE_FEEDBACK_DIR: process.env.THUMBGATE_FEEDBACK_DIR,
    THUMBGATE_PROOF_DIR: process.env.THUMBGATE_PROOF_DIR,
  };
  let handle = null;
  let origin = '';

  before(async () => {
    // CODEX_SANDBOX blocks socket listen permission; tests below self-skip.
    if (process.env.CODEX_SANDBOX) return;
    // Isolate every writable dir to tmp and self-inject the API key so a clean
    // clone with no CI env or operator data still passes (audit rule).
    process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;
    process.env.THUMBGATE_PROOF_DIR = tmpProofDir;
    process.env.THUMBGATE_API_KEY = process.env.THUMBGATE_API_KEY || 'test-api-key';
    const { startServer } = require('../src/api/server');
    try {
      handle = await startServer({ port: 0, host: '127.0.0.1' });
    } catch (err) {
      if (err && err.code === 'EPERM') {
        handle = null;
        return;
      }
      throw err;
    }
    origin = `http://localhost:${handle.port}`;
  });

  after(async () => {
    if (handle) {
      await new Promise((resolve) => handle.server.close(resolve));
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
      fs.rmSync(tmpProofDir, { recursive: true, force: true });
    } catch {
      // Best-effort teardown; tmp reaper handles leftovers.
    }
  });

  const LIVE_ROUTES = [
    { route: '/architecture', marker: 'Architecture diagrams' },
    { route: '/whitepaper', marker: 'How we know ThumbGate works' },
    { route: '/case-studies', marker: 'Case studies' },
    { route: '/eval-scorecard', marker: 'Eval scorecard' },
  ];

  for (const { route, marker } of LIVE_ROUTES) {
    it(`${route} serves its public page over HTTP`, async (t) => {
      if (!handle) return t.skip('socket listen unavailable in this sandbox');
      const res = await fetch(new URL(route, origin));
      assert.equal(res.status, 200, `${route} must return 200`);
      assert.match(String(res.headers.get('content-type')), /text\/html/);
      const html = await res.text();
      assert.ok(
        html.toLowerCase().includes(marker.toLowerCase()),
        `${route} body missing marker: ${marker}`,
      );
    });
  }

  it('registered aliases resolve to the same canonical pages', async (t) => {
    if (!handle) return t.skip('socket listen unavailable in this sandbox');
    const ALIASES = [
      { route: '/bench', marker: 'Eval scorecard' },
      { route: '/scorecard', marker: 'Eval scorecard' },
      { route: '/how-we-know', marker: 'How we know ThumbGate works' },
      { route: '/architecture.html', marker: 'Architecture diagrams' },
      { route: '/case-studies.html', marker: 'Case studies' },
    ];
    for (const { route, marker } of ALIASES) {
      const res = await fetch(new URL(route, origin));
      assert.equal(res.status, 200, `${route} must return 200`);
      const html = await res.text();
      assert.ok(
        html.toLowerCase().includes(marker.toLowerCase()),
        `${route} body missing marker: ${marker}`,
      );
    }
  });

  it('/eval-scorecard falls back to 404 JSON when the page file is unreadable', async (t) => {
    if (!handle) return t.skip('socket listen unavailable in this sandbox');
    const scorecardPath = path.join(root, 'public', 'eval-scorecard.html');
    const realReadFileSync = fs.readFileSync;
    // Inject an unreadable page file: only the scorecard path throws, every
    // other read (telemetry, config, sibling pages) passes through untouched.
    fs.readFileSync = function patchedReadFileSync(target, ...rest) {
      if (typeof target === 'string' && path.resolve(target) === scorecardPath) {
        const err = new Error(`ENOENT: no such file or directory, open '${target}'`);
        err.code = 'ENOENT';
        throw err;
      }
      return realReadFileSync.apply(this, [target, ...rest]);
    };
    try {
      const res = await fetch(new URL('/eval-scorecard', origin));
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.equal(body.error, 'Eval scorecard page not found');
    } finally {
      fs.readFileSync = realReadFileSync;
    }
  });
});
