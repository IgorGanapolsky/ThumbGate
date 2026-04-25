'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const GUIDE_FILES = [
  'guides/pre-action-checks.html',
  'guides/agent-harness-optimization.html',
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
];

const ALL_FILES = [...GUIDE_FILES, ...COMPARE_FILES];

describe('SEO guide and comparison pages', () => {
  it('all 15 HTML files exist', () => {
    for (const file of ALL_FILES) {
      const fullPath = path.join(PUBLIC_DIR, file);
      assert.ok(fs.existsSync(fullPath), `Missing file: ${file}`);
    }
    assert.equal(ALL_FILES.length, 15);
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
