#!/usr/bin/env node
'use strict';

const path = require('node:path');
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
  return report?.hostedAudit?.summaries?.[name] || {};
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

function humanBlockedAction(status, title, why, exactInputNeeded, autonomousAfterInput) {
  return {
    owner: 'human',
    status,
    title,
    why,
    exactInputNeeded,
    autonomousAfterInput,
  };
}

function agentReadyAction(title, why, autonomousAction) {
  return {
    owner: 'agent',
    status: 'ready',
    title,
    why,
    autonomousAction,
  };
}

function buildRevenueMetrics(report) {
  const trailing30 = readWindow(report, '30d');
  const today = readWindow(report, 'today');
  const runtime = report?.hostedAudit?.runtimePresence || {};
  const runtimeKnown = Boolean(report?.diagnosis?.runtimePresenceKnown);
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

  return {
    runtime,
    runtimeKnown,
    todayVisitors: number(today.trafficMetrics?.visitors),
    visitors,
    checkoutStarts,
    paidOrders,
    sprintLeads,
    bookedRevenueCents,
    checkoutToPaidRate,
    visitorToSprintLeadRate,
    uniqueLeads: number(signups30.uniqueLeads),
    leakingSource,
    leakingCampaign,
  };
}

function buildRuntimeGapActions({ runtime, runtimeKnown }) {
  if (!runtimeKnown) return [];
  return [
    !runtime.THUMBGATE_GA_MEASUREMENT_ID && humanBlockedAction(
      'blocked_on_account_value',
      'Set GA4 measurement ID in Railway/GitHub variables',
      'The page has GA4 hooks but no loader in production, so paid-intent attribution is blind outside first-party telemetry.',
      'GA4 Measurement ID, for example G-XXXXXXXXXX.',
      [
        'Set THUMBGATE_GA_MEASUREMENT_ID',
        'Redeploy Railway',
        'Verify gtag loader and generate_lead/begin_checkout events',
      ]
    ),
    !runtime.THUMBGATE_CHECKOUT_FALLBACK_URL && humanBlockedAction(
      'blocked_on_payment_link',
      'Set Stripe checkout fallback URL',
      'Checkout should have a no-code Stripe fallback when hosted session creation is unavailable.',
      'Live Stripe Payment Link URL for Pro or a fallback offer.',
      [
        'Set THUMBGATE_CHECKOUT_FALLBACK_URL',
        'Verify /checkout/pro 302 behavior',
        'Record fallback in revenue status',
      ]
    ),
  ].filter(Boolean);
}

function buildSprintPathAction({ visitors, checkoutStarts, sprintLeads }) {
  if (sprintLeads === 0 && visitors >= 500) {
    return humanBlockedAction(
      'blocked_on_payment_links',
      'Activate paid high-ticket path above the sprint intake',
      `${visitors} visitors and ${checkoutStarts} checkout starts in 30d produced 0 sprint leads; the page needs a direct paid diagnostic/sprint path for buyers with budget now.`,
      [
        `${DEFAULT_OFFER_STACK.diagnostic.envKey}: Stripe Payment Link for ${DEFAULT_OFFER_STACK.diagnostic.name} ($${DEFAULT_OFFER_STACK.diagnostic.priceDollars})`,
        `${DEFAULT_OFFER_STACK.sprint.envKey}: Stripe Payment Link for ${DEFAULT_OFFER_STACK.sprint.name} ($${DEFAULT_OFFER_STACK.sprint.priceDollars})`,
      ],
      [
        'Expose paid diagnostic/sprint buttons',
        'Track begin_checkout for both offers',
        'Keep unpaid intake as qualification fallback',
      ]
    );
  }
  return null;
}

function leakEvidence(label, leak) {
  return leak
    ? ` Top leaking ${label}: ${leak.key} (${leak.checkoutStarts} starts, ${leak.paidOrders} paid).`
    : '';
}

