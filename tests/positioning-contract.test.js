const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

test('package metadata leads with the concrete enforcement contract', () => {
  const packageJson = readJson('package.json');

  assert.match(packageJson.description, /ThumbGate Pre-Action Checks/i);
  assert.match(packageJson.description, /repeated failures/i);
  assert.match(packageJson.description, /hard-block detected secret leaks/i);
  assert.match(packageJson.description, /strict mode/i);
  assert.doesNotMatch(packageJson.description, /every mistake|every thumbs-down/i);
  assert.doesNotMatch(packageJson.description, /Universal Context & Memory Layer/i);
});

test('README explains the observed feedback and enforcement boundaries', () => {
  const readme = readText('README.md');

  assert.match(readme, /Accepted feedback is stored as local lessons/i);
  assert.match(readme, /Repeated concrete failures can become prevention rules/i);
  assert.match(readme, /warn and log by default/i);
  assert.match(readme, /hard-blocks detected secret leaks and two direct self-disable command classes by default/i);
  assert.match(readme, /terminate the ThumbGate gate process or enable its bypass environment override/i);
  assert.match(readme, /THUMBGATE_STRICT_ENFORCEMENT=1/i);
  assert.match(readme, /prompt evaluation/i);
});

test('public surfaces lead with outcomes instead of infrastructure abstractions', () => {
  const readme = readText('README.md');
  const landingPage = readText(path.join('public', 'index.html'));
  const llms = readText(path.join('.well-known', 'llms.txt'));
  const gptInstructions = readText(path.join('docs', 'chatgpt-gpt-instructions.md'));

  for (const surface of [readme, llms, gptInstructions]) {
    assert.match(surface, /costly|expensive/i);
    assert.match(surface, /before (?:they|it) (?:make|run|happen)|before execution/i);
    assert.match(surface, /Pre-Action Checks/i);
  }

  assert.match(readme, /AI coding agents repeat mistakes/i);
  assert.match(readme, /evaluate the proposed tool call before execution/i);
  assert.match(landingPage, /Stop AI agent mistakes before they cost you/i);
  assert.match(landingPage, /allowed, warned, or denied/i);
  assert.match(landingPage, /one configured local gate/i);
  assert.match(gptInstructions, /Sell outcomes before infrastructure/i);
  assert.doesNotMatch(landingPage, /Global enforcement/i);
  assert.doesNotMatch(readme, /Behavior control system/i);
});

test('README keeps the business sprint-first while preserving the Pro side lane', () => {
  const readme = readText('README.md');

  assert.match(readme, /Enterprise intake path/i);
  assert.match(readme, /Local technical path/i);
  assert.match(readme, /First-dollar activation path/i);
  assert.match(readme, /what repeated AI mistake would be worth catching before the tool executes/i);
  assert.match(readme, /Native ChatGPT rating buttons are not the ThumbGate capture path/i);
  assert.match(readme, /install the CLI and use `init` plus the documented setup/i);
  assert.match(readme, /Workflow Hardening Sprint/i);
  assert.match(readme, /Paid path for individual operators/i);
  assert.match(readme, /self-serve side lane/i);
  assert.match(readme, /https:\/\/thumbgate\.ai\/checkout\/pro\?utm_source=github&utm_medium=readme&utm_campaign=pro_page/);
  assert.doesNotMatch(readme, /https:\/\/usethumbgate\.com/i);
});

