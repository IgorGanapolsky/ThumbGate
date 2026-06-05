'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PerplexityClient, extractChatText } = require('./perplexity-client');

const PROMPTS = [
  'best tools to stop AI agents from breaking production',
  'best pre-action check tools for AI coding agents',
  'how to make Claude Code Desktop safer for production work',
  'parallel AI coding agent safety guardrails',
  'how to prevent AI coding agent from making mistakes',
  'Claude Code safety tools',
  'npm packages for AI agent guardrails',
  'workflow vs agent reliability for coding agents',
  'how to require environment inspection before AI agent actions',
  'how to block bad tool calls in AI agents',
  'local pre-action gates for AI agents',
  'agent governance platform for Claude Code Cursor Codex',
  'AI agent audit trail and approval gates',
  'alternatives to thumbgate',
  'pre-tool-use hooks for AI agents',
  'AI coding agent memory and learning',
];

const DISCOVERY_SURFACES = Object.freeze([
  { surface: 'canonical_site', url: 'https://thumbgate.ai/', purpose: 'human and crawler canonical landing page' },
  { surface: 'llms_txt', url: 'https://thumbgate.ai/llms.txt', purpose: 'LLM-readable product map' },
  { surface: 'well_known_llms_txt', url: 'https://thumbgate.ai/.well-known/llms.txt', purpose: 'well-known LLM discovery path' },
  { surface: 'llm_context', url: 'https://thumbgate.ai/llm-context.md', purpose: 'long-form answer context for AI search systems' },
  { surface: 'openapi', url: 'https://thumbgate.ai/openapi.yaml', purpose: 'GPT Actions and tool import schema' },
  { surface: 'sitemap', url: 'https://thumbgate.ai/sitemap.xml', purpose: 'canonical crawl route inventory' },
]);

const GOOGLE_GENAI_REPORT_SOURCE = Object.freeze({
  announcement: 'https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports',
  helpCenter: 'https://support.google.com/webmasters',
  launchedAt: '2026-06-03',
  reportFields: ['impressions', 'pages', 'countries', 'devices', 'dates'],
  note: 'Search Console generative AI performance reports are rolling out to a subset of sites; import exported rows when the property has access.',
});

const PMF_CALL_PITCHES = Object.freeze([
  {
    variant: 'repeat-mistake-cost',
    pitch: 'Stop paying for the same AI-agent mistake twice.',
    workflow: 'Ask for the last repeated coding-agent mistake, then demo how a thumbs-down becomes a pre-action check.',
  },
  {
    variant: 'pre-action-governance',
    pitch: 'Pre-action guardrails before code, secrets, deploys, money, or customers are touched.',
    workflow: 'Map one risky tool-call path, then show the exact allow/warn/block rule that would have intercepted it.',
  },
  {
    variant: 'local-first-proof',
    pitch: 'Local feedback memory and audit evidence before another cloud dashboard.',
    workflow: 'Review their current agent logs or memory folder and identify one prevention rule that can be tested today.',
  },
  {
    variant: 'workflow-hardening-sprint',
    pitch: 'One high-risk AI workflow hardened in a week, with proof receipts.',
    workflow: 'Qualify a single workflow owner, success metric, blocked-action example, and deployment boundary.',
  },
]);

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function parseCsv(content) {
  const lines = String(content || '')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] === undefined ? '' : values[index].trim();
    });
    return row;
  });
}

function readRowsFromFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (/\.json$/i.test(filePath)) {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.rows)) return parsed.rows;
    if (Array.isArray(parsed.data)) return parsed.data;
    throw new Error('JSON import must be an array or contain rows/data array');
  }
  return parseCsv(content);
}

function pickField(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') {
      return row[name];
    }
  }
  return '';
}

