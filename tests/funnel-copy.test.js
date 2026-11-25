'use strict';

// Buyer-facing copy checks: the request-only team pilot page opens in the buyer's words with one primary button,
// and the landing page and /pricing link to our two sister products in the footer.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const diagnostic = read('public/diagnostic.html');
const firstScreen = diagnostic.slice(diagnostic.indexOf('<main>'), diagnostic.indexOf('data-oceans-pain'));
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script\s*>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('the sprint page title is a phrase a buyer would search for, not a product slogan', () => {
  const title = diagnostic.match(/<title>([^<]*)<\/title>/)[1];
  assert.equal(title, 'Stop Your AI Coding Agent Repeating Mistakes — Team Pilot | ThumbGate');
  assert.doesNotMatch(title, /Self-Improving Firewall/i);
  assert.doesNotMatch(diagnostic, /Self-Improving Firewall/i);
  assert.ok(title.length <= 80, 'title fits a search result');
});

test('the sprint page headline names the pain in the buyer\'s words', () => {
  const heading = diagnostic.match(/<h1>([^<]*)<\/h1>/)[1];
  assert.equal(heading, 'Your coding agent keeps making the same mistake. We make it stop.');
  assert.equal((diagnostic.match(/<h1>/g) || []).length, 1);
});

test('the first screen states outcome, guarantee, speed and the buyer\'s effort, each once, with the real numbers', () => {
  const text = textOf(firstScreen);
  assert.match(text, /The outcome: a configured gate and a regression test for that mistake, with the accepted result agreed before we start\./);
  assert.match(text, /The terms: request only\. No price is listed and no payment is taken on this page\./);
  assert.doesNotMatch(text, /\$\s?\d/, 'no price on the first screen of a request-only page');
  assert.match(text, /The speed: two business days, counted from when we have access and your workflow materials\./);
  assert.match(text, /Your part: a short intake and one 60-minute working review\./);
  assert.doesNotMatch(text, /30 minutes|minutes of your time/i, 'no effort claim the delivery process does not back');
});

test('the first screen says "supported" once, and it links to the integrations list', () => {
  const words = firstScreen.replace(/<script[\s\S]*?<\/script\s*>/g, ' ').match(/supported/gi) || [];
  assert.equal(words.length, 1, 'the word appears ' + words.length + ' times on the first screen');
  assert.match(firstScreen, /<a href="\/install#install">supported integration<\/a>/);
  assert.match(read('public/install.html'), /id="install"/, 'the link target exists');
});

test('one primary button above the fold, with the fit check as the secondary option', () => {
  assert.equal((firstScreen.match(/class="button primary"/g) || []).length, 1);
  assert.match(firstScreen, /<a class="button primary" href="#intake"[^>]*data-cta-id="diagnostic_hero_intake_primary"[^>]*>Request a team pilot<\/a>/);
  assert.doesNotMatch(firstScreen, /diagnostic_hero_paid|Book the \$/, 'no paid button');
});

test('the page takes a pilot request, not a payment', () => {
  assert.match(diagnostic, /<form id="intake" class="intake-card" action="\/v1\/intake\/workflow-sprint" method="POST"[^>]*data-diagnostic-intake-form>/);
  assert.match(diagnostic, /<input id="email" name="email" type="email" autocomplete="email" required>/);
  assert.match(diagnostic, /<textarea id="workflow" name="workflow" required/);
  assert.match(diagnostic, /data-cta-id="diagnostic_page_submit"[^>]*>Request pilot<\/button>/);
  // No payment path: no Stripe form, endpoint, plan id or buyer-email field, and no price in the offer markup.
  assert.doesNotMatch(diagnostic, /diagnostic-pay-form|data-diagnostic-pay-form|\/go\/diagnostic-pay|name="plan_id" value="sprint_diagnostic"|name="customer_email"|No Stripe session/);
  assert.doesNotMatch(diagnostic, /"price"\s*:/, 'the Service offer lists no price');
});

for (const page of ['public/index.html', 'public/pricing.html']) {
  test(`${page} footer has an "Also by Igor" row linking Mac YOLO Safeguards and Dayglass`, () => {
    const html = read(page);
    const footer = html.slice(html.indexOf('<footer>'), html.indexOf('</footer>'));
    assert.match(footer, /<strong>Also by Igor<\/strong>/);
    assert.match(footer, /<a href="https:\/\/macyolosafeguards\.io\/\?utm_source=thumbgate" rel="noopener">Mac YOLO Safeguards<\/a>: Free menu bar app that cleans up what coding agents leave running on your Mac\./);
    assert.match(footer, /<a href="https:\/\/dayglass\.io\/\?utm_source=thumbgate" rel="noopener">Dayglass<\/a>: Private AI memory for your Mac calls and work, no meeting bot\./);
    assert.doesNotMatch(footer, /\/go\/|redirect/i, 'plain links, no tracking redirects');
  });
}
