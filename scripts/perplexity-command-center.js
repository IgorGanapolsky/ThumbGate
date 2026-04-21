'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { PROMPTS: VISIBILITY_PROMPTS } = require('./ai-search-visibility');
const {
  PerplexityClient,
  extractAgentText,
  extractChatText,
  extractCitations,
  normalizeSearchResults,
} = require('./perplexity-client');

const DEFAULT_OUTPUT_ROOT = path.join(process.cwd(), '.thumbgate', 'perplexity');
const DEFAULT_LEAD_LIMIT = 12;
const DEFAULT_AGENT_MODEL = process.env.PERPLEXITY_AGENT_MODEL || 'openai/gpt-5.4';

const PRODUCT = {
  name: 'ThumbGate',
  repo: 'https://github.com/IgorGanapolsky/ThumbGate',
  site: 'https://thumbgate.ai',
  checkout: 'https://thumbgate.ai/checkout/pro',
  promise: 'turn thumbs-up/down feedback into pre-action gates that stop AI agents from repeating mistakes',
};

const LEAD_SEARCH_QUERIES = [
  {
    label: 'agent reliability pain',
    query: 'AI coding agent repeats mistakes Claude Code Cursor Codex MCP guardrails',
  },
  {
    label: 'pre-action gate demand',
    query: 'pre tool use hook block bad tool calls AI agent safety developer workflow',
  },
  {
    label: 'team workflow hardening',
    query: 'AI coding agent broke production migration force push guardrail team workflow',
  },
  {
    label: 'memory and feedback loop',
    query: 'thumbs down feedback memory AI coding agents DPO preference learning developer tools',
  },
  {
    label: 'marketplace placement',
    query: 'Claude Code plugins MCP memory guardrails AI developer tools',
  },
];

