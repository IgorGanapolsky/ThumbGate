#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const AWS_BLOCKS_DEPENDENCY_PATTERN = /(^|\/)@aws-blocks\/(?:blocks|[^/\s"']+)/;
const PRODUCTION_DEPLOY_PATTERNS = [
  /\bcdk\s+deploy\b/i,
  /\bnpm\s+run\s+deploy\b/i,
  /\bpnpm\s+deploy\b/i,
  /\byarn\s+deploy\b/i,
  /\bsst\s+deploy\b/i,
  /\bblocks?\s+deploy\b/i,
];
const DESTROY_PATTERNS = [
  /\bcdk\s+destroy\b/i,
  /\bnpm\s+run\s+destroy\b/i,
  /\bpnpm\s+destroy\b/i,
  /\byarn\s+destroy\b/i,
  /\bsandbox\b.*--destroy\b/i,
  /\b--destroy\b/i,
  /\baws\s+cloudformation\s+delete-stack\b/i,
];
const DESTRUCTIVE_AWS_PATTERNS = [
  /\baws\s+dynamodb\s+delete-table\b/i,
  /\baws\s+rds\s+delete-db-instance\b/i,
  /\baws\s+s3\s+rm\b[\s\S]*--recursive\b/i,
  /\baws\s+lambda\s+delete-function\b/i,
  /\baws\s+bedrock-agent\s+delete-/i,
  /\baws\s+bedrock-agent-runtime\b/i,
];

