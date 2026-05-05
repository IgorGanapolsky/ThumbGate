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

test('package metadata leads with self-improving governance framing instead of generic memory-layer phrasing', () => {
  const packageJson = readJson('package.json');

  assert.match(packageJson.description, /self-improving/i);
  assert.match(packageJson.description, /governance/i);
  assert.match(packageJson.description, /prevention rule/i);
  assert.doesNotMatch(packageJson.description, /Universal Context & Memory Layer/i);
});

test('README explains the product as self-improving agent enforcement', () => {
  const readme = readText('README.md');

  assert.match(readme, /self-improv/i);
  assert.match(readme, /enforcement/i);
  assert.match(readme, /permanently/i);
  assert.match(readme, /prompt evaluation/i);
});

test('public surfaces lead with outcomes instead of infrastructure abstractions', () => {
  const readme = readText('README.md');
  const landingPage = readText(path.join('public', 'index.html'));
  const llms = readText(path.join('.well-known', 'llms.txt'));
  const gptInstructions = readText(path.join('docs', 'chatgpt-gpt-instructions.md'));

  for (const surface of [readme, landingPage, llms, gptInstructions]) {
    assert.match(surface, /costly|expensive/i);
    assert.match(surface, /before (?:they|it) (?:make|run|happen)|before execution/i);
    assert.match(surface, /Pre-Action Checks/i);
  }

  assert.match(readme, /Prevent expensive AI mistakes/i);
  assert.match(readme, /Make AI stop repeating mistakes/i);
  assert.match(readme, /reliable operator/i);
  assert.match(landingPage, /Stop the same mistake before|paying Anthropic to watch/i);
  assert.match(landingPage, /machine-speed pre-action defense/i);
  assert.match(landingPage, /agent surface inventory/i);
  assert.match(gptInstructions, /Sell outcomes before infrastructure/i);
  assert.doesNotMatch(landingPage, /Global enforcement/i);
  assert.doesNotMatch(readme, /Behavior control system/i);
});

test('README keeps the business sprint-first while preserving the Pro side lane', () => {
  const readme = readText('README.md');

  assert.match(readme, /Best first paid motion for teams/i);
  assert.match(readme, /Best first technical motion/i);
  assert.match(readme, /First-dollar activation path/i);
  assert.match(readme, /what repeated AI mistake would be worth blocking before the next tool call/i);
  assert.match(readme, /Native ChatGPT rating buttons are not the ThumbGate capture path/i);
  assert.match(readme, /CLI-first/i);
  assert.match(readme, /Workflow Hardening Sprint/i);
  assert.match(readme, /Paid path for individual operators/i);
  assert.match(readme, /self-serve side lane/i);
  assert.match(readme, /https:\/\/thumbgate-production\.up\.railway\.app\/checkout\/pro\?utm_source=github&utm_medium=readme&utm_campaign=pro_page/);
  assert.doesNotMatch(readme, /https:\/\/usethumbgate\.com/i);
});

