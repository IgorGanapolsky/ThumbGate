'use strict';

/**
 * tests/mailer-dns.test.js — granular unit tests for the mailer's Resend sender
 * DNS gating.
 *
 * Covers the internal helpers that keep ThumbGate from sending email from a
 * domain whose DNS is not yet configured for Resend:
 *   - recordsHaveResendDns       — pure predicate over DNS record shapes
 *   - hasResendSenderDns         — resolver + cache + verified-domain bypass
 *   - resolveSenderAddress       — ready-vs-fallback branching
 *   - getCachedSenderDnsReadiness / setCachedSenderDnsReadiness — TTL behaviour
 *
 * These tests intentionally import `scripts/mailer/resend-mailer` directly
 * (not the package entry point) because they exercise private helpers that
 * are exposed on the module object under `_`-prefixed names for testing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const mailerModulePath = require.resolve('../scripts/mailer/resend-mailer');

function freshInternals() {
  delete require.cache[mailerModulePath];
  const mod = require('../scripts/mailer/resend-mailer');
  return {
    recordsHaveResendDns: mod._recordsHaveResendDns,
    hasResendSenderDns: mod._hasResendSenderDns,
    resolveSenderAddress: mod._resolveSenderAddress,
    getCachedSenderDnsReadiness: mod._getCachedSenderDnsReadiness,
    setCachedSenderDnsReadiness: mod._setCachedSenderDnsReadiness,
    senderDnsCache: mod._senderDnsCache,
    SENDER_DNS_CACHE_MS: mod._SENDER_DNS_CACHE_MS,
    constants: mod._constants,
  };
}

function savingEnv(keys) {
  const saved = {};
  for (const k of keys) saved[k] = process.env[k];
  return () => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
}

const GOOD_DKIM = [['p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...']];
const GOOD_MX = [{ priority: 10, exchange: 'feedback-smtp.us-east-1.amazonses.com' }];
const GOOD_SPF = [['v=spf1 include:amazonses.com ~all']];

/* ---------- recordsHaveResendDns ---------- */

test('recordsHaveResendDns returns true when DKIM/MX/SPF all match Resend', () => {
  const { recordsHaveResendDns } = freshInternals();
  assert.equal(
    recordsHaveResendDns({ dkimRecords: GOOD_DKIM, mxRecords: GOOD_MX, spfRecords: GOOD_SPF }),
    true,
  );
});

test('recordsHaveResendDns returns false when DKIM record lacks p= prefix', () => {
  const { recordsHaveResendDns } = freshInternals();
  assert.equal(
    recordsHaveResendDns({
      dkimRecords: [['v=DKIM1; k=rsa']],
      mxRecords: GOOD_MX,
      spfRecords: GOOD_SPF,
    }),
    false,
  );
});

test('recordsHaveResendDns returns false when MX exchange is not the SES feedback host', () => {
  const { recordsHaveResendDns } = freshInternals();
  assert.equal(
    recordsHaveResendDns({
      dkimRecords: GOOD_DKIM,
      mxRecords: [{ priority: 10, exchange: 'mail.other-provider.com' }],
      spfRecords: GOOD_SPF,
    }),
    false,
  );
});

test('recordsHaveResendDns returns false when SPF record does not include amazonses.com', () => {
  const { recordsHaveResendDns } = freshInternals();
  assert.equal(
    recordsHaveResendDns({
      dkimRecords: GOOD_DKIM,
      mxRecords: GOOD_MX,
      spfRecords: [['v=spf1 include:_spf.google.com ~all']],
    }),
    false,
  );
});

test('recordsHaveResendDns handles missing/empty record arrays without throwing', () => {
  const { recordsHaveResendDns } = freshInternals();
  assert.equal(recordsHaveResendDns({ dkimRecords: [], mxRecords: [], spfRecords: [] }), false);
  assert.equal(
    recordsHaveResendDns({ dkimRecords: undefined, mxRecords: undefined, spfRecords: undefined }),
    false,
  );
});

test('recordsHaveResendDns joins multi-chunk TXT records before matching', () => {
  // Resend publishes a DKIM key that DNS returns as multiple TXT chunks.
  // The helper must rejoin chunks before matching the p= prefix.
  const { recordsHaveResendDns } = freshInternals();
  const chunkedDkim = [['p=MIIBIjANBgkqhkiG', '9w0BAQEFAAOCAQ8AMIIBCgKCAQEA']];
  assert.equal(
    recordsHaveResendDns({
      dkimRecords: chunkedDkim,
      mxRecords: GOOD_MX,
      spfRecords: GOOD_SPF,
    }),
    true,
  );
});

