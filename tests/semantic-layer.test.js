'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { describeSemanticSchema, getBusinessMetrics, SemanticSchema } = require('../scripts/semantic-layer');

describe('semantic-layer', () => {
  it('SemanticSchema has required entity definitions', () => {
    assert.ok(SemanticSchema.entities.Customer);
    assert.ok(SemanticSchema.entities.Revenue);
    assert.ok(SemanticSchema.entities.Funnel);
    assert.ok(SemanticSchema.entities.DataPipeline);
  });

  it('SemanticSchema Customer has expected tiers', () => {
    assert.deepStrictEqual(SemanticSchema.entities.Customer.tiers, ['free', 'pro', 'enterprise-sprint']);
  });

  it('SemanticSchema Funnel has correct stages', () => {
    assert.deepStrictEqual(SemanticSchema.entities.Funnel.stages, ['visitor', 'checkout_start', 'acquisition', 'paid']);
  });

  it('describeSemanticSchema returns the full schema', () => {
    const schema = describeSemanticSchema();
    assert.strictEqual(schema, SemanticSchema);
    assert.ok(schema.metrics.ConversionRate);
    assert.ok(schema.metrics.BookedRevenue);
    assert.ok(schema.metrics.AttributionCoverageRate);
    assert.ok(schema.metrics.UnreconciledPaidEvents);
  });

  it('getBusinessMetrics returns semantic pipeline metrics and data quality state', async () => {
    const metrics = await getBusinessMetrics({
      write: false,
      recordWorkflowRun: false,
      telemetryEvents: [
        { receivedAt: '2026-03-30T11:00:00.000Z', eventType: 'landing_page_view' },
      ],
      telemetryAnalytics: {
        window: {
          window: '30d',
          timeZone: 'America/New_York',
          bounded: true,
          startLocalDate: '2026-03-01',
          endLocalDate: '2026-03-30',
          now: '2026-03-30T12:00:00.000Z',
        },
        visitors: {
          uniqueVisitors: 1,
          attributionCoverageRate: 1,
          acquisitionIdCoverageRate: 1,
          bySource: { website: 1 },
          byCampaign: { launch: 1 },
          byTrafficChannel: { direct: 1 },
          byCommunity: {},
          byOfferCode: {},
          byCampaignVariant: {},
          pageViews: 1,
        },
        ctas: {
          checkoutStarts: 1,
          checkoutStartsBySource: { website: 1 },
          checkoutStartsByCampaign: { launch: 1 },
          checkoutStartsByTrafficChannel: { direct: 1 },
          checkoutStartsByCommunity: {},
          checkoutStartsByOfferCode: {},
          checkoutStartsByCampaignVariant: {},
        },
        buyerLoss: { reasonsByCode: {} },
        seo: { bySurface: {}, byQuery: {} },
        cli: { uniqueInstalls: 0, byPlatform: {} },
        recent: [],
      },
      billingSummary: {
        signups: {
          uniqueLeads: 1,
        },
        revenue: {
          paidCustomers: 1,
          bookedRevenueCents: 4900,
        },
        attribution: {
          acquisitionBySource: { website: 1 },
          acquisitionByCampaign: { launch: 1 },
          acquisitionByCommunity: {},
          acquisitionByOfferCode: {},
          paidBySource: { website: 1 },
          paidByCampaign: { launch: 1 },
          paidByCommunity: {},
          paidByOfferCode: {},
          bookedRevenueBySourceCents: { website: 4900 },
          bookedRevenueByCampaignCents: { launch: 4900 },
          bookedRevenueByCommunityCents: {},
          bookedRevenueByOfferCodeCents: {},
        },
        dataQuality: {
          unreconciledPaidEvents: 0,
        },
        keys: {
          active: 1,
          totalUsage: 7,
        },
      },
    });

    assert.equal(metrics.metrics.bookedRevenueCents, 4900);
    assert.equal(metrics.metrics.attributionCoverageRate, 1);
    assert.equal(metrics.metrics.unreconciledPaidEvents, 0);
    assert.equal(metrics.pipeline.reconciliationStatus, 'healthy');
  });
});
