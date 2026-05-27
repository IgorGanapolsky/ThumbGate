'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const GUIDE_FILES = [
  'guides/pre-action-checks.html',
  'guides/agent-harness-optimization.html',
  'guides/code-knowledge-graph-guardrails.html',
  'guides/developer-machine-supply-chain-guardrails.html',
  'guides/prompt-tricks-to-workflow-rules.html',
  'guides/semantic-programmatic-seo-guardrails.html',
  'guides/proxy-pointer-rag-guardrails.html',
  'guides/rag-precision-tuning-guardrails.html',
  'guides/internal-ai-engineering-stack-guardrails.html',
  'guides/seo-agent-skills-guardrails.html',
  'guides/claude-code-skills-guardrails.html',
  'guides/long-running-agent-context-management.html',
  'guides/reasoning-compression-guardrails.html',
  'guides/deepseek-v4-runtime-guardrails.html',
  'guides/claude-code-ultrawork-safety.html',
  'guides/local-desktop-agent-governance.html',
  'guides/cloudflare-agent-platform-governance.html',
  'guides/direct-corpus-interaction-agent-governance.html',
  'guides/terraform-mcp-plan-review-governance.html',
  'guides/delta-mem-agent-memory-governance.html',
  'guides/claude-code-usage-token-governance.html',
  'guides/agentic-agile-development-governance.html',
  'guides/ai-fluency-marketing-agent-governance.html',
  'guides/background-agent-governance.html',
  'guides/ai-agent-workflow-migration-checklist.html',
  'guides/ai-agent-governance-sprint.html',
  'guides/ai-deployment-readiness.html',
  'guides/gpt-5-5-model-evaluation.html',
  'guides/browser-automation-safety.html',
  'guides/native-messaging-host-security.html',
  'guides/ai-search-topical-presence.html',
  'guides/best-tools-stop-ai-agents-breaking-production.html',
  'guides/relational-knowledge-ai-recommendations.html',
  'guides/ai-mode-ads-agent-governance.html',
  'guides/mcp-tool-governance.html',
  'guides/ai-agent-pre-action-approval-gates.html',
  'guides/langfuse-thumbgate-observability-enforcement.html',
  'guides/low-latency-ai-governance.html',
  'guides/claude-code-feedback.html',
  'guides/stop-repeated-ai-agent-mistakes.html',
  'guides/claude-code-prevent-repeated-mistakes.html',
  'guides/cursor-prevent-repeated-mistakes.html',
  'guides/codex-cli-guardrails.html',
  'guides/autoresearch-agent-safety.html',
];

const COMPARE_FILES = [
  'compare/speclock.html',
  'compare/mem0.html',
  'compare/fallow.html',
  'compare/agentix-labs.html',
];

const ALL_FILES = [...GUIDE_FILES, ...COMPARE_FILES];

function hasCheckoutPath(html, pathname) {
  return Array.from(
    html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g),
    (match) => match[1]
  ).some((href) => {
    const url = new URL(href, 'https://thumbgate.ai');
    return url.protocol === 'https:' && url.hostname === 'buy.stripe.com' && url.pathname === pathname;
  });
}

