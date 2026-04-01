'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCreatorCampaignLinks,
  buildCreatorOfferCode,
  normalizeCreatorHandle,
  summarizeCreatorPerformance,
} = require('../scripts/creator-campaigns');

test('normalizeCreatorHandle strips @ and lowercases values', () => {
  assert.equal(normalizeCreatorHandle('@Reach_VB'), 'reach_vb');
  assert.equal(normalizeCreatorHandle('  CreatorName  '), 'creatorname');
});

test('buildCreatorOfferCode creates stable creator-oriented codes', () => {
  assert.equal(buildCreatorOfferCode('reach_vb', 'team'), 'REACH-VB-TEAM');
});

test('buildCreatorCampaignLinks generates tracked landing, Pro, Team, and sprint links', () => {
  const result = buildCreatorCampaignLinks({
    creator: '@reach_vb',
    source: 'x',
    campaign: 'claude-code-apr-2026',
    contentShape: 'workflow_teardown',
    postId: '2038670509768839458',
  }, {
    appOrigin: 'https://thumbgate.example',
  });

  assert.equal(result.creator, 'reach_vb');
  assert.equal(result.attribution.utmMedium, 'creator_partnership');
  assert.equal(result.attribution.campaignVariant, 'workflow-teardown');
  assert.equal(result.attribution.offerCode, 'REACH-VB-PRO');

  const landingUrl = new URL(result.links.landingUrl);
  assert.equal(landingUrl.searchParams.get('creator'), 'reach_vb');
  assert.equal(landingUrl.searchParams.get('utm_source'), 'x');
  assert.equal(landingUrl.searchParams.get('utm_medium'), 'creator_partnership');
  assert.equal(landingUrl.searchParams.get('campaign_variant'), 'workflow-teardown');

  const proCheckoutUrl = new URL(result.links.proCheckoutUrl);
  assert.equal(proCheckoutUrl.pathname, '/checkout/pro');
  assert.equal(proCheckoutUrl.searchParams.get('plan_id'), 'pro');
  assert.equal(proCheckoutUrl.searchParams.get('cta_id'), 'pricing_pro');

  const teamCheckoutUrl = new URL(result.links.teamCheckoutUrl);
  assert.equal(teamCheckoutUrl.searchParams.get('plan_id'), 'team');
  assert.equal(teamCheckoutUrl.searchParams.get('seat_count'), '3');

  const sprintUrl = new URL(result.links.sprintUrl);
  assert.equal(sprintUrl.hash, '#workflow-sprint-intake');
});

test('summarizeCreatorPerformance ranks creators by revenue before traffic', () => {
  const creators = summarizeCreatorPerformance(
    {
      visitors: {
        byCreator: {
          reach_vb: 12,
          another_creator: 40,
        },
      },
      ctas: {
        byCreator: {
          reach_vb: 5,
          another_creator: 10,
        },
        checkoutStartsByCreator: {
          reach_vb: 3,
          another_creator: 4,
        },
      },
    },
    {
      attribution: {
        acquisitionByCreator: {
          reach_vb: 3,
          another_creator: 4,
        },
        paidByCreator: {
          reach_vb: 2,
          another_creator: 1,
        },
        bookedRevenueByCreatorCents: {
          reach_vb: 29800,
          another_creator: 1900,
        },
      },
      pipeline: {
        workflowSprintLeads: {
          byCreator: {
            reach_vb: 1,
          },
        },
        qualifiedWorkflowSprintLeads: {
          byCreator: {
            reach_vb: 1,
          },
        },
      },
    }
  );

  assert.equal(creators.length, 2);
  assert.equal(creators[0].creator, 'reach_vb');
  assert.equal(creators[0].paidOrders, 2);
  assert.equal(creators[0].bookedRevenueCents, 29800);
  assert.equal(creators[0].qualifiedSprintLeads, 1);
});