/* ---------- hasResendSenderDns ---------- */

test('hasResendSenderDns returns true for empty domain without a lookup', async () => {
  const { hasResendSenderDns } = freshInternals();
  let called = false;
  const dnsResolver = { resolveTxt: () => { called = true; return []; }, resolveMx: () => { called = true; return []; } };
  assert.equal(await hasResendSenderDns('', { dnsResolver }), true);
  assert.equal(called, false, 'resolver must not be consulted for empty domain');
});

test('hasResendSenderDns returns true for the resend.dev sandbox domain without a lookup', async () => {
  const { hasResendSenderDns } = freshInternals();
  let called = false;
  const dnsResolver = { resolveTxt: () => { called = true; return []; }, resolveMx: () => { called = true; return []; } };
  assert.equal(await hasResendSenderDns('resend.dev', { dnsResolver }), true);
  assert.equal(called, false, 'resolver must not be consulted for the sandbox domain');
});

test('hasResendSenderDns short-circuits when THUMBGATE_ALLOW_UNVERIFIED_SENDER is truthy', async () => {
  const restore = savingEnv(['THUMBGATE_ALLOW_UNVERIFIED_SENDER', 'THUMBGATE_VERIFIED_SENDER_DOMAINS']);
  process.env.THUMBGATE_ALLOW_UNVERIFIED_SENDER = '1';
  delete process.env.THUMBGATE_VERIFIED_SENDER_DOMAINS;
  const { hasResendSenderDns } = freshInternals();
  let called = false;
  const dnsResolver = {
    resolveTxt: async () => { called = true; return []; },
    resolveMx: async () => { called = true; return []; },
  };
  assert.equal(await hasResendSenderDns('any-unverified.example', { dnsResolver }), true);
  assert.equal(called, false, 'resolver must not run when the override is enabled');
  restore();
});

test('hasResendSenderDns short-circuits when domain is on THUMBGATE_VERIFIED_SENDER_DOMAINS', async () => {
  const restore = savingEnv(['THUMBGATE_ALLOW_UNVERIFIED_SENDER', 'THUMBGATE_VERIFIED_SENDER_DOMAINS']);
  delete process.env.THUMBGATE_ALLOW_UNVERIFIED_SENDER;
  process.env.THUMBGATE_VERIFIED_SENDER_DOMAINS = 'thumbgate.app, example.com';
  const { hasResendSenderDns } = freshInternals();
  let called = false;
  const dnsResolver = {
    resolveTxt: async () => { called = true; return []; },
    resolveMx: async () => { called = true; return []; },
  };
  assert.equal(await hasResendSenderDns('thumbgate.app', { dnsResolver }), true);
  assert.equal(await hasResendSenderDns('EXAMPLE.com'.toLowerCase(), { dnsResolver }), true);
  assert.equal(called, false, 'verified-list bypass must not consult DNS');
  restore();
});

test('hasResendSenderDns returns true when resolver returns a complete Resend record set', async () => {
  const restore = savingEnv(['THUMBGATE_ALLOW_UNVERIFIED_SENDER', 'THUMBGATE_VERIFIED_SENDER_DOMAINS']);
  delete process.env.THUMBGATE_ALLOW_UNVERIFIED_SENDER;
  delete process.env.THUMBGATE_VERIFIED_SENDER_DOMAINS;
  const { hasResendSenderDns } = freshInternals();
  const dnsResolver = {
    resolveTxt: async (name) => {
      if (name.startsWith('resend._domainkey.')) return GOOD_DKIM;
      if (name.startsWith('send.')) return GOOD_SPF;
      return [];
    },
    resolveMx: async () => GOOD_MX,
  };
  assert.equal(await hasResendSenderDns('thumbgate.app', { dnsResolver }), true);
  restore();
});

