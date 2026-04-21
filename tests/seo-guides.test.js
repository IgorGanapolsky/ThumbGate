'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const GUIDE_FILES = [
  'guides/pre-action-gates.html',
  'guides/agent-harness-optimization.html',
  'guides/openai-agents-sdk-guardrails.html',
  'guides/codex-chronicle-memory-guardrails.html',
  'guides/cloudflare-sandbox-ai-coding-agents.html',
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
  it('all 12 HTML files exist', () => {
    for (const file of ALL_FILES) {
      const fullPath = path.join(PUBLIC_DIR, file);
      assert.ok(fs.existsSync(fullPath), `Missing file: ${file}`);
    }
    assert.equal(ALL_FILES.length, 12);
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

  it('Cloudflare Sandbox guide links machine-readable sandbox proof', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/cloudflare-sandbox-ai-coding-agents.html'),
      'utf-8'
    );

    assert.ok(
      html.includes('proof/cloudflare-sandbox-report.json'),
      'Cloudflare sandbox guide should link machine-readable sandbox proof'
    );
  });

  it('Codex Chronicle guide links machine-readable local intelligence proof', () => {
    const html = fs.readFileSync(
      path.join(PUBLIC_DIR, 'guides/codex-chronicle-memory-guardrails.html'),
      'utf-8'
    );

    assert.ok(
      html.includes('proof/local-intelligence-report.json'),
      'Codex Chronicle guide should link machine-readable local intelligence proof'
    );
  });
});
