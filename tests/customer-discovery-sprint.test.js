'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DOC_PATH = path.join(__dirname, '..', 'docs', 'CUSTOMER_DISCOVERY_SPRINT.md');
const DOC = fs.readFileSync(DOC_PATH, 'utf8');
const MARKETING_DIR = path.join(__dirname, '..', 'docs', 'marketing');
const EXPECTED_ARTIFACTS = [
  'gtm-revenue-loop.md',
  'gtm-revenue-loop.json',
  'gtm-marketplace-copy.md',
  'gtm-marketplace-copy.json',
  'gtm-target-queue.csv',
  'gtm-target-queue.jsonl',
  'team-outreach-messages.md',
  'operator-priority-handoff.md',
  'operator-priority-handoff.json',
  'operator-send-now.md',
  'operator-send-now.csv',
  'operator-send-now.json',
  'claude-workflow-hardening-pack.md',
  'claude-workflow-hardening-pack.json',
  'cursor-marketplace-revenue-pack.md',
  'cursor-marketplace-revenue-pack.json',
  'cursor-marketplace-surfaces.csv',
  'chatgpt-gpt-revenue-pack.md',
  'chatgpt-gpt-revenue-pack.json',
  'chatgpt-gpt-operator-queue.csv',
  'codex-plugin-revenue-pack.md',
  'codex-plugin-revenue-pack.json',
  'codex-plugin-surfaces.csv',
  'codex-marketplace-revenue-pack.md',
  'codex-marketplace-revenue-pack.json',
  'codex-operator-queue.csv',
  'gemini-cli-demand-pack.md',
  'gemini-cli-demand-pack.json',
  'gemini-cli-operator-queue.csv',
  'roo-sunset-demand-pack.md',
  'roo-sunset-demand-pack.json',
  'roo-sunset-operator-queue.csv',
  'roo-sunset-channel-drafts.csv',
  'linkedin-workflow-hardening-pack.md',
  'linkedin-workflow-hardening-pack.json',
  'linkedin-operator-queue.csv',
  'mcp-directory-revenue-pack.md',
  'mcp-directory-revenue-pack.json',
  'mcp-directory-operator-queue.csv',
];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('customer discovery sprint doc stays aligned with the revenue-loop artifact surface', () => {
  assert.doesNotMatch(DOC, /emits twenty operator artifacts/i);
  assert.match(DOC, /docs\/marketing\/gtm-revenue-loop\.json/);
  assert.match(DOC, /docs\/marketing\//);

  for (const artifact of EXPECTED_ARTIFACTS) {
    assert.match(
      DOC,
      new RegExp(`\`${escapeRegExp(artifact)}\``),
      `Expected ${artifact} to be documented in ${DOC_PATH}`,
    );
  }
});

test('documented operator artifacts exist in docs/marketing for the checked-in revenue loop', () => {
  for (const artifact of EXPECTED_ARTIFACTS) {
    assert.equal(
      fs.existsSync(path.join(MARKETING_DIR, artifact)),
      true,
      `Expected checked-in operator artifact ${artifact} in ${MARKETING_DIR}`,
    );
  }
});
