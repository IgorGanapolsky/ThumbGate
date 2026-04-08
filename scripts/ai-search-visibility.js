'use strict';

const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const PROMPTS = [
  'best pre-action gate tools for AI coding agents',
  'how to prevent AI coding agent from making mistakes',
  'Claude Code safety tools',
  'npm packages for AI agent guardrails',
  'how to block bad tool calls in AI agents',
  'alternatives to thumbgate',
  'pre-tool-use hooks for AI agents',
  'AI coding agent memory and learning',
];

function queryPerplexity(prompt, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'sonar',
      messages: [{ role: 'user', content: prompt }],
    });
    const req = https.request(
      {
        hostname: 'api.perplexity.ai',
        path: '/chat/completions',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString());
            const content = json.choices?.[0]?.message?.content || '';
            resolve(content);
          } catch (e) {
            reject(new Error(`Failed to parse Perplexity response: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function runVisibilityCheck(opts = {}) {
  const apiKey = opts.apiKey || process.env.PERPLEXITY_API_KEY;
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
    results: results.map((r) => ({
      prompt: r.prompt,
      status: r.status,
      ...(r.error ? { error: r.error } : {}),
    })),
  };

  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
  return filePath;
}

module.exports = { PROMPTS, queryPerplexity, runVisibilityCheck, formatReport, saveReport };

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