function parseArgs(argv = process.argv.slice(2)) {
  const opts = {
    command: 'full',
    dryRun: false,
    write: true,
    json: false,
    leadLimit: DEFAULT_LEAD_LIMIT,
    outDir: null,
    allowChatFallback: false,
  };

  for (const arg of argv) {
    if (!arg.startsWith('-') && opts.command === 'full') {
      opts.command = arg;
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--no-write') {
      opts.write = false;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--allow-chat-fallback') {
      opts.allowChatFallback = true;
    } else if (arg.startsWith('--out-dir=')) {
      opts.outDir = arg.slice('--out-dir='.length);
    } else if (arg.startsWith('--limit=')) {
      opts.leadLimit = parsePositiveInt(arg.slice('--limit='.length), DEFAULT_LEAD_LIMIT);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return opts;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function dateStamp(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function outputDirFor(opts = {}) {
  if (opts.outDir) return path.resolve(opts.outDir);
  return path.join(DEFAULT_OUTPUT_ROOT, dateStamp(opts.now));
}

function hasLiveAccess(ctx) {
  return !ctx.dryRun && ctx.client.hasApiKey();
}

function normalizeStatusResponse(response) {
  return String(response || '').replaceAll(/\s+/g, ' ').trim();
}

async function collectVisibility(ctx) {
  const results = [];

  for (const prompt of VISIBILITY_PROMPTS) {
    if (!hasLiveAccess(ctx)) {
      results.push({
        prompt,
        status: 'MANUAL',
        found: false,
        response: null,
        citations: [],
      });
      continue;
    }

    try {
      const response = await ctx.client.chatCompletion({
        model: 'sonar',
        messages: [{ role: 'user', content: prompt }],
      });
      const text = extractChatText(response);
      const found = /thumbgate/i.test(text);
      results.push({
        prompt,
        status: found ? 'FOUND' : 'MISSING',
        found,
        response: normalizeStatusResponse(text),
        citations: extractCitations(response),
      });
    } catch (err) {
      results.push({
        prompt,
        status: 'ERROR',
        found: false,
        response: null,
        citations: [],
        error: err.message,
      });
    }
  }

  const scored = scoreVisibility(results);
  return {
    date: dateStamp(ctx.now),
    mode: hasLiveAccess(ctx) ? 'live' : 'manual',
    prompts: VISIBILITY_PROMPTS.length,
    ...scored,
    results,
  };
}

function scoreVisibility(results) {
  const measured = results.filter((item) => item.status !== 'MANUAL');
  const found = measured.filter((item) => item.status === 'FOUND').length;
  const missing = measured.filter((item) => item.status === 'MISSING').length;
  const errors = measured.filter((item) => item.status === 'ERROR').length;
  const score = measured.length ? `${found}/${measured.length}` : 'manual';
  return { score, found, missing, errors, measured: measured.length };
}

async function discoverLeads(ctx) {
  const rawResults = [];
  const queryReports = [];

  for (const search of LEAD_SEARCH_QUERIES) {
    if (!hasLiveAccess(ctx)) {
      queryReports.push({ ...search, status: 'MANUAL', results: [] });
      continue;
    }

    try {
      const response = await ctx.client.search({
        query: search.query,
        maxResults: Math.min(10, ctx.leadLimit),
        maxTokensPerPage: 768,
      });
      const results = normalizeSearchResults(response).map((item) => ({
        ...item,
        queryLabel: search.label,
        query: search.query,
      }));
      rawResults.push(...results);
      queryReports.push({ ...search, status: 'OK', results });
    } catch (err) {
      queryReports.push({ ...search, status: 'ERROR', error: err.message, results: [] });
    }
  }

  const deduped = dedupeLeads(rawResults)
    .map(scoreLead)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, ctx.leadLimit);

  return {
    date: dateStamp(ctx.now),
    mode: hasLiveAccess(ctx) ? 'live' : 'manual',
    queryCount: LEAD_SEARCH_QUERIES.length,
    leadCount: deduped.length,
    queries: queryReports.map((item) => ({
      label: item.label,
      query: item.query,
      status: item.status,
      resultCount: item.results.length,
      ...(item.error ? { error: item.error } : {}),
    })),
    leads: deduped,
  };
}

function canonicalLeadUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    const trackingKeys = [];
    for (const key of parsed.searchParams.keys()) {
      if (/^(utm$|utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) {
        trackingKeys.push(key);
      }
    }
    for (const key of trackingKeys) parsed.searchParams.delete(key);
    parsed.searchParams.sort();
    const cleanUrl = parsed.toString();
    return cleanUrl.endsWith('/') ? cleanUrl.slice(0, -1) : cleanUrl;
  } catch {
    return String(url || '').trim();
  }
}

function dedupeLeads(results) {
  const seen = new Map();
  for (const item of results) {
    const key = canonicalLeadUrl(item.url);
    if (!key) continue;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, { ...item, url: key, queryLabels: [item.queryLabel] });
    } else if (!existing.queryLabels.includes(item.queryLabel)) {
      existing.queryLabels.push(item.queryLabel);
    }
  }
  return [...seen.values()];
}

function scoreLead(lead) {
  const text = `${lead.title} ${lead.snippet} ${lead.url}`.toLowerCase();
  const reasons = [];
  let score = 0;

  score += addScore(text, /\b(ai|llm|agent|coding agent|assistant)\b/, 3, reasons, 'AI-agent context');
  score += addScore(text, /\b(claude|codex|cursor|gemini|amp|mcp|pretooluse|tool call)\b/, 3, reasons, 'target ecosystem');
  score += addScore(text, /\b(repeat|mistake|broken|failure|guardrail|safety|block|prevent|hook)\b/, 4, reasons, 'clear pain signal');
  score += addScore(text, /\b(team|enterprise|production|workflow|devops|platform)\b/, 2, reasons, 'team workflow angle');
  score += addScore(text, /\b(reddit|news\.ycombinator|github\.com|stackoverflow|discord|forum|community)\b/, 2, reasons, 'community surface');
  score += addScore(text, /\b(price|buy|paid|tool|saas|plugin|marketplace)\b/, 2, reasons, 'commercial intent');

  if (lead.date && /2026|2025/.test(String(lead.date))) {
    score += 1;
    reasons.push('recent result');
  }

  return {
    ...lead,
    score,
    reasons,
    outreachAngle: buildOutreachAngle(lead, reasons),
  };
}

