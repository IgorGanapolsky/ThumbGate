'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  detectAction,
  detectAwsBlocksProject,
  evaluateAwsBlocksAction,
  buildAwsBlocksHardeningOffer,
} = require('../scripts/aws-blocks-guardrails');

test('detectAwsBlocksProject recognizes an AWS Blocks workspace without network calls', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-aws-blocks-'));
  fs.mkdirSync(path.join(dir, 'aws-blocks'));
  fs.writeFileSync(path.join(dir, 'aws-blocks', 'index.ts'), 'export const blocks = [];\n');

  assert.equal(detectAwsBlocksProject(dir), true);
});

test('detectAwsBlocksProject recognizes package scripts and dependency hints', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-aws-blocks-package-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    dependencies: {
      '@aws-blocks/blocks': '1.0.0',
    },
    scripts: {
      deploy: 'cdk deploy',
    },
  }));

  assert.equal(detectAwsBlocksProject(dir), true);
});

test('local AWS Blocks dev loop is allowed without production evidence', () => {
  const report = evaluateAwsBlocksAction({
    projectUsesAwsBlocks: true,
    command: 'npm run dev',
  });

  assert.equal(report.status, 'allowed');
  assert.ok(report.signals.some((signal) => signal.id === 'local-dev'));
  assert.deepEqual(report.requiredEvidence, []);
});

test('AWS Blocks production deploy is blocked until local tests, CDK diff, and cost blast radius evidence exist', () => {
  const report = evaluateAwsBlocksAction({
    projectUsesAwsBlocks: true,
    command: 'npm run deploy',
  });

  assert.equal(report.status, 'blocked');
  assert.deepEqual(
    report.requiredEvidence.map((entry) => entry.id),
    ['local-tests-pass', 'cdk-diff-reviewed', 'cost-blast-radius-reviewed']
  );
  assert.match(report.enforcementBoundary, /local AWS Blocks confidence/);
});

test('AWS Blocks deploy can pass when required evidence is attached', () => {
  const report = evaluateAwsBlocksAction({
    projectUsesAwsBlocks: true,
    command: 'cdk deploy',
    evidence: ['local-tests-pass', 'cdk-diff-reviewed', 'cost-blast-radius-reviewed'],
  });

  assert.equal(report.status, 'needs-review');
  assert.deepEqual(report.requiredEvidence, []);
});

test('high-risk cloud actions outside AWS Blocks are marked for review rather than blocked', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-non-aws-blocks-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  const report = evaluateAwsBlocksAction({
    projectUsesAwsBlocks: false,
    projectDir: dir,
    command: 'aws s3 rm s3://customer-bucket --recursive',
  });

  assert.equal(report.status, 'needs-review');
  assert.ok(report.requiredEvidence.some((entry) => entry.id === 'aws-account-and-region-confirmed'));
  assert.ok(report.signals.some((signal) => signal.id === 'destructive-aws-cli'));
});

test('scoped SQL updates are not treated as destructive SQL', () => {
  const action = detectAction({
    command: 'psql "$DATABASE_URL" -c "update accounts set status = active where id = 42"',
  });

  assert.equal(action.signals.some((signal) => signal.id === 'destructive-sql-or-ddl'), false);
});

test('destroy and destructive SQL require backup and human approval evidence', () => {
  const destroy = evaluateAwsBlocksAction({
    projectUsesAwsBlocks: true,
    command: 'npm run destroy',
  });
  const sql = evaluateAwsBlocksAction({
    projectUsesAwsBlocks: true,
    command: 'psql "$DATABASE_URL" -c "DROP TABLE prod_events"',
  });

  assert.equal(destroy.status, 'blocked');
  assert.ok(destroy.requiredEvidence.some((entry) => entry.id === 'human-destroy-approval'));
  assert.equal(sql.status, 'blocked');
  assert.ok(sql.requiredEvidence.some((entry) => entry.id === 'backup-or-rollback-ready'));
  assert.ok(sql.requiredEvidence.some((entry) => entry.id === 'bounded-row-count-reviewed'));
});

test('IAM escalation and Bedrock/Agent tool expansion are treated as owner-approved boundaries', () => {
  const iam = evaluateAwsBlocksAction({
    projectUsesAwsBlocks: true,
    command: 'aws iam attach-role-policy --role-name agent --policy-arn arn:aws:iam::aws:policy/AdministratorAccess',
  });
  const agent = evaluateAwsBlocksAction({
    projectUsesAwsBlocks: true,
    code: "const agent = new Agent(scope, 'support-agent', { tools: [refundTool] });",
  });

  assert.equal(iam.status, 'blocked');
  assert.ok(iam.requiredEvidence.some((entry) => entry.id === 'least-privilege-review'));
  assert.equal(agent.status, 'blocked');
  assert.ok(agent.requiredEvidence.some((entry) => entry.id === 'agent-tool-allowlist'));
});

test('hardening offer converts AWS Blocks news into one paid diagnostic path', () => {
  const offer = buildAwsBlocksHardeningOffer({
    workflow: 'customer onboarding backend',
    buyer: 'AI platform lead',
  });

  assert.equal(offer.offer, 'AWS Blocks Agent Safety Review');
  assert.equal(offer.diagnosticPrice, '$499');
  assert.match(offer.headline, /AWS Blocks helps agents build/);
  assert.ok(offer.proofPlan.some((step) => /deploy, destroy, data mutation, IAM, Bedrock Agent/.test(step)));
});

test('CLI emits blocked JSON for AWS Blocks deploy guardrail', () => {
  const stdout = execFileSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'aws-blocks-guardrails.js'),
    '--json',
    '--project-uses-aws-blocks',
    '--command=npm run deploy',
  ], { encoding: 'utf8' });
  const report = JSON.parse(stdout);

  assert.equal(report.status, 'blocked');
  assert.ok(report.requiredEvidence.some((entry) => entry.id === 'cdk-diff-reviewed'));
});

test('CLI renders the hardening offer in text mode', () => {
  const stdout = execFileSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'aws-blocks-guardrails.js'),
    'offer',
    '--workflow=agent backend',
    '--buyer=platform lead',
  ], { encoding: 'utf8' });

  assert.match(stdout, /thumbgate-aws-blocks-hardening-offer: ready-for-positioning/);
  assert.match(stdout, /map one AWS Blocks local-to-cloud workflow/);
});
