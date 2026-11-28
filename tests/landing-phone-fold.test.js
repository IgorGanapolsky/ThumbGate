'use strict';
// 28 Nov 2026 daily grade: on phones the consent banner covered both hero buttons,
// fine print sat above the fold, and the hero had no demo link.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const clarity = require('../scripts/clarity');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('hero links the demo right after the buttons and keeps fine print below the install steps', () => {
  const actions = html.indexOf('class="actions"');
  const demo = html.indexOf('href="/demo" data-cta-id="hero_demo_link"');
  const install = html.indexOf('id="install"');
  const fine = html.indexOf('class="hero-fine"');
  assert.ok(actions > 0 && demo > actions && demo < install, 'demo link sits between the buttons and the install steps');
  assert.ok(fine > install, 'fine print comes after the install steps');
  assert.ok(html.indexOf('id="hero-audience"') > fine, 'deny list lives in the fine print block');
});

test('phones get a slim consent bar with shorter wording', () => {
  const page = clarity.injectAnalyticsTags('<html><head></head><body></body></html>', { pathname: '/', headers: { host: 'thumbgate.ai' } });
  assert.match(page, /var narrow=\(w\.innerWidth\|\|1024\)<640/);
  assert.match(page, /left:0;right:0;bottom:0/);
  assert.match(page, /"short":"May Microsoft Clarity and Orion measure your visit\? Neither loads unless you accept\. Declining also turns off Google Analytics cookies\."/);
});

test('footer and offer link rows give standalone links a 24px target (WCAG 2.5.8)', () => {
  assert.match(html, /\.footer-links a, \.offer-links a \{ display: inline-flex; align-items: center; min-height: 24px; \}/);
  assert.match(html, /<p class="offer-links"><a href="\/install">Start with the free CLI<\/a>/);
});
