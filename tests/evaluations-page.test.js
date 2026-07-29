'use strict';

// Regression coverage for the /evaluations marketing page.
//
// Review caught that the page shipped with a canonical URL, nav links, and an announcement
// plan while the Railway entrypoint (node src/api/server.js) returned 404 for it — the server
// routes marketing pages EXPLICITLY, so a page that exists in public/ but has no route is
// live nowhere. These tests boot the real server and fetch the real route, because that is
// the only claim that matters.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

if (process.env.CODEX_SANDBOX === 'seatbelt') {
  console.log('Skipping evaluations page route tests because CODEX_SANDBOX blocks socket listen.');
  process.exit(0);
}

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'public', 'evaluations.html');
const { startServer } = require('../src/api/server');

describe('public/evaluations.html', () => {
  it('exists and carries the canonical URL it advertises', () => {
    const html = fs.readFileSync(PAGE, 'utf-8');
    assert.ok(html.includes('<link rel="canonical" href="https://thumbgate.ai/evaluations">'));
    assert.ok(html.includes('−10.5') || html.includes('-10.5'),
      'the unflattering novel-context number is the point of the page; it must not be edited out');
    assert.ok(html.includes('majority-class baseline'),
      'lift must stay anchored to the baseline it beats');
  });
});

describe('GET /evaluations route', () => {
  let handle;
  let base;

  before(async () => {
    handle = await startServer({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${handle.port}`;
  });

  after(async () => {
    // The handle exposes the raw server, not a close() helper — same teardown as
    // tests/api-server.test.js. Getting this wrong hangs the test runner forever.
    if (handle) await new Promise((resolve) => handle.server.close(resolve));
  });

  for (const route of ['/evaluations', '/evaluations.html']) {
    it(`serves the page at ${route}`, async () => {
      const res = await fetch(`${base}${route}`);
      assert.equal(res.status, 200, `${route} must not 404 in the production entrypoint`);
      const body = await res.text();
      assert.ok(body.includes('How We Evaluate'), 'served content is not the evaluations page');
    });
  }

  it('still serves /numbers (the route this one was modeled on)', async () => {
    const res = await fetch(`${base}/numbers`);
    assert.equal(res.status, 200);
  });
});
