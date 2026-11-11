const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  REQUIRED_ISSUE_FIELDS,
  REQUIRED_PR_SECTIONS,
  REQUIRED_PROOF_COMMANDS,
  REQUIRED_WORKFLOW_HEADINGS,
  extractFrontMatter,
  runWorkflowContractValidation,
} = require('../scripts/validate-workflow-contract');

const PROJECT_ROOT = path.join(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

test('workflow contract validation passes for tracked repo files', () => {
  const result = runWorkflowContractValidation({ projectRoot: PROJECT_ROOT });

  assert.equal(result.ok, true, result.issues.join('\n'));
  assert.deepEqual(result.issues, []);
});

test('WORKFLOW.md front matter and headings stay complete', () => {
  const workflowText = readText('WORKFLOW.md');
  const extracted = extractFrontMatter(workflowText);

  assert.equal(extracted.ok, true);

  REQUIRED_WORKFLOW_HEADINGS.forEach((heading) => {
    assert.match(extracted.body, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  REQUIRED_PROOF_COMMANDS.forEach((command) => {
    assert.match(extracted.body, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});

test('ready-for-agent issue template includes required fields', () => {
  const templateText = readText(path.join('.github', 'ISSUE_TEMPLATE', 'ready-for-agent.yml'));

  REQUIRED_ISSUE_FIELDS.forEach((fieldId) => {
    assert.match(templateText, new RegExp(`id: ${fieldId}`));
  });

  REQUIRED_PROOF_COMMANDS.forEach((command) => {
    assert.match(templateText, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});

test('pull request template includes required proof sections', () => {
  const templateText = readText(path.join('.github', 'pull_request_template.md'));

  REQUIRED_PR_SECTIONS.forEach((section) => {
    assert.match(templateText, new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  REQUIRED_PROOF_COMMANDS.forEach((command) => {
    assert.match(templateText, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});

test('Claude Code Review workflow runs once on ready_for_review and skips trunk-merge/* and dependabot', () => {
  const raw = readText(path.join('.github', 'workflows', 'claude-code-review.yml'));

  assert.match(raw, /pull_request:\s*\n\s*types:\s*\[ready_for_review\]/);
  assert.doesNotMatch(raw, /types:\s*\[[^\]]*synchronize[^\]]*\]/);
  assert.match(raw, /!startsWith\(github\.head_ref,\s*'trunk-merge\/'\)/);
  assert.match(raw, /!github\.event\.pull_request\.draft/);
  assert.match(raw, /dependabot\[bot\]/);
});

test('.coderabbit.yaml disables CodeRabbit auto-review noise', () => {
  const raw = readText('.coderabbit.yaml');

  assert.match(raw, /auto_review:\s*\n\s*enabled:\s*false/);
  assert.match(raw, /drafts:\s*false/);
  assert.match(raw, /high_level_summary:\s*false/);
  assert.match(raw, /auto_reply:\s*false/);
});
