'use strict';

// 2026 AI Infrastructure Trends Report (Crusoe/MetaLab) ideas: a learn page on control, transparency and
// support, and a homepage line saying the rules are yours. Claims must match shipped behavior.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const slug = 'ai-infrastructure-report-control-for-agent-guardrails';

test('learn page is canonical, linked from hub and sitemap, cites the report and disclaims affiliation', () => {
  const page = read(`public/learn/${slug}.html`);
  assert.match(page, new RegExp(`rel="canonical" href="https://thumbgate.ai/learn/${slug}"`));
  assert.match(page, /ThumbGate is not a Crusoe or MetaLab partner/);
  assert.match(page, /2026_AI_Infrastructure_Trends_Report\.pdf/);
  assert.doesNotMatch(page, /mkt_tok/);
  assert.match(page, /href="\/pilot\?utm_source=learn/);
  assert.ok(read('public/learn.html').includes(`href="/learn/${slug}"`));
  assert.ok(read(path.join('src', 'api', 'server.js')).includes(`'/learn/${slug}'`));
});

test('the off switch the copy names is the one cli-telemetry honors', () => {
  const telemetry = read('scripts/cli-telemetry.js');
  assert.match(telemetry, /THUMBGATE_NO_TELEMETRY === '1'/);
  assert.match(telemetry, /DO_NOT_TRACK === '1'/);
  assert.match(read(`public/learn/${slug}.html`), /THUMBGATE_NO_TELEMETRY=1/);
  const home = read('public/index.html');
  assert.match(home, /id="you-own-the-rules"/);
  assert.match(home, /THUMBGATE_NO_TELEMETRY=1/);
  assert.ok(home.includes(`href="/learn/${slug}"`));
});