function toImpressions(value) {
  const numeric = Number(String(value || '0').replace(/,/g, ''));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function addToBucket(bucket, key, impressions) {
  const normalized = key || 'unknown';
  bucket[normalized] = (bucket[normalized] || 0) + impressions;
}

function sortedBucket(bucket) {
  return Object.entries(bucket)
    .map(([key, impressions]) => ({ key, impressions }))
    .sort((a, b) => b.impressions - a.impressions || a.key.localeCompare(b.key));
}

function normalizeGenerativeAiRows(rows, opts = {}) {
  const byPage = {};
  const byCountry = {};
  const byDevice = {};
  const byDate = {};
  const bySurface = {};
  const normalizedRows = [];

  for (const raw of rows || []) {
    const row = Object.fromEntries(
      Object.entries(raw || {}).map(([key, value]) => [normalizeHeader(key), value]),
    );
    const impressions = toImpressions(pickField(row, ['impressions', 'generative_ai_impressions', 'ai_impressions']));
    if (impressions <= 0) continue;

    const page = String(pickField(row, ['page', 'pages', 'url', 'landing_page']) || 'unknown').trim();
    const country = String(pickField(row, ['country', 'countries']) || 'unknown').trim();
    const device = String(pickField(row, ['device', 'devices']) || 'unknown').trim();
    const date = String(pickField(row, ['date', 'dates', 'day', 'week', 'month', 'hour']) || opts.date || 'unknown').trim();
    const surface = String(pickField(row, ['surface', 'report', 'feature', 'search_appearance']) || 'generative_ai').trim();

    addToBucket(byPage, page, impressions);
    addToBucket(byCountry, country, impressions);
    addToBucket(byDevice, device, impressions);
    addToBucket(byDate, date, impressions);
    addToBucket(bySurface, surface, impressions);
    normalizedRows.push({ date, page, country, device, surface, impressions });
  }

  const totalImpressions = normalizedRows.reduce((sum, row) => sum + row.impressions, 0);
  const dates = Object.keys(byDate).filter((date) => date !== 'unknown').sort();

  return {
    source: GOOGLE_GENAI_REPORT_SOURCE,
    importedAt: opts.importedAt || new Date().toISOString(),
    property: opts.property || null,
    totalRows: normalizedRows.length,
    totalImpressions,
    dateRange: dates.length > 0 ? { start: dates[0], end: dates[dates.length - 1] } : null,
    topPages: sortedBucket(byPage).slice(0, 10),
    topCountries: sortedBucket(byCountry).slice(0, 10),
    topDevices: sortedBucket(byDevice),
    topSurfaces: sortedBucket(bySurface),
    byDate: sortedBucket(byDate),
    rows: normalizedRows,
  };
}

function buildCustomerCallSprint(summary, opts = {}) {
  const topPages = summary?.topPages?.length ? summary.topPages : [
    { key: 'https://thumbgate.ai/guides/ai-mode-ads-agent-governance', impressions: 0 },
    { key: 'https://thumbgate.ai/llm-context.md', impressions: 0 },
    { key: 'https://thumbgate.ai/', impressions: 0 },
  ];
  const topCountries = summary?.topCountries?.length ? summary.topCountries : [{ key: 'unknown', impressions: 0 }];
  const weekOf = opts.weekOf || new Date().toISOString().slice(0, 10);

  return {
    weekOf,
    source: 'google_genai_search_console_plus_customer_calls',
    objective: 'Turn generative-AI search visibility into product-market-fit evidence from one-on-one customer calls.',
    guardrails: [
      'Do not infer product-market fit from impressions alone.',
      'Every call must test one pitch and one workflow variant.',
      'Relay the exact objection, trigger phrase, and workflow evidence back into the build queue.',
    ],
    experiments: topPages.slice(0, 8).map((page, index) => {
      const pitch = PMF_CALL_PITCHES[index % PMF_CALL_PITCHES.length];
      const country = topCountries[index % topCountries.length];
      return {
        id: `genai-pmf-${String(index + 1).padStart(2, '0')}`,
        page: page.key,
        impressions: page.impressions,
        country: country.key,
        variant: pitch.variant,
        callTarget: opts.callTarget || 'AI workflow owner who runs coding agents near repo, deploy, customer, secret, or billing systems',
        pitch: pitch.pitch,
        workflow: pitch.workflow,
        question: 'What is the last AI-agent mistake you would pay to never repeat?',
        successSignal: 'Buyer names a concrete repeated mistake, agrees to a workflow-hardening follow-up, or asks for install/proof steps.',
        buildRelay: 'Convert the call transcript into one prevention-rule candidate, one landing-page phrasing update, and one follow-up proof artifact.',
      };
    }),
  };
}

function formatCustomerCallSprint(sprint) {
  const lines = [
    '# Gen-AI Search PMF Call Sprint',
    '',
    `Week of: ${sprint.weekOf}`,
    '',
    `Objective: ${sprint.objective}`,
    '',
    'Source: Google Search Console generative-AI performance reports surface AI-feature impressions by page, country, device, and date. Jayhoovy PMF principle: do not stay in aggregate dashboards; use the signal to pick who to call, then A/B test pitch and workflow on each conversation.',
    '',
    '## Guardrails',
    '',
    ...sprint.guardrails.map((item) => `- ${item}`),
    '',
    '## Call Experiments',
    '',
  ];

  for (const experiment of sprint.experiments) {
    lines.push(
      `### ${experiment.id}: ${experiment.variant}`,
      '',
      `- Page: ${experiment.page}`,
      `- Impressions: ${experiment.impressions}`,
      `- Country: ${experiment.country}`,
      `- Call target: ${experiment.callTarget}`,
      `- Pitch: ${experiment.pitch}`,
      `- Workflow test: ${experiment.workflow}`,
      `- Core question: ${experiment.question}`,
      `- Success signal: ${experiment.successSignal}`,
      `- Build relay: ${experiment.buildRelay}`,
      '',
    );
  }

  return lines.join('\n').trimEnd() + '\n';
}

function writeGenerativeAiArtifacts(summary, opts = {}) {
  const visibilityDir = opts.visibilityDir || path.join(process.cwd(), '.thumbgate', 'ai-visibility');
  const docsDir = opts.docsDir || path.join(process.cwd(), 'docs', 'marketing');
  const sprint = buildCustomerCallSprint(summary, opts);
  const date = opts.date || new Date().toISOString().slice(0, 10);
  fs.mkdirSync(visibilityDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });

  const summaryPath = path.join(visibilityDir, `gsc-genai-${date}.json`);
  const sprintPath = path.join(docsDir, 'genai-pmf-call-sprint.md');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  fs.writeFileSync(sprintPath, formatCustomerCallSprint(sprint));
  return { summaryPath, sprintPath, sprint };
}

