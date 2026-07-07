'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const pagePath = path.join(ROOT, 'public', 'learn', 'token-economics-finops-agentic-ai.html');
const learnHubPath = path.join(ROOT, 'public', 'learn.html');
const serverPath = path.join(ROOT, 'src', 'api', 'server.js');
const llmsTxtPath = path.join(ROOT, 'public', 'llms.txt');

function readPage() {
  return fs.readFileSync(pagePath, 'utf8');
}

test('token economics GEO page exists with answer-first positioning', () => {
  const html = readPage();

  assert.match(html, /Token Economics: The New FinOps for Agentic AI/);
  assert.match(html, /token economics is the new FinOps for agentic AI/i);
  assert.match(html, /repeated <em>behavior<\/em>/);
  assert.match(html, /the only zero-token model call is the one that never happens/i);
  assert.match(html, /behavioral deduplication/i);
});

test('token economics page cites the Microsoft source and companion project', () => {
  const html = readPage();

  assert.match(html, /techcommunity\.microsoft\.com\/blog\/azuredevcommunityblog\/token-economics-the-new-finops-for-agentic-ai\/4533743/);
  assert.match(html, /EvalAgentic/);
  assert.match(html, /GitHub AI Credits/);
  assert.match(html, /budget incident/);
});

test('token economics page exposes TechArticle and FAQPage schema with canonical URL', () => {
  const html = readPage();

  assert.match(html, /"@type": "TechArticle"/);
  assert.match(html, /"@type": "FAQPage"/);
  assert.match(html, /rel="canonical"\s+href="https:\/\/thumbgate\.ai\/learn\/token-economics-finops-agentic-ai"/);
  assert.match(html, /data-domain="thumbgate\.ai"/);
});

test('token economics page states budget enforcement honestly (advisory by default, opt-in strict)', () => {
  const html = readPage();

  assert.match(html, /advisory by default/i);
  assert.match(html, /THUMBGATE_BUDGET_ENFORCE=1/);
  assert.match(html, /it records, it does not silently block/i);
  assert.match(html, /Claude Code and OpenAI Codex CLI/);
  // Never claim default hard caps or instant shutdowns.
  assert.doesNotMatch(html, /instant(ly)? (shutdown|halts)/i);
  assert.doesNotMatch(html, /hard-?caps? by default/i);
});

test('token economics page avoids fake scarcity and unverified compliance claims', () => {
  const html = readPage();

  assert.doesNotMatch(html, /spots remaining|founding members|guaranteed ROI|money-back guarantee/i);
  assert.doesNotMatch(html, /SOC 2|HIPAA|GDPR DPA/i);
});

test('learn hub links the token economics GEO asset', () => {
  const html = fs.readFileSync(learnHubPath, 'utf8');

  assert.match(html, /\/learn\/token-economics-finops-agentic-ai/);
  assert.match(html, /Token Economics/);
});

test('sitemap and llms.txt expose the token economics page for crawlers and answer engines', () => {
  const server = fs.readFileSync(serverPath, 'utf8');
  const llms = fs.readFileSync(llmsTxtPath, 'utf8');

  assert.match(server, /\/learn\/token-economics-finops-agentic-ai/);
  assert.match(llms, /https:\/\/thumbgate\.ai\/learn\/token-economics-finops-agentic-ai/);
});
