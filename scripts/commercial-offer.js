'use strict';

const PRO_MONTHLY_PAYMENT_LINK = 'https://buy.stripe.com/5kQ4gzbmI9Lo6tPayn3sI06';
const PRO_ANNUAL_PAYMENT_LINK = 'https://buy.stripe.com/3cI8wPfCYaPs2dzdKz3sI07';
const PRO_FOUNDER_PAYMENT_LINK = 'https://buy.stripe.com/aFa4gz1M84r419v7mb3sI05';

const PRO_MONTHLY_PRICE_ID = 'price_1THQY7GGBpd520QYHoS7RG0J';
const PRO_ANNUAL_PRICE_ID = 'price_1THQZ7GGBpd520QYxzDRnxhB';
const TEAM_MONTHLY_PRICE_ID = 'price_1THQa5GGBpd520QYoqdq1R1S';

const PRO_MONTHLY_PRICE_DOLLARS = 19;
const PRO_ANNUAL_PRICE_DOLLARS = 149;
const TEAM_MONTHLY_PRICE_DOLLARS = 12;
const TEAM_ANNUAL_PRICE_DOLLARS = 99;
const TEAM_MIN_SEATS = 3;

const PRO_PRICE_LABEL = '$19/mo or $149/yr';
const TEAM_PRICE_LABEL = '$12/seat/mo (min 3 seats)';

function normalizePlanId(value) {
  const text = String(value || '').trim().toLowerCase();
  return text || 'pro';
}

function normalizeBillingCycle(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'yearly') return 'annual';
  return text || 'monthly';
}

function normalizeSeatCount(value, fallback = TEAM_MIN_SEATS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(TEAM_MIN_SEATS, Math.round(parsed));
}

module.exports = {
  PRO_MONTHLY_PAYMENT_LINK,
  PRO_ANNUAL_PAYMENT_LINK,
  PRO_FOUNDER_PAYMENT_LINK,
  PRO_MONTHLY_PRICE_ID,
  PRO_ANNUAL_PRICE_ID,
  TEAM_MONTHLY_PRICE_ID,
  PRO_MONTHLY_PRICE_DOLLARS,
  PRO_ANNUAL_PRICE_DOLLARS,
  TEAM_MONTHLY_PRICE_DOLLARS,
  TEAM_ANNUAL_PRICE_DOLLARS,
  TEAM_MIN_SEATS,
  PRO_PRICE_LABEL,
  TEAM_PRICE_LABEL,
  normalizePlanId,
  normalizeBillingCycle,
  normalizeSeatCount,
};