function addScore(text, regex, points, reasons, reason) {
  if (!regex.test(text)) return 0;
  reasons.push(reason);
  return points;
}

function buildOutreachAngle(lead, reasons) {
  if (reasons.includes('clear pain signal')) {
    return 'Lead with repeated-agent-mistake prevention and offer a concrete before/after gate example.';
  }
  if (reasons.includes('target ecosystem')) {
    return 'Lead with the exact install path for their agent ecosystem and show the first thumbs-down-to-gate loop.';
  }
  return 'Lead with ThumbGate as a lightweight reliability gateway for AI coding workflows.';
}

async function buildAgentBrief(ctx, inputs = {}) {
  const visibility = inputs.visibility || null;
  const leads = inputs.leads || null;
  const prompt = buildBriefPrompt({ visibility, leads });

  if (!hasLiveAccess(ctx)) {
    return {
      date: dateStamp(ctx.now),
      mode: 'manual',
      model: DEFAULT_AGENT_MODEL,
      content: formatManualBrief({ visibility, leads }),
    };
  }

  try {
    const response = await ctx.client.agentResponse({
      model: ctx.agentModel,
      input: prompt,
      instructions: 'You are ThumbGate revenue intelligence. Be specific, factual, and conversion-oriented. Prioritize actions that can create the first dollar or improve distribution quality.',
      tools: [{ type: 'web_search' }, { type: 'fetch_url' }],
      maxOutputTokens: 1800,
    });
    return {
      date: dateStamp(ctx.now),
      mode: 'live',
      model: ctx.agentModel,
      content: extractAgentText(response),
      rawUsage: response.usage || null,
    };
  } catch (err) {
    if (!ctx.allowChatFallback) {
      throw err;
    }
    const response = await ctx.client.chatCompletion({
      model: 'sonar-pro',
      messages: [{ role: 'user', content: prompt }],
      options: { web_search_options: { search_context_size: 'medium' } },
    });
    return {
      date: dateStamp(ctx.now),
      mode: 'chat-fallback',
      model: 'sonar-pro',
      content: extractChatText(response),
      fallbackReason: err.message,
    };
  }
}

function buildBriefPrompt({ visibility, leads }) {
  const visibilitySummary = visibility
    ? `Visibility score: ${visibility.score}; missing prompts: ${visibility.missing}; errors: ${visibility.errors}.`
    : 'Visibility report was not generated in this run.';
  const leadSummary = leads
    ? leads.leads.slice(0, 8).map((lead, index) => `${index + 1}. ${lead.title} (${lead.url}) score=${lead.score}`).join('\n')
    : 'Lead report was not generated in this run.';

  return `Create a ThumbGate Perplexity Max command brief.

Product: ${PRODUCT.name}
Promise: ${PRODUCT.promise}
Repo: ${PRODUCT.repo}
Site: ${PRODUCT.site}
Checkout: ${PRODUCT.checkout}

${visibilitySummary}

Top lead surfaces:
${leadSummary}

Return:
1. The single highest-ROI acquisition action for the next 24 hours.
2. Three search/GEO gaps to fix in docs or landing copy.
3. Five outreach targets or communities with a specific angle.
4. One risk that could waste time or spend.
5. A concise action plan with owners and proof to collect.`;
}

function formatManualBrief({ visibility, leads }) {
  const visibilityScore = visibility?.score || 'manual';
  const leadCount = leads?.leadCount || 0;
  return [
    '# ThumbGate Perplexity Max Brief',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'Mode: manual or dry-run. Set PERPLEXITY_API_KEY to generate a live Agent API brief.',
    '',
    `Visibility score: ${visibilityScore}`,
    `Lead count: ${leadCount}`,
    '',
    'Next action: run `npm run perplexity:full` with PERPLEXITY_API_KEY configured, then inspect the top scored leads before posting or replying.',
  ].join('\n');
}