test('hasResendSenderDns returns false when DNS lookup throws (ENOTFOUND)', async () => {
  const restore = savingEnv(['THUMBGATE_ALLOW_UNVERIFIED_SENDER', 'THUMBGATE_VERIFIED_SENDER_DOMAINS']);
  delete process.env.THUMBGATE_ALLOW_UNVERIFIED_SENDER;
  delete process.env.THUMBGATE_VERIFIED_SENDER_DOMAINS;
  const { hasResendSenderDns } = freshInternals();
  const dnsResolver = {
    resolveTxt: async () => { throw Object.assign(new Error('queryTxt ENOTFOUND'), { code: 'ENOTFOUND' }); },
    resolveMx: async () => { throw Object.assign(new Error('queryMx ENOTFOUND'), { code: 'ENOTFOUND' }); },
  };
  assert.equal(await hasResendSenderDns('new-domain.test', { dnsResolver }), false);
  restore();
});

test('hasResendSenderDns bypasses cache when a custom dnsResolver is injected', async () => {
  const restore = savingEnv(['THUMBGATE_ALLOW_UNVERIFIED_SENDER', 'THUMBGATE_VERIFIED_SENDER_DOMAINS']);
  delete process.env.THUMBGATE_ALLOW_UNVERIFIED_SENDER;
  delete process.env.THUMBGATE_VERIFIED_SENDER_DOMAINS;
  const { hasResendSenderDns, senderDnsCache } = freshInternals();
  senderDnsCache.clear();

  let txtCalls = 0;
  let mxCalls = 0;
  const dnsResolver = {
    resolveTxt: async (name) => {
      txtCalls++;
      if (name.startsWith('resend._domainkey.')) return GOOD_DKIM;
      if (name.startsWith('send.')) return GOOD_SPF;
      return [];
    },
    resolveMx: async () => { mxCalls++; return GOOD_MX; },
  };

  await hasResendSenderDns('thumbgate.app', { dnsResolver });
  await hasResendSenderDns('thumbgate.app', { dnsResolver });

  assert.equal(txtCalls, 4, 'both DKIM+SPF TXT lookups must run on every call (no cache)');
  assert.equal(mxCalls, 2, 'MX lookup must run on every call (no cache)');
  assert.equal(senderDnsCache.size, 0, 'injected-resolver path must never populate the shared cache');
  restore();
});

/* ---------- getCachedSenderDnsReadiness / setCachedSenderDnsReadiness ---------- */

test('cache helpers return null for an unknown key', () => {
  const { getCachedSenderDnsReadiness, senderDnsCache } = freshInternals();
  senderDnsCache.clear();
  assert.equal(getCachedSenderDnsReadiness('unknown.example'), null);
});

test('cache helpers short-circuit for an empty cacheKey', () => {
  const { getCachedSenderDnsReadiness, setCachedSenderDnsReadiness, senderDnsCache } = freshInternals();
  senderDnsCache.clear();
  // A falsy key is how hasResendSenderDns signals "injected resolver — do not cache".
  assert.equal(setCachedSenderDnsReadiness('', true), true, 'setter returns the ready value unchanged');
  assert.equal(getCachedSenderDnsReadiness(''), null);
  assert.equal(senderDnsCache.size, 0, 'empty key must never populate the cache');
});

test('setCachedSenderDnsReadiness stores ready:true with a future expiresAt', () => {
  const { setCachedSenderDnsReadiness, senderDnsCache, SENDER_DNS_CACHE_MS } = freshInternals();
  senderDnsCache.clear();

  const before = Date.now();
  const returned = setCachedSenderDnsReadiness('example.com', true);
  const after = Date.now();

  assert.equal(returned, true);
  assert.equal(senderDnsCache.size, 1);
  const entry = senderDnsCache.get('example.com');
  assert.equal(entry.ready, true);
  assert.ok(entry.expiresAt >= before + SENDER_DNS_CACHE_MS);
  assert.ok(entry.expiresAt <= after + SENDER_DNS_CACHE_MS);
});

test('setCachedSenderDnsReadiness stores ready:false the same way (negatives are cached)', () => {
  // Caching negative results is the whole point — otherwise every failed
  // lookup re-hammers DNS on every send call.
  const { setCachedSenderDnsReadiness, getCachedSenderDnsReadiness, senderDnsCache } = freshInternals();
  senderDnsCache.clear();

  setCachedSenderDnsReadiness('not-ready.example', false);
  assert.equal(getCachedSenderDnsReadiness('not-ready.example'), false);
});

