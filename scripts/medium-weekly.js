#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createSchedule } = require('./schedule-manager');
const { ensureDir } = require('./fs-utils');

const REPO_ROOT = path.resolve(__dirname, '..');
const MEDIUM_DIR = path.join(REPO_ROOT, 'docs', 'marketing', 'medium');
const CONVERSATIONAL_AI_WEEKLY_URL = 'https://medium.com/conversational-ai-weekly';

const ARTICLE_TOPICS = Object.freeze([
  {
    slug: 'pre-action-gates-for-tool-using-ai-agents',
    title: 'Pre-Action Gates for Tool-Using AI Agents',
    subtitle: 'Observability tells you what happened. Enforcement decides what is allowed to happen next.',
    angle: 'educational',
    buyerIntent: 'agent observability, policy checks, safe action execution',
    tags: ['ai-agents', 'llmops', 'agent-safety', 'developer-tools', 'automation'],
  },
  {
    slug: 'from-passive-observability-to-active-enforcement',
    title: 'From Passive Observability to Active Enforcement for AI Agents',
    subtitle: 'Dashboards show that something broke. Pre-action gates stop the repeated break before the next tool call runs.',
    angle: 'active-observability',
    buyerIntent: 'agentic observability, real-time reasoning, active monitoring, reliability engineering',
    tags: ['observability', 'ai-agents', 'reliability', 'llmops', 'automation'],
  },
  {
    slug: 'deterministic-policy-not-llm-as-policy',
    title: 'Do Not Put an LLM in the Final Policy Seat',
    subtitle: 'Use models to propose rules, then enforce inspectable policy over tool names, arguments, paths, and command shape.',
    angle: 'technical',
    buyerIntent: 'deterministic policy, approval gates, guardrail reliability',
    tags: ['ai-agents', 'guardrails', 'llmops', 'security', 'mcp'],
  },
  {
    slug: 'team-gates-without-brittle-shared-rules',
    title: 'How Teams Should Share AI Agent Gates Without Making Them Brittle',
    subtitle: 'Personal failures should stay local until the pattern is generalized, reviewed, and promoted.',
    angle: 'platform-team',
    buyerIntent: 'team rollout, shared lessons, promotion workflow',
    tags: ['platform-engineering', 'ai-agents', 'developer-tools', 'governance', 'automation'],
  },
  {
    slug: 'safe-agent-execution-for-ai-automation-agencies',
    title: 'The Missing Execution Layer in AI Automation Agency Work',
    subtitle: 'Custom agent teams need a reusable enforcement layer underneath client-specific orchestration.',
    angle: 'agency-partner',
    buyerIntent: 'custom AI agents, automation agency, production hardening',
    tags: ['ai-agents', 'automation', 'llmops', 'consulting', 'agent-safety'],
  },
]);

function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function topicForDate(date = new Date()) {
  const start = Date.UTC(2026, 4, 4);
  const now = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const week = Math.max(0, Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000)));
  return ARTICLE_TOPICS[week % ARTICLE_TOPICS.length];
}

function buildTrackedUrl(pathname, topic) {
  const url = new URL(pathname, 'https://thumbgate-production.up.railway.app');
  url.searchParams.set('utm_source', 'medium');
  url.searchParams.set('utm_medium', 'organic_article');
  url.searchParams.set('utm_campaign', 'medium_weekly');
  url.searchParams.set('utm_content', topic.slug);
  url.searchParams.set('cta_id', 'medium_weekly_article');
  return url.toString();
}