function buildMcpConfig() {
  return {
    source: 'https://github.com/perplexityai/modelcontextprotocol',
    claudeCode: 'claude mcp add perplexity --env PERPLEXITY_API_KEY="your_key_here" -- npx -y @perplexity-ai/mcp-server',
    codex: 'codex mcp add perplexity --env PERPLEXITY_API_KEY="your_key_here" -- npx -y @perplexity-ai/mcp-server',
    mcpServers: {
      perplexity: {
        command: 'npx',
        args: ['-y', '@perplexity-ai/mcp-server'],
        env: {
          PERPLEXITY_API_KEY: '${PERPLEXITY_API_KEY}',
        },
      },
    },
  };
}

function lessonsFromRun(run) {
  const lessons = [];
  const visibility = run.visibility;
  if (visibility) {
    for (const result of visibility.results || []) {
      if (result.status !== 'MISSING') continue;
      lessons.push({
        signal: 'down',
        domain: 'perplexity-visibility',
        context: `Perplexity answer for "${result.prompt}" did not mention ThumbGate.`,
        whatWentWrong: 'ThumbGate is not visible for a high-intent AI-agent reliability query.',
        whatToChange: 'Add or strengthen docs, landing-page copy, and citations for this exact query intent.',
        tags: ['perplexity', 'geo', 'visibility', 'acquisition'],
        createdAt: new Date().toISOString(),
      });
    }
  }
  const leads = run.leads?.leads || [];
  for (const lead of leads.slice(0, 5)) {
    lessons.push({
      signal: 'up',
      domain: 'perplexity-lead-discovery',
      context: `Perplexity surfaced ${lead.url} as a lead candidate with score ${lead.score}.`,
      whatWorked: lead.outreachAngle,
      tags: ['perplexity', 'lead', 'acquisition'],
      createdAt: new Date().toISOString(),
    });
  }
  return lessons;
}

async function runCommand(command = 'full', opts = {}) {
  const ctx = {
    now: opts.now || new Date(),
    dryRun: Boolean(opts.dryRun),
    write: opts.write !== false,
    outDir: outputDirFor(opts),
    leadLimit: parsePositiveInt(opts.leadLimit, DEFAULT_LEAD_LIMIT),
    allowChatFallback: Boolean(opts.allowChatFallback),
    agentModel: opts.agentModel || DEFAULT_AGENT_MODEL,
    client: opts.client || new PerplexityClient(opts.clientOptions || {}),
  };

  const run = {
    command,
    date: dateStamp(ctx.now),
    outputDir: ctx.outDir,
    dryRun: ctx.dryRun,
    hasApiKey: ctx.client.hasApiKey(),
  };

  switch (command) {
  case 'visibility':
    run.visibility = await collectVisibility(ctx);
    break;
  case 'leads':
    run.leads = await discoverLeads(ctx);
    break;
  case 'brief':
    run.brief = await buildAgentBrief(ctx);
    break;
  case 'mcp-config':
    run.mcpConfig = buildMcpConfig();
    break;
  case 'full':
    run.visibility = await collectVisibility(ctx);
    run.leads = await discoverLeads(ctx);
    run.brief = await buildAgentBrief(ctx, { visibility: run.visibility, leads: run.leads });
    run.mcpConfig = buildMcpConfig();
    break;
  default:
    throw new Error(`Unknown command: ${command}`);
  }

  run.lessons = lessonsFromRun(run);
  run.summary = buildSummary(run);

  if (ctx.write) {
    run.written = writeArtifacts(run, ctx.outDir);
  }

  return run;
}

function buildSummary(run) {
  return {
    command: run.command,
    date: run.date,
    dryRun: run.dryRun,
    hasApiKey: run.hasApiKey,
    visibilityScore: run.visibility?.score || null,
    leadCount: run.leads?.leadCount || 0,
    lessonCount: run.lessons?.length || 0,
    briefMode: run.brief?.mode || null,
  };
}

