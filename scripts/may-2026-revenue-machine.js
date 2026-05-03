#!/usr/bin/env node
'use strict';

const {
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_FETCH_TIMEOUT_MS,
  generateRevenueStatusReport,
  centsToDollars,
  parsePositiveInteger,
} = require('./revenue-status');

const DEFAULT_OFFER_STACK = {
  diagnostic: {
    name: 'Workflow Hardening Diagnostic',
    priceDollars: 499,
    envKey: 'THUMBGATE_SPRINT_DIAGNOSTIC_CHECKOUT_URL',
  },
  sprint: {
    name: 'Workflow Hardening Sprint',
    priceDollars: 1500,
    envKey: 'THUMBGATE_WORKFLOW_SPRINT_CHECKOUT_URL',
  },
};

function parseArgs(argv = []) {
  const options = {
    json: false,
    repo: process.env.THUMBGATE_GITHUB_REPO || 'IgorGanapolsky/ThumbGate',
    timeZone: process.env.TZ || 'America/New_York',
    fetchTimeoutMs: parsePositiveInteger(
      process.env.THUMBGATE_REVENUE_STATUS_FETCH_TIMEOUT_MS,
      DEFAULT_FETCH_TIMEOUT_MS
    ),
    commandTimeoutMs: parsePositiveInteger(
      process.env.THUMBGATE_REVENUE_STATUS_COMMAND_TIMEOUT_MS,
      DEFAULT_COMMAND_TIMEOUT_MS
    ),
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg.startsWith('--repo=')) {
      options.repo = arg.slice('--repo='.length).trim() || options.repo;
      continue;
    }
    if (arg.startsWith('--timezone=')) {
      options.timeZone = arg.slice('--timezone='.length).trim() || options.timeZone;
      continue;
    }
    if (arg.startsWith('--fetch-timeout-ms=')) {
      options.fetchTimeoutMs = parsePositiveInteger(
        arg.slice('--fetch-timeout-ms='.length),
        options.fetchTimeoutMs
      );
      continue;
    }
    if (arg.startsWith('--command-timeout-ms=')) {
      options.commandTimeoutMs = parsePositiveInteger(
        arg.slice('--command-timeout-ms='.length),
        options.commandTimeoutMs
      );
    }
  }

  return options;
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readWindow(report, name) {
  return report && report.hostedAudit && report.hostedAudit.summaries
    ? report.hostedAudit.summaries[name] || {}
    : {};
}

function conversionRate(numerator, denominator) {
  const den = number(denominator);
  if (den <= 0) return 0;
  return number(numerator) / den;
}

function topLeakingCounter({ starts = {}, paid = {}, revenueCents = {}, minimumStarts = 3 } = {}) {
  const rows = Object.keys(starts || {})
    .map((key) => {
      const checkoutStarts = number(starts[key]);
      const paidOrders = number(paid[key]);
      const bookedRevenueCents = number(revenueCents[key]);
      const leakCount = Math.max(0, checkoutStarts - paidOrders);
      const paidRate = conversionRate(paidOrders, checkoutStarts);
      return {
        key,
        checkoutStarts,
        paidOrders,
        bookedRevenueCents,
        leakCount,
        paidRate,
      };
    })
    .filter((row) => row.checkoutStarts >= minimumStarts)
    .sort((left, right) => (
      right.leakCount - left.leakCount ||
      left.paidRate - right.paidRate ||
      right.checkoutStarts - left.checkoutStarts ||
      left.key.localeCompare(right.key)
    ));
  return rows[0] || null;
}

