'use strict';

const { afterEach, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildMcpConfig,
  dedupeLeads,
  formatLeadsMarkdown,
  parseArgs,
  runCommand,
  scoreLead,
} = require('../scripts/perplexity-command-center');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perplexity-command-center-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('parseArgs supports command-center flags', () => {
  const opts = parseArgs(['leads', '--dry-run', '--json', '--out-dir=/tmp/out', '--limit=7']);
  assert.equal(opts.command, 'leads');
  assert.equal(opts.dryRun, true);
  assert.equal(opts.json, true);
  assert.equal(opts.outDir, '/tmp/out');
  assert.equal(opts.leadLimit, 7);
});

test('dry-run full command writes safe manual artifacts without an API key', async () => {
  const run = await runCommand('full', {
    dryRun: true,
    outDir: tmpDir,
    now: new Date('2026-04-13T12:00:00.000Z'),
    client: { hasApiKey: () => false },
  });

  assert.equal(run.summary.visibilityScore, 'manual');
  assert.equal(run.summary.leadCount, 0);
  assert.equal(run.summary.briefMode, 'manual');
  assert.ok(fs.existsSync(path.join(tmpDir, 'summary.json')));
  assert.ok(fs.existsSync(path.join(tmpDir, 'visibility.json')));
  assert.ok(fs.existsSync(path.join(tmpDir, 'leads.json')));
  assert.ok(fs.existsSync(path.join(tmpDir, 'agent-brief.md')));
  assert.ok(fs.existsSync(path.join(tmpDir, 'perplexity-mcp-config.json')));
});

test('full command uses mocked Perplexity APIs for visibility, leads, and agent brief', async () => {
  const calls = { chat: 0, search: 0, agent: 0 };
  const client = {
    hasApiKey: () => true,
    chatCompletion: async ({ messages }) => {
      calls.chat += 1;
      const prompt = messages[0].content;
      const content = /alternatives to thumbgate/i.test(prompt)
        ? 'LangSmith and custom scripts are common options.'
        : 'ThumbGate is a pre-action gate for AI coding agent reliability.';
      return { choices: [{ message: { content } }], citations: ['https://example.com/thumbgate'] };
    },
    search: async () => {
      calls.search += 1;
      return {
        results: [
          {
            title: 'Claude Code agent repeats mistake in production workflow',
            url: 'https://news.ycombinator.com/item?id=1&utm_source=x',
            snippet: 'Teams need MCP guardrails to block bad tool calls.',
            date: '2026-04-12',
          },
          {
            title: 'Duplicate with tracking',
            url: 'https://news.ycombinator.com/item?id=1&utm_medium=social',
            snippet: 'Same target URL.',
          },
        ],
      };
    },
    agentResponse: async () => {
      calls.agent += 1;
      return { output_text: '# Brief\n\nHighest ROI: contact the top scored lead.' };
    },
  };

  const run = await runCommand('full', {
    outDir: tmpDir,
    now: new Date('2026-04-13T12:00:00.000Z'),
    client,
    leadLimit: 5,
  });

  assert.equal(calls.chat, run.visibility.prompts);
  assert.equal(calls.search, 5);
  assert.equal(calls.agent, 1);
  assert.match(run.summary.visibilityScore, /^\d+\/\d+$/);
  assert.equal(run.leads.leadCount, 1);
  assert.ok(run.leads.leads[0].score >= 10);
  assert.equal(run.summary.briefMode, 'live');
  assert.ok(fs.readFileSync(path.join(tmpDir, 'agent-brief.md'), 'utf8').includes('Highest ROI'));
  assert.ok(fs.readFileSync(path.join(tmpDir, 'memory-lessons.jsonl'), 'utf8').includes('perplexity'));
});

test('dedupeLeads canonicalizes tracking variants', () => {
  const leads = dedupeLeads([
    { title: 'A', url: 'https://example.com/thread?utm=1#top', queryLabel: 'one' },
    { title: 'B', url: 'https://example.com/thread', queryLabel: 'two' },
  ]);
  assert.equal(leads.length, 1);
  assert.deepEqual(leads[0].queryLabels, ['one', 'two']);
  assert.equal(leads[0].url, 'https://example.com/thread');
});

test('scoreLead rewards ThumbGate buyer-intent signals', () => {
  const scored = scoreLead({
    title: 'AI coding agent repeats mistakes in Claude Code team workflow',
    url: 'https://github.com/example/issue',
    snippet: 'Need MCP guardrails to prevent bad tool calls in production.',
  });
  assert.ok(scored.score >= 12);
  assert.ok(scored.reasons.includes('clear pain signal'));
  assert.match(scored.outreachAngle, /repeated-agent-mistake/);
});

test('lead markdown escapes backslashes, table pipes, and link brackets', () => {
  const markdown = formatLeadsMarkdown({
    date: '2026-04-13',
    mode: 'live',
    leadCount: 1,
    leads: [{
      score: 12,
      title: 'bad \\ title [x]',
      url: 'https://example.com/thread',
      reasons: ['pipe | backslash \\ newline\nx'],
      outreachAngle: 'angle | \\',
    }],
  });

  assert.match(markdown, /\[bad \\\\ title \\\[x\\\]\]\(https:\/\/example\.com\/thread\)/);
  assert.match(markdown, /pipe \\\| backslash \\\\ newline x/);
  assert.match(markdown, /angle \\\| \\\\/);
});

test('buildMcpConfig returns official Perplexity MCP install commands', () => {
  const config = buildMcpConfig();
  assert.equal(config.source, 'https://github.com/perplexityai/modelcontextprotocol');
  assert.match(config.claudeCode, /@perplexity-ai\/mcp-server/);
  assert.match(config.codex, /codex mcp add perplexity/);
  assert.equal(config.mcpServers.perplexity.command, 'npx');
  assert.deepEqual(config.mcpServers.perplexity.args, ['-y', '@perplexity-ai/mcp-server']);
  assert.equal(config.mcpServers.perplexity.env.PERPLEXITY_API_KEY, '${PERPLEXITY_API_KEY}');
});

test('Perplexity command-center workflow is scheduled, secret-backed, and artifact-only', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', 'perplexity-command-center.yml'),
    'utf8'
  );

  assert.match(workflow, /cron: '30 12 \* \* \*'/);
  assert.match(workflow, /PERPLEXITY_API_KEY:\s*\$\{\{\s*secrets\.PERPLEXITY_API_KEY\s*\}\}/);
  assert.match(workflow, /node scripts\/perplexity-command-center\.js "\$COMMAND"/);
  assert.match(workflow, /--allow-chat-fallback/);
  assert.match(workflow, /actions\/upload-artifact@v7/);
  assert.doesNotMatch(workflow, /git commit|git push/);
});