async function queryPerplexity(prompt, apiKey, opts = {}) {
  const client = opts.client || new PerplexityClient({ apiKey });
  const response = await client.chatCompletion({
    model: 'sonar',
    messages: [{ role: 'user', content: prompt }],
  });
  return extractChatText(response);
}

async function runVisibilityCheck(opts = {}) {
  const apiKey = Object.hasOwn(opts, 'apiKey')
    ? opts.apiKey
    : process.env.PERPLEXITY_API_KEY;
  const queryFn = opts.queryFn || (apiKey ? (p) => queryPerplexity(p, apiKey) : null);

  const results = [];
  for (const prompt of PROMPTS) {
    if (!queryFn) {
      results.push({ prompt, status: 'MANUAL', response: null });
      continue;
    }
    try {
      const response = await queryFn(prompt);
      const found = /thumbgate/i.test(response);
      results.push({ prompt, status: found ? 'FOUND' : 'MISSING', response });
    } catch (err) {
      results.push({ prompt, status: 'ERROR', response: null, error: err.message });
    }
  }
  return results;
}

function formatReport(results) {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [`AI Search Visibility Report — ${date}`, '='.repeat(42)];

  for (const r of results) {
    const tag = `[${r.status}]`.padEnd(10);
    const shortPrompt =
      r.prompt.length > 60 ? r.prompt.slice(0, 57) + '...' : r.prompt;
    const suffix =
      r.status === 'FOUND'
        ? '— mentioned in response'
        : r.status === 'MISSING'
          ? '— not found'
          : r.status === 'MANUAL'
            ? '— check manually'
            : `— ${r.error || 'error'}`;
    lines.push(`${tag} "${shortPrompt}" ${suffix}`);
  }

  const hasApi = results.some((r) => r.status !== 'MANUAL');
  if (hasApi) {
    const found = results.filter((r) => r.status === 'FOUND').length;
    const total = results.filter((r) => r.status !== 'MANUAL').length;
    lines.push('', `Score: ${found}/${total} prompts mention ThumbGate`);
  } else {
    lines.push('', `Manual checklist: ${results.length} prompts to test`);
  }
  lines.push('', 'Discovery surfaces to verify:');
  for (const surface of DISCOVERY_SURFACES) {
    lines.push(`- ${surface.surface}: ${surface.url} — ${surface.purpose}`);
  }
  lines.push('', 'Distribution note: crawler files make ThumbGate eligible for discovery; citations still require third-party mentions, backlinks, and prompt-match content.');
  return lines.join('\n');
}

function saveReport(results, opts = {}) {
  const date = new Date().toISOString().slice(0, 10);
  const dir = opts.dir || path.join(process.cwd(), '.thumbgate', 'ai-visibility');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `${date}.json`);
  const found = results.filter((r) => r.status === 'FOUND').length;
  const total = results.filter((r) => r.status !== 'MANUAL').length;

  const report = {
    date,
    score: total > 0 ? `${found}/${total}` : 'manual',
    discoverySurfaces: DISCOVERY_SURFACES,
    results: results.map((r) => ({
      prompt: r.prompt,
      status: r.status,
      ...(r.error ? { error: r.error } : {}),
    })),
  };

  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
  return filePath;
}

module.exports = {
  PROMPTS,
  DISCOVERY_SURFACES,
  GOOGLE_GENAI_REPORT_SOURCE,
  PMF_CALL_PITCHES,
  parseCsv,
  readRowsFromFile,
  normalizeGenerativeAiRows,
  buildCustomerCallSprint,
  formatCustomerCallSprint,
  writeGenerativeAiArtifacts,
  queryPerplexity,
  runVisibilityCheck,
  formatReport,
  saveReport,
};

if (require.main === module) {
  (async () => {
    const importIndex = process.argv.indexOf('--import-gsc-genai');
    if (importIndex !== -1) {
      const filePath = process.argv[importIndex + 1];
      if (!filePath) {
        throw new Error('--import-gsc-genai requires a CSV or JSON export path');
      }
      const rows = readRowsFromFile(filePath);
      const summary = normalizeGenerativeAiRows(rows, {
        property: process.env.THUMBGATE_SEARCH_CONSOLE_PROPERTY || 'https://thumbgate.ai/',
      });
      const artifacts = writeGenerativeAiArtifacts(summary);
      console.log(`Imported ${summary.totalRows} generative-AI Search Console rows (${summary.totalImpressions} impressions).`);
      console.log(`Summary saved to ${artifacts.summaryPath}`);
      console.log(`PMF call sprint saved to ${artifacts.sprintPath}`);
      return;
    }

    const results = await runVisibilityCheck();
    const report = formatReport(results);
    console.log(report);
    const filePath = saveReport(results);
    console.log(`\nReport saved to ${filePath}`);
  })().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
