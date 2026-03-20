
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Force Local Mode BEFORE requiring billing
delete process.env.STRIPE_SECRET_KEY;

const { 
  createCheckoutSession, 
  getCheckoutSessionStatus, 
  recordUsage, 
  validateApiKey,
  loadKeyStore,
  CONFIG 
} = require('./billing');

// GSD Test Environment
const testDir = path.join(__dirname, 'gsd-test-data');
if (!fs.existsSync(testDir)) fs.mkdirSync(testDir);
process.env._TEST_API_KEYS_PATH = path.join(testDir, 'api-keys.json');
process.env._TEST_FUNNEL_LEDGER_PATH = path.join(testDir, 'funnel-events.jsonl');
process.env._TEST_REVENUE_LEDGER_PATH = path.join(testDir, 'revenue-events.jsonl');
process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = path.join(testDir, 'local-checkout-sessions.json');

delete require.cache[require.resolve('./billing')];
const billing = require('./billing');
// Re-extract with new cache
const { 
  createCheckoutSession: createCheckoutSession2, 
  getCheckoutSessionStatus: getCheckoutSessionStatus2, 
  recordUsage: recordUsage2, 
  validateApiKey: validateApiKey2,
  loadKeyStore: loadKeyStore2,
  CONFIG: CONFIG2 
} = billing;

(async () => {
  try {
    console.log('--- GSD PROOF: Revenue Pivot Verification ---');

    // 1. Pack Definition
    assert.ok(CONFIG2.CREDIT_PACKS['mistake-free-starter'], 'Pack must exist in config');
    console.log('✅ Evidence: $49 Pack exists in Billing Config.');

    // 2. Checkout & Provisioning
    const session = await createCheckoutSession2({
      packId: 'mistake-free-starter',
      installId: 'gsd-hero-1',
      successUrl: 'http://localhost/success',
      cancelUrl: 'http://localhost/cancel'
    });
    const status = await getCheckoutSessionStatus2(session.sessionId);
    assert.strictEqual(status.remainingCredits, 500, 'Must provision 500 credits');
    const apiKey = status.apiKey;
    console.log('✅ Evidence: 500 credits provisioned for $49 session.');

    // 3. Usage Decrement
    const beforeUsage = validateApiKey2(apiKey).metadata.remainingCredits;
    recordUsage2(apiKey);
    const afterUsage = validateApiKey2(apiKey).metadata.remainingCredits;
    assert.strictEqual(beforeUsage - afterUsage, 1, 'Usage must decrement credit by 1');
    console.log(`✅ Evidence: Credits decremented on usage (${beforeUsage} -> ${afterUsage}).`);

    // 4. Kill Switch (Exhaustion)
    const store = loadKeyStore2();
    store.keys[apiKey].remainingCredits = 0;
    fs.writeFileSync(process.env._TEST_API_KEYS_PATH, JSON.stringify(store));
    
    const validation = validateApiKey2(apiKey);
    assert.strictEqual(validation.valid, false, 'Key must be invalid at 0 credits');
    assert.strictEqual(validation.reason, 'credits_exhausted');
    console.log('✅ Evidence: System blocks access when credits are exhausted.');

    console.log('\n--- GSD PROOF: SUCCESS ---');
  } catch (err) {
    console.error('❌ GSD PROOF: FAILED', err);
    process.exit(1);
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
})();
