#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.join(__dirname, '..');
const WORKFLOW_PATH = path.join(PROJECT_ROOT, 'WORKFLOW.md');
const ISSUE_TEMPLATE_PATH = path.join(PROJECT_ROOT, '.github', 'ISSUE_TEMPLATE', 'ready-for-agent.yml');
const PR_TEMPLATE_PATH = path.join(PROJECT_ROOT, '.github', 'pull_request_template.md');
const README_PATH = path.join(PROJECT_ROOT, 'README.md');

const REQUIRED_WORKFLOW_HEADINGS = [
  '## Scope',
  '## Hard Stops',
  '## Required Proof of Work',
  '## Implementation Rules',
  '## Done Means',
  '## Handoff Format',
];

const REQUIRED_PROOF_COMMANDS = [
  'npm test',
  'npm run test:coverage',
  'npm run prove:adapters',
  'npm run prove:automation',
  'npm run self-heal:check',
];

const REQUIRED_ISSUE_FIELDS = [
  'business_outcome',
  'problem',
  'in_scope',
  'out_of_scope',
  'acceptance_criteria',
  'proof_commands',
];

const REQUIRED_PR_SECTIONS = [
  '## What Changed',
  '## Why',
  '## Verification',
  '## Evidence',
  '## Risks',
];

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function extractFrontMatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return {
      ok: false,
      frontMatter: '',
      body: '',
      error: 'WORKFLOW.md must start with YAML front matter wrapped in --- markers.',
    };
  }

  return {
    ok: true,
    frontMatter: match[1],
    body: match[2].trim(),
    error: null,
  };
}

function hasLine(text, pattern) {
  return pattern.test(text);
}

function collectMatches(text, entries, matcher) {
  return entries.filter((entry) => matcher(text, entry));
}