function toList(value) {
  if (Array.isArray(value)) return value.map(String).map((entry) => entry.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  return [];
}

function normalizeText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function readPackageJson(projectDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function hasDestructiveSql(text) {
  if (/\bdrop\s+(table|database|schema|index|column)\b/i.test(text)) return true;
  if (/\btruncate\s+table\b/i.test(text)) return true;
  if (/\bdelete\s+from\s+[\w".-]+(?:\s*;|\s*$)/i.test(text)) return true;
  const updateMatch = /\bupdate\s+[\w".-]+\s+set\b/i.exec(text);
  if (!updateMatch) return false;
  const afterUpdate = text.slice(updateMatch.index, updateMatch.index + 180);
  return !/\bwhere\b/i.test(afterUpdate);
}

function packageUsesAwsBlocks(pkg) {
  if (!pkg || typeof pkg !== 'object') return false;
  const dependencyText = JSON.stringify({
    dependencies: pkg.dependencies || {},
    devDependencies: pkg.devDependencies || {},
    peerDependencies: pkg.peerDependencies || {},
    optionalDependencies: pkg.optionalDependencies || {},
  });
  const scriptsText = JSON.stringify(pkg.scripts || {});
  return AWS_BLOCKS_DEPENDENCY_PATTERN.test(dependencyText) || /aws-blocks|blocks-app|cdk|sandbox/i.test(scriptsText);
}

function detectAwsBlocksProject(projectDir = process.cwd()) {
  const pkg = readPackageJson(projectDir);
  if (packageUsesAwsBlocks(pkg)) return true;
  return fs.existsSync(path.join(projectDir, 'aws-blocks', 'index.ts'))
    || fs.existsSync(path.join(projectDir, 'aws-blocks', 'index.js'))
    || fs.existsSync(path.join(projectDir, 'blocks.spec.json'));
}

function detectAction(input = {}) {
  const command = normalizeText(input.command || input.args || input.shell || input.toolInput);
  const toolName = normalizeText(input.toolName || input.tool || input.name);
  const code = normalizeText(input.code || input.file || input.diff || input.body);
  const combined = `${toolName}\n${command}\n${code}`;
  const lower = combined.toLowerCase();

  const signals = [];
  const add = (id, label, severity = 'medium') => signals.push({ id, label, severity });

  if (matchesAny(combined, PRODUCTION_DEPLOY_PATTERNS)) {
    add('aws-blocks-production-deploy', 'production deploy from an AWS Blocks workflow', 'high');
  }

  if (matchesAny(combined, DESTROY_PATTERNS)) {
    add('aws-blocks-destroy', 'destroy command can remove AWS resources created from local Blocks code', 'critical');
  }

  if (hasDestructiveSql(combined)) {
    add('destructive-sql-or-ddl', 'destructive or unscoped SQL mutation', 'critical');
  }

  if (matchesAny(combined, DESTRUCTIVE_AWS_PATTERNS)) {
    add('destructive-aws-cli', 'destructive AWS CLI or Bedrock agent action', 'critical');
  }

  if (/\b(gcloud|aws)\b[\s\S]{0,220}\b(add-iam-policy-binding|put-role-policy|attach-role-policy|create-policy-version)\b/i.test(combined)
      || /\b(AdministratorAccess|roles\/owner|iam:PassRole|serviceAccountTokenCreator)\b/i.test(combined)) {
    add('iam-escalation', 'agent session attempts to grant broad IAM authority', 'critical');
  }

  if (/\b(new\s+Agent\s*\(|@aws-blocks\/(?:agent|blocks)|\bAgent\b[\s\S]{0,120}\btools?\b)/.test(combined)) {
    add('blocks-agent-tool-call', 'AWS Blocks Agent or Bedrock-style tool action needs a tool boundary', 'medium');
  }

  if (/\b(npm\s+run\s+dev|npm\s+start|pnpm\s+dev|yarn\s+dev|create-blocks-app)\b/i.test(combined)) {
    add('local-dev', 'local AWS Blocks development loop', 'low');
  }

  return {
    command,
    toolName,
    code,
    signals,
    highRisk: signals.some((signal) => ['high', 'critical'].includes(signal.severity)),
    localOnly: signals.some((signal) => signal.id === 'local-dev') && signals.every((signal) => signal.severity === 'low'),
    lower,
  };
}

function evaluateAwsBlocksAction(input = {}) {
  const projectDir = input.projectDir || input.cwd || process.cwd();
  const projectUsesAwsBlocks = Boolean(
    input.projectUsesAwsBlocks
    || input.awsBlocks
    || input.blocksProject
    || detectAwsBlocksProject(projectDir)
  );
  const evidence = new Set(toList(input.evidence || input.proof || input.receipts));
  const action = detectAction(input);
  const requiredEvidence = [];

  const requireEvidence = (id, label) => {
    if (!evidence.has(id)) requiredEvidence.push({ id, label });
  };

  if (projectUsesAwsBlocks && action.signals.some((signal) => signal.id === 'aws-blocks-production-deploy')) {
    requireEvidence('local-tests-pass', 'local AWS Blocks tests pass against local implementations');
    requireEvidence('cdk-diff-reviewed', 'CDK diff or synthesized CloudFormation change set reviewed');
    requireEvidence('cost-blast-radius-reviewed', 'AWS cost and resource blast radius reviewed');
  }

  if (action.signals.some((signal) => signal.id === 'aws-blocks-destroy')) {
    requireEvidence('resource-inventory-exported', 'resource inventory exported before destroy');
    requireEvidence('human-destroy-approval', 'named human approval for destroy');
  }

  if (action.signals.some((signal) => signal.id === 'destructive-sql-or-ddl')) {
    requireEvidence('backup-or-rollback-ready', 'backup, rollback, or restore point exists');
    requireEvidence('bounded-row-count-reviewed', 'row/table impact was previewed before mutation');
  }

  if (action.signals.some((signal) => signal.id === 'destructive-aws-cli')) {
    requireEvidence('aws-account-and-region-confirmed', 'target AWS account and region confirmed');
    requireEvidence('rollback-plan-attached', 'rollback or recovery plan attached');
  }

  if (action.signals.some((signal) => signal.id === 'iam-escalation')) {
    requireEvidence('least-privilege-review', 'least-privilege review completed');
    requireEvidence('security-owner-approval', 'security owner approval captured');
  }

  if (action.signals.some((signal) => signal.id === 'blocks-agent-tool-call')) {
    requireEvidence('agent-tool-allowlist', 'agent tool allowlist and data boundary declared');
  }

  const shouldBlock = projectUsesAwsBlocks && requiredEvidence.length > 0;
  let status = 'allowed';
  if (shouldBlock) {
    status = 'blocked';
  } else if (action.highRisk) {
    status = 'needs-review';
  }

  return {
    name: 'thumbgate-aws-blocks-guardrails',
    status,
    projectUsesAwsBlocks,
    signals: action.signals,
    requiredEvidence,
    enforcementBoundary: 'local AWS Blocks confidence must not automatically become production AWS authority',
    gates: [
      'allow local AWS Blocks dev loops without AWS credentials',
      'require local test proof plus CDK diff before production deploy',
      'block destroy and destructive data mutations until backup, blast-radius, and human approval evidence exists',
      'block IAM escalation and Bedrock/Agent tool expansion until an owner approves the tool boundary',
      'write a ThumbGate receipt for every allowed high-risk cloud action',
    ],
    nextActions: shouldBlock
      ? requiredEvidence.map((item) => `Provide ${item.id}: ${item.label}`)
      : ['Record an allow receipt when this action touches real AWS resources'],
  };
}

function buildAwsBlocksHardeningOffer(input = {}) {
  const workflow = String(input.workflow || input.name || 'AWS Blocks backend').trim();
  const buyer = String(input.buyer || input.owner || 'platform owner').trim();
  return {
    name: 'thumbgate-aws-blocks-hardening-offer',
    status: 'ready-for-positioning',
    buyer,
    workflow,
    headline: 'AWS Blocks helps agents build the backend. ThumbGate stops them before unsafe cloud actions run.',
    offer: 'AWS Blocks Agent Safety Review',
    diagnosticPrice: '$499',
    proofPlan: [
      'map one AWS Blocks local-to-cloud workflow',
      'install ThumbGate against the agent running that workflow',
      'add gates for deploy, destroy, data mutation, IAM, Bedrock Agent, and cost-blast-radius actions',
      'produce a receipt showing the first blocked repeat and the evidence required to allow it',
    ],
    cta: 'Send one AWS Blocks workflow that is about to deploy, mutate data, or call Bedrock tools.',
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg === '--aws-blocks' || arg === '--project-uses-aws-blocks') args.projectUsesAwsBlocks = true;
    else if (arg.startsWith('--command=')) args.command = arg.slice('--command='.length);
    else if (arg.startsWith('--tool=')) args.toolName = arg.slice('--tool='.length);
    else if (arg.startsWith('--code=')) args.code = arg.slice('--code='.length);
    else if (arg.startsWith('--cwd=')) args.projectDir = arg.slice('--cwd='.length);
    else if (arg.startsWith('--evidence=')) args.evidence = arg.slice('--evidence='.length);
    else if (arg.startsWith('--workflow=')) args.workflow = arg.slice('--workflow='.length);
    else if (arg.startsWith('--buyer=')) args.buyer = arg.slice('--buyer='.length);
    else if (arg === 'offer') args.commandName = 'offer';
  }
  return args;
}

function runCli(args = parseArgs()) {
  const report = args.commandName === 'offer'
    ? buildAwsBlocksHardeningOffer(args)
    : evaluateAwsBlocksAction(args);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`${report.name}: ${report.status}`);
    for (const action of report.nextActions || report.proofPlan || []) console.log(`- ${action}`);
  }
}

if (require.main?.filename === __filename) runCli();

module.exports = {
  detectAwsBlocksProject,
  detectAction,
  evaluateAwsBlocksAction,
  buildAwsBlocksHardeningOffer,
};
