'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE_PATH = path.resolve(__dirname, '../public/enterprise-governance.html');

test('enterprise-governance: HTML file exists and is valid', () => {
  assert.ok(fs.existsSync(PAGE_PATH), 'public/enterprise-governance.html must exist');
  const html = fs.readFileSync(PAGE_PATH, 'utf8');
  assert.ok(html.length > 1000);
});

test('enterprise-governance: contains required enterprise sentinels', () => {
  const html = fs.readFileSync(PAGE_PATH, 'utf8');
  assert.match(html, /Gemini at Work/i);
  assert.match(html, /Vertex AI/i);
  assert.match(html, /Pre-Action Interdiction/i);
  assert.match(html, /ActiveSaddler/i);
  assert.match(html, /NIST SP 800-53/i);
});

test('enterprise-governance: contains valid JSON-LD schemas', () => {
  const html = fs.readFileSync(PAGE_PATH, 'utf8');
  const scriptRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  const matches = [...html.matchAll(scriptRegex)];
  assert.ok(matches.length >= 2, 'Expected at least 2 JSON-LD blocks (SoftwareApplication, FAQPage)');

  for (const match of matches) {
    const jsonStr = match[1].trim();
    const parsed = JSON.parse(jsonStr);
    assert.ok(parsed['@context']);
    assert.ok(parsed['@type']);
  }
});
