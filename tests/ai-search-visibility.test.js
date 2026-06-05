'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  PROMPTS,
  DISCOVERY_SURFACES,
  GOOGLE_GENAI_REPORT_SOURCE,
  parseCsv,
  normalizeGenerativeAiRows,
  buildCustomerCallSprint,
  formatCustomerCallSprint,
  writeGenerativeAiArtifacts,
  runVisibilityCheck,
  formatReport,
  saveReport,
} = require('../scripts/ai-search-visibility');

test('PROMPTS array is non-empty and contains expected entries', () => {
  assert.ok(PROMPTS.length >= 5, `expected at least 5 prompts, got ${PROMPTS.length}`);
  assert.ok(PROMPTS.some((p) => /pre-action check/i.test(p)));
  assert.ok(PROMPTS.some((p) => /breaking production/i.test(p)));
  assert.ok(PROMPTS.some((p) => /parallel AI coding agent safety/i.test(p)));
  assert.ok(PROMPTS.some((p) => /environment inspection/i.test(p)));
  assert.ok(PROMPTS.some((p) => /thumbgate/i.test(p)));
  assert.ok(PROMPTS.some((p) => /pre-action gates/i.test(p)));
  assert.ok(PROMPTS.some((p) => /agent governance platform/i.test(p)));
});

test('DISCOVERY_SURFACES covers canonical AI-search entrypoints', () => {
  assert.ok(DISCOVERY_SURFACES.some((surface) => surface.url === 'https://thumbgate.ai/llms.txt'));
  assert.ok(DISCOVERY_SURFACES.some((surface) => surface.url === 'https://thumbgate.ai/.well-known/llms.txt'));
  assert.ok(DISCOVERY_SURFACES.some((surface) => surface.url === 'https://thumbgate.ai/llm-context.md'));
  assert.ok(DISCOVERY_SURFACES.some((surface) => surface.url === 'https://thumbgate.ai/openapi.yaml'));
});

test('runVisibilityCheck with mocked queryFn returns found results', async () => {
  const mockQuery = async (prompt) => {
    if (/pre-action check|alternatives to thumbgate/i.test(prompt)) {
      return 'ThumbGate is a popular pre-action check tool for AI agents.';
    }
    return 'There are many tools for AI safety.';
  };
  const results = await runVisibilityCheck({ queryFn: mockQuery });
  assert.equal(results.length, PROMPTS.length);
  const found = results.filter((r) => r.status === 'FOUND');
  assert.ok(found.length >= 2, `expected at least 2 FOUND, got ${found.length}`);
  const missing = results.filter((r) => r.status === 'MISSING');
  assert.ok(missing.length >= 1, 'expected at least 1 MISSING');
});

test('runVisibilityCheck manual mode (no API key) does not crash', async () => {
  const results = await runVisibilityCheck({ apiKey: null, queryFn: null });
  assert.equal(results.length, PROMPTS.length);
  assert.ok(results.every((r) => r.status === 'MANUAL'));
});

test('formatReport produces correct tags for found results', async () => {
  const mockQuery = async (prompt) => {
    if (/pre-action check/i.test(prompt)) return 'ThumbGate is great.';
    return 'No mention here.';
  };
  const results = await runVisibilityCheck({ queryFn: mockQuery });
  const report = formatReport(results);
  assert.ok(report.includes('[FOUND]'));
  assert.ok(report.includes('[MISSING]'));
  assert.ok(/Score: \d+\/\d+/.test(report));
  assert.ok(report.includes('Discovery surfaces to verify'));
});

test('formatReport manual-only produces manual score line', async () => {
  const results = await runVisibilityCheck({ apiKey: null, queryFn: null });
  const report = formatReport(results);
  assert.ok(report.includes('[MANUAL]'));
  assert.ok(report.includes('Manual checklist'));
});

describe('saveReport', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-vis-test-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('writes valid JSON to temp directory', async () => {
    const results = [
      { prompt: 'test prompt', status: 'FOUND', response: 'thumbgate mentioned' },
      { prompt: 'another prompt', status: 'MISSING', response: 'no mention' },
    ];
    const filePath = saveReport(results, { dir: tmpDir });
    assert.ok(fs.existsSync(filePath));
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.equal(data.score, '1/2');
    assert.ok(Array.isArray(data.discoverySurfaces));
    assert.equal(data.results.length, 2);
    assert.equal(data.results[0].status, 'FOUND');
  });
});

test('runVisibilityCheck handles queryFn errors gracefully', async () => {
  const errorQuery = async () => {
    throw new Error('API timeout');
  };
  const results = await runVisibilityCheck({ queryFn: errorQuery });
  assert.ok(results.every((r) => r.status === 'ERROR'));
  assert.ok(results.every((r) => r.error === 'API timeout'));
});

test('Google Gen-AI report source documents the June 2026 Search Console surface', () => {
  assert.equal(GOOGLE_GENAI_REPORT_SOURCE.launchedAt, '2026-06-03');
  assert.match(GOOGLE_GENAI_REPORT_SOURCE.announcement, /developers\.google\.com\/search\/blog\/2026\/06\/gen-ai-performance-reports/);
  assert.deepEqual(
    GOOGLE_GENAI_REPORT_SOURCE.reportFields,
    ['impressions', 'pages', 'countries', 'devices', 'dates'],
  );
});

