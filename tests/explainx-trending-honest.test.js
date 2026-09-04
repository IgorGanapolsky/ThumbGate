'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const http = require('http');

const {
  buildReport,
  fetchUrl,
  mapItem,
  parseArgs,
  parseTrendingHtml,
  run,
  skipReason,
} = require('../scripts/explainx-trending-honest');

const REPO = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'explainx-trending-rsc-snippet.html');
const FIXTURE_REL = 'tests/fixtures/explainx-trending-rsc-snippet.html';

describe('explainx-trending-honest', () => {
  it('parses scored items from RSC HTML fixture (fail closed on empty)', () => {
    const html = fs.readFileSync(FIXTURE, 'utf8');
    const items = parseTrendingHtml(html);
    assert.ok(items.length >= 10, `expected >=10 items, got ${items.length}`);
    assert.ok(items.every((item) => Number.isFinite(item.score) && item.score >= 0));
    assert.ok(items[0].score >= items[1].score);
    assert.deepEqual(parseTrendingHtml(''), []);
  });

  it('parses plain JSON item blobs and keeps higher score on href collision', () => {
    const html = [
      '{"type":"blog","typeLabel":"blog","name":"Low","description":"d","href":"/a","score":10}',
      '{"type":"blog","typeLabel":"blog","name":"High","description":"d","href":"/a","score":99}',
      '{"type":"skill","typeLabel":"skill","name":"Other","description":"x","href":"/b","score":5}',
    ].join('\n');
    const items = parseTrendingHtml(html);
    assert.equal(items.length, 2);
    assert.equal(items[0].href, '/a');
    assert.equal(items[0].score, 99);
    assert.equal(items[0].name, 'High');
    assert.match(items[0].url, /^https:\/\/explainx\.ai\/a$/);
  });

  it('ranks by parsed score and never invents ROI', () => {
    const html = fs.readFileSync(FIXTURE, 'utf8');
    const report = buildReport({ html, source: 'fixture:test', top: 20 });
    assert.equal(report.ok, true);
    assert.equal(report.status, 'OK');
    assert.match(report.disclaimer, /not ThumbGate ROI/i);
    assert.ok(!JSON.stringify(report).includes('TF-IDF'));
    assert.ok(report.items[0].score >= report.items.at(-1).score);
    assert.ok(report.counts.parsed >= report.counts.shown);
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

  it('maps grill-me / harness / skills-mcp and observes unmatched', () => {
    assert.equal(mapItem({
      type: 'skill', name: 'grill-me', description: '', href: '/skills/grill-me', score: 96,
    }).mapId, 'grill-me-spec');
    assert.equal(mapItem({
      type: 'blog',
      name: 'Top 10 Closed-Source and Open-Source Agent Harnesses (2026)',
      description: 'agent harness roundup',
      href: '/blog/harness',
      score: 79,
    }).mapId, 'harness-compare');
    assert.equal(mapItem({
      type: 'blog',
      name: 'Skills + MCP + Loops',
      description: 'agent skills and MCP loops',
      href: '/blog/skills-mcp',
      score: 50,
    }).mapId, 'skills-mcp-loops');

    const observe = mapItem({
      type: 'blog',
      name: 'Totally Unrelated Topic',
      description: 'gardening tips',
      href: '/blog/gardening',
      score: 1,
    });
    assert.equal(observe.disposition, 'observe');
    assert.match(observe.steal, /observe only/i);
  });

  it('classifies skip reasons without auto-install', () => {
    assert.equal(skipReason({
      name: 'ExplainX MCP Bootcamp', description: 'workshop', href: '/pricing', type: 'course',
    }), 'product_clone');
    assert.equal(skipReason({
      name: 'Flutter UI kit', description: 'mobile-app-ui lottie', href: '/ui', type: 'blog',
    }), 'ui_design_sku');
    assert.equal(skipReason({
      name: 'Claude Commerce Agents', description: 'shopping agent', href: '/commerce', type: 'blog',
    }), 'eci_pause');
    assert.equal(skipReason({
      name: 'Ordinary note', description: 'nothing special', href: '/x', type: 'blog',
    }), null);
  });

  it('parseArgs accepts fixture/fetch/json/top and rejects unknowns', () => {
    assert.deepEqual(parseArgs(['--fixture', 'x.html', '--json', '--top', '5']), {
      fixture: 'x.html',
      fetch: false,
      url: 'https://explainx.ai/trending',
      json: true,
      top: 5,
      help: false,
    });
    assert.equal(parseArgs(['--help']).help, true);
    assert.equal(parseArgs(['--fetch']).fetch, true);
    assert.throws(() => parseArgs(['--nope']), /Unknown or incomplete/);
  });

  it('run() loads fixture and prints text + json modes', async () => {
    const help = await run(['--help']);
    assert.equal(help.status, 'HELP');

    const text = await run(['--fixture', FIXTURE_REL, '--top', '3']);
    assert.equal(text.ok, true);
    assert.equal(text.status, 'OK');
    assert.ok(text.actionable.length >= 1);

    const json = await run(['--fixture', FIXTURE, '--json', '--top', '2']);
    assert.equal(json.ok, true);
    assert.equal(json.items.length, 2);

    await assert.rejects(() => run([]), /Provide --fixture PATH or --fetch/);
  });

  it('CLI --help exits 0', () => {
    const result = spawnSync(
      process.execPath,
      [path.join(REPO, 'scripts/explainx-trending-honest.js'), '--help'],
      { encoding: 'utf8', timeout: 10000 },
    );
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
  });

  it('returns UNAVAILABLE when HTML has no scored items', () => {
    const report = buildReport({ html: '<html><body>empty</body></html>', source: 'empty', top: 5 });
    assert.equal(report.ok, false);
    assert.equal(report.status, 'UNAVAILABLE');
    assert.equal(report.items.length, 0);
  });

  it('fetchUrl follows redirects and rejects non-200', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/ok') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html>ok-body</html>');
        return;
      }
      if (req.url === '/redir') {
        res.writeHead(302, { Location: '/ok' });
        res.end();
        return;
      }
      res.writeHead(503);
      res.end('nope');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    try {
      const body = await fetchUrl(`${base}/ok`);
      assert.match(body, /ok-body/);
      const redirected = await fetchUrl(`${base}/redir`);
      assert.match(redirected, /ok-body/);
      await assert.rejects(() => fetchUrl(`${base}/fail`), /HTTP 503/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
