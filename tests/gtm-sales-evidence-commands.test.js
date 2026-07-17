const test = require('node:test');
const assert = require('node:assert/strict');

const { buildTargetSalesCommands } = require('../scripts/gtm-revenue-loop');

test('GTM operator commands require receipts for every post-target stage', () => {
  const commands = buildTargetSalesCommands({
    pipelineLeadId: 'reddit_example',
    channel: 'reddit_comment',
    motion: 'sprint',
    motionLabel: 'Workflow Hardening Diagnostic',
    motionReason: 'one expensive search workflow',
  });

  assert.match(commands.markContacted, /--evidence-kind 'platform_send_receipt'/);
  assert.match(commands.markContacted, /--evidence-ref 'REPLACE_WITH_PLATFORM_RECEIPT'/);
  assert.match(commands.markReplied, /--evidence-kind 'buyer_reply'/);
  assert.match(commands.markCallBooked, /--evidence-kind 'booking_confirmation'/);
  assert.match(commands.markCheckoutStarted, /--evidence-kind 'provider_checkout_session'/);
  assert.match(commands.markSprintIntake, /--evidence-kind 'intake_submission'/);
  assert.match(commands.markPaid, /^npm run sales:reconcile-payment --/);
  assert.match(commands.markPaid, /--lead 'reddit_example'/);
  assert.match(commands.markPaid, /--provider 'REPLACE_WITH_PAYMENT_PROVIDER'/);
  assert.match(commands.markPaid, /--payment 'REPLACE_WITH_PROVIDER_PAYMENT_ID'/);
  assert.doesNotMatch(commands.markPaid, /amount-cents|evidence-kind|stage 'paid'/);
});
