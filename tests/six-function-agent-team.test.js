'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const team = require('../scripts/six-function-agent-team');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'public/yt.html');

test('six-function map is not a new SKU and maps onto existing surfaces', () => {
  const report = team.runSixFunctionMap();
  assert.equal(report.schema, team.SCHEMA);
  assert.equal(report.isNewSku, false);
  assert.equal(report.livePromotionAllowed, false);
  assert.equal(report.affiliation, 'none');
  assert.equal(report.capturedRevenueUsd, 0);
  assert.equal(report.ok, true, report.missingSurfaces.join(', '));
  assert.equal(report.functions.length, 6);
  const ids = report.functions.map((fn) => fn.id);
  assert.deepEqual(ids, ['lead_gen', 'content', 'product', 'marketing', 'sales', 'ops']);
  for (const fn of report.functions) {
    assert.ok(fs.existsSync(path.join(ROOT, fn.existingSurface)), fn.existingSurface);
  }
});

test('CLI --json repeats honesty flags', () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/six-function-agent-team.js'), '--json'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.isNewSku, false);
  assert.equal(parsed.livePromotionAllowed, false);
  assert.equal(parsed.affiliation, 'none');
  assert.equal(parsed.utm.utm_campaign, 'six-function-agent-gates');
});

test('YouTube landing steals FORMAT not the summit product', () => {
  const html = fs.readFileSync(PAGE, 'utf8');
  assert.match(html, /Six business functions\. Existing gates\./);
  assert.match(html, /for you if/i);
  assert.match(html, /not for you if/i);
  assert.match(html, /data-affiliation="none"/);
  assert.match(html, /data-live-promotion-allowed="false"/);
  assert.match(html, /data-new-sku="false"/);
  assert.match(html, /not affiliated/i);
  assert.match(html, /Industry Rockstar/);
  assert.match(html, /Kane Minkus/);
  assert.match(html, /Alessia Minkus/);
  assert.match(html, /FAQPage/);
  assert.match(html, /How is this different from other AI events/);
  assert.match(html, /Two paths/);
  assert.match(html, /context engineering/i);
  assert.match(html, /data-function="lead_gen"/);
  assert.match(html, /data-function="content"/);
  assert.match(html, /data-function="product"/);
  assert.match(html, /data-function="marketing"/);
  assert.match(html, /data-function="sales"/);
  assert.match(html, /data-function="ops"/);
  assert.match(html, /utm_source=youtube/);
  assert.match(html, /utm_medium=cpc/);
  assert.match(html, /utm_campaign=six-function-agent-gates/);
  assert.match(html, /github.com\/IgorGanapolsky\/ThumbGate/);
  assert.match(html, /npmjs.com\/package\/thumbgate/);
  assert.match(html, /marketplace\/actions\/thumbgate-agent-governance/);
  assert.match(html, /npx thumbgate init/);
  assert.match(html, /VERIFICATION_EVIDENCE\.md/);
});

test('YouTube landing refuses celebrity theater and paid-pilot hero', () => {
  const html = fs.readFileSync(PAGE, 'utf8');
  const banned = [
    /Tony Robbins/i,
    /Richard Branson/i,
    /Kiyosaki/i,
    /Katalyst/i,
    /3M\+/,
    /3 million/i,
    /2,000 seats/,
    /2000 seats/,
    /\$499/,
    /countdown/i,
  ];
  for (const pattern of banned) {
    assert.doesNotMatch(html, pattern, `banned copy leaked: ${pattern}`);
  }
});
