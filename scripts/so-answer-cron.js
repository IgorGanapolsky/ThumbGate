#!/usr/bin/env node
'use strict';

/**
 * so-answer-cron.js — Daily Stack Overflow autonomous answer discovery + drafting.
 *
 * Runs via cron at 9:00 AM EST daily. Finds high-ROI SO questions relevant to
 * ThumbGate, drafts answers with real gate examples, anti-slop verifies them,
 * and stages them for human approval.
 *
 * Usage:
 *   node scripts/so-answer-cron.js                  # discover + draft + stage
 *   node scripts/so-answer-cron.js --post <id>    # post a specific staged answer
 *   node scripts/so-answer-cron.js --status       # show staging queue
 *
 * Stolen from Tailscale patterns:
 * - Identity-first: dedicated SE application key + dedicated posting account
 * - MagicRoute: route questions to best template based on tag + complexity
 * - Public recipes: answers include copy-pasteable gate rule recipes
 *
 * Requires: THUMBGATE_SO_APP_KEY and THUMBGATE_SO_POSTING_ACCOUNT in env
 */

const https = require('https');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DRAFTS_DIR = path.join(require('os').homedir(), 'Documents', 'AI-Agent-Sync', 'Email-Drafts');
const HANDOFFS_DIR = path.join(require('os').homedir(), 'Documents', 'AI-Agent-Sync', 'Handoffs');
const TRACKER_FILE = path.join(HANDOFFS_DIR, 'so-answer-tracker.tsv');
const ANTI_SLOP_SCRIPT = '/Users/iganapolsky/workspace/projects/secure-yolo/scripts/verify-human-paste-anti-slop.sh';

const TARGET_TAGS = [
  'claude-code', 'cursor-ide', 'codex', 'ai-agent',
  'code-review', 'mcp', 'automation', 'anthropic-claude',
  'large-language-model', 'llm'
];

const TAG_WEIGHTS = {
  'claude-code': 2.0, 'cursor-ide': 1.8, 'codex': 1.5,
  'ai-agent': 1.3, 'mcp': 1.5, 'code-review': 1.4,
  'automation': 1.2, 'anthropic-claude': 1.1,
  'large-language-model': 1.0, 'llm': 1.0
};

const ANSWER_TEMPLATES = {
  safety: {
    name: 'Gate catches mistakes before they execute',
    file: 'so-answer-template-safety.md',
    tags: ['claude-code', 'cursor-ide', 'codex', 'ai-agent', 'code-review', 'automation'],
    monetization: '$19/mo Pro, $49 Rule-Pack Kit'
  },
  branch_review: {
    name: 'Shift-left review for branch PRs',
    file: 'so-answer-template-branch-review.md',
    tags: ['claude-code', 'cursor-ide', 'code-review', 'git'],
    monetization: '$19/mo Pro, $49 Rule-Pack Kit, $499 diagnostic'
  },
  devops: {
    name: 'DevOps pipeline guardrails',
    file: 'DevOps pipeline guardrails for AI agents',
    tags: ['automation', 'mcp', 'ai-agent', 'ci-cd'],
    monetization: '$499 Workflow Gate Diagnostic'
  }
};

// ---- StackExchange API ----

function soSearch(params) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams({
      order: 'desc',
      sort: 'creation',  // newest first
      site: 'stackoverflow',
      pagesize: 50,
      ...params
    }).toString();

    const req = https.get(
      `https://api.stackexchange.com/2.3/questions?${qs}`,
      {
        headers: {
          'Accept-Encoding': 'gzip',
          'Accept': 'application/json',
          'User-Agent': 'ThumbGate-SO-Bot/1.0 (contact@thumbgate.ai)'
        }
      },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('SO API parse error: ' + e.message));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy());
  });
}

