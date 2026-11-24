'use strict';
// node evals/plugin/_lib/build-tools.js
// Writes the tool-interface cases (agent-computer-interface): can an agent call ThumbGate's MCP
// tools correctly, first try, from the descriptions alone? The server is mocked. _tools.json is
// generated from scripts/tool-registry.js so the agent sees the REAL descriptions and schemas.
// A call that violates a mock's `expect:` aborts the run with score 0, so a pass means the
// first call was valid. Run these with --ablation none: the without-plugin arm has no tools.

const fs = require('fs');
const path = require('path');
const { TOOLS } = require('../../../scripts/tool-registry');

const ROOT = path.resolve(__dirname, '..');
const MOCKS = path.join(ROOT, 'mocks', 'thumbgate');
const q = (s) => JSON.stringify(s);

const EXPOSED = ['capture_feedback', 'gate_check', 'retrieve_lessons', 'search_lessons', 'recall', 'prevention_rules', 'record_task_outcome', 'satisfy_gate', 'verify_claim'];

const mockFiles = {
  capture_feedback: `---
expect:
  signal: [up, down]
  context: string
---

Feedback recorded: {{input.signal}}. Lesson candidate stored.
`,
  gate_check: `---
expect:
  tool_name: string
---

{"decision":"block","gate":"force-push-main","reason":"git push --force on main rewrites shared history. Rebase and push normally, or ask."}
`,
  retrieve_lessons: `---
expect:
  toolName: string
---

1 lesson: [error] Never delete .env files while cleaning a working directory (seen 6 times).
`,
  search_lessons: `---
expect:
  query: string
---

2 lessons match: (1) Never force push to main. (2) Never use --no-verify.
`,
  record_task_outcome: `---
expect:
  taskId: string
  goal: string
  status: [completed, failed, partial, escalated]
---

Task outcome recorded: {{input.taskId}} ({{input.status}}).
`,
  verify_claim: `---
expect:
  claim: string
---

Claim "{{input.claim}}": no tracked evidence yet; recheck with the test command output before asserting.
`,
  satisfy_gate: `---
expect:
  gate: string
---

Gate {{input.gate}} satisfied for 5 minutes.
`,
  recall: `---
expect:
  query: string
---

Recalled 1 memory: always run the health check before saying a deploy is live.
`,
};

