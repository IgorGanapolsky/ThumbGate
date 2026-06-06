const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function readWorkflow() {
  return fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'daily-revenue-loop.yml'), 'utf8');
}

function readRevenueTruthWorkflow() {
  return fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'revenue-truth-audit.yml'), 'utf8');
}

function readStripeDiagnosticWorkflow() {
  return fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'audit-stripe-checkout-diagnostic.yml'), 'utf8');
}

test('daily revenue loop audits hosted revenue truth before reporting', () => {
  const workflow = readWorkflow();

  assert.match(workflow, /name: Audit hosted revenue truth/);
  assert.match(workflow, /THUMBGATE_OPERATOR_KEY: \$\{\{ secrets\.THUMBGATE_OPERATOR_KEY \}\}/);
  assert.match(workflow, /THUMBGATE_API_KEY: \$\{\{ secrets\.THUMBGATE_API_KEY \}\}/);
  assert.match(workflow, /node scripts\/revenue-status\.js --json/);
  assert.match(workflow, /SOURCE=\$\(node -p "require\('\.\/reports\/revenue\/revenue-status\.json'\)\.source"\)/);
  assert.match(workflow, /Hosted revenue truth fell back to local data; failing observability gate\./);
});

test('daily revenue loop audits Stripe and Plausible with stored artifacts', () => {
  const workflow = readWorkflow();

  assert.match(workflow, /name: Audit Stripe live status/);
  assert.match(workflow, /STRIPE_SECRET_KEY: \$\{\{ secrets\.STRIPE_SECRET_KEY \}\}/);
  assert.match(workflow, /node scripts\/stripe-live-status\.js --strict/);
  assert.match(workflow, /name: Audit Plausible checkout attribution/);
  assert.match(workflow, /PLAUSIBLE_API_KEY: \$\{\{ secrets\.PLAUSIBLE_API_KEY \}\}/);
  assert.match(workflow, /PLAUSIBLE_SITE_ID: \$\{\{ secrets\.PLAUSIBLE_SITE_ID \}\}/);
  assert.match(workflow, /npm run social:poll:plausible/);
  assert.match(workflow, /actions\/upload-artifact@v7/);
  assert.match(workflow, /revenue-observability-\$\{\{ github\.run_id \}\}/);
});

test('manual revenue truth audit produces hosted and owner-filtered artifacts', () => {
  const workflow = readRevenueTruthWorkflow();

  assert.match(workflow, /name:\s*Revenue Truth Audit/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /THUMBGATE_OPERATOR_KEY:\s*\$\{\{\s*secrets\.THUMBGATE_OPERATOR_KEY\s*\}\}/);
  assert.match(workflow, /THUMBGATE_API_KEY:\s*\$\{\{\s*secrets\.THUMBGATE_API_KEY\s*\}\}/);
  assert.match(workflow, /node bin\/cli\.js cfo --window="\$\{\{ inputs\.window \}\}"/);
  assert.match(workflow, /if \[ "\$SOURCE" != "hosted" \]/);
  assert.match(workflow, /node scripts\/stripe-live-status\.js --strict/);
  assert.match(workflow, /node scripts\/external-customer-audit\.js --json > reports\/revenue\/external-customer-audit\.json/);
  assert.match(workflow, /Real non-owner paying customers lifetime/);
  assert.match(workflow, /actions\/upload-artifact@v7/);
  assert.match(workflow, /revenue-truth-audit-\$\{\{ github\.run_id \}\}/);
});

test('Stripe checkout diagnostic is runnable on main, schedule, and manual dispatch', () => {
  const workflow = readStripeDiagnosticWorkflow();

  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /scripts\/stripe-checkout-diagnostic\.js/);
  assert.match(workflow, /STRIPE_SECRET_KEY:\s*\$\{\{\s*secrets\.STRIPE_SECRET_KEY\s*\}\}/);
  assert.match(workflow, /stripe-checkout-diagnostic\.md/);
  assert.match(workflow, /stripe-checkout-diagnostic\.json/);
  assert.match(workflow, /actions\/upload-artifact@v7/);
  assert.match(workflow, /stripe-checkout-diagnostic-\$\{\{ github\.run_id \}\}/);
});