describe('SEO guide and comparison pages', () => {
  it('all configured HTML files exist', () => {
    assert.ok(ALL_FILES.length > 0, 'SEO guide file list is empty');
    for (const file of ALL_FILES) {
      const fullPath = path.join(PUBLIC_DIR, file);
      assert.ok(fs.existsSync(fullPath), `Missing file: ${file}`);
    }
  });

  for (const file of ALL_FILES) {
    const label = file.replace('.html', '');

    describe(label, () => {
      let html;

      it('can be read', () => {
        html = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf-8');
        assert.ok(html.length > 0, 'File is not empty');
      });

      it('has FAQPage schema.org markup', () => {
        html = html || fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf-8');
        assert.ok(html.includes('"FAQPage"'), `${file} missing FAQPage schema`);
      });

      it('has TechArticle schema.org markup', () => {
        html = html || fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf-8');
        assert.ok(html.includes('"TechArticle"'), `${file} missing TechArticle schema`);
      });

      it('has the llm-context link tag', () => {
        html = html || fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf-8');
        assert.ok(
          html.includes('rel="llm-context"'),
          `${file} missing llm-context link tag`
        );
      });

      it('mentions ThumbGate', () => {
        html = html || fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf-8');
        assert.ok(html.includes('ThumbGate'), `${file} does not mention ThumbGate`);
      });

      it('mentions the current Pro and Team pricing', () => {
        html = html || fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf-8');
        assert.ok(
          html.includes('$19/mo') && html.includes('$149/yr') && html.includes('$49/seat/mo'),
          `${file} missing current Pro and Team pricing`
        );
      });
    });
  }

  it('agent harness optimization guide links machine-readable harness proof', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/agent-harness-optimization.html'),
      'utf-8'
    );

    assert.ok(
      html.includes('proof/harnesses-report.json'),
      'agent harness guide should link machine-readable harness proof'
    );
  });

  it('browser safety guide routes readers into the native messaging audit', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/browser-automation-safety.html'),
      'utf-8'
    );

    assert.ok(
      html.includes('npx thumbgate native-messaging-audit'),
      'browser automation safety guide should include the native messaging audit command'
    );
  });

  it('background agent governance guide routes teams into review risk checks', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/background-agent-governance.html'),
      'utf-8'
    );

    assert.ok(html.includes('npx thumbgate background-governance --json'));
    assert.ok(html.includes('pre-dispatch governance check'));
    assert.ok(html.includes('risk-tiered review'));
    assert.ok(html.includes('Workflow Hardening Sprint'));
  });

  it('Claude Code Ultrawork safety guide routes long-running agents into governance checks', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/claude-code-ultrawork-safety.html'),
      'utf-8'
    );

    assert.ok(html.includes('Claude Code Ultrawork makes agents faster. ThumbGate makes them governable.'));
    assert.ok(html.includes('Ultrawork, Ralph loops, background sessions, batch agents, and parallel worktrees'));
    assert.ok(html.includes('Pre-dispatch scope'));
    assert.ok(html.includes('Cap background-agent runs by time, tokens, changed files'));
    assert.ok(html.includes('Workflow Hardening Sprint'));
  });

  it('local desktop agent governance guide pairs local memory with enforcement', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/local-desktop-agent-governance.html'),
      'utf-8'
    );

    assert.ok(html.includes('Local desktop agents need memory and impulse control.'));
    assert.ok(html.includes('Obsidian-style vaults'));
    assert.ok(html.includes('users vote on answers and actions'));
    assert.ok(html.includes('successes as well as mistakes'));
    assert.ok(html.includes('Model routing'));
    assert.ok(html.includes('pre-action enforcement'));
    assert.ok(html.includes('Go Pro'));
  });

  it('Cloudflare agent platform governance guide routes platform-stack demand into gates', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/cloudflare-agent-platform-governance.html'),
      'utf-8'
    );

    assert.ok(html.includes('Cloudflare gives agents the stack. ThumbGate gives them judgment.'));
    assert.ok(html.includes('Browser Run'));
    assert.ok(html.includes('Sandboxes'));
    assert.ok(html.includes('Agent Memory'));
    assert.ok(html.includes('agent commerce'));
    assert.ok(html.includes('Users should vote on answers, plans, tool choices, and outcomes'));
    assert.ok(html.includes('pre-action governance'));
    assert.ok(html.includes('Go Pro'));
  });

  it('direct corpus interaction guide routes terminal-retrieval demand into gates', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/direct-corpus-interaction-agent-governance.html'),
      'utf-8'
    );

    assert.ok(html.includes('Terminal-native retrieval needs terminal-native guardrails.'));
    assert.ok(html.includes('find, glob, grep, rg, sed, head, tail'));
    assert.ok(html.includes('Search scope'));
    assert.ok(html.includes('Secret exposure'));
    assert.ok(html.includes('Users can vote on answers, searches, evidence trails, and outcomes'));
    assert.ok(html.includes('pre-action gates'));
    assert.ok(html.includes('Go Pro'));
  });

  it('Terraform MCP plan review guide routes IaC risk into gates', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/terraform-mcp-plan-review-governance.html'),
      'utf-8'
    );

    assert.ok(html.includes('Terraform MCP gives agents context. ThumbGate decides if the plan is safe to run.'));
    assert.ok(html.includes('terraform show -json'));
    assert.ok(html.includes('wildcard IAM'));
    assert.ok(html.includes('public ingress'));
    assert.ok(html.includes('database replacement'));
    assert.ok(html.includes('config/gates/terraform.json'));
    assert.ok(html.includes('Go Pro'));
  });

  it('Delta-Mem agent memory governance guide routes working-memory demand into policy gates', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/delta-mem-agent-memory-governance.html'),
      'utf-8'
    );

    assert.ok(html.includes('Working memory helps agents remember. ThumbGate decides what memory can do.'));
    assert.ok(html.includes('stored, retrieved, forgotten, exposed, or enforced'));
    assert.ok(html.includes('memory-source labels'));
    assert.ok(html.includes('success reinforcement'));
    assert.ok(html.includes('dashboard proof'));
    assert.ok(html.includes('Go Pro'));
  });

  it('Claude Code usage token governance guide routes /usage visibility into prevention gates', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/claude-code-usage-token-governance.html'),
      'utf-8'
    );

    assert.ok(html.includes('Usage breakdowns show where tokens went. ThumbGate prevents the waste from repeating.'));
    assert.ok(html.includes('Skills, Agents, MCPs, and Plugins'));
    assert.ok(html.includes('config/gates/token-usage.json'));
    assert.ok(html.includes('runtime_component'));
    assert.ok(html.includes('budget_decision'));
    assert.ok(html.includes('repeated token waste'));
    assert.ok(html.includes('Go Pro'));
  });

  it('Agentic Agile development governance guide routes process demand into acceptance gates', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/agentic-agile-development-governance.html'),
      'utf-8'
    );

    assert.ok(html.includes('Agentic agile needs more than prompts. It needs acceptance evidence and gates.'));
    assert.ok(html.includes('Definition of done'));
    assert.ok(html.includes('Retrospective memory'));
    assert.ok(html.includes('dashboard proof'));
    assert.ok(html.includes('governed AI delivery workflow'));
    assert.ok(html.includes('Go Pro'));
  });

  it('AI fluency marketing governance guide routes non-developer adoption into approval gates', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/ai-fluency-marketing-agent-governance.html'),
      'utf-8'
    );

    assert.ok(html.includes('AI-fluent teams need brand-safe agent memory, not one-off prompts.'));
    assert.ok(html.includes('brand lessons'));
    assert.ok(html.includes('vote, remember, approve, prove'));
    assert.ok(html.includes('legal claims review'));
    assert.ok(html.includes('cross-tool governance'));
    assert.ok(html.includes('Go Pro'));
  });

  it('AI agent workflow migration checklist routes buyers into the paid diagnostic', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/ai-agent-workflow-migration-checklist.html'),
      'utf-8'
    );

    assert.ok(html.includes('AI Agent Workflow Migration Checklist'));
    assert.ok(html.includes('$499 Agent Workflow Migration Diagnostic'));
    assert.ok(html.includes('Pay $19 quick read'));
    assert.ok(html.includes('Pay $1 first rule'));
    assert.ok(html.includes('Pay $499 diagnostic'));
    assert.ok(hasCheckoutPath(html, '/5kQ7sL76s1eSaK55e33sI2H'));
    assert.ok(hasCheckoutPath(html, '/fZu28rfCY6zcbO99uj3sI2G'));
    assert.ok(hasCheckoutPath(html, '/00w14neyUcXA5pL5e33sI0e'));
    assert.ok(html.includes('workflow-sprint-intake'));
    assert.ok(html.includes('Pro $19/mo or $149/yr. Team $49/seat/mo.'));
    assert.ok(html.includes('pre-action rule that stops the already-rejected mistake'));
  });

  it('AI agent governance sprint guide routes buyers into the Team intake', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/ai-agent-governance-sprint.html'),
      'utf-8'
    );

    assert.ok(html.includes('AI Agent Governance Sprint'));
    assert.ok(html.includes('48-hour Workflow Hardening Sprint'));
    assert.ok(html.includes('npx thumbgate background-governance --check --json'));
    assert.ok(html.includes('workflow-sprint-intake'));
    assert.ok(html.includes('Ready to buy the sprint?'));
    const paidOfferHrefs = Array.from(
      html.matchAll(/<a class="paid-offer [^"]+" href="([^"]+)"/g),
      (match) => match[1]
    );
    assert.deepEqual(paidOfferHrefs, [
      'https://buy.stripe.com/00w14neyUcXA5pL5e33sI0e',
      'https://buy.stripe.com/fZu9AT76saPsg4pbCr3sI0f',
    ]);
    assert.ok(html.includes('$499'));
    assert.ok(html.includes('$1500'));
  });

  it('Langfuse enforcement guide explains observability plus gate-score export', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/langfuse-thumbgate-observability-enforcement.html'),
      'utf-8'
    );

    assert.ok(html.includes('Langfuse observes agent behavior. ThumbGate gates the next action.'));
    assert.ok(html.includes('Langfuse is observability, prompt management, scoring, and experiments'));
    assert.ok(html.includes('Pre-action enforcement before tool execution'));
    assert.ok(html.includes('Gate block rate by prompt version'));
    assert.ok(html.includes('Go Pro'));
  });

  it('low-latency AI governance guide keeps pre-action gates in the production path', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/low-latency-ai-governance.html'),
      'utf-8'
    );

    assert.ok(html.includes('AI governance only works when it is fast enough to stay in the path.'));
    assert.ok(html.includes('Track p50 and p99 gate latency'));
    assert.ok(html.includes('local-first pre-action checks'));
    assert.ok(html.includes('risk-tiered decisions'));
    assert.ok(html.includes('Go Pro'));
  });

  it('AI deployment readiness guide converts production rollout demand into paid sprint paths', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/ai-deployment-readiness.html'),
      'utf-8'
    );

    assert.ok(html.includes('AI Deployment Readiness'));
    assert.ok(html.includes('deployment companies'));
    assert.ok(html.includes('governance and proof layer'));
    assert.ok(html.includes('npx thumbgate background-governance --check --json'));
    assert.ok(html.includes('workflow-sprint-intake'));
    assert.ok(html.includes('Ready to buy the sprint?'));
    assert.ok(hasCheckoutPath(html, '/00w14neyUcXA5pL5e33sI0e'));
    assert.ok(hasCheckoutPath(html, '/fZu9AT76saPsg4pbCr3sI0f'));
  });

  it('GPT-5.5 model evaluation guide routes teams into benchmark-first model routing', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/gpt-5-5-model-evaluation.html'),
      'utf-8'
    );

    assert.ok(html.includes('npx thumbgate model-candidates --workload=dashboard-analysis --provider=openai --json'));
    assert.ok(html.includes('dashboard-analysis workload'));
    assert.ok(html.includes('chart-spec validity'));
    assert.ok(html.includes('Benchmark Before Routing Expensive Agent Work'));
  });

  it('code knowledge graph guide routes graph context into enforceable checks', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/code-knowledge-graph-guardrails.html'),
      'utf-8'
    );

    assert.ok(html.includes('Code graphs tell the agent what the system is'));
    assert.ok(html.includes('Require diff impact before central edits'));
    assert.ok(html.includes('Checkpoint cross-layer refactors'));
    assert.ok(html.includes('Protect generated graph artifacts'));
    assert.ok(html.includes('Knowledge Graph Safety'));
    assert.ok(html.includes('npx thumbgate code-graph-guardrails'));
  });

  it('developer machine supply chain guide routes local compromise risk into pre-action checks', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/developer-machine-supply-chain-guardrails.html'),
      'utf-8'
    );

    assert.ok(html.includes('Stop AI Assistants From Amplifying Supply-Chain Attacks'));
    assert.ok(html.includes('Block package lifecycle secret harvest'));
    assert.ok(html.includes('Review untrusted CLI before execution'));
    assert.ok(html.includes('Require credential exposure assessment'));
    assert.ok(html.includes('Supply Chain Safety'));
  });

  it('prompt tricks guide routes prompt advice into enforceable workflow rules', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/prompt-tricks-to-workflow-rules.html'),
      'utf-8'
    );

    assert.ok(html.includes('Prompt Tricks Are Not Enough'));
    assert.ok(html.includes('clear rules, examples, and pre-action checks'));
    assert.ok(html.includes('Do not rely on politeness, threats, flattery, or roleplay'));
    assert.ok(html.includes('Workflow Rule Safety'));
  });

  it('semantic pSEO guide routes scaled content into governed publish checks', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/semantic-programmatic-seo-guardrails.html'),
      'utf-8'
    );
    assert.match(html, /Semantic pSEO Needs Governance Before Scale/);
    assert.match(html, /Authority map before page generation/);
    assert.match(html, /Brand context governance before drafting/);
    assert.match(html, /Semantic mesh links before publish/);
    assert.match(html, /Technical guardian checks before crawl/);
  });

  it('document RAG guides route retrieval and visual answer risks into gates', () => {
    const proxyPointer = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/proxy-pointer-rag-guardrails.html'),
      'utf-8'
    );
    const precision = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/rag-precision-tuning-guardrails.html'),
      'utf-8'
    );

    assert.ok(proxyPointer.includes('npx thumbgate proxy-pointer-rag-guardrails'));
    assert.ok(proxyPointer.includes('Section tree and image pointer grounding'));
    assert.ok(precision.includes('npx thumbgate rag-precision-guardrails'));
    assert.ok(precision.includes('Retrieval baseline before tuning'));
    assert.ok(precision.includes('Two-stage verifier for structural near misses'));
  });

  it('internal AI engineering stack guide routes platform wiring into enforceable gates', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/internal-ai-engineering-stack-guardrails.html'),
      'utf-8'
    );

    assert.ok(html.includes('Internal AI Engineering Stacks Need Pre-Action Enforcement'));
    assert.ok(html.includes('npx thumbgate ai-engineering-stack-guardrails'));
    assert.ok(html.includes('AI gateway gate'));
    assert.ok(html.includes('MCP portal gate'));
    assert.ok(html.includes('AGENTS.md and LLM wiki freshness gate'));
    assert.ok(html.includes('Background agent sandbox gate'));
  });

  it('SEO and Claude skill guides route advisory skills into enforceable gates', () => {
    const seoSkills = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/seo-agent-skills-guardrails.html'),
      'utf-8'
    );
    const claudeSkills = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/claude-code-skills-guardrails.html'),
      'utf-8'
    );

    assert.ok(seoSkills.includes('SEO Agents Need Workspaces and Guardrails'));
    assert.ok(seoSkills.includes('Technical publish gate'));
    assert.ok(claudeSkills.includes('Claude Code Skills Need Pre-Action Enforcement'));
    assert.ok(claudeSkills.includes('skillbook'));
  });

  it('long-running context and reasoning guides expose new research-backed CLI gates', () => {
    const contextGuide = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/long-running-agent-context-management.html'),
      'utf-8'
    );
    const reasoningGuide = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/reasoning-compression-guardrails.html'),
      'utf-8'
    );

    assert.ok(contextGuide.includes('npx thumbgate long-running-agent-context-guardrails'));
    assert.ok(contextGuide.includes('Director journals'));
    assert.ok(reasoningGuide.includes('npx thumbgate reasoning-efficiency-guardrails'));
    assert.ok(reasoningGuide.includes('Step-Level Verifier Checks'));
  });

  it('DeepSeek V4 runtime guide exposes sparse-attention guardrails', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/deepseek-v4-runtime-guardrails.html'),
      'utf-8'
    );

    assert.ok(html.includes('DeepSeek V4 Runtime Guardrails'));
    assert.ok(html.includes('npx thumbgate deepseek-v4-runtime-guardrails'));
    assert.ok(html.includes('Hybrid sparse attention'));
  });

  it('Fallow comparison positions static analysis as complementary context', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'compare/fallow.html'),
      'utf-8'
    );

    assert.ok(html.includes('ThumbGate vs Fallow'));
    assert.ok(html.includes('Fallow finds JS/TS code health issues'));
    assert.ok(html.includes('ThumbGate governs what AI agents are allowed to do next'));
  });

  it('AI search visibility guides reinforce the recommendation-discovery story', () => {
    const topicalPresence = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/ai-search-topical-presence.html'),
      'utf-8'
    );
    const productionListicle = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/best-tools-stop-ai-agents-breaking-production.html'),
      'utf-8'
    );
    const relationalKnowledge = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/relational-knowledge-ai-recommendations.html'),
      'utf-8'
    );
    const aiModeAds = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/ai-mode-ads-agent-governance.html'),
      'utf-8'
    );
    const mcpGovernance = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/mcp-tool-governance.html'),
      'utf-8'
    );
    const approvalGates = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/ai-agent-pre-action-approval-gates.html'),
      'utf-8'
    );

    assert.ok(topicalPresence.includes('Topical presence'), 'topical presence guide should mention topical presence');
    assert.ok(topicalPresence.includes('Verification evidence'), 'topical presence guide should link proof assets');
    assert.ok(productionListicle.includes('AEO fuel'), 'production listicle should explain the answer-engine citation angle');
    assert.ok(productionListicle.includes('Parallel branch budgets'), 'production listicle should mention parallel branch budgets');
    assert.ok(productionListicle.includes('Environment inspection requirements'), 'production listicle should mention environment inspection');
    assert.ok(relationalKnowledge.includes('Relational knowledge'), 'relational knowledge guide should mention relational knowledge');
    assert.ok(relationalKnowledge.includes('pre-action checks'), 'relational knowledge guide should tie the topic back to ThumbGate');
    assert.ok(aiModeAds.includes('AI Mode ads make agent-governance promotion conversational'), 'AI Mode guide should answer the conversational-ad prompt');
    assert.ok(aiModeAds.includes('Buyer prompts ThumbGate should target'), 'AI Mode guide should include prompt targets');
    assert.ok(mcpGovernance.includes('MCP tool governance before agents call real systems'), 'MCP guide should lead with tool governance');
    assert.ok(mcpGovernance.includes('Tool inventory'), 'MCP guide should describe governance requirements');
    assert.ok(approvalGates.includes('pre-action approval gates for risky tool calls'), 'approval-gates guide should lead with the buyer phrase');
    assert.ok(approvalGates.includes('Block: deny known-bad actions'), 'approval-gates guide should describe gate outcomes');
  });
});