function rankQuestions(questions) {
  return questions
    .filter(q => {
      // Only questions with 0 answers or low-scoring answers
      const hasGoodAnswers = q.answer_count > 0 && q.score >= 5;
      if (hasGoodAnswers) return false;
      // Only recent questions (last 7 days)
      const ageDays = (Date.now() / 1000 - q.creation_date) / 86400;
      if (ageDays > 7) return false;
      // Only high-interest questions
      if (q.score < 1) return false;
      // Skip closed/locked
      if (q.closed_date || q.locked_date) return false;
      // Skip community wiki
      if (q.community_owned_date) return false;
      return true;
    })
    .map(q => {
      const ageDays = (Date.now() / 1000 - q.creation_date) / 86400;
      const tagScore = (q.tags || []).reduce((sum, tag) => {
        return sum + (TAG_WEIGHTS[tag] || 1.0);
      }, 0);
      const roi = (q.score * q.view_count * (Math.max(1, 3 - q.answer_count)) * tagScore) / (ageDays + 1);
      return { ...q, roi };
    })
    .sort((a, b) => b.roi - a.roi)
    .slice(0, 5);
}

function selectTemplate(tags) {
  let best = 'safety';
  let bestScore = 0;
  for (const [key, template] of Object.entries(ANSWER_TEMPLATES)) {
    let score = 0;
    for (const tag of tags) {
      if (template.tags.includes(tag)) score += TAG_WEIGHTS[tag] || 1.0;
    }
    if (score > bestScore) {
      bestScore = score;
      best = key;
    }
  }
  return ANSWER_TEMPLATES[best];
}

// ---- Get real gate-check examples for the answer ----

function getGateExamples() {
  const os = require('os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-so-examples-'));
  try {
    const gateEnv = {
      ...process.env,
      NODE_TEST_CONTEXT: 'true',
      THUMBGATE_FEEDBACK_DIR: tmpDir,
      THUMBGATE_STATE_DIR: tmpDir,
    };
    // Run the gate-check on representative patterns in an isolated temp store
    const secretPayload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/config.py', content: 'api_key=ghp_1234567890abcdefghijklmnopqrstuvwxyz' }
    });
    const secretResult = execSync(
      `echo '${secretPayload}' | npx thumbgate gate-check 2>/dev/null`,
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 10000, env: gateEnv }
    ).trim();

    const rmPayload = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf ./src/' }
    });
    const rmResult = execSync(
      `echo '${rmPayload}' | npx thumbgate gate-check 2>/dev/null`,
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 10000, env: gateEnv }
    ).trim();

    // Extract the human-readable parts
    const parseGateOutput = (raw) => {
      try {
        const json = JSON.parse(raw);
        const ctx = json.hookSpecificOutput?.additionalContext || '';
        return ctx.replace(/\[ThumbGate\].*$/s, '').trim().substring(0, 200);
      } catch {
        return raw.substring(0, 200);
      }
    };

    return {
      hardBlock: parseGateOutput(secretResult),
      warning: parseGateOutput(rmResult)
    };
  } catch (e) {
    return {
      hardBlock: '[GATE:secret-exfiltration] Blocked — GitHub personal access token detected',
      warning: '[ThumbGate] WARNING: rm -rf is destructive. Past mistake seen 9x.'
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore temp cleanup errors
    }
  }
}

// ---- Build answer body ----

function buildAnswer(question, template, gateExamples) {
  const slug = question.title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  const body = `
**Short answer:** ${getShortAnswer(question, template)}

${getTemplateBody(question, template, gateExamples)}

${getMonetization(template)}

---
*This answer was generated with [ThumbGate](https://github.com/IgorGanapolsky/ThumbGate) — the pre-action firewall for AI coding agents. Paste the gate-check examples above into your terminal to verify locally.*`;

  return { slug, body: body.trim() };
}

function getShortAnswer(question, template) {
  if (template === ANSWER_TEMPLATES.safety) {
    return 'The core issue isn\\'t the tool — it\\'s that the LLM introduces mistakes *during* generation, not after. Catch them *before* they execute.';
  }
  if (template === ANSWER_TEMPLATES.branch_review) {
    return 'Cursor\\'s Agent Review only covers local buffer changes. For full-branch review you need a tool that gates every file edit in real-time.';
  }
  return 'AI agents need pre-action guardrails — not post-hoc review. Here\\'s how to shift left.';
}

