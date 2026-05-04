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
  'guides/background-agent-governance.html',
  'guides/ai-agent-governance-sprint.html',
  'guides/gpt-5-5-model-evaluation.html',
  'guides/browser-automation-safety.html',
  'guides/native-messaging-host-security.html',
  'guides/ai-search-topical-presence.html',
  'guides/best-tools-stop-ai-agents-breaking-production.html',
  'guides/relational-knowledge-ai-recommendations.html',
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

  it('AI agent governance sprint guide routes buyers into the Team intake', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/ai-agent-governance-sprint.html'),
      'utf-8'
    );

    assert.ok(html.includes('AI Agent Governance Sprint'));
    assert.ok(html.includes('48-hour Workflow Hardening Sprint'));
    assert.ok(html.includes('npx thumbgate background-governance --check --json'));
    assert.ok(html.includes('workflow-sprint-intake'));
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

    assert.ok(topicalPresence.includes('Topical presence'), 'topical presence guide should mention topical presence');
    assert.ok(topicalPresence.includes('Verification evidence'), 'topical presence guide should link proof assets');
    assert.ok(productionListicle.includes('AEO fuel'), 'production listicle should explain the answer-engine citation angle');
    assert.ok(productionListicle.includes('Parallel branch budgets'), 'production listicle should mention parallel branch budgets');
    assert.ok(productionListicle.includes('Environment inspection requirements'), 'production listicle should mention environment inspection');
    assert.ok(relationalKnowledge.includes('Relational knowledge'), 'relational knowledge guide should mention relational knowledge');
    assert.ok(relationalKnowledge.includes('pre-action checks'), 'relational knowledge guide should tie the topic back to ThumbGate');
  });
});
