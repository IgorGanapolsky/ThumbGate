'use strict';

// DXC Frontier Code Assurance (Nov 24 2026) ideas: the pilot page explains how a pilot runs
// (one repo, the team decides, an evidence report, a day-30 decision) and a learn page positions the gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('pilot page explains how the pilot runs, using the shipped inventory report', () => {
  const page = read('public/pilot.html');
  assert.match(page, /id="how-the-pilot-runs"/);
  assert.match(page, /Start with one repo\./);
  assert.match(page, /npx thumbgate init/);
  assert.match(page, /npx thumbgate inventory/);
  // The report the page promises is a real, packaged module.
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.files.includes('scripts/agent-action-inventory.js'));
  const { buildInventory, renderInventoryText } = require('../scripts/agent-action-inventory');
  assert.equal(typeof buildInventory, 'function');
  assert.equal(typeof renderInventoryText, 'function');
  // The form still posts to the intake route.
  assert.match(page, /action="\/v1\/intake\/pilot-request"/);
});

test('DXC learn page is linked from the hub and sitemap, and disclaims any partnership', () => {
  const slug = 'dxc-frontier-code-assurance-ai-written-code';
  const page = read(`public/learn/${slug}.html`);
  assert.match(page, new RegExp(`rel="canonical" href="https://thumbgate.ai/learn/${slug}"`));
  assert.match(page, /ThumbGate is not a DXC partner/);
  assert.match(page, /href="\/pilot\?utm_source=learn/);
  assert.ok(read('public/learn.html').includes(`href="/learn/${slug}"`));
  assert.ok(read('src/api/server.js').includes(`'/learn/${slug}'`));
});

test('pilot page keeps the shared width constraint on header, main and footer', () => {
  const page = read('public/pilot.html');
  assert.match(page, /header, main, footer \{ width:min\(1040px,calc\(100% - 32px\)\); margin:0 auto; \}/);
});