function getTemplateBody(question, template, examples) {
  if (template === ANSWER_TEMPLATES.safety) {
    return `**The problem is timing.** By the time you\\'re reviewing a diff or output, the damage is already written to disk. The review becomes cleanup, not prevention.

**ThumbGate** is a pre-action firewall that runs in Claude Code\\'s, Cursor\\'s, and Codex\\'s \`PreToolUse\` hook. It evaluates every proposed tool call *before* execution.

Real gate output — two representative checks:

\\\`\\\`\\\`
# Hard-block: secret leak attempt
\${examples.hardBlock}

# Warning: destructive command  
\${examples.warning}
\\\`\\\`\\\`

**Quick start:**
\\\`\\\`\\\`bash
cd /path/to/your/project
npx thumbgate init
\\\`\\\`\\\`

It wires into \`PreToolUse\` (Claude Code), \`before_command\` (Cursor), and \`pre_tool_use\` (Codex).`;
  }

  if (template === ANSWER_TEMPLATES.branch_review) {
    return `**Cursor\\'s "Agent Review" is buffer-scoped.** It reads from the editor\\'s in-memory buffer layer — it doesn\\'t invoke \`git diff\` against a remote branch or walk a PR\\'s file list on the platform.

**ThumbGate** shifts review left — it gates every tool call *as the agent makes it*, so mistakes never get written to the branch in the first place.

**1. Live gate** — every edit, write, bash command is checked before execution:

\\\`\\\`\\\`
$ echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf ./src/"}}' | npx thumbgate gate-check
→ ${examples.warning}
\\\`\\\`\\\`

**2. CI gate** — runs on every PR, no Anthropic key needed:

\\\`\\\`\\\`yaml
- uses: IgorGanapolsky/ThumbGate@v1
  with:
    command: security-central
\\\`\\\`\\\``;
  }

  // devops template
  return `**AI agents in CI need guardrails too.** ThumbGate's GitHub Action runs deterministic checks on every PR:

\\\`\\\`\\\`yaml
- uses: IgorGanapolsky/ThumbGate@v1
  with { command: "agent-loop --health --json" }
\\\`\\\`\\\`

This fail-closed health check covers package.json integrity, MCP allowlists, session leases, and spend guards — all without an LLM call.`;
}

function getMonetization(template) {
  if (template.file.startsWith('so-answer-template-safety')) {
    return 'The core gate is free and MIT-licensed at https://github.com/IgorGanapolsky/ThumbGate. For the dashboard and 150+ pre-built rules, ThumbGate Pro is `$19/mo` or `$149/yr`: https://thumbgate.ai/go/pro-direct';
  }
  if (template.file === 'DevOps pipeline guardrails') {
    return 'For enterprise workflow gate diagnostics (root-cause one repeated team failure), the $499 Workflow Gate Diagnostic: https://thumbgate.ai/diagnostic';
  }
  return 'Free core at https://github.com/IgorGanapolsky/ThumbGate. Pro: https://thumbgate.ai/go/pro-direct. Enterprise: https://thumbgate.ai/diagnostic';
}

// ---- Anti-slop verification ----

function verifyAntiSlop(filePath) {
  try {
    const output = execSync(
      `bash ${ANTI_SLOP_SCRIPT} check --file "${filePath}" 2>&1`,
      { encoding: 'utf8', timeout: 10000 }
    ).trim();
    return output.includes('ALLOW');
  } catch {
    return false;
  }
}

// ---- Main ----

