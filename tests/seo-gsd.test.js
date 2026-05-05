'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  HIGH_ROI_QUERY_SEEDS,
  PAGE_BLUEPRINTS,
  THUMBGATE_SEO_SITEMAP_ENTRIES,
  buildThumbGateSeoPlan,
  buildAuthorityMap,
  buildContextGovernance,
  buildSemanticMesh,
  buildTechnicalGuardian,
  findSeoPageByPath,
  parseCsv,
  renderPlanMarkdown,
  renderSeoPageHtml,
  writePlanOutputs,
} = require('../scripts/seo-gsd');

test('parseCsv handles quoted commas and preserves headers', () => {
  const rows = parseCsv([
    'Query,Business Value,Notes',
    '"thumbgate vs speclock",100,"Bottom-of-funnel, comparison page"',
  ].join('\n'));

  assert.deepEqual(rows, [{
    query: 'thumbgate vs speclock',
    business_value: '100',
    notes: 'Bottom-of-funnel, comparison page',
  }]);
});

test('buildThumbGateSeoPlan returns GSD stages and prioritizes comparison pages first', () => {
  const plan = buildThumbGateSeoPlan();

  assert.equal(plan.framework, 'GSD');
  assert.equal(plan.capture.totalKeywords, HIGH_ROI_QUERY_SEEDS.length);
  assert.ok(plan.capture.keywordRows.every((row) => typeof row.opportunityScore === 'number'));
  assert.equal(plan.execute.pages.length, PAGE_BLUEPRINTS.length);
  assert.equal(plan.execute.briefs[0].path, '/compare/speclock');
  assert.equal(plan.execute.briefs[1].path, '/compare/mem0');
  assert.equal(plan.review.recommendedOrder[0], '/compare/speclock');
});