function buildArticleBody(topic, date = new Date()) {
  const numbersUrl = buildTrackedUrl('/numbers', topic);
  const sprintUrl = buildTrackedUrl('/#workflow-sprint-intake', topic);
  const compareUrl = buildTrackedUrl('/compare/agentix-labs', topic);
  const guideUrl = buildTrackedUrl('/guides/pre-action-checks', topic);

  return [
    `# ${topic.title}`,
    '',
    `_${topic.subtitle}_`,
    '',
    `Published draft date: ${isoDate(date)}`,
    '',
    'Most production AI-agent discussions stop at observability. Traces are useful, but traces only explain the incident after the agent has already run the tool call.',
    '',
    'The same shift happening in data-stream systems applies to AI agents: passive dashboards are giving way to active agents that perceive a window, reason over limits, and act. ThumbGate applies that idea to execution safety: passive observability becomes active enforcement.',
    '',
    'The higher-leverage question is: what should be allowed to execute before the tool call leaves the agent?',
    '',
    'That is the role of a pre-action gate.',
    '',
    '## The failure mode',
    '',
    'Tool-using agents do not fail like normal chatbots. They fail by doing work: running shell commands, editing files, calling APIs, writing records, sending messages, or publishing changes.',
    '',
    'When a team says an agent is unreliable, the real complaint is usually one of these:',
    '',
    '- It repeated the same bad action after being corrected.',
    '- It ignored a rule that lived in a prompt or context file.',
    '- It made a tool call that should have required evidence first.',
    '- It escalated from a small edit into a risky workflow without a checkpoint.',
    '- It created a plausible answer while the underlying action failed.',
    '',
    'Logging those failures is necessary. Blocking the repeated action is what changes the operating model.',
    '',
    '## The enforcement pattern',
    '',
    'A pre-action gate sits before execution and evaluates the next tool call. The enforced layer should be deterministic: inspect the tool name, arguments, working directory, normalized command shape, and required evidence.',
    '',
    'A model can help propose a rule from feedback, but the runtime allow/deny decision should be inspectable policy. Do not put an LLM in the final policy seat for high-impact actions.',
    '',
    '## Where ThumbGate fits',
    '',
    'ThumbGate is the enforcement layer for coding-agent workflows. It turns thumbs-up/down feedback into history-aware lessons and pre-action checks across Claude Code, Cursor, Codex, Gemini CLI, Amp, Cline, OpenCode, and MCP-compatible agents.',
    '',
    'It is not trying to replace broad orchestration platforms or AI automation agencies. Those systems decide what should happen next. ThumbGate decides what is allowed to execute.',
    '',
    `The comparison with AI automation agencies is here: ${compareUrl}`,
    '',
    '## Weekly operating loop',
    '',
    '- Pick one repeated failure in one repo.',
    '- Add a pre-action gate for that failure.',
    '- Run the workflow again and capture proof.',
    '- Promote only generalized rules to the team.',
    '- Keep weird local rules personal until they prove reusable.',
    '',
    'That loop is more valuable than a giant policy document nobody enforces.',
    '',
    '## CTA',
    '',
    `If you want the self-serve path, start with the pre-action checks guide: ${guideUrl}`,
    '',
    `If you have one AI-agent workflow that needs hardening, use the Workflow Hardening Sprint intake: ${sprintUrl}`,
    '',
    `For proof-backed numbers and current evidence, use: ${numbersUrl}`,
  ].join('\n');
}

function buildMediumDraft({ date = new Date(), topic = topicForDate(date) } = {}) {
  return {
    platform: 'medium',
    status: 'draft_ready_manual_publish_required',
    publicationUrl: CONVERSATIONAL_AI_WEEKLY_URL,
    date: isoDate(date),
    title: topic.title,
    subtitle: topic.subtitle,
    slug: topic.slug,
    angle: topic.angle,
    buyerIntent: topic.buyerIntent,
    tags: topic.tags,
    body: buildArticleBody(topic, date),
    publishChecklist: [
      'Open Medium Write from the signed-in browser session.',
      'Paste the title, subtitle, body, and tags.',
      'Review links and claims against COMMERCIAL_TRUTH.md and VERIFICATION_EVIDENCE.md.',
      'Submit to Conversational AI Weekly only if the publication accepts outside submissions; otherwise publish under the founder profile.',
      'After publish, record the URL in docs/marketing/medium/published.csv.',
    ],
  };
}

function buildEngagementQueue({ date = new Date(), topic = topicForDate(date) } = {}) {
  const sprintUrl = buildTrackedUrl('/#workflow-sprint-intake', topic);
  return [
    {
      channel: 'medium_comment',
      target: CONVERSATIONAL_AI_WEEKLY_URL,
      priority: 'high',
      reason: 'Audience already discusses production AI agents and linked into the Reddit thread.',
      prompt: 'Reply to one relevant article with a technical point about deterministic pre-action gates, not a generic pitch.',
      draft: 'Useful breakdown. The piece I keep coming back to in production agent work is the split between observability and enforcement: traces explain what happened, but pre-action gates decide what is allowed to execute before the tool call runs.',
    },
    {
      channel: 'medium_response_article',
      target: CONVERSATIONAL_AI_WEEKLY_URL,
      priority: 'high',
      reason: 'A response article can convert their audience without interruptive outreach.',
      prompt: 'Turn the weekly draft into a Medium response if a current article discusses agent operations, observability, safety, or business automation.',
      draft: `If the audience has one tool-using workflow that keeps repeating the same failure, the fastest diagnostic is one workflow hardening sprint: ${sprintUrl}`,
    },
  ];
}