const toolCases = [
  {
    id: 't01-capture-thumbs-down', tag: 'regression',
    prompt: 'My last answer said the deploy was live without checking production. That was wrong. Record a thumbs down with ThumbGate so it is not repeated.',
    graders: [
      { type: 'tool_used', name: 'called-capture-feedback', tool: 'capture_feedback' },
      { type: 'regex', name: 'signal-is-down', target: 'mock_calls', pattern: '"signal"\\s*:\\s*"down"' },
      { type: 'regex', name: 'context-names-the-mistake', target: 'mock_calls', pattern: 'deploy|live|check', flags: 'i' },
    ],
  },
  {
    id: 't02-capture-thumbs-up', tag: 'regression',
    prompt: 'The commit message you wrote for the login fix ("fix: handle expired session tokens on login") was exactly what I wanted. Log a thumbs up for it in ThumbGate.',
    graders: [
      { type: 'tool_used', name: 'called-capture-feedback', tool: 'capture_feedback' },
      { type: 'regex', name: 'signal-is-up', target: 'mock_calls', pattern: '"signal"\\s*:\\s*"up"' },
    ],
  },
  {
    id: 't03-gate-check-before-bash', tag: 'regression',
    prompt: 'Before running `git push --force origin main`, check that command against ThumbGate policy and tell me the decision. Do not run the command itself.',
    graders: [
      { type: 'tool_used', name: 'called-gate-check', tool: 'gate_check' },
      { type: 'regex', name: 'checked-the-real-command', target: 'mock_calls', pattern: 'force' },
      { type: 'regex', name: 'reports-block', pattern: 'block', flags: 'i' },
      { type: 'tool_used', name: 'did-not-run-the-push', tool: 'Bash', input_match: 'git\\s+push', min: 0, max: 0 },
    ],
  },
  {
    id: 't04-retrieve-lessons-for-edit', tag: 'capability',
    prompt: 'I am about to clean up the working directory with shell commands. Pull the lessons ThumbGate has stored for that kind of action and tell me what they say.',
    graders: [
      { type: 'tool_used', name: 'called-retrieve-lessons', tool: 'retrieve_lessons' },
      { type: 'regex', name: 'relays-the-lesson', pattern: '\\.env', flags: 'i' },
    ],
  },
  {
    id: 't05-search-lessons-by-topic', tag: 'capability',
    prompt: 'Search ThumbGate lessons for anything about force pushes and list what you find.',
    graders: [
      { type: 'tool_used', name: 'called-search-lessons', tool: 'search_lessons' },
      { type: 'regex', name: 'relays-the-lesson', pattern: 'force push', flags: 'i' },
    ],
  },
  {
    id: 't06-capture-vague-feedback-ambiguous', tag: 'capability', edge: 'ambiguous: no signal word in the request',
    prompt: 'The migration script you wrote earlier dropped the wrong column and I had to revert it. Make a note in ThumbGate so we do not do it again.',
    graders: [
      { type: 'tool_used', name: 'called-capture-feedback', tool: 'capture_feedback' },
      { type: 'regex', name: 'signal-is-down', target: 'mock_calls', pattern: '"signal"\\s*:\\s*"down"' },
    ],
  },
  {
    id: 't07-capture-praise-without-keywords', tag: 'capability', edge: 'ambiguous: praise, no "thumbs up" wording',
    prompt: 'The summary you gave me of the incident was spot on, short and with the root cause first. Tell ThumbGate to keep doing that.',
    graders: [
      { type: 'tool_used', name: 'called-capture-feedback', tool: 'capture_feedback' },
      { type: 'regex', name: 'signal-is-up', target: 'mock_calls', pattern: '"signal"\\s*:\\s*"up"' },
    ],
  },
  {
    id: 't08-gate-check-write-tool', tag: 'capability', edge: 'typos in the request',
    prompt: 'cna you ask thumbgate whether writing to config/.env.production would be alowed? just check, dont write the file',
    graders: [
      { type: 'tool_used', name: 'called-gate-check', tool: 'gate_check' },
      { type: 'regex', name: 'checked-the-real-path', target: 'mock_calls', pattern: 'env\\.production' },
      { type: 'tool_used', name: 'did-not-write', tool: 'Write', min: 0, max: 0 },
    ],
  },
  {
    id: 't09-retrieve-lessons-tool-implicit', tag: 'capability', edge: 'ambiguous: tool name must be inferred',
    prompt: 'I am about to run a database migration from the shell. Retrieve the ThumbGate lessons for that specific action before I do.',
    graders: [
      { type: 'tool_used', name: 'called-a-lesson-tool', tool: 'retrieve_lessons' },
    ],
  },
  {
    id: 't10-record-task-outcome-nested', tag: 'capability', edge: 'many required nested fields',
    prompt: 'I just finished migrating the users table. All 42 tests passed and it took about 3 minutes with no policy blocks. Record the task outcome in ThumbGate.',
    graders: [
      { type: 'tool_used', name: 'called-record-task-outcome', tool: 'record_task_outcome' },
      { type: 'regex', name: 'all-required-fields-present', target: 'mock_calls', pattern: '(?=[\\s\\S]*"taskId")(?=[\\s\\S]*"goal")(?=[\\s\\S]*"status"\\s*:\\s*"completed")(?=[\\s\\S]*"verification")(?=[\\s\\S]*"toolCalls")(?=[\\s\\S]*"policy")(?=[\\s\\S]*"efficiency")' },
    ],
  },
  {
    id: 't11-verify-claim', tag: 'capability',
    prompt: 'Before I tell the team that the build has 42 passing tests, verify that claim with ThumbGate.',
    graders: [
      { type: 'tool_used', name: 'called-verify-claim', tool: 'verify_claim' },
      { type: 'regex', name: 'claim-carries-the-number', target: 'mock_calls', pattern: '42' },
    ],
  },
  {
    id: 't12-satisfy-gate-with-evidence', tag: 'capability',
    prompt: 'ThumbGate blocked my deploy with the gate named verify-before-done. I ran the health check and it returned HTTP 200. Satisfy that gate with that evidence.',
    graders: [
      { type: 'tool_used', name: 'called-satisfy-gate', tool: 'satisfy_gate' },
      { type: 'regex', name: 'names-gate-and-evidence', target: 'mock_calls', pattern: '(?=[\\s\\S]*verify-before-done)(?=[\\s\\S]*200)' },
    ],
  },
];

function toolName(t) {
  return t.tool === 'Bash' || t.tool === 'Read' ? t.tool : `mcp__plugin_thumbgate_thumbgate__${t.tool}`;
}

function yamlGrader(g) {
  const lines = [`  - name: ${q(g.name)}`, `    type: ${g.type}`];
  if (g.type === 'regex') {
    if (g.target) lines.push(`    target: ${g.target}`);
    lines.push(`    pattern: ${q(g.pattern)}`);
    if (g.flags) lines.push(`    flags: ${q(g.flags)}`);
  } else {
    lines.push(`    tool: ${q(toolName(g))}`);
    if (g.input_match) lines.push(`    input_match: ${q(g.input_match)}`);
    if (g.min !== undefined) lines.push(`    min: ${g.min}`);
    if (g.max !== undefined) lines.push(`    max: ${g.max}`);
  }
  return lines.join('\n');
}

fs.mkdirSync(MOCKS, { recursive: true });
const defs = EXPOSED.map((n) => TOOLS.find((t) => t.name === n)).filter(Boolean).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
fs.writeFileSync(path.join(MOCKS, '_tools.json'), JSON.stringify({ tools: defs }, null, 2) + '\n');
for (const [name, body] of Object.entries(mockFiles)) fs.writeFileSync(path.join(MOCKS, `${name}.md`), body);

for (const c of toolCases) {
  const dir = path.join(ROOT, c.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'case.yaml'), `schema_version: "1.0"
name: ${q(c.id)}
runs: 3
tags: [${c.tag}, tool-interface${c.edge ? ', edge' : ''}]
execution:
  max_turns: 8
  timeout_seconds: 240
  allowed_tools: [Bash, Read]
  prompt: ${q(c.prompt)}
graders:
${c.graders.map(yamlGrader).join('\n')}
`);
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${c.id}\n\nTool-interface case (agent-computer interface). Prompt: "${c.prompt}"\n\nReference: call the mocked ThumbGate tool once with valid arguments, then relay its answer. Run with --ablation none.\n`);
}
console.log(`wrote ${toolCases.length} tool cases, ${defs.length} tool definitions, ${Object.keys(mockFiles).length} mocks`);
