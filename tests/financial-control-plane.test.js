'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-erp-'));
const prevFinancialDir = process.env.THUMBGATE_FINANCIAL_DIR;
const prevAuthPath = process.env.THUMBGATE_SPEND_AUTH_PATH;
const prevSpendAuth = process.env.THUMBGATE_SPEND_AUTH;
const prevConfig = process.env.THUMBGATE_FINANCIAL_CONFIG;

process.env.THUMBGATE_FINANCIAL_DIR = path.join(tmpRoot, 'financial');
process.env.THUMBGATE_SPEND_AUTH_PATH = path.join(tmpRoot, 'spend-authorizations.jsonl');
delete process.env.THUMBGATE_SPEND_AUTH;

const fcp = require('../scripts/financial-control-plane');
const spendGuard = require('../scripts/thumbgate-spend-guard');

before(() => {
  fs.mkdirSync(process.env.THUMBGATE_FINANCIAL_DIR, { recursive: true });
});

after(() => {
  if (prevFinancialDir === undefined) delete process.env.THUMBGATE_FINANCIAL_DIR;
  else process.env.THUMBGATE_FINANCIAL_DIR = prevFinancialDir;
  if (prevAuthPath === undefined) delete process.env.THUMBGATE_SPEND_AUTH_PATH;
  else process.env.THUMBGATE_SPEND_AUTH_PATH = prevAuthPath;
  if (prevSpendAuth === undefined) delete process.env.THUMBGATE_SPEND_AUTH;
  else process.env.THUMBGATE_SPEND_AUTH = prevSpendAuth;
  if (prevConfig === undefined) delete process.env.THUMBGATE_FINANCIAL_CONFIG;
  else process.env.THUMBGATE_FINANCIAL_CONFIG = prevConfig;
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

test('ERP classifies free Apollo search as non-financial', () => {
  const c = fcp.classifyFinancialIntent('Bash', { command: 'apollo people search --q founder' });
  assert.equal(c.financial, false);
  assert.equal(c.freeAllowed, true);
});

test('ERP classifies Apollo upgrade URL as saas_upgrade', () => {
  const c = fcp.classifyFinancialIntent('Bash', {
    command: 'open https://app.apollo.io/#/settings/plans/upgrade',
  });
  assert.equal(c.financial, true);
  assert.equal(c.class, 'saas_upgrade');
  assert.equal(c.vendor, 'apollo');
});

test('ERP hard-denies unauthenticated paid mutation and journals it', () => {
  const r = fcp.evaluateFinancialControl('Bash', {
    command: 'upgrade plan and buy credits for Apollo Pro',
  });
  assert.equal(r.decision, 'deny');
  assert.equal(r.gate, 'financial-control-plane');
  assert.ok(fs.existsSync(fcp.journalPath()));
  const journal = fcp.readJsonl(fcp.journalPath(), 20);
  assert.ok(journal.some((e) => e.event === 'deny_unauth_spend'));
});

test('ERP default envelope is $0 — authorization alone does not open unlimited spend without cap raise', () => {
  // With daily/monthly caps at 0, even a positive auth is denied by envelope.
  const auth = fcp.issueAuthorization({
    amountUsd: 10,
    vendor: 'apollo',
    note: 'test auth',
    ttlMinutes: 15,
  });
  assert.ok(auth.id);
  const r = fcp.evaluateFinancialControl('Bash', {
    command: 'upgrade Apollo Pro plan',
  });
  assert.equal(r.decision, 'deny');
  assert.equal(r.gate, 'financial-control-envelope');
});

test('spend-guard defers to ERP and hard-denies checkout paths', () => {
  assert.equal(
    spendGuard.evaluateSpend('Bash', { command: 'apollo people search --q x' }).decision,
    'allow',
  );
  assert.equal(
    spendGuard.evaluateSpend('WebFetch', {
      url: 'https://app.apollo.io/settings/plans/upgrade',
    }).decision,
    'deny',
  );
  assert.equal(
    spendGuard.evaluateSpend('Bash', {
      command: 'curl -X POST https://checkout.stripe.com/c/pay/cs_test',
    }).decision,
    'deny',
  );
});

test('status reports ERP modules and zero-spend envelope', () => {
  const status = fcp.getFinancialStatus();
  assert.match(status.erp, /Financial Control Plane/);
  assert.equal(status.envelope.dailyCapUsd, 0);
  assert.equal(status.envelope.monthlyCapUsd, 0);
});