test('parseCsv handles quoted Google Search Console export rows', () => {
  const rows = parseCsv([
    'Date,Page,Country,Device,Surface,Impressions',
    '2026-06-04,"https://thumbgate.ai/guides/ai-mode-ads-agent-governance",US,DESKTOP,"AI Overview","1,200"',
  ].join('\n'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2026-06-04');
  assert.equal(rows[0].page, 'https://thumbgate.ai/guides/ai-mode-ads-agent-governance');
  assert.equal(rows[0].surface, 'AI Overview');
  assert.equal(rows[0].impressions, '1,200');
});

test('normalizeGenerativeAiRows rolls up impressions by page, country, device, date, and surface', () => {
  const summary = normalizeGenerativeAiRows([
    {
      Date: '2026-06-04',
      Page: 'https://thumbgate.ai/guides/ai-mode-ads-agent-governance',
      Country: 'US',
      Device: 'DESKTOP',
      Surface: 'AI Overview',
      Impressions: '1200',
    },
    {
      Date: '2026-06-05',
      URL: 'https://thumbgate.ai/llm-context.md',
      Country: 'CA',
      Device: 'MOBILE',
      Report: 'AI Mode',
      Impressions: '300',
    },
    {
      Date: '2026-06-05',
      Page: 'https://thumbgate.ai/guides/ai-mode-ads-agent-governance',
      Country: 'US',
      Device: 'DESKTOP',
      Surface: 'AI Overview',
      Impressions: '500',
    },
  ], {
    importedAt: '2026-06-05T17:00:00.000Z',
    property: 'https://thumbgate.ai/',
  });

  assert.equal(summary.totalRows, 3);
  assert.equal(summary.totalImpressions, 2000);
  assert.deepEqual(summary.dateRange, { start: '2026-06-04', end: '2026-06-05' });
  assert.equal(summary.topPages[0].key, 'https://thumbgate.ai/guides/ai-mode-ads-agent-governance');
  assert.equal(summary.topPages[0].impressions, 1700);
  assert.equal(summary.topCountries[0].key, 'US');
  assert.equal(summary.topDevices[0].key, 'DESKTOP');
  assert.equal(summary.topSurfaces[0].key, 'AI Overview');
});

test('buildCustomerCallSprint converts Gen-AI visibility into A/B customer-call experiments', () => {
  const summary = normalizeGenerativeAiRows([
    { date: '2026-06-05', page: 'https://thumbgate.ai/a', country: 'US', device: 'DESKTOP', surface: 'AI Mode', impressions: 100 },
    { date: '2026-06-05', page: 'https://thumbgate.ai/b', country: 'GB', device: 'MOBILE', surface: 'AI Overview', impressions: 75 },
  ]);
  const sprint = buildCustomerCallSprint(summary, { weekOf: '2026-06-05' });

  assert.equal(sprint.weekOf, '2026-06-05');
  assert.equal(sprint.experiments.length, 2);
  assert.equal(sprint.experiments[0].page, 'https://thumbgate.ai/a');
  assert.match(sprint.experiments[0].question, /last AI-agent mistake/i);
  assert.match(sprint.experiments[0].buildRelay, /prevention-rule candidate/i);
  assert.notEqual(sprint.experiments[0].variant, sprint.experiments[1].variant);
});

test('formatCustomerCallSprint writes a usable PMF call plan', () => {
  const sprint = buildCustomerCallSprint(null, { weekOf: '2026-06-05' });
  const markdown = formatCustomerCallSprint(sprint);
  assert.match(markdown, /Gen-AI Search PMF Call Sprint/);
  assert.match(markdown, /Google Search Console generative-AI performance reports/);
  assert.match(markdown, /Jayhoovy PMF principle/);
  assert.match(markdown, /A\/B test pitch and workflow/);
});

test('writeGenerativeAiArtifacts writes summary JSON and PMF call sprint', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-genai-test-'));
  try {
    const visibilityDir = path.join(tmpDir, 'visibility');
    const docsDir = path.join(tmpDir, 'docs');
    const summary = normalizeGenerativeAiRows([
      { date: '2026-06-05', page: 'https://thumbgate.ai/a', country: 'US', device: 'DESKTOP', surface: 'AI Mode', impressions: 100 },
    ], { importedAt: '2026-06-05T17:00:00.000Z' });
    const artifacts = writeGenerativeAiArtifacts(summary, {
      visibilityDir,
      docsDir,
      date: '2026-06-05',
      weekOf: '2026-06-05',
    });
    assert.ok(fs.existsSync(artifacts.summaryPath));
    assert.ok(fs.existsSync(artifacts.sprintPath));
    assert.equal(JSON.parse(fs.readFileSync(artifacts.summaryPath, 'utf8')).totalImpressions, 100);
    assert.match(fs.readFileSync(artifacts.sprintPath, 'utf8'), /genai-pmf-01/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
