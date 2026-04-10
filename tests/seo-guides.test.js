'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const GUIDE_FILES = [
  'guides/pre-action-gates.html',
  'guides/stop-repeated-ai-agent-mistakes.html',
  'guides/claude-code-prevent-repeated-mistakes.html',
  'guides/cursor-prevent-repeated-mistakes.html',
  'guides/codex-cli-guardrails.html',
];

const COMPARE_FILES = [
  'compare/speclock.html',
  'compare/mem0.html',
];

const ALL_FILES = [...GUIDE_FILES, ...COMPARE_FILES];

describe('SEO guide and comparison pages', () => {
  it('all 7 HTML files exist', () => {
    for (const file of ALL_FILES) {
      const fullPath = path.join(PUBLIC_DIR, file);
      assert.ok(fs.existsSync(fullPath), `Missing file: ${file}`);
    }
    assert.equal(ALL_FILES.length, 7);
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

      it('mentions the founding member deal', () => {
        html = html || fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf-8');
        assert.ok(
          html.includes('$49') || html.includes('Founding Member'),
          `${file} missing founding member deal`
        );
      });
    });
  }
});
