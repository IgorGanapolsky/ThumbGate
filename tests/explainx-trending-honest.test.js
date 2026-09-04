'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  buildReport,
  mapItem,
  parseTrendingHtml,
} = require('../scripts/explainx-trending-honest');

const FIXTURE = path.join(__dirname, 'fixtures', 'explainx-trending-rsc-snippet.html');

describe('explainx-trending-honest', () => {
  it('parses scored items from RSC HTML fixture (fail closed on empty)', () => {
    const html = fs.readFileSync(FIXTURE, 'utf8');
    const items = parseTrendingHtml(html);
    assert.ok(items.length >= 10, `expected >=10 items, got ${items.length}`);
    assert.ok(items.every((item) => Number.isFinite(item.score) && item.score >= 0));
    assert.ok(items[0].score >= items[1].score);
    assert.deepEqual(parseTrendingHtml(''), []);
  });

  it('ranks by parsed score and never invents ROI', () => {
    const html = fs.readFileSync(FIXTURE, 'utf8');
    const report = buildReport({ html, source: 'fixture:test', top: 20 });
    assert.equal(report.ok, true);
    assert.equal(report.status, 'OK');
    assert.match(report.disclaimer, /not ThumbGate ROI/i);
    assert.ok(!JSON.stringify(report).includes('TF-IDF'));
    assert.ok(report.items[0].score >= report.items.at(-1).score);
  });

  it('maps /show-me and limit-reset onto existing rails; skips news noise', () => {
    const showMe = mapItem({
      type: 'blog',
      name: 'The /show-me Skill: Making Coding Agents Draw Instead of Ramble',
      description: 'trees, mermaid diagrams',
      href: '/blog/show-me-skill-visual-output-coding-agents-2026',
      score: 87,
    });
    assert.equal(showMe.disposition, 'map');
    assert.equal(showMe.mapId, 'show-me-visual');
    assert.ok(showMe.rails.some((r) => r.includes('show-me')));

    const limits = mapItem({
      type: 'blog',
      name: "Claude Code's New /limit-reset Command, Explained",
      description: 'resets 5-hour session usage limit once a week',
      href: '/blog/claude-code-limit-reset-command-september-2026',
      score: 925,
    });
    assert.equal(limits.disposition, 'map');
    assert.equal(limits.mapId, 'session-budget');

    const rsa = mapItem({
      type: 'blog',
      name: 'RSA-260 Just Fell',
      description: 'prime factor',
      href: '/blog/rsa-260-factored',
      score: 633,
    });
    assert.equal(rsa.disposition, 'skip');
    assert.equal(rsa.skipReason, 'news_noise');
  });

  it('returns UNAVAILABLE when HTML has no scored items', () => {
    const report = buildReport({ html: '<html><body>empty</body></html>', source: 'empty', top: 5 });
    assert.equal(report.ok, false);
    assert.equal(report.status, 'UNAVAILABLE');
    assert.equal(report.items.length, 0);
  });
});