function renderDraftMarkdown(draft) {
  return [
    '---',
    `platform: ${draft.platform}`,
    `status: ${draft.status}`,
    `publication_url: ${draft.publicationUrl}`,
    `date: ${draft.date}`,
    `title: ${JSON.stringify(draft.title)}`,
    `subtitle: ${JSON.stringify(draft.subtitle)}`,
    `slug: ${draft.slug}`,
    `angle: ${draft.angle}`,
    `buyer_intent: ${JSON.stringify(draft.buyerIntent)}`,
    `tags: ${draft.tags.join(', ')}`,
    '---',
    '',
    draft.body,
    '',
    '## Manual publish checklist',
    '',
    ...draft.publishChecklist.map((item) => `- ${item}`),
    '',
  ].join('\n');
}

function renderQueueCsv(rows) {
  const headers = ['channel', 'target', 'priority', 'reason', 'prompt', 'draft'];
  const esc = (value) => `"${String(value || '').replaceAll('"', '""')}"`;
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => esc(row[header])).join(',')),
  ].join('\n');
}

function writeMediumWeeklyDraft({ date = new Date(), outDir = MEDIUM_DIR } = {}) {
  ensureDir(outDir);
  const topic = topicForDate(date);
  const draft = buildMediumDraft({ date, topic });
  const draftPath = path.join(outDir, `${draft.date}-${draft.slug}.md`);
  const queuePath = path.join(outDir, `${draft.date}-engagement-queue.csv`);
  fs.writeFileSync(draftPath, renderDraftMarkdown(draft), 'utf8');
  fs.writeFileSync(queuePath, `${renderQueueCsv(buildEngagementQueue({ date, topic }))}\n`, 'utf8');
  return { draftPath, queuePath, draft };
}

function createMediumWeeklySchedule({ day = 'monday', time = '09:30' } = {}) {
  const command = [
    `const medium = require(${JSON.stringify(__filename)});`,
    'const result = medium.writeMediumWeeklyDraft();',
    String.raw`process.stdout.write(JSON.stringify({ draftPath: result.draftPath, queuePath: result.queuePath }, null, 2) + "\n");`,
  ].join(' ');

  return createSchedule({
    id: 'thumbgate-medium-weekly-draft',
    name: 'ThumbGate Medium Weekly Draft',
    description: `Generate one Medium article draft and engagement queue every ${day} at ${time}`,
    schedule: `weekly ${day} ${time}`,
    command,
    workingDirectory: REPO_ROOT,
  });
}

function runCli(argv = process.argv.slice(2), {
  writeMediumWeeklyDraft: writeDraft = writeMediumWeeklyDraft,
  createMediumWeeklySchedule: createScheduleFn = createMediumWeeklySchedule,
} = {}) {
  if (argv.includes('--schedule')) {
    const result = createScheduleFn();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  const result = writeDraft();
  process.stdout.write(`${JSON.stringify({ draftPath: result.draftPath, queuePath: result.queuePath }, null, 2)}\n`);
  return result;
}

function isCliInvocation(argv = process.argv) {
  const invokedPath = argv[1];
  return invokedPath ? path.resolve(invokedPath) === __filename : false;
}

if (isCliInvocation()) {
  runCli();
}

module.exports = {
  ARTICLE_TOPICS,
  CONVERSATIONAL_AI_WEEKLY_URL,
  MEDIUM_DIR,
  buildArticleBody,
  buildEngagementQueue,
  buildMediumDraft,
  buildTrackedUrl,
  createMediumWeeklySchedule,
  isCliInvocation,
  renderDraftMarkdown,
  renderQueueCsv,
  runCli,
  topicForDate,
  writeMediumWeeklyDraft,
};
