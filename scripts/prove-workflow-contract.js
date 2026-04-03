#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {
  runWorkflowContractValidation,
} = require('./validate-workflow-contract');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_PROOF_DIR = path.join(PROJECT_ROOT, 'proof', 'workflow-contract');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function toMarkdown(report) {
  const lines = [
    '# Workflow Contract Proof Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Summary: ${report.summary.passed} passed, ${report.summary.failed} failed`,
    '',
    '## Validated Files',
    '',
    ...Object.values(report.files).map((filePath) => `- \`${filePath}\``),
    '',
    '## Checks',
    '',
  ];

  report.checks.forEach((check) => {
    lines.push(`- ${check.name}: ${check.passed ? 'PASS' : 'FAIL'}`);
  });

  if (report.issues.length > 0) {
    lines.push('');
    lines.push('## Issues');
    lines.push('');
    report.issues.forEach((issue) => {
      lines.push(`- ${issue}`);
    });
  }

  return `${lines.join('\n')}\n`;
}

function runWorkflowContractProof(options = {}) {
  const proofDir = options.proofDir || process.env.RLHF_WORKFLOW_CONTRACT_PROOF_DIR || DEFAULT_PROOF_DIR;
  const writeArtifacts = options.writeArtifacts !== false;
  const validation = runWorkflowContractValidation({ projectRoot: options.projectRoot || PROJECT_ROOT });

  const report = {
    generatedAt: validation.generatedAt,
    files: validation.files,
    checks: [
      {
        name: 'workflow.contract.complete',
        passed: validation.ok,
        details: {
          headingsFound: validation.details.workflow ? validation.details.workflow.headingsFound : [],
          proofCommandsFound: validation.details.workflow ? validation.details.workflow.proofCommandsFound : [],
        },
      },
      {
        name: 'issue.template.complete',
        passed: validation.ok,
        details: {
          fieldIdsFound: validation.details.issueTemplate ? validation.details.issueTemplate.fieldIdsFound : [],
        },
      },
      {
        name: 'pull_request.template.complete',
        passed: validation.ok,
        details: {
          sectionsFound: validation.details.pullRequestTemplate ? validation.details.pullRequestTemplate.sectionsFound : [],
        },
      },
      {
        name: 'readme.links.contracts',
        passed: validation.ok,
        details: validation.details.readme || {},
      },
    ],
    issues: validation.issues.slice(),
    summary: {
      passed: validation.ok ? 4 : 0,
      failed: validation.ok ? 0 : 4,
    },
  };

  if (writeArtifacts) {
    ensureDir(proofDir);
    fs.writeFileSync(path.join(proofDir, 'report.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(proofDir, 'report.md'), toMarkdown(report));
  }

  return report;
}

if (require.main === module) {
  const report = runWorkflowContractProof();
  if (report.summary.failed > 0) {
    console.error(toMarkdown(report));
    process.exit(1);
  }

  console.log(toMarkdown(report));
}

module.exports = {
  DEFAULT_PROOF_DIR,
  runWorkflowContractProof,
  toMarkdown,
};
