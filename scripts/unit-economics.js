'use strict';

// Unit economics for the owner console: what it costs to deliver ThumbGate, per active install and per paying customer,
// and what each plan keeps after those costs. Pure arithmetic over numbers the app already has:
//   - hosting: the container's own measured CPU and memory (scripts/cost-meter.js) at Railway's list rates
//   - email: emails the mailer sent, at Resend's per-email rate
//   - payment fees: Stripe's fee on each ThumbGate checkout when Stripe returned it, else the published card rate
//   - revenue: Stripe checkouts and renewal invoices (US dollars only; other currencies are listed, never converted)
// Every figure carries its basis. A number that cannot be measured is null with a reason, never a guess.

const fs = require('node:fs');
const path = require('node:path');

const MONTH_SECONDS = 30 * 86400;
const cents = (usd) => (Number.isFinite(usd) ? Math.round(usd * 100) : null);
const round2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
const round4 = (n) => (Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null);
const usdCents = (byCurrency) => (byCurrency && Number.isSafeInteger(byCurrency.USD) ? byCurrency.USD : 0);
const sumList = (list) => (Array.isArray(list) ? list : []).filter((item) => item && Number.isFinite(item.usd) && item.usd >= 0).reduce((total, item) => total + item.usd, 0);

function loadUnitCosts(file = path.join(__dirname, '..', 'config', 'unit-costs.json')) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// Hosting for the window: measured compute plus the configured volume and egress, scaled to 30 days when the meter
// covered only part of the window (for example the first days after this feature shipped).
function hostingCost(meter, rates) {
  if (!meter || !rates || !(meter.sampledSeconds > 0)) return { usd: null, measuredUsd: null, coverage: meter ? meter.coverage || 0 : 0, basis: 'not_measured_yet', reason: 'The cost meter has no samples yet. It records once a minute after the server starts.' };
  const cpuUsd = (meter.cpuSeconds / MONTH_SECONDS) * rates.vcpuMonthUsd;
  const memoryUsd = (meter.memoryGbSeconds / MONTH_SECONDS) * rates.memoryGbMonthUsd;
  const measuredUsd = cpuUsd + memoryUsd;
  const scale = MONTH_SECONDS / meter.sampledSeconds;
  const computeMonthUsd = measuredUsd * scale;
  const volumeUsd = (Number(rates.volumeGb) || 0) * (Number(rates.volumeGbMonthUsd) || 0);
  const egressUsd = (Number(rates.egressGbPerMonth) || 0) * (Number(rates.egressGbUsd) || 0);
  const full = meter.coverage >= 0.95;
  return {
    usd: round4(computeMonthUsd + volumeUsd + egressUsd),
    measuredUsd: round4(measuredUsd),
    parts: { cpuUsd: round4(cpuUsd * scale), memoryUsd: round4(memoryUsd * scale), volumeUsd: round4(volumeUsd), egressUsd: round4(egressUsd) },
    coverage: round4(meter.coverage),
    sources: meter.sources || [],
    basis: full ? 'measured_30d' : 'projected_from_partial_window',
    reason: full ? null : `The meter covered ${Math.round(meter.coverage * 1000) / 10}% of the 30 days, so compute is projected to 30 days from what it saw.`,
  };
}

// Stripe fees in US dollars: the fees Stripe returned for ThumbGate checkouts, plus the published rate for what it did not
// return and for renewal invoices. Subscription money also pays the Stripe Billing percentage.
function paymentFees(money, rates) {
  if (!money || !rates) return { usd: null, basis: 'unavailable', reason: 'Stripe numbers are not available right now.' };
  const fees = money.paymentFees30d || {};
  const reported = usdCents(fees.reportedFees) / 100;
  const unreportedCharges = Number.isSafeInteger(fees.unreportedCharges) ? fees.unreportedCharges : 0;
  const unreportedAmount = usdCents(fees.unreportedAmount) / 100;
  const renewalCount = Number.isSafeInteger(money.recurring30d?.renewalInvoices) ? money.recurring30d.renewalInvoices : 0;
  const renewalUsd = usdCents(money.recurring30d?.renewalRevenue) / 100;
  const card = (count, amount) => count * rates.fixedUsd + amount * rates.percent;
  const estimated = card(unreportedCharges, unreportedAmount) + card(renewalCount, renewalUsd) + renewalUsd * (rates.billingPercent || 0) + (usdCents(fees.subscriptionFirstCharges) / 100) * (rates.billingPercent || 0);
  return { usd: round4(reported + estimated), reportedUsd: round4(reported), estimatedUsd: round4(estimated), basis: estimated > 0 ? (reported > 0 ? 'stripe_reported_plus_published_rate' : 'published_rate') : 'stripe_reported' };
}

function perUnit(totalUsd, count) {
  return Number.isFinite(totalUsd) && Number.isInteger(count) && count > 0 ? round4(totalUsd / count) : null;
}

// Contribution for one plan sale: price, minus the payment fee on that price, minus the delivery cost one customer adds.
function planContribution({ priceUsd, recurring, costPerCustomerUsd, rates, laborNote = null }) {
  if (!Number.isFinite(priceUsd) || !rates) return null;
  const feeUsd = priceUsd * rates.percent + rates.fixedUsd + (recurring ? priceUsd * (rates.billingPercent || 0) : 0);
  const deliveryUsd = Number.isFinite(costPerCustomerUsd) ? costPerCustomerUsd : 0;
  const contributionUsd = priceUsd - feeUsd - deliveryUsd;
  return { priceUsd: round2(priceUsd), paymentFeeUsd: round2(feeUsd), deliveryCostUsd: round4(deliveryUsd), contributionUsd: round2(contributionUsd), marginPct: round4(contributionUsd / priceUsd), laborNote };
}

