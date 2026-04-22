const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const integrationsPath = path.join(root, 'public', 'integrations.html');
const useCasesPath = path.join(root, 'public', 'use-cases.html');
const landingPath = path.join(root, 'public', 'index.html');
const serverPath = path.join(root, 'src', 'api', 'server.js');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('integrations hub exposes collection and FAQ schema plus core integration links', () => {
  const html = read(integrationsPath);

  assert.match(html, /"@type": "CollectionPage"/);
  assert.match(html, /"@type": "FAQPage"/);
  assert.match(html, /ThumbGate Integrations/);
  assert.match(html, /\/guides\/claude-code-feedback/);
  assert.match(html, /\/guides\/cursor-agent-guardrails/);
  assert.match(html, /\/guides\/codex-cli-guardrails/);
  assert.match(html, /\/guides\/gemini-cli-feedback-memory/);
  assert.match(html, /\/guide/);
  assert.match(html, /\/use-cases/);
});

test('use-cases hub exposes collection and FAQ schema plus problem-led links', () => {
  const html = read(useCasesPath);

  assert.match(html, /"@type": "CollectionPage"/);
  assert.match(html, /"@type": "FAQPage"/);
  assert.match(html, /ThumbGate Use Cases/);
  assert.match(html, /\/guides\/stop-repeated-ai-agent-mistakes/);
  assert.match(html, /\/guides\/pre-action-gates/);
  assert.match(html, /\/guides\/autoresearch-agent-safety/);
  assert.match(html, /\/learn\/stop-ai-agent-force-push/);
  assert.match(html, /\/learn\/ai-agent-persistent-memory/);
  assert.match(html, /\/integrations/);
});

test('landing page links to integrations and use-case hubs and includes organization schema', () => {
  const html = read(landingPath);

  assert.match(html, /"@type": "Organization"/);
  assert.match(html, /href="\/integrations"/);
  assert.match(html, /href="\/use-cases"/);
  assert.match(html, /Agent-specific landing pages/);
  assert.match(html, /Problem-led pages for commercial intent/);
});

test('server exposes integrations and use-cases marketing routes', () => {
  const src = read(serverPath);

  assert.match(src, /INTEGRATIONS_PAGE_PATH/);
  assert.match(src, /USE_CASES_PAGE_PATH/);
  assert.match(src, /pathname === '\/integrations'/);
  assert.match(src, /pathname === '\/use-cases'/);
  assert.match(src, /pageType: 'integrations_hub'/);
  assert.match(src, /pageType: 'use_cases_hub'/);
  assert.match(src, /'\/integrations'/);
  assert.match(src, /'\/use-cases'/);
});