test('getCachedSenderDnsReadiness returns null once the entry has expired', () => {
  const { setCachedSenderDnsReadiness, getCachedSenderDnsReadiness, senderDnsCache } = freshInternals();
  senderDnsCache.clear();

  setCachedSenderDnsReadiness('expiring.example', true);
  // Manually wind the expiresAt into the past to simulate the 10-minute TTL lapsing.
  const entry = senderDnsCache.get('expiring.example');
  entry.expiresAt = Date.now() - 1;

  assert.equal(getCachedSenderDnsReadiness('expiring.example'), null);
});

test('SENDER_DNS_CACHE_MS is 10 minutes', () => {
  const { SENDER_DNS_CACHE_MS } = freshInternals();
  assert.equal(SENDER_DNS_CACHE_MS, 10 * 60 * 1000);
});

test('hasResendSenderDns uses the shared cache when no resolver is injected', async () => {
  const restore = savingEnv(['THUMBGATE_ALLOW_UNVERIFIED_SENDER', 'THUMBGATE_VERIFIED_SENDER_DOMAINS']);
  delete process.env.THUMBGATE_ALLOW_UNVERIFIED_SENDER;
  delete process.env.THUMBGATE_VERIFIED_SENDER_DOMAINS;
  const { hasResendSenderDns, setCachedSenderDnsReadiness, senderDnsCache } = freshInternals();
  senderDnsCache.clear();

  // Prime the cache with a positive result and assert we never touch DNS.
  setCachedSenderDnsReadiness('cached.example', true);
  // If the default `dns` resolver were consulted, an unresolvable .example domain
  // would return false — a cache hit is the only way this returns true.
  assert.equal(await hasResendSenderDns('cached.example'), true);
  restore();
});

/* ---------- resolveSenderAddress ---------- */

test('resolveSenderAddress returns the requested from unchanged when DNS is ready', async () => {
  const restore = savingEnv([
    'THUMBGATE_ALLOW_UNVERIFIED_SENDER',
    'THUMBGATE_VERIFIED_SENDER_DOMAINS',
  ]);
  process.env.THUMBGATE_VERIFIED_SENDER_DOMAINS = 'thumbgate.app';
  delete process.env.THUMBGATE_ALLOW_UNVERIFIED_SENDER;
  const { resolveSenderAddress } = freshInternals();

  const result = await resolveSenderAddress('ThumbGate <hello@thumbgate.app>');
  assert.equal(result.from, 'ThumbGate <hello@thumbgate.app>');
  assert.equal(result.senderFallback, null);
  restore();
});

test('resolveSenderAddress falls back to resend.dev with a structured reason when DNS is not ready', async () => {
  const restore = savingEnv([
    'THUMBGATE_ALLOW_UNVERIFIED_SENDER',
    'THUMBGATE_VERIFIED_SENDER_DOMAINS',
  ]);
  delete process.env.THUMBGATE_ALLOW_UNVERIFIED_SENDER;
  delete process.env.THUMBGATE_VERIFIED_SENDER_DOMAINS;
  const { resolveSenderAddress, constants } = freshInternals();

  const dnsResolver = {
    resolveTxt: async () => { throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }); },
    resolveMx: async () => { throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }); },
  };

  const result = await resolveSenderAddress('hello@thumbgate.app', { dnsResolver });
  assert.equal(result.from, constants.DEFAULT_FROM);
  assert.deepEqual(result.senderFallback, {
    requestedFrom: 'hello@thumbgate.app',
    fallbackFrom: constants.DEFAULT_FROM,
    domain: 'thumbgate.app',
    reason: 'resend_dns_not_ready',
  });
  restore();
});

test('resolveSenderAddress falls back to getFromAddress() when requestedFrom is blank', async () => {
  const restore = savingEnv([
    'RESEND_FROM_EMAIL',
    'THUMBGATE_TRIAL_EMAIL_FROM',
    'THUMBGATE_ALLOW_UNVERIFIED_SENDER',
    'THUMBGATE_VERIFIED_SENDER_DOMAINS',
  ]);
  delete process.env.THUMBGATE_TRIAL_EMAIL_FROM;
  process.env.RESEND_FROM_EMAIL = 'Ops <ops@thumbgate.app>';
  process.env.THUMBGATE_VERIFIED_SENDER_DOMAINS = 'thumbgate.app';
  delete process.env.THUMBGATE_ALLOW_UNVERIFIED_SENDER;
  const { resolveSenderAddress } = freshInternals();

  const result = await resolveSenderAddress('');
  assert.equal(result.from, 'Ops <ops@thumbgate.app>');
  assert.equal(result.senderFallback, null);
  restore();
});