function writeArtifacts(run, outDir) {
  ensureDir(outDir);
  const written = [];

  written.push(writeJson(path.join(outDir, 'summary.json'), run.summary));

  if (run.visibility) {
    written.push(
      writeJson(path.join(outDir, 'visibility.json'), run.visibility),
      writeText(path.join(outDir, 'visibility.md'), formatVisibilityMarkdown(run.visibility))
    );
  }
  if (run.leads) {
    written.push(
      writeJson(path.join(outDir, 'leads.json'), run.leads),
      writeText(path.join(outDir, 'leads.md'), formatLeadsMarkdown(run.leads))
    );
  }
  if (run.brief) {
    written.push(writeText(path.join(outDir, 'agent-brief.md'), run.brief.content || ''));
  }
  if (run.mcpConfig) {
    written.push(writeJson(path.join(outDir, 'perplexity-mcp-config.json'), run.mcpConfig));
  }
  if (run.lessons?.length) {
    written.push(writeText(path.join(outDir, 'memory-lessons.jsonl'), run.lessons.map((item) => JSON.stringify(item)).join('\n') + '\n'));
  }

  return written;
}

function writeJson(filePath, value) {
  return writeText(filePath, JSON.stringify(value, null, 2) + '\n');
}

function writeText(filePath, value) {
  fs.writeFileSync(filePath, value, 'utf8');
  return filePath;
}

function formatVisibilityMarkdown(report) {
  const lines = [
    '# Perplexity Visibility Report',
    '',
    `Date: ${report.date}`,
    `Mode: ${report.mode}`,
    `Score: ${report.score}`,
    '',
    '| Status | Prompt | Notes |',
    '| --- | --- | --- |',
  ];

  for (const item of report.results) {
    const note = visibilityNote(item);
    lines.push(`| ${item.status} | ${escapeMarkdownTable(item.prompt)} | ${escapeMarkdownTable(note)} |`);
  }
  return lines.join('\n') + '\n';
}

function visibilityNote(item) {
  if (item.error) return item.error;
  if (item.found) return 'ThumbGate mentioned';
  if (item.status === 'MANUAL') return 'Manual check required';
  return 'ThumbGate missing';
}

function formatLeadsMarkdown(report) {
  const lines = [
    '# Perplexity Lead Discovery Report',
    '',
    `Date: ${report.date}`,
    `Mode: ${report.mode}`,
    `Leads: ${report.leadCount}`,
    '',
    '| Score | Lead | Reason | Angle |',
    '| ---: | --- | --- | --- |',
  ];

  for (const lead of report.leads) {
    const link = `[${escapeMarkdownLinkText(lead.title)}](${lead.url})`;
    lines.push(`| ${lead.score} | ${link} | ${escapeMarkdownTable(lead.reasons.join(', '))} | ${escapeMarkdownTable(lead.outreachAngle)} |`);
  }
  return lines.join('\n') + '\n';
}

function escapeMarkdownTable(value) {
  return String(value || '')
    .split('\\').join('\\\\')
    .split('|').join('\\|')
    .split('\r').join(' ')
    .split('\n').join(' ');
}

function escapeMarkdownLinkText(value) {
  return String(value || 'Untitled')
    .split('\\').join('\\\\')
    .split('[').join('\\[')
    .split(']').join('\\]');
}

function isCliEntrypoint(argv = process.argv) {
  return Boolean(argv[1] && path.resolve(argv[1]) === __filename);
}

async function main() {
  const opts = parseArgs();
  const run = await runCommand(opts.command, opts);
  if (opts.json) {
    console.log(JSON.stringify(run.summary, null, 2));
    return;
  }
  console.log(`Perplexity command center: ${run.command}`);
  console.log(`Output: ${run.outputDir}`);
  console.log(`Visibility: ${run.summary.visibilityScore || 'not run'}`);
  console.log(`Leads: ${run.summary.leadCount}`);
  console.log(`Lessons staged: ${run.summary.lessonCount}`);
}

module.exports = {
  LEAD_SEARCH_QUERIES,
  buildAgentBrief,
  buildBriefPrompt,
  buildMcpConfig,
  buildSummary,
  collectVisibility,
  dateStamp,
  dedupeLeads,
  discoverLeads,
  formatLeadsMarkdown,
  formatVisibilityMarkdown,
  isCliEntrypoint,
  lessonsFromRun,
  parseArgs,
  runCommand,
  scoreLead,
};

if (isCliEntrypoint()) {
  main().catch((err) => {
    console.error(`Perplexity command center failed: ${err.message}`);
    process.exit(1);
  });
}