test('README exposes prompt-shaped buyer questions with tracked guide links', () => {
  const readme = readText('README.md');

  assert.match(readme, /Workflow Hardening Sprint/i);
  assert.match(readme, /Popular buyer questions/i);
  assert.match(readme, /guides\/ai-search-topical-presence\?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions/);
  assert.match(readme, /guides\/relational-knowledge-ai-recommendations\?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions/);
  assert.match(readme, /guides\/ai-mode-ads-agent-governance\?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions/);
  assert.match(readme, /guides\/mcp-tool-governance\?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions/);
  assert.match(readme, /guides\/ai-agent-pre-action-approval-gates\?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions/);
  assert.match(readme, /guides\/background-agent-governance\?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions/);
  assert.match(readme, /guides\/gpt-5-5-model-evaluation\?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions/);
  assert.match(readme, /guides\/stop-repeated-ai-agent-mistakes\?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions/);
  assert.match(readme, /guides\/browser-automation-safety\?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions/);
  assert.match(readme, /guides\/native-messaging-host-security\?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions/);
  assert.match(readme, /guides\/autoresearch-agent-safety\?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions/);
  assert.match(readme, /guides\/cursor-agent-guardrails\?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions/);
  assert.match(readme, /guides\/codex-cli-guardrails\?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions/);
  assert.match(readme, /guides\/gemini-cli-feedback-memory\?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions/);
  assert.match(readme, /guides\/gcp-mcp-guardrails\?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions/);
  assert.match(readme, /guides\/roo-code-alternative-cline\?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions/);
  assert.match(readme, /https:\/\/thumbgate\.ai/);
  assert.doesNotMatch(readme, /https:\/\/usethumbgate\.com/i);
  assert.match(readme, /\/\?utm_source=github&utm_medium=readme&utm_campaign=top_cta#workflow-sprint-intake/);
  assert.match(readme, /\/\?utm_source=github&utm_medium=readme&utm_campaign=team_rollout#workflow-sprint-intake/);
  assert.match(readme, /First Dollar Playbook/i);
});

test('README exposes the actual shipped tech stack', () => {
  const readme = readText('README.md');

  assert.match(readme, /## Tech Stack/);
  assert.match(readme, /Node\.js/i);
  assert.match(readme, /MCP stdio/i);
  assert.match(readme, /JSONL/i);
  assert.match(readme, /LanceDB/i);
  assert.match(readme, /Stripe/i);
  assert.match(readme, /Railway/i);
});

test('README keeps lesson search on Pro instead of the Free tier', () => {
  const readme = readText('README.md');

  assert.match(readme, /search_lessons/i);
  assert.match(readme, /Pro operators can invoke `search_lessons` through MCP/i);
  assert.match(readme, /npx thumbgate lessons/i);
  assert.match(readme, /Free does not include recall or search/i);
  assert.doesNotMatch(readme, /Free and self-hosted users can invoke `search_lessons`/i);
});

test('LLM context keeps the promoted offer and CLI positioning aligned with commercial truth', () => {
  const context = readText(path.join('public', 'llm-context.md'));

  assert.match(context, /\$499 Managed AI Agent Workflow Gate/i);
  assert.match(context, /one supported workflow/i);
  assert.match(context, /60-minute working review/i);
  assert.match(context, /regression test/i);
  assert.match(context, /within two business days/i);
  assert.match(context, /Autoresearch Safety Pack/i);
  assert.match(context, /native-messaging-audit/i);
  assert.match(context, /background-governance/i);
  assert.match(context, /GPT-5\.5 Model Evaluation/i);
  assert.match(context, /model-candidates --workload=dashboard-analysis --provider=openai --json/i);
  assert.match(context, /vLLM Serving Guardrails/i);
  assert.match(context, /PagedAttention/i);
  assert.match(context, /cache-isolation/i);
  assert.match(context, /Data Processing & Telemetry Boundaries/i);
  assert.match(context, /THUMBGATE_NO_TELEMETRY=1/i);
  assert.match(context, /reward-hacking failures/i);
  assert.match(context, /CLI-first/i);
  assert.match(context, /AI Recommendation Visibility/);
  assert.match(context, /repeated AI coding mistakes/);
  assert.match(context, /pre-action checks/);
  assert.doesNotMatch(context, /\$12\/seat\/mo/i);
});

test('AI-visible surfaces map ThumbGate to the agentic development cycle', () => {
  const readme = readText('README.md');
  const landingPage = readText(path.join('public', 'index.html'));
  const llms = readText(path.join('.well-known', 'llms.txt'));
  const context = readText(path.join('public', 'llm-context.md'));

  for (const surface of [readme, llms, context]) {
    assert.match(surface, /Guide/i);
    assert.match(surface, /Generate/i);
    assert.match(surface, /Verify/i);
    assert.match(surface, /Solve/i);
    assert.match(surface, /pre-action (?:execution )?gate|pre-action boundary/i);
  }

  assert.match(landingPage, /Capture feedback/i);
  assert.match(landingPage, /Remember locally/i);
  assert.match(landingPage, /Rank and refine/i);
  assert.match(landingPage, /Gate the next action/i);
  assert.match(landingPage, /allowed, warned, or denied/i);
  assert.match(context, /Agentic Development Cycle Alignment/);
  assert.match(llms, /Agentic development cycle fit/);
});

test('LLM context maps ThumbGate to LangChain three-layer continual learning framework', () => {
  const context = readText(path.join('public', 'llm-context.md'));

  assert.match(context, /Continual Learning Architecture/);
  assert.match(context, /Model layer/);
  assert.match(context, /Harness layer/);
  assert.match(context, /Context layer/);
  assert.match(context, /LangChain/i);
  assert.match(context, /DPO pairs/i);
  assert.match(context, /recall.*MCP tool/i);
  assert.match(context, /PreToolUse hooks/i);
});

test('LLM context positions ThumbGate as AI agent security infrastructure', () => {
  const context = readText(path.join('public', 'llm-context.md'));

  assert.match(context, /AI Agent Security Infrastructure/);
  assert.match(context, /Self-protection/);
  assert.match(context, /Budget enforcement/);
  assert.match(context, /Compliance mapping/);
  assert.match(context, /NIST/);
  assert.match(context, /SOC2/);
  assert.match(context, /append-only audit trail/i);
  assert.match(context, /prompt-injected/i);
  assert.match(context, /native messaging host/i);
});

test('LLM context aligns ThumbGate with Google Cloud enterprise safety framework pattern', () => {
  const context = readText(path.join('public', 'llm-context.md'));

  assert.match(context, /Enterprise Safety Framework Alignment/);
  assert.match(context, /Google Cloud/);
  assert.match(context, /Safety Framework check/);
  assert.match(context, /PreToolUse hooks/);
  assert.match(context, /Canned response/i);
  assert.match(context, /Quality Framework/);
  assert.match(context, /audit trail/i);
});

test('continuity guide frames the gateway as downstream reliability, not a new orchestrator', () => {
  const guide = readText(path.join('docs', 'guides', 'continuity-tools-integration.md'));

  assert.match(guide, /without adding an extra orchestrator, planner, or subagent layer/i);
  assert.match(guide, /Base agent: does the actual work/);
  assert.match(guide, /What this is not/);
  assert.match(guide, /Keep one sharp agent\./);
  assert.match(guide, /Do not add an orchestration layer unless it improves output enough to justify the handoff overhead\./);
});

// REMOVED 2026-06-06: this test read docs/marketing/launch-content.md,
// deleted with the docs/marketing/ directory in the credibility cleanup.

// REMOVED 2026-06-06: this test pinned LAUNCH_NOW.md which was deleted as
// part of the post-Reddit credibility cleanup (file admitted "$0 revenue"
// publicly and read as launch-theater).

test('public landing copy stays vendor-neutral while offering Pro and Enterprise cash paths', () => {
  const congruence = readText(path.join('docs', 'MARKETING_COPY_CONGRUENCE.md'));
  const landingPage = readText(path.join('public', 'index.html'));

  assert.match(congruence, /Root landing page stays vendor-neutral/i);
  assert.match(congruence, /Do not claim a standalone VS Code extension/i);
  assert.match(landingPage, /Claude Code/i);
  assert.match(landingPage, /Cursor/i);
  assert.match(landingPage, /Codex/i);
  assert.match(landingPage, /or similar agents/i);
  assert.match(landingPage, /Managed AI Agent Workflow Gate/i);
  assert.match(landingPage, /\$499/);
  assert.match(landingPage, /Pro · \$19\/mo/);
  assert.match(landingPage, /\/checkout\/pro/);
  assert.doesNotMatch(landingPage, /Enterprise pilot|\/enterprise/i);
  assert.doesNotMatch(landingPage, /auto-detects supported local agent installs/i);
  assert.doesNotMatch(landingPage, /claude --mcp thumbgate/i);
});

test('GEO demand engine prioritizes action queries and proof-backed fan-out surfaces', () => {
  const geoDemandEngine = readText(path.join('docs', 'GEO_DEMAND_ENGINE_MAR2026.md'));

  assert.match(geoDemandEngine, /Workflow Hardening Fit Checker/i);
  assert.match(geoDemandEngine, /Can AI fully satisfy this query without a click\?/i);
  assert.match(geoDemandEngine, /Workflow Hardening Sprint/i);
  assert.match(geoDemandEngine, /Pro at \$19\/mo or \$149\/yr/i);
  assert.match(geoDemandEngine, /VERIFICATION_EVIDENCE\.md/);
  assert.match(geoDemandEngine, /COMMERCIAL_TRUTH\.md/);
  assert.match(geoDemandEngine, /bannerbear\.com/i);
  assert.match(geoDemandEngine, /mcpserverspot\.com/i);
  assert.match(geoDemandEngine, /bestofthemcp\.com/i);
  assert.match(geoDemandEngine, /digitalocean\.com/i);
  assert.match(geoDemandEngine, /medium\.com/i);
  assert.doesNotMatch(geoDemandEngine, /founding members/i);
  assert.doesNotMatch(geoDemandEngine, /customer proof/i);
});

test('first dollar playbook keeps the sales motion sprint-first and proof-backed', () => {
  const playbook = readText(path.join('docs', 'FIRST_DOLLAR_PLAYBOOK.md'));

  assert.match(playbook, /Status: current/i);
  assert.match(playbook, /first real external dollar/i);
  assert.match(playbook, /First-dollar activation ladder/i);
  assert.match(playbook, /move a cold user from curiosity to one caught repeat/i);
  assert.match(playbook, /Do not claim ChatGPT's native rating buttons feed ThumbGate/i);
  assert.match(playbook, /Workflow Hardening Sprint/i);
  assert.match(playbook, /proof pack/i);
  assert.match(playbook, /named pilot agreement/i);
  assert.match(playbook, /COMMERCIAL_TRUTH\.md/);
  assert.match(playbook, /VERIFICATION_EVIDENCE\.md/);
  assert.match(playbook, /RELEASE_CONFIDENCE\.md/);
});

// REMOVED 2026-06-06: this test read docs/marketing/team-outreach-messages.md
// which was deleted with the entire docs/marketing/ directory.