// The whole board. `money` is collectMoney's data, `usage` the 30-day CLI usage, `meter` cost-meter's 30-day window.
function computeUnitEconomics({ money = null, usage = null, meter = null, costs = loadUnitCosts() } = {}) {
  if (!costs) return { status: 'unavailable', reason: 'config/unit-costs.json could not be read.' };
  const hosting = hostingCost(meter, costs.hosting);
  const emails = meter ? meter.emails : null;
  const emailUsd = Number.isInteger(emails) ? round4(emails * costs.email.costPerEmailUsd) : null;
  const fees = paymentFees(money, costs.payments);
  const fixedUsd = round4(sumList(costs.fixedDeliveryMonthly));
  const buildUsd = round4(sumList(costs.buildAndInternalMonthly));
  const parts = [hosting.usd, emailUsd, fees.usd, fixedUsd];
  const deliveryUsd = parts.every(Number.isFinite) ? round4(parts.reduce((a, b) => a + b, 0)) : null;
  // Serving cost (hosting, email, fixed) is shared by every install; payment fees belong to paying customers only.
  const servingUsd = [hosting.usd, emailUsd, fixedUsd].every(Number.isFinite) ? hosting.usd + emailUsd + fixedUsd : null;

  const activeInstalls = Number.isInteger(usage?.activeInstalls30d) ? usage.activeInstalls30d : null;
  const payingCustomers = Number.isInteger(money?.payingCustomers) ? money.payingCustomers : null;
  const activePro = Number.isInteger(money?.activePro) ? money.activePro : null;
  const servingPerInstall = perUnit(servingUsd, activeInstalls);

  const oneTimeUsd = money ? usdCents(money.revenueLast30Days) / 100 : null;
  const renewalsUsd = money ? usdCents(money.recurring30d?.renewalRevenue) / 100 : null;
  const revenueUsd = money ? round2(oneTimeUsd + renewalsUsd) : null;
  const otherCurrencies = money ? [...new Set([...Object.keys(money.revenueLast30Days || {}), ...Object.keys(money.recurring30d?.renewalRevenue || {}), ...Object.keys(money.mrr || {})])].filter((code) => code !== 'USD') : [];
  const contribution = Number.isFinite(revenueUsd) && Number.isFinite(deliveryUsd)
    ? { revenueUsd, deliveryUsd, contributionUsd: round2(revenueUsd - deliveryUsd), marginPct: revenueUsd > 0 ? round4((revenueUsd - deliveryUsd) / revenueUsd) : null, afterBuildUsd: round2(revenueUsd - deliveryUsd - buildUsd) }
    : null;

  // Pro: the list price, or the average active subscription in dollars when Stripe has some.
  const mrrUsd = money ? usdCents(money.mrr) / 100 : 0;
  const proPrice = activePro > 0 && mrrUsd > 0 ? mrrUsd / activePro : costs.plans.pro.listMonthlyUsd;
  const plans = {
    pro: { name: costs.plans.pro.name, priceBasis: activePro > 0 && mrrUsd > 0 ? 'stripe_average_active_subscription' : 'list_price', ...planContribution({ priceUsd: proPrice, recurring: true, costPerCustomerUsd: servingPerInstall, rates: costs.payments }) },
    setupSprint: { name: costs.plans.setupSprint.name, priceBasis: 'list_price', ...planContribution({ priceUsd: costs.plans.setupSprint.listUsd, recurring: false, costPerCustomerUsd: servingPerInstall, rates: costs.payments, laborNote: costs.plans.setupSprint.deliveryHoursNote }) },
  };

  const reasons = {};
  if (hosting.reason) reasons.hosting = hosting.reason;
  if (fees.reason) reasons.paymentFees = fees.reason;
  if (activeInstalls === null) reasons.activeInstalls = 'CLI usage telemetry is not available right now.';
  else if (activeInstalls === 0) reasons.activeInstalls = 'No active installs in 30 days, so there is no cost per install.';
  if (payingCustomers === 0) reasons.payingCustomers = 'No paying customers, so there is no cost per paying customer.';
  if (!costs.fixedDeliveryMonthly.length) reasons.fixed = 'No fixed delivery costs are recorded in config/unit-costs.json.';
  if (!costs.buildAndInternalMonthly.length) reasons.build = 'No build or internal costs are recorded in config/unit-costs.json, so "after build costs" equals contribution.';
  if (otherCurrencies.length) reasons.currencies = `Revenue in ${otherCurrencies.join(', ')} is left out: only US dollars are added up, and nothing is converted.`;

  return {
    status: deliveryUsd === null ? 'partial' : 'ok',
    window: '30d',
    ratesCheckedAt: costs.checkedAt,
    delivery: { hostingUsd: hosting.usd, hosting, emails, emailUsd, emailBasis: costs.email.basis, paymentFeesUsd: fees.usd, paymentFees: fees, fixedUsd, totalUsd: deliveryUsd },
    build: { totalUsd: buildUsd, items: costs.buildAndInternalMonthly },
    denominators: { activeInstalls30d: activeInstalls, payingCustomers, activePro },
    perActiveInstallUsd: servingPerInstall,
    perPayingCustomerUsd: perUnit(deliveryUsd, payingCustomers),
    revenue: { oneTimeUsd, renewalsUsd, totalUsd: revenueUsd, mrrUsd: money ? round2(mrrUsd) : null },
    contribution,
    plans,
    reasons,
    sources: { hosting: costs.hosting.source, email: costs.email.source, payments: costs.payments.source },
  };
}

module.exports = { computeUnitEconomics, hostingCost, paymentFees, planContribution, loadUnitCosts, cents };