function buildCheckoutRecoveryAction({
  checkoutStarts,
  checkoutToPaidRate,
  paidOrders,
  leakingSource,
  leakingCampaign,
}) {
  if (checkoutStarts >= 25 && checkoutToPaidRate < 0.03) {
    return agentReadyAction(
      'Prioritize checkout-loss recovery before more top-of-funnel traffic',
      `${checkoutStarts} checkout starts converted to ${paidOrders} paid orders (${(checkoutToPaidRate * 100).toFixed(1)}%).${leakEvidence('source', leakingSource)}${leakEvidence('campaign', leakingCampaign)}`,
      leakingSource || leakingCampaign
        ? 'Move proof/payment CTA higher for the highest-leak source/campaign and route it to the paid diagnostic path when configured.'
        : 'Expose checkout-start attribution in the hosted summary, then move proof/payment CTA higher for the highest-leak source/campaign.'
    );
  }
  return null;
}

function buildOutboundAction({ uniqueLeads, bookedRevenueCents }) {
  if (uniqueLeads >= 25 && bookedRevenueCents < 50000) {
    return humanBlockedAction(
      'blocked_on_outbound_authority',
      'Authorize compliant follow-up to captured buyer emails',
      `${uniqueLeads} 30d signups exist, but booked revenue is ${centsToDollars(bookedRevenueCents)}. Follow-up needs explicit permission because it leaves the machine.`,
      'Written approval to send ThumbGate sales follow-up, sender identity, postal footer, and daily send limit.',
      [
        'Generate segmented follow-up sequence',
        'Send only to captured/qualified contacts',
        'Log stage changes in sales:pipeline',
      ]
    );
  }
  return null;
}

function prioritizeActions(actions) {
  const filtered = actions.filter(Boolean);
  if (filtered.length === 0) {
    filtered.push(agentReadyAction(
      'Keep optimizing the highest-leverage channel',
      'No critical config gap was detected from the available report.',
      'Run channel-level attribution, produce the next experiment, and keep payment proof visible.'
    ));
  }

  return filtered.map((action, index) => ({
    priority: index + 1,
    ...action,
  }));
}

function buildRevenuePlan(report, options = {}) {
  const metrics = buildRevenueMetrics(report);
  const actions = prioritizeActions([
    ...buildRuntimeGapActions(metrics),
    buildSprintPathAction(metrics),
    buildCheckoutRecoveryAction(metrics),
    buildOutboundAction(metrics),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    source: report.source,
    offerStack: DEFAULT_OFFER_STACK,
    metrics: {
      todayVisitors: metrics.todayVisitors,
      visitors30d: metrics.visitors,
      checkoutStarts30d: metrics.checkoutStarts,
      paidOrders30d: metrics.paidOrders,
      bookedRevenue30d: centsToDollars(metrics.bookedRevenueCents),
      checkoutToPaidRate: metrics.checkoutToPaidRate,
      sprintLeads30d: metrics.sprintLeads,
      visitorToSprintLeadRate: metrics.visitorToSprintLeadRate,
      leakingSource: metrics.leakingSource,
      leakingCampaign: metrics.leakingCampaign,
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

function formatAction(action) {
  const lines = [
    `${action.priority}. [${action.owner}/${action.status}] ${action.title}`,
    `   Why: ${action.why}`,
  ];
  const inputs = action.exactInputNeeded && (
    Array.isArray(action.exactInputNeeded)
      ? action.exactInputNeeded
      : [action.exactInputNeeded]
  );
  const afterInput = action.autonomousAfterInput || [];

  if (inputs) {
    lines.push('   Need:', ...inputs.map((input) => `   - ${input}`));
  }
  if (action.autonomousAction) {
    lines.push(`   I can do next: ${action.autonomousAction}`);
  }
  if (afterInput.length > 0) {
    lines.push('   I will do after input:', ...afterInput.map((step) => `   - ${step}`));
  }

  return lines;
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
    lines.push(...formatAction(action));
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

function isCliEntrypoint(entrypoint = process.argv[1]) {
  return Boolean(entrypoint) && path.resolve(entrypoint) === __filename;
}

if (isCliEntrypoint()) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || String(error)}\n`);
    process.exit(1);
  });
}
