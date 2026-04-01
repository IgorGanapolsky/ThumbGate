'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  HIGH_ROI_QUERY_SEEDS,
  THUMBGATE_SEO_SITEMAP_ENTRIES,
  buildThumbGateSeoPlan,
  findSeoPageByPath,
  parseCsv,
  renderPlanMarkdown,
  renderSeoPageHtml,
  writePlanOutputs,
} = require('../scripts/seo-gsd');

test('parseCsv handles quoted commas and preserves headers', () => {
  const rows = parseCsv([
    'Query,Business Value,Notes',
    '"thumbgate vs speclock",100,"Bottom-of-funnel, comparison page"',
  ].join('\n'));

  assert.deepEqual(rows, [{
    query: 'thumbgate vs speclock',
    business_value: '100',
    notes: 'Bottom-of-funnel, comparison page',
  }]);
});

test('buildThumbGateSeoPlan returns GSD stages and prioritizes comparison pages first', () => {
  const plan = buildThumbGateSeoPlan();

  assert.equal(plan.framework, 'GSD');
  assert.equal(plan.capture.totalKeywords, HIGH_ROI_QUERY_SEEDS.length);
  assert.ok(plan.capture.keywordRows.every((row) => typeof row.opportunityScore === 'number'));
  assert.equal(plan.execute.pages.length, 5);
  assert.equal(plan.execute.briefs[0].path, '/compare/speclock');
  assert.equal(plan.execute.briefs[1].path, '/compare/mem0');
  assert.equal(plan.review.recommendedOrder[0], '/compare/speclock');
});

test('renderPlanMarkdown names all five GSD stages and page briefs', () => {
  const markdown = renderPlanMarkdown(buildThumbGateSeoPlan());

  assert.match(markdown, /## Capture/);
  assert.match(markdown, /## Clarify/);
  assert.match(markdown, /## Organize/);
  assert.match(markdown, /## Execute/);
  assert.match(markdown, /## Review/);
  assert.match(markdown, /ThumbGate vs SpecLock/);
  assert.match(markdown, /ThumbGate vs Mem0/);
});

test('renderSeoPageHtml includes structured data, thumbs messaging, and proof links', () => {
  const page = findSeoPageByPath('/compare/speclock');
  const html = renderSeoPageHtml(page, { appOrigin: 'https://app.example.com' });

  assert.ok(page);
  assert.match(html, /"@type": "TechArticle"/);
  assert.match(html, /"@type": "FAQPage"/);
  assert.match(html, /https:\/\/app\.example\.com\/compare\/speclock/);
  assert.match(html, /👍 Thumbs up reinforces good behavior/);
  assert.match(html, /👎 Thumbs down blocks repeated mistakes/);
  assert.match(html, /Verification evidence/);
  assert.match(html, /Automation proof/);
  assert.match(html, /ThumbGate vs SpecLock/);
});

test('page lookup and sitemap entries stay aligned', () => {
  const page = findSeoPageByPath('/guides/claude-code-feedback');
  const sitemapEntry = THUMBGATE_SEO_SITEMAP_ENTRIES.find((entry) => entry.path === '/guides/claude-code-feedback');

  assert.ok(page);
  assert.equal(page.pageType, 'integration');
  assert.deepEqual(sitemapEntry, {
    path: '/guides/claude-code-feedback',
    changefreq: 'monthly',
    priority: '0.8',
  });
});

test('writePlanOutputs persists machine-readable GSD artifacts', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-gsd-outputs-'));

  try {
    const files = writePlanOutputs(buildThumbGateSeoPlan(), tmpDir);

    assert.deepEqual(Object.keys(files).sort(), ['capture', 'clarify', 'execute', 'organize', 'pages', 'review']);
    for (const filePath of Object.values(files)) {
      assert.ok(fs.existsSync(filePath), `${filePath} should exist`);
    }

    const capture = JSON.parse(fs.readFileSync(files.capture, 'utf8'));
    const pages = JSON.parse(fs.readFileSync(files.pages, 'utf8'));
    const execute = fs.readFileSync(files.execute, 'utf8');

    assert.equal(capture.totalKeywords, HIGH_ROI_QUERY_SEEDS.length);
    assert.equal(pages.length, 5);
    assert.match(execute, /# ThumbGate SEO\/GEO GSD Plan/);
    assert.match(execute, /Recommended publish order/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