test('renderPlanMarkdown names all five GSD stages and page briefs', () => {
  const markdown = renderPlanMarkdown(buildThumbGateSeoPlan());

  assert.match(markdown, /## Capture/);
  assert.match(markdown, /## Clarify/);
  assert.match(markdown, /## Organize/);
  assert.match(markdown, /## Execute/);
  assert.match(markdown, /## Review/);
  assert.match(markdown, /ThumbGate vs SpecLock/);
  assert.match(markdown, /ThumbGate vs Mem0/);
  assert.match(markdown, /AI Agent Harness Optimization \| Progressive Disclosure \+ Pre-Action Checks/);
  assert.match(markdown, /Code Knowledge Graph Guardrails \| ThumbGate Guide/);
  assert.match(markdown, /Developer Machine Supply Chain Guardrails \| ThumbGate Guide/);
  assert.match(markdown, /Prompt Tricks Are Not Enough \| Turn AI Instructions Into Workflow Rules/);
  assert.match(markdown, /Semantic Programmatic SEO Guardrails \| ThumbGate Guide/);
  assert.match(markdown, /Proxy-Pointer RAG Guardrails \| Multimodal Answers Without Ungrounded Images/);
  assert.match(markdown, /RAG Precision Tuning Guardrails \| Stop Retrieval Regressions Before Agents Act/);
  assert.match(markdown, /SEO Agent Skills Guardrails \| Govern Workspaces, Proof, and Publish Gates/);
  assert.match(markdown, /ThumbGate vs Fallow \| Static Analysis vs Agent Action Enforcement/);
  assert.match(markdown, /Claude Code Skills Guardrails \| Turn Skillbooks Into Enforced Workflows/);
  assert.match(markdown, /Long-Running Agent Context Management \| Director Journals and Critic Reviews/);
  assert.match(markdown, /Reasoning Compression Guardrails \| Step-Level Verifier Checks Before Token Savings/);
  assert.match(markdown, /Authority Map/);
  assert.match(markdown, /Semantic Mesh/);
  assert.match(markdown, /Background Agent Governance \| Risk-Tiered Review for Agent PRs/);
  assert.match(markdown, /GPT-5\.5 Model Evaluation \| Benchmark Before Routing Expensive Agent Work/);
  assert.match(markdown, /AI Search Topical Presence \| Become the Obvious Recommendation/);
  assert.match(markdown, /Best Tools to Stop AI Agents From Breaking Production \| ThumbGate Listicle/);
  assert.match(markdown, /Relational Knowledge in AI Recommendations \| Why Brands Get Picked/);
  assert.match(markdown, /How to Stop AI Coding Agents From Repeating Mistakes \| ThumbGate/);
  assert.match(markdown, /Cursor Agent Guardrails \| Stop Repeated Mistakes with ThumbGate/);
  assert.match(markdown, /Roo Code Alternative: Migrating to Cline with Portable Lesson Memory/);
  assert.match(markdown, /Autoresearch Agent Safety \| Gates for Self-Improving Coding Agents/);
});

test('renderSeoPageHtml includes structured data, thumbs messaging, proof links, and the Pro CTA', () => {
  const page = findSeoPageByPath('/compare/speclock');
  const html = renderSeoPageHtml(page, { appOrigin: 'https://app.example.com' });

  assert.ok(page);
  assert.match(html, /"@type": "TechArticle"/);
  assert.match(html, /"@type": "FAQPage"/);
  assert.match(html, /https:\/\/app\.example\.com\/compare\/speclock/);
  assert.match(html, /👍 Thumbs up reinforces good behavior/);
  assert.match(html, /👎 Thumbs down blocks repeated mistakes/);
  assert.match(html, /Verification evidence/);
  assert.match(html, /Automation proof/);
  assert.match(html, /Go Pro — \$19\/mo/);
  assert.match(html, /\/checkout\/pro\?utm_source=website&amp;utm_medium=seo_page&amp;utm_campaign=compare_speclock&amp;cta_placement=seo_brief&amp;plan_id=pro/);
  assert.match(html, /ThumbGate vs SpecLock/);
});

test('page lookup and sitemap entries stay aligned', () => {
  const page = findSeoPageByPath('/guides/cursor-agent-guardrails');
  const sitemapEntry = THUMBGATE_SEO_SITEMAP_ENTRIES.find((entry) => entry.path === '/guides/cursor-agent-guardrails');

  assert.ok(page);
  assert.equal(page.pageType, 'integration');
  assert.deepEqual(sitemapEntry, {
    path: '/guides/cursor-agent-guardrails',
    changefreq: 'monthly',
    priority: '0.8',
  });
});

test('Autoresearch safety page is discoverable and commercially classified', () => {
  const page = findSeoPageByPath('/guides/autoresearch-agent-safety');
  const sitemapEntry = THUMBGATE_SEO_SITEMAP_ENTRIES.find((entry) => entry.path === '/guides/autoresearch-agent-safety');

  assert.ok(page);
  assert.equal(page.query, 'autoresearch agent safety');
  assert.equal(page.pageType, 'guide');
  assert.equal(page.pillar, 'pre-action-checks');
  assert.deepEqual(sitemapEntry, {
    path: '/guides/autoresearch-agent-safety',
    changefreq: 'monthly',
    priority: '0.8',
  });
});

test('agent harness optimization page is discoverable and commercially classified', () => {
  const page = findSeoPageByPath('/guides/agent-harness-optimization');
  const sitemapEntry = THUMBGATE_SEO_SITEMAP_ENTRIES.find((entry) => entry.path === '/guides/agent-harness-optimization');

  assert.ok(page);
  assert.equal(page.query, 'ai agent harness optimization');
  assert.equal(page.pageType, 'guide');
  assert.equal(page.pillar, 'pre-action-checks');
  assert.deepEqual(sitemapEntry, {
    path: '/guides/agent-harness-optimization',
    changefreq: 'monthly',
    priority: '0.8',
  });
});

test('code knowledge graph guardrails page is discoverable and commercially classified', () => {
  const page = findSeoPageByPath('/guides/code-knowledge-graph-guardrails');
  const sitemapEntry = THUMBGATE_SEO_SITEMAP_ENTRIES.find((entry) => entry.path === '/guides/code-knowledge-graph-guardrails');
  const html = renderSeoPageHtml(page, { appOrigin: 'https://app.example.com' });

  assert.ok(page);
  assert.equal(page.query, 'code knowledge graph guardrails');
  assert.equal(page.pageType, 'guide');
  assert.equal(page.pillar, 'pre-action-checks');
  assert.match(html, /Code Graphs Are Context/);
  assert.match(html, /npx thumbgate code-graph-guardrails/);
  assert.match(html, /Require diff impact before central edits/);
  assert.match(html, /ThumbGate decides what the agent is allowed to do next/);
  assert.deepEqual(sitemapEntry, {
    path: '/guides/code-knowledge-graph-guardrails',
    changefreq: 'monthly',
    priority: '0.8',
  });
});

test('developer machine supply chain guardrails page is discoverable and commercially classified', () => {
  const page = findSeoPageByPath('/guides/developer-machine-supply-chain-guardrails');
  const sitemapEntry = THUMBGATE_SEO_SITEMAP_ENTRIES.find((entry) => entry.path === '/guides/developer-machine-supply-chain-guardrails');
  const html = renderSeoPageHtml(page, { appOrigin: 'https://app.example.com' });

  assert.ok(page);
  assert.equal(page.query, 'developer machine supply chain guardrails');
  assert.equal(page.pageType, 'guide');
  assert.equal(page.pillar, 'pre-action-checks');
  assert.match(html, /Stop AI Assistants From Amplifying Supply-Chain Attacks/);
  assert.match(html, /Block package lifecycle secret harvest/);
  assert.match(html, /Secrets scanners tell you what leaked/);
  assert.deepEqual(sitemapEntry, {
    path: '/guides/developer-machine-supply-chain-guardrails',
    changefreq: 'monthly',
    priority: '0.8',
  });
});

test('prompt tricks to workflow rules page is discoverable and commercially classified', () => {
  const page = findSeoPageByPath('/guides/prompt-tricks-to-workflow-rules');
  const sitemapEntry = THUMBGATE_SEO_SITEMAP_ENTRIES.find((entry) => entry.path === '/guides/prompt-tricks-to-workflow-rules');
  const html = renderSeoPageHtml(page, { appOrigin: 'https://app.example.com' });

  assert.ok(page);
  assert.equal(page.query, 'prompt tricks to workflow rules');
  assert.equal(page.pageType, 'guide');
  assert.equal(page.pillar, 'pre-action-checks');
  assert.match(html, /Prompt Tricks Are Table Stakes/);
  assert.match(html, /clear rules, examples, and pre-action checks/);
  assert.match(html, /Do not rely on politeness, threats, flattery, or roleplay/);
  assert.deepEqual(sitemapEntry, {
    path: '/guides/prompt-tricks-to-workflow-rules',
    changefreq: 'monthly',
    priority: '0.8',
  });
});

test('semantic programmatic SEO guardrails page is discoverable and commercially classified', () => {
  const page = findSeoPageByPath('/guides/semantic-programmatic-seo-guardrails');
  const sitemapEntry = THUMBGATE_SEO_SITEMAP_ENTRIES.find((entry) => entry.path === '/guides/semantic-programmatic-seo-guardrails');
  const html = renderSeoPageHtml(page, { appOrigin: 'https://app.example.com' });

  assert.ok(page);
  assert.equal(page.query, 'semantic programmatic seo guardrails');
  assert.equal(page.pageType, 'guide');
  assert.equal(page.pillar, 'seo-governance');
  assert.match(html, /Semantic pSEO Needs Governance Before Scale/);
  assert.match(html, /Authority map before page generation/);
  assert.match(html, /Brand context governance before drafting/);
  assert.match(html, /Semantic mesh links before publish/);
  assert.match(html, /Technical guardian checks before crawl/);
  assert.deepEqual(sitemapEntry, {
    path: '/guides/semantic-programmatic-seo-guardrails',
    changefreq: 'monthly',
    priority: '0.8',
  });
});

test('semantic pSEO plan includes authority map, context governance, mesh, and technical guardian', () => {
  const plan = buildThumbGateSeoPlan();
  const semanticCluster = plan.organize.authorityMap.find((entry) => entry.pillar === 'seo-governance');
  const semanticPage = plan.organize.semanticMesh.find((entry) => entry.path === '/guides/semantic-programmatic-seo-guardrails');

  assert.ok(semanticCluster);
  assert.equal(semanticCluster.rankPermission, 'expand');
  assert.ok(semanticCluster.proofPages.includes('/guides/semantic-programmatic-seo-guardrails'));
  assert.match(plan.clarify.contextGovernance.brandPersona, /enforcement layer/);
  assert.ok(plan.clarify.contextGovernance.negativeConstraints.some((item) => /Do not create find-and-replace pages/.test(item)));
  assert.ok(semanticPage);
  assert.equal(semanticPage.meshStatus, 'healthy');
  assert.equal(plan.review.technicalGuardian.publishBlockers.length, 0);
});

test('semantic pSEO helpers are usable by revenue automation', () => {
  const page = findSeoPageByPath('/guides/semantic-programmatic-seo-guardrails');
  const pages = buildThumbGateSeoPlan().execute.pages;
  const rows = [
    { query: 'semantic programmatic seo guardrails', businessValue: 94, source: 'test' },
  ].map((row, index) => ({
    ...row,
    intent: 'commercial',
    pillar: 'seo-governance',
    persona: 'growth-engineer',
    pageType: 'guide',
    opportunityScore: 82 + index,
  }));
  const contextGovernance = buildContextGovernance();
  const authorityMap = buildAuthorityMap(rows, [page]);
  const semanticMesh = buildSemanticMesh(pages);
  const technicalGuardian = buildTechnicalGuardian([page]);

  assert.equal(authorityMap[0].rankPermission, 'expand');
  assert.match(contextGovernance.requiredContext.join(' '), /verification evidence/);
  assert.equal(semanticMesh.find((entry) => entry.path === page.path).meshStatus, 'healthy');
  assert.deepEqual(technicalGuardian.publishBlockers, []);
});

test('document RAG and retrieval precision pages are discoverable and commercially classified', () => {
  const proxyPointer = findSeoPageByPath('/guides/proxy-pointer-rag-guardrails');
  const precision = findSeoPageByPath('/guides/rag-precision-tuning-guardrails');
  const proxyHtml = renderSeoPageHtml(proxyPointer, { appOrigin: 'https://app.example.com' });
  const precisionHtml = renderSeoPageHtml(precision, { appOrigin: 'https://app.example.com' });

  assert.ok(proxyPointer);
  assert.equal(proxyPointer.query, 'proxy pointer rag guardrails');
  assert.equal(proxyPointer.pillar, 'document-rag-safety');
  assert.match(proxyHtml, /npx thumbgate proxy-pointer-rag-guardrails/);
  assert.match(proxyHtml, /Document RAG Safety gates/);
  assert.ok(precision);
  assert.equal(precision.query, 'rag precision tuning guardrails');
  assert.equal(precision.pillar, 'document-rag-safety');
  assert.match(precisionHtml, /npx thumbgate rag-precision-guardrails/);
  assert.match(precisionHtml, /Retrieval baseline before tuning/);
});

test('internal AI engineering stack page is discoverable and commercially classified', () => {
  const page = findSeoPageByPath('/guides/internal-ai-engineering-stack-guardrails');
  const sitemapEntry = THUMBGATE_SEO_SITEMAP_ENTRIES.find((entry) => entry.path === '/guides/internal-ai-engineering-stack-guardrails');
  const html = renderSeoPageHtml(page, { appOrigin: 'https://app.example.com' });

  assert.ok(page);
  assert.equal(page.query, 'internal ai engineering stack guardrails');
  assert.equal(page.pageType, 'guide');
  assert.equal(page.pillar, 'ai-stack-governance');
  assert.deepEqual(sitemapEntry, {
    path: '/guides/internal-ai-engineering-stack-guardrails',
    changefreq: 'monthly',
    priority: '0.8',
  });
  assert.match(html, /Internal AI Engineering Stacks Need Pre-Action Enforcement/);
  assert.match(html, /npx thumbgate ai-engineering-stack-guardrails/);
  assert.match(html, /AI gateway gate/);
  assert.match(html, /MCP portal gate/);
  assert.match(html, /LLM wiki/);
  assert.match(html, /Background agent sandbox gate/);
});

test('skills, context, Fallow, and reasoning pages are discoverable', () => {
  const seoSkills = findSeoPageByPath('/guides/seo-agent-skills-guardrails');
  const fallow = findSeoPageByPath('/compare/fallow');
  const claudeSkills = findSeoPageByPath('/guides/claude-code-skills-guardrails');
  const context = findSeoPageByPath('/guides/long-running-agent-context-management');
  const reasoning = findSeoPageByPath('/guides/reasoning-compression-guardrails');
  const deepseek = findSeoPageByPath('/guides/deepseek-v4-runtime-guardrails');

  assert.equal(seoSkills.pillar, 'seo-governance');
  assert.equal(fallow.pageType, 'comparison');
  assert.equal(claudeSkills.pillar, 'agent-workflows');
  assert.equal(context.pillar, 'pre-action-checks');
  assert.equal(reasoning.pillar, 'pre-action-checks');
  assert.equal(deepseek.pillar, 'pre-action-checks');
  assert.match(renderSeoPageHtml(fallow, { appOrigin: 'https://app.example.com' }), /Fallow finds JS\/TS code health issues/);
  assert.match(renderSeoPageHtml(context, { appOrigin: 'https://app.example.com' }), /npx thumbgate long-running-agent-context-guardrails/);
  assert.match(renderSeoPageHtml(reasoning, { appOrigin: 'https://app.example.com' }), /npx thumbgate reasoning-efficiency-guardrails/);
  assert.match(renderSeoPageHtml(deepseek, { appOrigin: 'https://app.example.com' }), /npx thumbgate deepseek-v4-runtime-guardrails/);
});

test('background agent governance page is discoverable and commercially classified', () => {
  const page = findSeoPageByPath('/guides/background-agent-governance');
  const sitemapEntry = THUMBGATE_SEO_SITEMAP_ENTRIES.find((entry) => entry.path === '/guides/background-agent-governance');
  const html = renderSeoPageHtml(page, { appOrigin: 'https://app.example.com' });

  assert.ok(page);
  assert.equal(page.query, 'background agent governance');
  assert.equal(page.pageType, 'guide');
  assert.equal(page.pillar, 'pre-action-checks');
  assert.deepEqual(sitemapEntry, {
    path: '/guides/background-agent-governance',
    changefreq: 'monthly',
    priority: '0.8',
  });
  assert.match(html, /Background Agent Governance/);
  assert.match(html, /npx thumbgate background-governance --json/);
  assert.match(html, /risk-tiered review/i);
});

test('AI agent governance sprint page routes bottom-funnel buyers into Team intake', () => {
  const page = findSeoPageByPath('/guides/ai-agent-governance-sprint');
  const sitemapEntry = THUMBGATE_SEO_SITEMAP_ENTRIES.find((entry) => entry.path === '/guides/ai-agent-governance-sprint');
  const html = renderSeoPageHtml(page, { appOrigin: 'https://app.example.com' });

  assert.ok(page);
  assert.equal(page.query, 'ai agent governance sprint');
  assert.equal(page.intent, 'commercial');
  assert.equal(page.pageType, 'guide');
  assert.equal(page.pillar, 'pre-action-checks');
  assert.deepEqual(sitemapEntry, {
    path: '/guides/ai-agent-governance-sprint',
    changefreq: 'monthly',
    priority: '0.8',
  });
  assert.match(html, /AI Agent Governance Sprint/);
  assert.match(html, /48-hour Workflow Hardening Sprint/);
  assert.match(html, /npx thumbgate background-governance --check --json/);
  assert.match(html, /workflow-sprint-intake/);
});

test('GPT-5.5 model evaluation page is discoverable and commercially classified', () => {
  const page = findSeoPageByPath('/guides/gpt-5-5-model-evaluation');
  const sitemapEntry = THUMBGATE_SEO_SITEMAP_ENTRIES.find((entry) => entry.path === '/guides/gpt-5-5-model-evaluation');
  const html = renderSeoPageHtml(page, { appOrigin: 'https://app.example.com' });

  assert.ok(page);
  assert.equal(page.query, 'gpt-5.5 model evaluation');
  assert.equal(page.pageType, 'guide');
  assert.equal(page.pillar, 'pre-action-checks');
  assert.deepEqual(sitemapEntry, {
    path: '/guides/gpt-5-5-model-evaluation',
    changefreq: 'monthly',
    priority: '0.8',
  });
  assert.match(html, /GPT-5\.5 Model Evaluation/);
  assert.match(html, /npx thumbgate model-candidates --workload=dashboard-analysis --provider=openai --json/);
  assert.match(html, /chart-spec validity/i);
});

test('Roo to Cline migration page is discoverable and commercially classified', () => {
  const page = findSeoPageByPath('/guides/roo-code-alternative-cline');
  const sitemapEntry = THUMBGATE_SEO_SITEMAP_ENTRIES.find((entry) => entry.path === '/guides/roo-code-alternative-cline');

  assert.ok(page);
  assert.equal(page.query, 'roo code alternative cline');
  assert.equal(page.pageType, 'integration');
  assert.equal(page.pillar, 'agent-workflows');
  assert.deepEqual(sitemapEntry, {
    path: '/guides/roo-code-alternative-cline',
    changefreq: 'monthly',
    priority: '0.8',
  });
});

test('browser automation safety page is discoverable and commercially classified', () => {
  const page = findSeoPageByPath('/guides/browser-automation-safety');
  const sitemapEntry = THUMBGATE_SEO_SITEMAP_ENTRIES.find((entry) => entry.path === '/guides/browser-automation-safety');

  assert.ok(page);
  assert.equal(page.query, 'browser automation safety');
  assert.equal(page.pageType, 'guide');
  assert.equal(page.pillar, 'pre-action-checks');
  assert.deepEqual(sitemapEntry, {
    path: '/guides/browser-automation-safety',
    changefreq: 'monthly',
    priority: '0.8',
  });
});

test('AI search topical presence page is discoverable and commercially classified', () => {
  const page = findSeoPageByPath('/guides/ai-search-topical-presence');
  const sitemapEntry = THUMBGATE_SEO_SITEMAP_ENTRIES.find((entry) => entry.path === '/guides/ai-search-topical-presence');

  assert.ok(page);
  assert.equal(page.query, 'ai search topical presence');
  assert.equal(page.pageType, 'guide');
  assert.equal(page.pillar, 'pre-action-checks');
  assert.deepEqual(sitemapEntry, {
    path: '/guides/ai-search-topical-presence',
    changefreq: 'monthly',
    priority: '0.8',
  });
});

test('AI agent production listicle is discoverable and commercially classified', () => {
  const page = findSeoPageByPath('/guides/best-tools-stop-ai-agents-breaking-production');
  const sitemapEntry = THUMBGATE_SEO_SITEMAP_ENTRIES.find((entry) => entry.path === '/guides/best-tools-stop-ai-agents-breaking-production');
  const html = renderSeoPageHtml(page, { appOrigin: 'https://app.example.com' });

  assert.ok(page);
  assert.equal(page.query, 'best tools to stop ai agents from breaking production');
  assert.equal(page.pageType, 'guide');
  assert.equal(page.pillar, 'pre-action-checks');
  assert.match(html, /Claude Code, Cursor, Codex, Gemini/);
  assert.match(html, /Environment inspection requirements/);
  assert.match(html, /Parallel branch budgets/);
  assert.match(html, /AEO fuel/);
  assert.deepEqual(sitemapEntry, {
    path: '/guides/best-tools-stop-ai-agents-breaking-production',
    changefreq: 'monthly',
    priority: '0.8',
  });
});

test('native messaging host security page is discoverable and commercially classified', () => {
  const page = findSeoPageByPath('/guides/native-messaging-host-security');
  const sitemapEntry = THUMBGATE_SEO_SITEMAP_ENTRIES.find((entry) => entry.path === '/guides/native-messaging-host-security');

  assert.ok(page);
  assert.equal(page.query, 'native messaging host security');
  assert.equal(page.pageType, 'guide');
  assert.equal(page.pillar, 'pre-action-checks');
  assert.deepEqual(sitemapEntry, {
    path: '/guides/native-messaging-host-security',
    changefreq: 'monthly',
    priority: '0.8',
  });
});

test('relational knowledge page is discoverable and commercially classified', () => {
  const page = findSeoPageByPath('/guides/relational-knowledge-ai-recommendations');
  const sitemapEntry = THUMBGATE_SEO_SITEMAP_ENTRIES.find((entry) => entry.path === '/guides/relational-knowledge-ai-recommendations');

  assert.ok(page);
  assert.equal(page.query, 'relational knowledge ai recommendations');
  assert.equal(page.pageType, 'guide');
  assert.equal(page.pillar, 'pre-action-checks');
  assert.deepEqual(sitemapEntry, {
    path: '/guides/relational-knowledge-ai-recommendations',
    changefreq: 'monthly',
    priority: '0.8',
  });
});

test('writePlanOutputs persists machine-readable GSD artifacts', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-gsd-outputs-'));

  try {
    const files = writePlanOutputs(buildThumbGateSeoPlan(), tmpDir);

    assert.deepEqual(Object.keys(files).sort(), ['capture', 'clarify', 'execute', 'organize', 'pages', 'review']);
    for (const filePath of Object.values(files)) {
      assert.ok(fs.existsSync(filePath), `${filePath} should exist`);
    }

    const capture = JSON.parse(fs.readFileSync(files.capture, 'utf8'));
    const pages = JSON.parse(fs.readFileSync(files.pages, 'utf8'));
    const execute = fs.readFileSync(files.execute, 'utf8');

    assert.equal(capture.totalKeywords, HIGH_ROI_QUERY_SEEDS.length);
    assert.equal(pages.length, PAGE_BLUEPRINTS.length);
    assert.ok(pages.some((page) => page.path === '/guides/agent-harness-optimization'));
    assert.ok(pages.some((page) => page.path === '/guides/code-knowledge-graph-guardrails'));
    assert.ok(pages.some((page) => page.path === '/guides/developer-machine-supply-chain-guardrails'));
    assert.ok(pages.some((page) => page.path === '/guides/prompt-tricks-to-workflow-rules'));
    assert.ok(pages.some((page) => page.path === '/guides/proxy-pointer-rag-guardrails'));
    assert.ok(pages.some((page) => page.path === '/guides/rag-precision-tuning-guardrails'));
    assert.ok(pages.some((page) => page.path === '/guides/seo-agent-skills-guardrails'));
    assert.ok(pages.some((page) => page.path === '/compare/fallow'));
    assert.ok(pages.some((page) => page.path === '/guides/claude-code-skills-guardrails'));
    assert.ok(pages.some((page) => page.path === '/guides/long-running-agent-context-management'));
    assert.ok(pages.some((page) => page.path === '/guides/reasoning-compression-guardrails'));
    assert.ok(pages.some((page) => page.path === '/guides/background-agent-governance'));
    assert.ok(pages.some((page) => page.path === '/guides/ai-agent-governance-sprint'));
    assert.ok(pages.some((page) => page.path === '/guides/gpt-5-5-model-evaluation'));
    assert.ok(pages.some((page) => page.path === '/guides/ai-search-topical-presence'));
    assert.ok(pages.some((page) => page.path === '/guides/best-tools-stop-ai-agents-breaking-production'));
    assert.ok(pages.some((page) => page.path === '/guides/relational-knowledge-ai-recommendations'));
    assert.ok(pages.some((page) => page.path === '/guides/codex-cli-guardrails'));
    assert.ok(pages.some((page) => page.path === '/guides/gemini-cli-feedback-memory'));
    assert.ok(pages.some((page) => page.path === '/guides/roo-code-alternative-cline'));
    assert.ok(pages.some((page) => page.path === '/guides/browser-automation-safety'));
    assert.ok(pages.some((page) => page.path === '/guides/native-messaging-host-security'));
    assert.ok(pages.some((page) => page.path === '/guides/autoresearch-agent-safety'));
    assert.match(execute, /# ThumbGate SEO\/GEO GSD Plan/);
    assert.match(execute, /Recommended publish order/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
