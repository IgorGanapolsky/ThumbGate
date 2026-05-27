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

module.exports = { PROMPTS, DISCOVERY_SURFACES, queryPerplexity, runVisibilityCheck, formatReport, saveReport };

if (require.main === module) {
  (async () => {
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