function buildRevenuePlan(report, options = {}) {
  const trailing30 = readWindow(report, '30d');
  const today = readWindow(report, 'today');
  const runtime = report && report.hostedAudit ? report.hostedAudit.runtimePresence || {} : {};
  const runtimeKnown = Boolean(report && report.diagnosis && report.diagnosis.runtimePresenceKnown);
  const traffic30 = trailing30.trafficMetrics || {};
  const revenue30 = trailing30.revenue || {};
  const pipeline30 = trailing30.pipeline || {};
  const ctas30 = trailing30.ctas || {};
  const attribution30 = trailing30.attribution || {};
  const sprintLeads30 = pipeline30.workflowSprintLeads || {};
  const signups30 = trailing30.signups || {};
  const checkoutStarts = number(traffic30.checkoutStarts);
  const paidOrders = number(revenue30.paidOrders);
  const visitors = number(traffic30.visitors);
  const sprintLeads = number(sprintLeads30.total);
  const bookedRevenueCents = number(revenue30.bookedRevenueCents);
  const checkoutToPaidRate = conversionRate(paidOrders, checkoutStarts);
  const visitorToSprintLeadRate = conversionRate(sprintLeads, visitors);
  const leakingSource = topLeakingCounter({
    starts: ctas30.checkoutStartsBySource,
    paid: attribution30.paidBySource,
    revenueCents: attribution30.bookedRevenueBySourceCents,
  });
  const leakingCampaign = topLeakingCounter({
    starts: ctas30.checkoutStartsByCampaign,
    paid: attribution30.paidByCampaign,
    revenueCents: attribution30.bookedRevenueByCampaignCents,
  });
  const actions = [];

  function add(action) {
    actions.push({
      priority: actions.length + 1,
      ...action,
    });
  }

  if (runtimeKnown && !runtime.THUMBGATE_GA_MEASUREMENT_ID) {
    add({
      owner: 'human',
      status: 'blocked_on_account_value',
      title: 'Set GA4 measurement ID in Railway/GitHub variables',
      why: 'The page has GA4 hooks but no loader in production, so paid-intent attribution is blind outside first-party telemetry.',
      exactInputNeeded: 'GA4 Measurement ID, for example G-XXXXXXXXXX.',
      autonomousAfterInput: [
        'Set THUMBGATE_GA_MEASUREMENT_ID',
        'Redeploy Railway',
        'Verify gtag loader and generate_lead/begin_checkout events',
      ],
    });
  }

  if (runtimeKnown && !runtime.THUMBGATE_CHECKOUT_FALLBACK_URL) {
    add({
      owner: 'human',
      status: 'blocked_on_payment_link',
      title: 'Set Stripe checkout fallback URL',
      why: 'Checkout should have a no-code Stripe fallback when hosted session creation is unavailable.',
      exactInputNeeded: 'Live Stripe Payment Link URL for Pro or a fallback offer.',
      autonomousAfterInput: [
        'Set THUMBGATE_CHECKOUT_FALLBACK_URL',
        'Verify /checkout/pro 302 behavior',
        'Record fallback in revenue status',
      ],
    });
  }

  if (sprintLeads === 0 && visitors >= 500) {
    add({
      owner: 'human',
      status: 'blocked_on_payment_links',
      title: 'Activate paid high-ticket path above the sprint intake',
      why: `${visitors} visitors and ${checkoutStarts} checkout starts in 30d produced 0 sprint leads; the page needs a direct paid diagnostic/sprint path for buyers with budget now.`,
      exactInputNeeded: [
        `${DEFAULT_OFFER_STACK.diagnostic.envKey}: Stripe Payment Link for ${DEFAULT_OFFER_STACK.diagnostic.name} ($${DEFAULT_OFFER_STACK.diagnostic.priceDollars})`,
        `${DEFAULT_OFFER_STACK.sprint.envKey}: Stripe Payment Link for ${DEFAULT_OFFER_STACK.sprint.name} ($${DEFAULT_OFFER_STACK.sprint.priceDollars})`,
      ],
      autonomousAfterInput: [
        'Expose paid diagnostic/sprint buttons',
        'Track begin_checkout for both offers',
        'Keep unpaid intake as qualification fallback',
      ],
    });
  }

  if (checkoutStarts >= 25 && checkoutToPaidRate < 0.03) {
    const leakEvidence = leakingSource
      ? ` Top leaking source: ${leakingSource.key} (${leakingSource.checkoutStarts} starts, ${leakingSource.paidOrders} paid).`
      : '';
    const campaignEvidence = leakingCampaign
      ? ` Top leaking campaign: ${leakingCampaign.key} (${leakingCampaign.checkoutStarts} starts, ${leakingCampaign.paidOrders} paid).`
      : '';
    add({
      owner: 'agent',
      status: 'ready',
      title: 'Prioritize checkout-loss recovery before more top-of-funnel traffic',
      why: `${checkoutStarts} checkout starts converted to ${paidOrders} paid orders (${(checkoutToPaidRate * 100).toFixed(1)}%).${leakEvidence}${campaignEvidence}`,
      autonomousAction: leakingSource || leakingCampaign
        ? 'Move proof/payment CTA higher for the highest-leak source/campaign and route it to the paid diagnostic path when configured.'
        : 'Expose checkout-start attribution in the hosted summary, then move proof/payment CTA higher for the highest-leak source/campaign.',
    });
  }

  if (number(signups30.uniqueLeads) >= 25 && bookedRevenueCents < 50000) {
    add({
      owner: 'human',
      status: 'blocked_on_outbound_authority',
      title: 'Authorize compliant follow-up to captured buyer emails',
      why: `${number(signups30.uniqueLeads)} 30d signups exist, but booked revenue is ${centsToDollars(bookedRevenueCents)}. Follow-up needs explicit permission because it leaves the machine.`,
      exactInputNeeded: 'Written approval to send ThumbGate sales follow-up, sender identity, postal footer, and daily send limit.',
      autonomousAfterInput: [
        'Generate segmented follow-up sequence',
        'Send only to captured/qualified contacts',
        'Log stage changes in sales:pipeline',
      ],
    });
  }

  if (actions.length === 0) {
    add({
      owner: 'agent',
      status: 'ready',
      title: 'Keep optimizing the highest-leverage channel',
      why: 'No critical config gap was detected from the available report.',
      autonomousAction: 'Run channel-level attribution, produce the next experiment, and keep payment proof visible.',
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    source: report.source,
    offerStack: DEFAULT_OFFER_STACK,
    metrics: {
      todayVisitors: number((today.trafficMetrics || {}).visitors),
      visitors30d: visitors,
      checkoutStarts30d: checkoutStarts,
      paidOrders30d: paidOrders,
      bookedRevenue30d: centsToDollars(bookedRevenueCents),
      checkoutToPaidRate,
      sprintLeads30d: sprintLeads,
      visitorToSprintLeadRate,
      leakingSource,
      leakingCampaign,
    },
    constraints: [
      'Do not send public posts, emails, or DMs without explicit operator authorization.',
      'Do not automate LinkedIn scraping or messaging; keep LinkedIn work human-reviewed or API/terms-compliant.',
      'Cold/commercial email needs truthful headers, opt-out handling, and sender/domain authentication.',
      'Do not fabricate revenue, sent outreach, partner approval, or account configuration.',
    ],
    actions,
    options,
  };
}

function formatPlan(plan) {
  const lines = [
    `May 2026 Revenue Machine @ ${plan.generatedAt}`,
    `Source: ${plan.source}`,
    '',
    `30d: visitors ${plan.metrics.visitors30d}, checkoutStarts ${plan.metrics.checkoutStarts30d}, paidOrders ${plan.metrics.paidOrders30d}, bookedRevenue ${plan.metrics.bookedRevenue30d}, sprintLeads ${plan.metrics.sprintLeads30d}`,
    `Checkout -> paid: ${(plan.metrics.checkoutToPaidRate * 100).toFixed(2)}%`,
    `Visitor -> sprint lead: ${(plan.metrics.visitorToSprintLeadRate * 100).toFixed(2)}%`,
    '',
    'Constraints:',
    ...plan.constraints.map((constraint) => `- ${constraint}`),
    '',
    'Step-by-step actions:',
  ];

  for (const action of plan.actions) {
    lines.push(`${action.priority}. [${action.owner}/${action.status}] ${action.title}`);
    lines.push(`   Why: ${action.why}`);
    if (action.exactInputNeeded) {
      const inputs = Array.isArray(action.exactInputNeeded)
        ? action.exactInputNeeded
        : [action.exactInputNeeded];
      lines.push('   Need:');
      for (const input of inputs) lines.push(`   - ${input}`);
    }
    if (action.autonomousAction) {
      lines.push(`   I can do next: ${action.autonomousAction}`);
    }
    if (action.autonomousAfterInput) {
      lines.push('   I will do after input:');
      for (const step of action.autonomousAfterInput) lines.push(`   - ${step}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = await generateRevenueStatusReport({
    repo: options.repo,
    timeZone: options.timeZone,
    fetchTimeoutMs: options.fetchTimeoutMs,
    commandTimeoutMs: options.commandTimeoutMs,
  });
  const plan = buildRevenuePlan(report, options);
  process.stdout.write(options.json ? `${JSON.stringify(plan, null, 2)}\n` : formatPlan(plan));
}

module.exports = {
  DEFAULT_OFFER_STACK,
  parseArgs,
  buildRevenuePlan,
  formatPlan,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error && error.message ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
