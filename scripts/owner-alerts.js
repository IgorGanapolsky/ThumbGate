'use strict';

/**
 * Owner console alerts. Pure rules over the Money board and the Observability report: each alert says what happened,
 * with its numbers, and what to do next. No alert fires on a source that could not be read; that is its own alert.
 *
 * Delivery is off unless THUMBGATE_OWNER_ALERT_WEBHOOK is set (a Slack, Discord or Teams incoming webhook, all free).
 * A message goes out only when an alert appears that was not firing at the last check, so a standing problem is sent once.
 */

const LEVELS = { red: 0, amber: 1, info: 2 };
const dropped = (week, key, floor) => {
  const before = week?.prior7?.[key];
  const now = week?.last7?.[key];
  return Number.isFinite(before) && Number.isFinite(now) && before >= floor && now <= before / 2 ? { before, now } : null;
};
const percent = (part, whole) => Math.round((part / whole) * 100);

function evaluateAlerts({ money = null, report = null } = {}) {
  const alerts = [];
  const add = (id, level, text, action, tab) => alerts.push({ id, level, text, action, tab });

  if (report) {
    const errors = report.errors || {};
    if (Number.isFinite(errors.lastHour) && errors.lastHour >= 5) add('server_errors', 'red', errors.lastHour + ' server errors in the last hour.', 'Open Health to see which requests fail.', 'observability');
    const uptime = report.uptime || {};
    if (Number.isFinite(uptime.percent) && uptime.percent < 99.5) add('uptime', 'amber', 'Uptime is ' + uptime.percent + '% over about ' + uptime.observedDays + ' days.', 'Check the last outage on Health and the Railway deploy log.', 'observability');
    const hooks = report.webhooks || {};
    if (Number.isFinite(hooks.failures24h) && hooks.failures24h > 0) add('stripe_webhooks', 'red', hooks.failures24h + ' Stripe notifications failed in 24 hours, so a payment may not have unlocked Pro.', 'Check Stripe, Developers, Webhooks, and resend the failed events.', 'observability');
    const disk = report.disk || {};
    if (Number.isFinite(disk.percent) && disk.percent >= 85) add('disk', disk.percent >= 95 ? 'red' : 'amber', 'The data disk is ' + disk.percent + '% full.', 'Grow the Railway volume or rotate the telemetry log.', 'observability');
    const signIn = report.signIn || {};
    if (Number.isFinite(signIn.failed24h) && signIn.failed24h >= 10) add('sign_in', 'amber', signIn.failed24h + ' failed sign-ins in 24 hours.', 'Open Health to see the most common reason.', 'observability');
  }

  if (money) {
    const why = money.reasons || {};
    const stripeDown = ['payingCustomers', 'revenue', 'checkouts', 'mrr'].map((key) => why[key]).filter(Boolean);
    if (stripeDown.length) add('stripe_unreadable', 'amber', 'Stripe could not be read: ' + stripeDown[0] + '.', 'Refresh in a minute. If it stays, check the Stripe key on Railway.', 'money');
    if (why.visitors && why.visitors !== 'telemetry store empty') add('telemetry_unreadable', 'amber', 'Site and CLI telemetry could not be read: ' + why.visitors + '.', 'Refresh in a minute, then check the Railway volume.', 'analytics');

    const week = money.weekOverWeek;
    const visitors = dropped(week, 'realVisitors', 20);
    if (visitors) add('visitors_drop', 'amber', 'People on the site fell from ' + visitors.before + ' to ' + visitors.now + ' this week.', 'Check that the last deploy did not break a page, then check your launch posts and links.', 'analytics');
    const starts = dropped(week, 'checkoutStarts', 4);
    if (starts) add('checkout_drop', 'amber', 'Checkout starts fell from ' + starts.before + ' to ' + starts.now + ' this week.', 'Click through the pricing page to the Stripe checkout yourself.', 'money');
    const installs = dropped(week, 'activeInstalls', 4);
    if (installs) add('installs_drop', 'amber', 'Active CLI installs fell from ' + installs.before + ' to ' + installs.now + ' this week.', 'Run npx thumbgate init on a clean machine to check install still works.', 'analytics');

    const usage = money.usage30d;
    if (usage && usage.activeInstalls30d >= 10 && usage.activatedInstalls / usage.activeInstalls30d < 0.2) add('activation_low', 'amber', 'Only ' + usage.activatedInstalls + ' of ' + usage.activeInstalls30d + ' active installs (' + percent(usage.activatedInstalls, usage.activeInstalls30d) + '%) captured any feedback.', 'Make the first thumbs-down easier to reach in init.', 'analytics');

    if (Number.isFinite(money.cancellingAtPeriodEnd) && money.cancellingAtPeriodEnd > 0) add('cancelling', 'amber', money.cancellingAtPeriodEnd + ' subscriber' + (money.cancellingAtPeriodEnd === 1 ? ' is' : 's are') + ' set to cancel at the end of the period.', 'Look them up under Stripe records, Subscriptions, and ask why before the period ends.', 'stripe');
    const churned = money.recurring30d?.churnedSubscriptions;
    if (Number.isFinite(churned) && churned > 0) add('churned', 'amber', churned + ' subscription' + (churned === 1 ? '' : 's') + ' cancelled in the past 30 days.', 'Read the cancellation reasons in Stripe.', 'stripe');
  }

  return alerts.sort((a, b) => LEVELS[a.level] - LEVELS[b.level]);
}

function formatAlertMessage(alerts) {
  const lines = alerts.map((alert) => (alert.level === 'red' ? '[urgent] ' : '') + alert.text + ' ' + alert.action);
  return { title: 'ThumbGate: ' + alerts.length + ' thing' + (alerts.length === 1 ? '' : 's') + ' need you', message: lines.join('\n') + '\nhttps://thumbgate.ai/admin' };
}

// Returns the alerts that are new since the last call, and remembers the current set.
function createAlertTracker() {
  let firing = new Set();
  return {
    fresh(alerts) {
      const now = new Set(alerts.map((alert) => alert.id));
      const added = alerts.filter((alert) => !firing.has(alert.id));
      firing = now;
      return added;
    },
  };
}

module.exports = { evaluateAlerts, formatAlertMessage, createAlertTracker };
