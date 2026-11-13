/**
 * Unit Tests for Event-Driven High-Ticket Client Conversion Funnel
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MASTERCLASS_BLUEPRINT,
  generateLumaInvitePayload,
  generatePersonalOutreachDMs
} = require('../scripts/event-conversion-funnel');

test('Event Conversion Funnel - Blueprint has concrete date, clear title, and micro-offer', () => {
  assert.ok(MASTERCLASS_BLUEPRINT.eventDate.includes('2026'));
  assert.equal(
    MASTERCLASS_BLUEPRINT.clearTitle,
    'How to Stop Autonomous Coding Agents from Breaking Production and Burning Cloud Budgets'
  );
  assert.equal(MASTERCLASS_BLUEPRINT.microOffer.scarcityLimit, 3);
  assert.ok(MASTERCLASS_BLUEPRINT.microOffer.checkoutUrl.includes('buy.stripe.com'));
});

test('Event Conversion Funnel - Luma payload contains confirmation email obstacle prompt', () => {
  const luma = generateLumaInvitePayload();
  assert.equal(luma.title, MASTERCLASS_BLUEPRINT.clearTitle);
  assert.equal(luma.duration_minutes, 45);
  assert.ok(luma.confirmation_email_body.includes('What is the #1 problem'));
});

test('Event Conversion Funnel - Generates personal LinkedIn DM and post-event voice memo script', () => {
  const dms = generatePersonalOutreachDMs({
    prospectName: 'Sarah',
    companyName: 'Acme AI'
  });

  assert.ok(dms.linkedinDm.includes('Sarah'));
  assert.ok(dms.linkedinDm.includes('Acme AI'));
  assert.ok(dms.postEventVoiceMemoScript.includes('3 teams this week'));
  assert.ok(dms.postEventVoiceMemoScript.toLowerCase().includes('what was on your mind'));
});
