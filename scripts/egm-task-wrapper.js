#!/usr/bin/env node
'use strict';

/**
 * egm-task-wrapper.js — UserPromptSubmit hook for Claude Code.
 *
 * Wraps every user prompt in the Elephant-Goldfish-Engineer (EGM) cycle:
 *   1. Elephant: deep-context analysis of the request (full repo + memory context)
 *   2. Goldfish: cold-read review (would a fresh agent understand the plan?)
 *   3. Engineer: phased execution with evidence-first verification
 *
 * When the user submits a prompt, this hook reads it from CLAUDE_PROMPT
 * (Claude Code passes the prompt via stdin in UserPromptSubmit hooks) and
 * outputs an EGM workflow directive that Claude Code prepends as context.
 *
 * Output format: JSON with hookSpecificOutput.additionalContext containing
 * the EGM phase guidance, which Claude Code appends to the next agent turn.
 *
 * Usage: wired into .claude/settings.json under UserPromptSubmit hooks.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOME = os.homedir();
const VAULT_ROOT = process.env.AI_AGENT_SYNC_VAULT || path.join(HOME, 'Documents', 'AI-Agent-Sync');
const REPO_ROOT = process.cwd();
const CONSTITUTION_PATH = path.join(VAULT_ROOT, 'AGENT_SELF_IMPROVEMENT_PROMPT.md');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}

function classifyTask(prompt) {
  const p = prompt.toLowerCase();
  if (p.includes('fix') || p.includes('bug') || p.includes('bugfix')) return 'bugfix';
  if (p.includes('implement') || p.includes('add') || p.includes('create') || p.includes('build')) return 'feature';
  if (p.includes('review') || p.includes('audit') || p.includes('check')) return 'review';
  if (p.includes('investigate') || p.includes('investigate') || p.includes('what') || p.includes('why') || p.includes('how')) return 'investigation';
  if (p.includes('improve') || p.includes('optimize') || p.includes('refactor')) return 'improvement';
  if (p.includes('deploy') || p.includes('release') || p.includes('merge')) return 'release';
  return 'general';
}

function getEgmGuidance(taskType, prompt) {
  const templates = {
    bugfix: `
## EGM Phase Guidance — Bugfix
**Elephant**: Load full repo context for the affected subsystem. Trace the root cause through logs, tests, and git history. Identify all related code paths.
**Goldfish**: Write a 1-sentence summary that a fresh engineer could use to reproduce and fix this without any context. If that fails, add more to the spec.
**Engineer**: Fix the root cause (not the symptom). Add a regression test. Verify with \`npm test\`. Do NOT commit yet — wait for evidence.
`,
    feature: `
## EGM Phase Guidance — Feature
**Elephant**: Draft a design doc under \`docs/designs/\` BEFORE writing code. Include: Problem, Technical Plan, Block Diagram, Success Criteria, Failure Modes, Budget, Rollout.
**Goldfish**: Strip the design doc of all implicit context. A fresh engineer should reconstruct intent in <30 seconds.
**Engineer**: Implement from the verified spec. Stage explicit paths only. Open PR with evidence.
`,
    review: `
## EGM Phase Guidance — Review
**Elephant**: Load all relevant context (PR diffs, CI output, test results, issue history).
**Goldfish**: List 3 things a fresh reviewer would miss. If fewer than 3, you haven't dug deep enough.
**Engineer**: Produce a structured review with evidence: file:line references, test results, CI status.
`,
    investigation: `
## EGM Phase Guidance — Investigation
**Elephant**: Gather all relevant context (logs, code, docs, past incidents). Form a hypothesis.
**Goldfish**: Can you prove or disprove the hypothesis with a concrete experiment? If not, keep digging.
**Engineer**: Run the experiment. Report findings with evidence (file paths, command output, data).
`,
    improvement: `
## EGM Phase Guidance — Improvement
**Elephant**: Identify the specific bottleneck (latency, cost, false-block rate, churn).
**Goldfish**: Would a 10x simpler solution achieve the same outcome? Prefer simplicity.
**Engineer**: Make the smallest useful change. Measure before/after.
`,
    release: `
## EGM Phase Guidance — Release
**Elephant**: Verify CI green on exact SHA. Check for open PRs, Dependabot updates, ruleset compliance.
**Goldfish**: If you had to hand this to a stranger, what critical detail would you forget to mention?
**Engineer**: Use \`npm run pr:manage\` and Trunk. Do NOT --admin or --force. Never bypass branch protection.
`,
    general: `
## EGM Phase Guidance — General
**Elephant**: Understand the full context before acting. Read relevant docs, code, and history.
**Goldfish**: Can you explain the problem and your plan in 3 sentences to someone who knows nothing?
**Engineer**: Act, verify with evidence, record outcomes.
`,
  };

  return templates[taskType] || templates.general;
}

function getPreventionNote() {
  const memoryDir = path.join(REPO_ROOT, '.claude', 'memory');
  if (!fs.existsSync(memoryDir)) return '';

  const recentFailures = [];
  const feedbackDir = path.join(VAULT_ROOT, '.claude', 'memory', 'feedback');
  if (fs.existsSync(feedbackDir)) {
    const files = fs.readdirSync(feedbackDir).slice(-5);
    for (const f of files) {
      try {
        const content = fs.readFileSync(path.join(feedbackDir, f), 'utf8');
        const data = JSON.parse(content);
        if (data.signal === 'down' && data.promoted) {
          recentFailures.push(`- ${data.context || data.whatWentWrong || 'unknown'}`);
        }
      } catch {}
    }
  }

  if (recentFailures.length === 0) return '';

  return `
## Recent Prevention Rules (from feedback)
The following lessons were promoted from thumbs-down feedback. Check each before proceeding:

${recentFailures.join('\n')}
`;
}

function getConstitutionCheck() {
  if (!fs.existsSync(CONSTITUTION_PATH)) return '';

  const content = fs.readFileSync(CONSTITUTION_PATH, 'utf8');
  const lines = content.split('\n');

  const enforcement = lines
    .filter((l) => l.startsWith('- [ ]') || l.startsWith('- [x]'))
    .map((l) => `  ${l}`)
    .join('\n');

  if (!enforcement) return '';

  return `
## ASIP Enforcement Checklist (from ${path.relative(REPO_ROOT, CONSTITUTION_PATH)})

Pre-action:
${enforcement}

If any pre-action check is red, adjust your plan before proceeding.
`;
}

async function main() {
  const prompt = await readStdin();

  if (!prompt || prompt.length < 10) {
    process.stdout.write(JSON.stringify({}));
    return;
  }

  const taskType = classifyTask(prompt);
  const guidance = getEgmGuidance(taskType, prompt);
  const prevention = getPreventionNote();
  const constitution = getConstitutionCheck();

  const additionalContext = `${guidance}${prevention}${constitution}`;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: additionalContext.trim(),
      },
    })
  );
}

main().catch((err) => {
  process.stderr.write(`egm-task-wrapper error: ${err.message}\n`);
  process.stdout.write(JSON.stringify({}));
});