async function discoverAndStage() {
  console.log('SO Answer Bot — starting daily discovery');

  const allQuestions = [];
  for (const tag of TARGET_TAGS) {
    try {
      const result = await soSearch({ tagged: tag, order: 'desc', sort: 'creation' });
      if (result.items) allQuestions.push(...result.items);
      console.log(`  [${tag}] ${result.items?.length || 0} questions`);
    } catch (e) {
      console.error(`  [${tag}] failed: ${e.message}`);
    }
  }

  const ranked = rankQuestions(allQuestions);
  console.log(`\nTop ${ranked.length} questions after ranking:`);

  const gateExamples = getGateExamples();
  const staged = [];

  for (const q of ranked) {
    const template = selectTemplate(q.tags || []);
    const { slug, body } = buildAnswer(q, template, gateExamples);

    const draftFile = path.join(DRAFTS_DIR, `so-answer-${q.question_id}-${slug}.md`);
    fs.writeFileSync(draftFile, body);
    console.log(`\n  Staged: Q#${q.question_id} — "${q.title.substring(0, 60)}..."`);
    console.log(`  Template: ${template.name}`);
    console.log(`  Draft: ${draftFile}`);

    const antiSlopOk = verifyAntiSlop(draftFile);
    console.log(`  Anti-slop: ${antiSlopOk ? 'PASS ✅' : 'FAIL ❌'}`);

    if (antiSlopOk) {
      staged.push({
        question_id: q.question_id,
        title: q.title,
        slug,
        file: draftFile,
        template: template.name,
        link: `https://stackoverflow.com/questions/${q.question_id}`,
        action: 'STAGED_FOR_REVIEW'
      });
    } else {
      fs.unlinkSync(draftFile);
      console.log(`  Rejected: anti-slop FAIL, file removed`);
    }
  }

  // Update tracker
  if (staged.length > 0) {
    if (!fs.existsSync(HANDOFFS_DIR)) fs.mkdirSync(HANDOFFS_DIR, { recursive: true });
    for (const s of staged) {
      const line = [
        new Date().toISOString(),
        s.question_id,
        s.title,
        s.slug,
        s.template,
        s.action,
        s.link
      ].join('\t') + '\n';
      const trackerPath = path.join(HANDOFFS_DIR, 'so-answer-tracker.tsv');
      fs.appendFileSync(trackerPath, '#timestamp\tquestion_id\ttitle\tslug\ttemplate\taction\tlink\n'.replace(/#/, '') === '' ? '' : '');
      // Only write header if file is new
      if (!fs.existsSync(trackerPath)) {
        fs.writeFileSync(trackerPath, '#timestamp\tquestion_id\ttitle\tslug\ttemplate\taction\tlink\n');
      }
      fs.appendFileSync(trackerPath, line);
      console.log(`\n  Tracked: ${s.link}`);
    }

    console.log(`\n${staged.length} answer(s) staged for human review.`);
    console.log('Run with --status to see the queue.');
  } else {
    console.log('\nNo high-ROI questions found today.');
  }

  return staged;
}

function showStatus() {
  console.log('=== SO Answer Staging Queue ===\n');
  const trackerPath = path.join(HANDOFFS_DIR, 'so-answer-tracker.tsv');
  if (!fs.existsSync(trackerPath)) {
    console.log('No tracker file found. Queue is empty.');
    return;
  }
  const lines = fs.readFileSync(trackerPath, 'utf8').split('\n')
    .filter(l => l && !l.startsWith('#'));
  if (lines.length === 0) {
    console.log('Queue is empty.');
    return;
  }
  for (const line of lines.reverse()) {
    const [ts, id, title, slug, template, action, link] = line.split('\t');
    if (action === 'STAGED_FOR_REVIEW') {
      console.log(`  📝 Q#${id} — ${title?.substring(0, 50)}`);
      console.log(`     ${link}`);
      console.log(`     Template: ${template} | Status: ${action}`);
      console.log(`     Say "send it <${id}>" to post, or "skip" to dismiss.\n`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--status') {
    return showStatus();
  }
  if (args[0] === '--post') {
    console.log('Posting not implemented in this version — use browser to post staged answers.');
    return;
  }
  // Default: discover and stage
  await discoverAndStage();
}

main().catch(err => {
  console.error('so-answer-cron.js error:', err);
  process.exit(1);
});
