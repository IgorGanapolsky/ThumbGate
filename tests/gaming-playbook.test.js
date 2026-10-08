'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

if (process.env.CODEX_SANDBOX === 'seatbelt') {
  console.log('Skipping gaming playbook route tests because CODEX_SANDBOX blocks socket listen.');
  process.exit(0);
}

process.env.THUMBGATE_API_KEY = process.env.THUMBGATE_API_KEY || 'test-api-key';

const PLAYBOOK_PATH = path.resolve(__dirname, '../public/gaming-playbook.html');
const { startServer } = require('../src/api/server');

describe('Gaming AI Agent Playbook Delivery & Route Verification', () => {
  let handle;
  let base;

  before(async () => {
    handle = await startServer({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${handle.port}`;
  });

  after(async () => {
    if (handle) {
      await new Promise((resolve) => handle.server.close(resolve));
    }
  });

  test('gaming-playbook.html exists and contains necessary SEO, Schema, and ABM elements', () => {
    assert.ok(fs.existsSync(PLAYBOOK_PATH), 'public/gaming-playbook.html must exist on disk');
    const html = fs.readFileSync(PLAYBOOK_PATH, 'utf-8');

    // SEO & Titles
    assert.ok(html.includes('<title>Gaming AI Agent Infrastructure Playbook | ThumbGate</title>'));
    assert.ok(html.includes('The Autonomous Gaming Agent'));
    assert.ok(html.includes('Infrastructure Firewall Playbook'));

    // JSON-LD Schemas
    assert.ok(html.includes('"@type": "TechArticle"'), 'Must have TechArticle schema');
    assert.ok(html.includes('"@type": "SoftwareApplication"'), 'Must have SoftwareApplication schema');
    assert.ok(html.includes('"@type": "FAQPage"'), 'Must have FAQPage schema');

    // Strategic Struts & Proof
    assert.ok(html.includes('&lt; 0.5ms') || html.includes('< 0.5ms'), 'Must state sub-0.5ms latency');
    assert.ok(html.includes('Runaway Multi-Turn Loops'), 'Must address runaway loops');
    assert.ok(html.includes('Economy Prompt Exploits'), 'Must address economy exploits');

    // Monetization Rails
    assert.ok(html.includes('8x2dR91M84r4cSd9uj3sI3f'), 'Must include Pro Stripe checkout link slug');
    assert.ok(html.includes('9B69ATbmI4r4aK5eOD3sI3k'), 'Must include $499 audit Stripe checkout link slug');
    assert.ok(html.includes('LTQFR7P9AR3QG'), 'Must include sprint checkout link slug');
  });

  for (const route of ['/gaming-playbook', '/gaming-playbook.html', '/gaming', '/industry-playbook']) {
    test(`API server serves ${route} with 200 OK and HTML content`, async () => {
      const res = await fetch(`${base}${route}`);
      assert.equal(res.status, 200, `${route} must return 200 OK`);
      const contentType = res.headers.get('content-type') || '';
      assert.ok(contentType.includes('text/html'), `${route} must return text/html`);
      const body = await res.text();
      assert.ok(body.includes('Gaming AI Agent Infrastructure Playbook'), `${route} body must contain playbook title`);
    });
  }
});
