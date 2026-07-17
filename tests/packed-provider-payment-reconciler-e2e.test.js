'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

test('packed npm payment reconciler creates Stripe paid truth only from injected live-audit proof', { timeout: 120_000 }, async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-packed-stripe-reconcile-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const packDir = path.join(tempRoot, 'pack');
  const installDir = path.join(tempRoot, 'install');
  const statePath = path.join(tempRoot, 'sales-pipeline.jsonl');
  fs.mkdirSync(packDir, { recursive: true });

  const packResult = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', packDir], {
    cwd: ROOT,
    encoding: 'utf8',
  }));
  const tarballPath = path.join(packDir, packResult[0].filename);
  execFileSync('npm', ['install', '--prefix', installDir, '--ignore-scripts', '--no-audit', '--no-fund', tarballPath], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  const installedRoot = path.join(installDir, 'node_modules', 'thumbgate');
  const pipeline = require(path.join(installedRoot, 'scripts/sales-pipeline.js'));
  const reconciler = require(path.join(installedRoot, 'scripts/provider-payment-reconciler.js'));
  const { digestBuyerEmail } = require(path.join(installedRoot, 'scripts/provider-revenue-evidence.js'));
  for (const modulePath of [
    'scripts/external-customer-audit.js',
    'scripts/stripe-credentials.js',
    'scripts/provider-payment-reconciler.js',
  ]) {
    assert.equal(fs.existsSync(path.join(installedRoot, modulePath)), true, `${modulePath} missing after npm install`);
  }

  pipeline.addSalesLead({
    leadId: 'packed_stripe_buyer',
    source: 'direct',
    email: 'packed-buyer@example.com',
    stage: 'sprint_intake',
    evidenceKind: 'intake_submission',
    evidenceSource: 'thumbgate_hosted',
    evidenceRef: 'intake_packed_stripe_buyer',
  }, { statePath });
  const receipt = await reconciler.reconcileProviderPayment({
    leadId: 'packed_stripe_buyer',
    provider: 'stripe',
    paymentId: 'ch_packed_verified',
  }, {
    statePath,
    auditStripeLiveEvidence: async () => ({
      configured: true,
      generatedAt: '2026-07-16T13:00:00.000Z',
      productAttribution: {
        verified: true,
        thumbgate: {
          individualPaymentStates: [{
            provider: 'stripe',
            id: 'ch_packed_verified',
            createdAt: '2026-07-16T12:00:00.000Z',
            status: 'completed',
            grossCents: 150000,
            refundedCents: 0,
            netCents: 150000,
            currency: 'usd',
            customerId: 'sha256:private-customer',
            customerClassification: 'external',
            ownerTest: false,
            buyerEmailDigest: digestBuyerEmail('packed-buyer@example.com'),
            productAttribution: { verified: true, product: 'thumbgate' },
            evidenceVerified: true,
            evidenceSource: 'provider_api_live:stripe-checkout-product-reconciliation',
            evidenceDigest: `sha256:${'a'.repeat(64)}`,
            invoiceId: 'in_packed_sprint',
            offerIds: ['workflow_hardening_sprint'],
          }],
        },
      },
    }),
  });
  const lead = pipeline.loadSalesLeads({ statePath })[0];

  assert.equal(receipt.provider, 'stripe');
  assert.equal(receipt.stage, 'paid');
  assert.equal(receipt.amountCents, 150000);
  assert.equal(receipt.offerId, 'workflow_hardening_sprint');
  assert.equal(lead.history.at(-1).evidence.provider, 'stripe');
  assert.equal(lead.history.at(-1).evidence.offerId, 'workflow_hardening_sprint');
  assert.equal(JSON.stringify(receipt).includes('private-customer'), false);
});
