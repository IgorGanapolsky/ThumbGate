const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function readWorkflow() {
  return fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'daily-revenue-loop.yml'), 'utf8');
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