function validateWorkflowFile(text) {
  const issues = [];
  const extracted = extractFrontMatter(text);
  const result = {
    headingsFound: [],
    proofCommandsFound: [],
  };

  if (!extracted.ok) {
    issues.push(extracted.error);
    return { issues, details: result };
  }

  const frontMatter = extracted.frontMatter;
  const body = extracted.body;

  const requiredFrontMatterPatterns = [
    { label: 'tracker block', pattern: /^tracker:\s*$/m },
    { label: 'linear tracker kind', pattern: /^\s*kind:\s*linear\s*$/m },
    { label: 'project_slug', pattern: /^\s*project_slug:\s*.+$/m },
    { label: 'workspace block', pattern: /^workspace:\s*$/m },
    { label: 'workspace root', pattern: /^\s*root:\s*.+$/m },
    { label: 'hooks block', pattern: /^hooks:\s*$/m },
    { label: 'after_create hook', pattern: /^\s*after_create:\s*\|/m },
    { label: 'before_run hook', pattern: /^\s*before_run:\s*\|/m },
    { label: 'after_run hook', pattern: /^\s*after_run:\s*\|/m },
    { label: 'agent block', pattern: /^agent:\s*$/m },
    { label: 'max_concurrent_agents', pattern: /^\s*max_concurrent_agents:\s*\d+/m },
    { label: 'max_turns', pattern: /^\s*max_turns:\s*\d+/m },
    { label: 'codex block', pattern: /^codex:\s*$/m },
    { label: 'codex command', pattern: /^\s*command:\s*['"]?codex app-server['"]?\s*$/m },
  ];

  for (const entry of requiredFrontMatterPatterns) {
    if (!hasLine(frontMatter, entry.pattern)) {
      issues.push(`WORKFLOW.md is missing ${entry.label} in front matter.`);
    }
  }

  result.headingsFound = collectMatches(body, REQUIRED_WORKFLOW_HEADINGS, (value, heading) => value.includes(heading));
  for (const heading of REQUIRED_WORKFLOW_HEADINGS) {
    if (!body.includes(heading)) {
      issues.push(`WORKFLOW.md body is missing required heading "${heading}".`);
    }
  }

  result.proofCommandsFound = collectMatches(body, REQUIRED_PROOF_COMMANDS, (value, command) => value.includes(command));
  for (const command of REQUIRED_PROOF_COMMANDS) {
    if (!body.includes(command)) {
      issues.push(`WORKFLOW.md proof section is missing "${command}".`);
    }
  }

  if (!body.includes('no dead code')) {
    issues.push('WORKFLOW.md must explicitly ban dead code.');
  }

  if (!body.includes('docs/VERIFICATION_EVIDENCE.md')) {
    issues.push('WORKFLOW.md must require updates to docs/VERIFICATION_EVIDENCE.md for behavior changes.');
  }

  return { issues, details: result };
}

function validateIssueTemplateFile(text) {
  const issues = [];
  const result = {
    fieldIdsFound: collectMatches(text, REQUIRED_ISSUE_FIELDS, (value, fieldId) => value.includes(`id: ${fieldId}`)),
  };

  if (!text.includes('name: Ready for Agent')) {
    issues.push('ready-for-agent issue template must be named "Ready for Agent".');
  }

  for (const fieldId of REQUIRED_ISSUE_FIELDS) {
    if (!text.includes(`id: ${fieldId}`)) {
      issues.push(`ready-for-agent issue template is missing field id "${fieldId}".`);
    }
  }

  for (const command of REQUIRED_PROOF_COMMANDS) {
    if (!text.includes(command)) {
      issues.push(`ready-for-agent issue template must include proof command "${command}".`);
    }
  }

  return { issues, details: result };
}

function validatePullRequestTemplateFile(text) {
  const issues = [];
  const result = {
    sectionsFound: collectMatches(text, REQUIRED_PR_SECTIONS, (value, section) => value.includes(section)),
  };

  for (const section of REQUIRED_PR_SECTIONS) {
    if (!text.includes(section)) {
      issues.push(`pull request template is missing section "${section}".`);
    }
  }

  for (const command of REQUIRED_PROOF_COMMANDS) {
    if (!text.includes(command)) {
      issues.push(`pull request template must include proof command "${command}".`);
    }
  }

  return { issues, details: result };
}

function validateReadmeFile(text) {
  const issues = [];
  const result = {
    referencesWorkflow: text.includes('WORKFLOW.md'),
    referencesReadyTemplate: text.includes('ready-for-agent'),
  };

  if (!result.referencesWorkflow) {
    issues.push('README.md must reference WORKFLOW.md so operators can find the agent-run contract.');
  }

  if (!result.referencesReadyTemplate) {
    issues.push('README.md must reference the ready-for-agent intake template.');
  }

  return { issues, details: result };
}

function runWorkflowContractValidation(options = {}) {
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const files = {
    workflow: path.join(projectRoot, 'WORKFLOW.md'),
    issueTemplate: path.join(projectRoot, '.github', 'ISSUE_TEMPLATE', 'ready-for-agent.yml'),
    pullRequestTemplate: path.join(projectRoot, '.github', 'pull_request_template.md'),
    readme: path.join(projectRoot, 'README.md'),
  };
  const issues = [];
  const details = {};

  const validators = [
    ['workflow', validateWorkflowFile],
    ['issueTemplate', validateIssueTemplateFile],
    ['pullRequestTemplate', validatePullRequestTemplateFile],
    ['readme', validateReadmeFile],
  ];

  for (const [key, validator] of validators) {
    if (!fs.existsSync(files[key])) {
      issues.push(`${path.relative(projectRoot, files[key])} is missing.`);
      details[key] = {};
      continue;
    }

    const text = readText(files[key]);
    const validation = validator(text);
    details[key] = validation.details;
    issues.push(...validation.issues);
  }

  return {
    ok: issues.length === 0,
    generatedAt: new Date().toISOString(),
    files: {
      workflow: path.relative(projectRoot, files.workflow),
      issueTemplate: path.relative(projectRoot, files.issueTemplate),
      pullRequestTemplate: path.relative(projectRoot, files.pullRequestTemplate),
      readme: path.relative(projectRoot, files.readme),
    },
    requiredProofCommands: REQUIRED_PROOF_COMMANDS.slice(),
    details,
    issues,
  };
}

function printResult(result, asJson) {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.ok) {
    console.log('Workflow contract validation passed.');
    console.log(`Validated: ${Object.values(result.files).join(', ')}`);
    return;
  }

  console.error('Workflow contract validation failed:');
  result.issues.forEach((issue) => {
    console.error(`- ${issue}`);
  });
}

if (require.main === module) {
  const asJson = process.argv.includes('--json');
  const result = runWorkflowContractValidation();
  printResult(result, asJson);
  process.exit(result.ok ? 0 : 1);
}

module.exports = {
  PROJECT_ROOT,
  REQUIRED_ISSUE_FIELDS,
  REQUIRED_PR_SECTIONS,
  REQUIRED_PROOF_COMMANDS,
  REQUIRED_WORKFLOW_HEADINGS,
  extractFrontMatter,
  runWorkflowContractValidation,
  validateIssueTemplateFile,
  validatePullRequestTemplateFile,
  validateReadmeFile,
  validateWorkflowFile,
};