test('README exposes prompt-shaped buyer questions with tracked guide links', () => {
  const readme = readText('README.md');

  assert.match(readme, /Workflow Hardening Sprint/i);
  assert.match(readme, /Popular buyer questions/i);
  assert.match(readme, /guides\/ai-search-topical-presence\?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions/);
  assert.match(readme, /guides\/relational-knowledge-ai-recommendations\?utm_source=github&utm_medium=readme&utm_campaign=buyer_questions/);
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
  assert.match(readme, /https:\/\/thumbgate-production\.up\.railway\.app/);
  assert.doesNotMatch(readme, /https:\/\/usethumbgate\.com/i);
  assert.match(readme, /\/\?utm_source=github&utm_medium=readme&utm_campaign=top_cta#workflow-sprint-intake/);
  assert.match(readme, /\/\?utm_source=github&utm_medium=readme&utm_campaign=team_rollout#workflow-sprint-intake/);
  assert.match(readme, /First Dollar Playbook/i);
  assert.match(readme, /Partner Marketplace Revenue Pack/i);
  assert.match(readme, /Lindy\.ai, Gumroad, and GoHighLevel/i);
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

test('README exposes lesson search as a free self-hosted MCP surface', () => {
  const readme = readText('README.md');

  assert.match(readme, /search_lessons/i);
  assert.match(readme, /self-hosted users can invoke `search_lessons` directly through MCP/i);
  assert.match(readme, /npx thumbgate lessons/i);
});

test('LLM context keeps team pricing and CLI-first positioning aligned with commercial truth', () => {
  const context = readText(path.join('public', 'llm-context.md'));

  assert.match(context, /Workflow Hardening Sprint/i);
  assert.match(context, /\$49\/seat\/mo/i);
  assert.match(context, /Autoresearch Safety Pack/i);
  assert.match(context, /native-messaging-audit/i);
  assert.match(context, /background-governance/i);
  assert.match(context, /GPT-5\.5 Model Evaluation/i);
  assert.match(context, /model-candidates --workload=dashboard-analysis --provider=openai --json/i);
  assert.match(context, /Data Processing & Telemetry Boundaries/i);
  assert.match(context, /THUMBGATE_NO_TELEMETRY=1/i);
  assert.match(context, /reward-hacking failures/i);
  assert.match(context, /CLI-first/i);
  assert.match(context, /solo side lane/i);
  assert.match(context, /AI Recommendation Visibility/);
  assert.match(context, /repeated AI coding mistakes/);
  assert.match(context, /pre-action checks/);
  assert.doesNotMatch(context, /\$12\/seat\/mo/i);
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

test('launch-content variants align with reliability-over-orchestration positioning', () => {
  const launchContent = readText(path.join('docs', 'marketing', 'launch-content.md'));

  assert.match(launchContent, /ThumbGate/i);
  assert.match(launchContent, /Pre-Action Checks/i);
  assert.match(launchContent, /repeating known mistakes|block tool calls/i);
  assert.doesNotMatch(launchContent, /Agentic Feedback Studio/i);
  assert.doesNotMatch(launchContent, /persistent memory layer that fixes this/i);
});

test('launch-now playbook stays discovery-first and avoids retired broadcast channels', () => {
  const launchNow = readText('LAUNCH_NOW.md');

  assert.match(launchNow, /npm run gtm:revenue-loop/i);
  assert.match(launchNow, /sales:pipeline -- import/i);
  assert.match(launchNow, /Workflow Hardening Sprint/i);
  assert.match(launchNow, /X\/Twitter is retired/i);
  assert.match(launchNow, /Do not lead with Pro/i);
  assert.doesNotMatch(launchNow, /Show HN/i);
  assert.doesNotMatch(launchNow, /X\/Twitter thread/i);
});

test('public landing copy stays vendor-neutral and honest about editor support', () => {
  const congruence = readText(path.join('docs', 'MARKETING_COPY_CONGRUENCE.md'));
  const landingPage = readText(path.join('public', 'index.html'));

  assert.match(congruence, /Root landing page stays vendor-neutral/i);
  assert.match(congruence, /Do not claim a standalone VS Code extension/i);
  assert.match(landingPage, /Claude Code/i);
  assert.match(landingPage, /Cursor/i);
  assert.match(landingPage, /Codex/i);
  assert.match(landingPage, /Gemini/i);
  assert.match(landingPage, /Amp/i);
  assert.match(landingPage, /OpenCode/i);
  assert.match(landingPage, /VS Code works when you run an MCP-compatible agent inside it/i);
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
  assert.match(playbook, /next repeatable dollar/i);
  assert.match(playbook, /First-dollar activation ladder/i);
  assert.match(playbook, /move a cold user from curiosity to one blocked repeat/i);
  assert.match(playbook, /Do not claim ChatGPT's native rating buttons feed ThumbGate/i);
  assert.match(playbook, /Workflow Hardening Sprint/i);
  assert.match(playbook, /proof pack/i);
  assert.match(playbook, /named pilot agreement/i);
  assert.match(playbook, /COMMERCIAL_TRUTH\.md/);
  assert.match(playbook, /VERIFICATION_EVIDENCE\.md/);
  assert.match(playbook, /RELEASE_CONFIDENCE\.md/);
});

test('customer discovery sprint turns the GTM recommendation into a concrete interview loop', () => {
  const discovery = readText(path.join('docs', 'CUSTOMER_DISCOVERY_SPRINT.md'));
  const outreach = readText(path.join('docs', 'marketing', 'team-outreach-messages.md'));

  assert.match(discovery, /Pause broad posting for 7 days/i);
  assert.match(discovery, /3-5 people/i);
  assert.match(discovery, /Workflow Hardening Sprint/i);
  assert.match(discovery, /team agent governance|enterprise-first/i);
  assert.match(outreach, /CUSTOMER_DISCOVERY_SPRINT\.md/);
});
