#!/usr/bin/env node
'use strict';

/**
 * scripts/banking-code-confinement-diode.js
 *
 * Pre-action firewall diode inspired by Revolut's self-hosted GLM deployment
 * across 2,000 engineers (TechRadar / The Register Nov 2026).
 *
 * Enforces banking data and proprietary financial code privacy by strictly
 * confining sensitive banking operations (ledger settlements, cardholder data,
 * SWIFT/IBAN identifiers, payment tokens) to on-premise / self-hosted models
 * (localFrontier), hard-blocking egress to external commercial cloud LLMs.
 */

const BANKING_PATTERNS = Object.freeze([
  {
    id: 'financial_account_identifier',
    name: 'IBAN / SWIFT / Bank Account Identifier',
    pattern: /\b(?:[A-Z]{2}\d{2}[A-Z0-9]{11,30}|[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/,
    description: 'International Bank Account Number (IBAN) or SWIFT/BIC code.',
  },
  {
    id: 'payment_cardholder_data',
    name: 'Primary Account Number (PAN) / CVV Pattern',
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11})\b/,
    description: 'Unmasked credit/debit card primary account number.',
  },
  {
    id: 'core_ledger_transaction',
    name: 'Core Banking Ledger & Settlement Transaction',
    pattern: /\b(?:ledger_entry|settlement_batch|balance_transfer|reconciliation_run|ach_payout|wire_settlement|vault_rebalance)\b/i,
    description: 'Proprietary core banking ledger settlement and reconciliation mutation.',
  },
  {
    id: 'fintech_live_credentials',
    name: 'Live Fintech & Payment Gateway Credentials',
    pattern: /\b(?:sk_live_[a-zA-Z0-9]{24,}|revolut_live_[a-zA-Z0-9]{24,}|plaid_secret_[a-zA-Z0-9]{20,})\b/,
    description: 'Live production payment gateway or banking API credentials.',
  },
]);

const COMMERCIAL_CLOUD_PROVIDERS = new Set(['openai', 'anthropic', 'gemini', 'gemini-cloud']);

/**
 * Evaluates whether an agent action or model generation request complies with
 * banking code confinement policy.
 *
 * @param {object} action
 * @param {string} [action.provider]      - 'openai' | 'anthropic' | 'gemini' | 'openai-compatible' | 'local'
 * @param {string} [action.tier]          - 'localFrontier' | 'frontier' | 'mini' | 'nano'
 * @param {string} [action.payload]       - prompt, code diff, or tool command
 * @param {boolean} [action.strictMode]   - enforce confinement even without banking tags
 * @param {string[]} [action.tags]        - metadata tags
 * @returns {{ verdict: 'allow'|'block', findings: string[], confined: boolean, reason: string }}
 */
function evaluateBankingCodeConfinement(action = {}) {
  const payload = String(
    action.payload ||
    action.prompt ||
    action.code ||
    action.command ||
    (action.args && action.args.command) ||
    ''
  );
  const provider = String(action.provider || '').toLowerCase();
  const tier = String(action.tier || '');
  const tags = Array.isArray(action.tags) ? action.tags.map((t) => String(t).toLowerCase()) : [];
  const isBankingWorkload = tags.includes('banking') ||
    tags.includes('fintech') ||
    tags.includes('payment') ||
    Boolean(action.strictMode);

  const findings = [];
  for (const rule of BANKING_PATTERNS) {
    if (rule.pattern.test(payload)) {
      findings.push(rule.id);
    }
  }

  const hasBankingData = findings.length > 0 || isBankingWorkload;
  const isCloudProvider = COMMERCIAL_CLOUD_PROVIDERS.has(provider) || (tier === 'frontier' && provider !== 'openai-compatible');

  if (hasBankingData && isCloudProvider) {
    return {
      verdict: 'block',
      findings,
      confined: false,
      reason: `BLOCKED_CLOUD_EGRESS: Banking and financial ledger code detected [${findings.join(', ') || 'banking-tag'}]. Confinement policy requires routing to self-hosted/local model (Revolut compliance rule).`,
    };
  }

  const isConfined = tier === 'localFrontier' || provider === 'openai-compatible' || provider === 'local';

  return {
    verdict: 'allow',
    findings,
    confined: isConfined,
    reason: isConfined
      ? 'ALLOWED_CONFINED_ON_PREM: Banking payload confined to on-premise self-hosted cluster.'
      : 'ALLOWED: No sensitive banking data detected.',
  };
}

module.exports = {
  BANKING_PATTERNS,
  evaluateBankingCodeConfinement,
};
