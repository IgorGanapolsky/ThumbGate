'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const billing = require('./billing');

const JSON_LIMIT = 8 * 1024 * 1024;
const LOG_LIMIT = 16 * 1024 * 1024;
const RESPONSE_LIMIT = 1024 * 1024;
const RESOURCES = Object.freeze({ customers: 'cus', subscriptions: 'sub', payments: 'ch', refunds: 're', products: 'prod', prices: 'price', 'subscription-items': 'si' });
const SECTIONS = new Set(['overview', 'money', 'data', 'analytics', 'observability']);
const MONEY_CACHE_MS = 60000;
let moneyCache = null;
const PRIVATE_HEADERS = Object.freeze({ 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
let activeCollections = 0;
const text = (value, max = 256) => typeof value === 'string' ? value.slice(0, max) : null;
const number = (value) => Number.isFinite(value) ? value : null;
const id = (value) => text(typeof value === 'object' ? value?.id : value, 128);
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const stopped = (signal) => { if (signal?.aborted) throw Object.assign(new Error('Collection stopped'), { code: 'collection_timeout' }); };
const failure = (code) => Object.assign(new Error(code), { code });

function adminPath(raw) {
  try {
    const decoded = decodeURIComponent(raw);
    return { matched: decoded === '/admin' || decoded === '/admin.html' || decoded.startsWith('/admin/') || decoded === '/v1/admin' || decoded.startsWith('/v1/admin/'), pathname: decoded };
  } catch { return { matched: true, pathname: null }; }
}

function parseAdminRoute(pathname, params) {
  if (pathname === '/admin' || pathname === '/admin/' || pathname === '/admin.html') {
    if ([...params].length) throw failure('invalid_query');
    return { page: true };
  }
  const match = /^\/v1\/admin\/([^/]+)(?:\/([^/]+))?$/.exec(pathname || '');
  if (!match || (!SECTIONS.has(match[1]) && match[1] !== 'stripe')) return null;
  const section = match[1];
  const resource = match[2];
  if (section === 'stripe' ? !Object.hasOwn(RESOURCES, resource || '') : Boolean(resource)) return null;
  const allowed = section === 'stripe' ? ['limit', 'starting_after', ...(resource === 'subscription-items' ? ['subscription'] : [])] : section === 'data' ? ['limit', 'cursor'] : [];
  for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) throw failure('invalid_query');
  const limitRaw = params.get('limit');
  const max = section === 'data' ? 50 : 100;
  if (limitRaw !== null && (!/^[1-9][0-9]*$/.test(limitRaw) || Number(limitRaw) > max)) throw failure('invalid_query');
  const limit = limitRaw === null ? 25 : Number(limitRaw);
  const cursor = params.get(section === 'data' ? 'cursor' : 'starting_after') || '';
  if (section === 'stripe' && cursor && !new RegExp(`^${RESOURCES[resource]}_[A-Za-z0-9]{1,120}$`).test(cursor)) throw failure('invalid_query');
  let offset = 0;
  if (section === 'data' && cursor) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(cursor)) throw failure('invalid_query');
    const decoded = Buffer.from(cursor, 'base64url').toString();
    if (!/^accounts:[0-9]{1,6}$/.test(decoded) || Buffer.from(decoded).toString('base64url') !== cursor) throw failure('invalid_query');
    offset = Number(decoded.split(':')[1]);
  }
  const subscription = params.get('subscription');
  if (resource === 'subscription-items' && !/^sub_[A-Za-z0-9]{1,120}$/.test(subscription || '')) throw failure('invalid_query');
  return { section, resource, limit, cursor, offset, subscription };
}

function guardPath(root, candidate) {
  const lexicalRoot = path.resolve(root);
  const absoluteRoot = fs.realpathSync(lexicalRoot);
  const resolved = path.resolve(candidate);
  const within = (value, base) => value === base || value.startsWith(base + path.sep);
  if (!within(resolved, lexicalRoot) && !within(resolved, absoluteRoot)) throw failure('unsafe_path');
  const relative = path.relative(within(resolved, lexicalRoot) ? lexicalRoot : absoluteRoot, resolved);
  let current = absoluteRoot;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw failure('unsafe_path'); }
    catch (error) { if (error.code === 'ENOENT') break; throw error; }
  }
  return path.join(absoluteRoot, relative);
}

function readObject(root, filename) {
  let fd;
  try {
    const target = guardPath(root, path.join(root, filename));
    fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > JSON_LIMIT) return { state: 'oversized', value: {} };
    const value = JSON.parse(fs.readFileSync(fd, 'utf8'));
    if (!object(value)) return { state: 'corrupt', value: {} };
    return { state: 'ok', value };
  } catch (error) { return { state: error.code === 'ENOENT' ? 'missing' : 'corrupt', value: {} }; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

function readOwnerIdentity({ feedbackDir, token, isOwner, now = Date.now() }) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  const store = readObject(feedbackDir, 'auth-sessions.json');
  if (store.state !== 'ok') return null;
  const entry = store.value[crypto.createHash('sha256').update(token).digest('hex')];
  if (!object(entry) || !['apple', 'google'].includes(entry.ssoProvider) || !Number.isFinite(entry.expiresAt)
    || entry.expiresAt <= now || !isOwner(entry.ssoEmail)) return null;
  return { provider: entry.ssoProvider };
}

// Three states: no usable session, a valid session that is not the owner (any provider, API-key sessions included), or the owner.
function readSessionState({ feedbackDir, token, isOwner, now = Date.now() }) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return { state: 'none' };
  const store = readObject(feedbackDir, 'auth-sessions.json');
  if (store.state !== 'ok') return { state: 'none' };
  const entry = store.value[crypto.createHash('sha256').update(token).digest('hex')];
  if (!object(entry) || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= now) return { state: 'none' };
  const provider = ['apple', 'google'].includes(entry.ssoProvider) ? entry.ssoProvider : 'key';
  if (provider !== 'key' && isOwner(entry.ssoEmail)) return { state: 'owner', provider };
  return { state: 'non_owner', provider };
}

function envelope(source, data, warnings = [], status = warnings.length ? 'partial' : 'ok') {
  return { status, generatedAt: new Date().toISOString(), source, data, warnings };
}

function createRuntimeObservations(now = Date.now()) {
  const errors = [];
  const buckets = new Map();
  const trim = (stamp) => { for (const key of buckets.keys()) if (key < Math.floor(stamp / 1000) - 59) buckets.delete(key); };
  return {
    recordResponse(status, route, stamp = Date.now()) {
      if (status < 500 || status > 599) return;
      errors.push({ timestamp: new Date(stamp).toISOString(), status, route: ['admin', 'telemetry', 'health', 'api', 'page'].includes(route) ? route : 'other' });
      if (errors.length > 100) errors.shift();
    },
    recordTelemetry(persisted, stamp = Date.now()) {
      if (!persisted) return;
      trim(stamp);
      const key = Math.floor(stamp / 1000);
      buckets.set(key, (buckets.get(key) || 0) + 1);
    },
    snapshot(stamp = Date.now()) {
      trim(stamp);
      let events = 0;
      for (const [second, count] of buckets) if (second <= Math.floor(stamp / 1000)) events += count;
      return { processStartedAt: new Date(now).toISOString(), recentErrors: errors.slice(), errorRetention: 'last_100_http_5xx_since_process_start', telemetry: { events, windowSeconds: Math.min(60, Math.max(0, (stamp - now) / 1000)), observationStartedAt: new Date(now).toISOString(), resolutionSeconds: 1, retainedSeconds: buckets.size, windowStart: new Date(Math.max(now, (Math.floor(stamp / 1000) - 59) * 1000)).toISOString() } };
    },
  };
}

function projectStripe(resource, row) {
  const customer = object(row.customer) ? row.customer : null;
  const base = { id: id(row.id), created: number(row.created), livemode: typeof row.livemode === 'boolean' ? row.livemode : typeof row.charge?.livemode === 'boolean' ? row.charge.livemode : null, classification: billing.classifyRevenueRecord(row) };
  const price = (item) => ({ id: id(item.id), product: id(item.product), active: typeof item.active === 'boolean' ? item.active : null, unit_amount: number(item.unit_amount), currency: text(item.currency, 3), recurring: item.recurring ? { interval: text(item.recurring.interval, 16), interval_count: number(item.recurring.interval_count) } : null });
  if (resource === 'subscription-items') return { ...base, quantity: number(row.quantity), current_period_end: number(row.current_period_end), price: price(row.price || {}) };
  if (resource === 'customers') return { ...base, name: text(row.name), email: text(row.email, 320) };
  if (resource === 'subscriptions') return { ...base, customer: id(row.customer), customerName: text(customer?.name), customerEmail: text(customer?.email, 320), status: text(row.status, 32), current_period_end: number(row.current_period_end), cancel_at_period_end: row.cancel_at_period_end === true, items: (row.items?.data || []).slice(0, 100).map((item) => ({ quantity: number(item.quantity), current_period_end: number(item.current_period_end), price: price(item.price || {}) })), itemsComplete: row.items?.has_more !== true };
  if (resource === 'payments') return { ...base, customer: id(row.customer), amount: number(row.amount), currency: text(row.currency, 3), paid: row.paid === true, status: text(row.status, 32), amount_refunded: number(row.amount_refunded) };
  if (resource === 'refunds') return { ...base, charge: id(row.charge), amount: number(row.amount), currency: text(row.currency, 3), status: text(row.status, 32) };
  if (resource === 'products') return { ...base, name: text(row.name), active: row.active === true };
  return { ...base, ...price(row) };
}

async function collectStripe(route, deps, signal) {
  stopped(signal);
  const stripe = (deps.getStripeClient || billing.getStripeClient)();
  const api = stripe[route.resource === 'payments' ? 'charges' : route.resource === 'subscription-items' ? 'subscriptionItems' : route.resource];
  const params = { limit: route.limit, ...(route.cursor ? { starting_after: route.cursor } : {}) };
  if (route.resource === 'subscriptions') params.status = 'all';
  if (route.resource === 'subscription-items') params.subscription = route.subscription;
  if (['subscriptions', 'payments'].includes(route.resource)) params.expand = ['data.customer'];
  if (route.resource === 'refunds') params.expand = ['data.charge.customer'];
  const result = await deadline(billing.withStripeReadSlot(() => api.list(params, { timeout: 8000, maxNetworkRetries: 0 }), { signal }), 8000, signal);
  stopped(signal);
  if (!Array.isArray(result?.data)) throw failure('provider_unavailable');
  const records = result.data.map((row) => projectStripe(route.resource, row));
  const warnings = records.some((row) => row.itemsComplete === false) ? ['subscription_items_incomplete'] : [];
  return envelope('stripe_account', { records, hasMore: result.has_more === true, nextCursor: result.has_more && records.length ? records.at(-1).id : null }, warnings);
}

async function countRecords(root, target, signal) {
  stopped(signal);
  let stream;
  let lines;
  let total = 0;
  let malformedLines = 0;
  try {
    const safe = guardPath(root, target);
    const stat = await fs.promises.lstat(safe);
    if (!stat.isFile()) throw failure('unsafe_path');
    stream = fs.createReadStream(safe, { flags: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW, start: 0, end: LOG_LIMIT - 1, signal });
    lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let scanned = 0;
    for await (const line of lines) {
      stopped(signal);
      if (!line.trim()) continue;
      scanned += 1;
      try { if (object(JSON.parse(line))) total += 1; else malformedLines += 1; } catch { malformedLines += 1; }
      if (scanned >= 100000) return { total, complete: false, malformedLines, state: 'truncated' };
    }
    const complete = stat.size <= LOG_LIMIT && !malformedLines;
    return { total, complete, malformedLines, state: complete ? 'ok' : stat.size > LOG_LIMIT ? 'truncated' : 'corrupt' };
  } catch (error) {
    stopped(signal);
    return { total: null, complete: false, malformedLines, state: error.code === 'ENOENT' ? 'missing' : 'unavailable' };
  } finally { lines?.close(); stream?.destroy(); }
}

async function countPartition(root, partition, signal) {
  if (!/^(tenant|sso_free)_[a-f0-9]{24}$/.test(partition)) throw failure('unsafe_path');
  const dir = guardPath(root, path.join(root, 'tenants', partition));
  try { await fs.promises.access(dir); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { partition, state: 'no_hosted_data', feedback: { total: 0, complete: true, state: 'absent_tenant', malformedLines: 0 }, lessons: { total: 0, complete: true, state: 'absent_tenant', malformedLines: 0 } };
  }
  const feedback = await countRecords(root, path.join(dir, 'feedback-log.jsonl'), signal);
  const lessons = await countRecords(root, path.join(dir, 'memory-log.jsonl'), signal);
  return { partition, state: feedback.complete && lessons.complete ? 'ok' : 'partial', feedback, lessons };
}

async function collectData(route, deps, signal) {
  const root = deps.feedbackDir;
  const keys = readObject(root, 'api-keys.json');
  const sessions = readObject(root, 'auth-sessions.json');
  const warnings = [];
  if (keys.state !== 'ok' || !object(keys.value.keys)) warnings.push('key_store_' + (keys.state === 'ok' ? 'corrupt' : keys.state));
  if (sessions.state !== 'ok') warnings.push('session_store_' + sessions.state);
  const usableKeys = keys.state === 'ok' && object(keys.value.keys);
  const usableSessions = sessions.state === 'ok';
  if (!usableKeys && !usableSessions) return envelope('current_known_accounts', null, warnings, 'unavailable');
  const inventoryComplete = usableKeys && usableSessions;
  const accounts = new Map();
  const emailCustomers = new Map();
  const normalized = (email) => typeof email === 'string' ? email.trim().toLowerCase() : '';
  for (const meta of Object.values(usableKeys ? keys.value.keys : {})) {
    if (!object(meta) || typeof meta.customerId !== 'string' || !meta.customerId) continue;
    const email = normalized(meta.customerEmail);
    const key = 'paid:' + meta.customerId;
    if (!accounts.has(key)) accounts.set(key, { customerId: meta.customerId, email, createdAt: text(meta.createdAt), hasActiveKey: false, hasCurrentSession: false, freeEmails: new Set() });
    accounts.get(key).hasActiveKey ||= meta.active === true;
    if (email) { const matches = emailCustomers.get(email) || new Set(); matches.add(key); emailCustomers.set(email, matches); }
  }
  for (const session of Object.values(sessions.value)) {
    if (!object(session) || !['apple', 'google'].includes(session.ssoProvider) || !(session.expiresAt > Date.now())) continue;
    const email = normalized(session.ssoEmail);
    if (!email) continue;
    const customerKey = session.customerId ? 'paid:' + session.customerId : null;
    if (customerKey && !accounts.has(customerKey)) accounts.set(customerKey, { customerId: session.customerId, email, createdAt: Number.isFinite(session.createdAt) ? new Date(session.createdAt).toISOString() : null, hasActiveKey: false, hasCurrentSession: true, freeEmails: new Set() });
    const matches = emailCustomers.get(email);
    const joined = customerKey && accounts.has(customerKey) ? customerKey : matches?.size === 1 ? [...matches][0] : null;
    const key = joined || 'sso:' + email;
    if (!accounts.has(key)) accounts.set(key, { customerId: null, email, createdAt: Number.isFinite(session.createdAt) ? new Date(session.createdAt).toISOString() : null, hasActiveKey: false, hasCurrentSession: true, possibleDuplicate: Boolean(matches?.size > 1), freeEmails: new Set() });
    accounts.get(key).hasCurrentSession = true;
    if (!session.customerId || session.subjectType === 'sso_free') accounts.get(key).freeEmails.add(email);
  }
  const ordered = [...accounts.entries()].sort(([a], [b]) => a.localeCompare(b));
  const page = ordered.slice(route.offset, route.offset + route.limit);
  const records = [];
  for (const [, account] of page) {
    stopped(signal);
    await new Promise((resolve) => setImmediate(resolve));
    const partitions = new Set();
    if (account.customerId) partitions.add(deps.buildHostedTenantIdentity({ valid: true, customerId: account.customerId }).partition);
    for (const email of account.freeEmails) partitions.add(deps.hashDataIdentity('sso_free', email));
    const counts = [];
    for (const partition of partitions) counts.push(await countPartition(root, partition, signal));
    if (counts.some((row) => row.state === 'partial')) warnings.push('account_counts_partial');
    records.push({ accountId: account.customerId ? text(account.customerId, 128) : [...partitions][0], email: text(account.email, 320), createdAt: account.createdAt, hasActiveKey: account.hasActiveKey, hasCurrentSession: account.hasCurrentSession, possibleDuplicate: account.possibleDuplicate === true, classification: billing.classifyRevenueRecord({ email: account.email }), partitions: counts });
  }
  stopped(signal);
  const feedback = await countRecords(root, path.join(root, 'feedback-log.jsonl'), signal);
  const lessons = await countRecords(root, path.join(root, 'memory-log.jsonl'), signal);
  if (!feedback.complete || !lessons.complete) warnings.push('legacy_counts_partial');
  return envelope('current_known_accounts', { records, totalKnown: ordered.length, total: inventoryComplete ? ordered.length : null, inventoryComplete, hasMore: route.offset + page.length < ordered.length, nextCursor: route.offset + page.length < ordered.length ? Buffer.from('accounts:' + (route.offset + page.length)).toString('base64url') : null, coverage: 'current_known_accounts_not_lifetime_signups', unattributedLegacy: { feedback, lessons }, projects: { status: 'unavailable', reason: 'project_scope_not_integrated' } }, [...new Set(warnings)]);
}

const numericFields = (value, names) => Object.fromEntries(names.map((name) => [name, number(value?.[name])]));
const currencies = (value) => Object.fromEntries(Object.entries(value || {}).filter(([key, amount]) => /^[A-Z]{3}$/.test(key) && Number.isSafeInteger(amount)));
function projectAnalytics(summary) {
  const external = summary.revenue?.external;
  return {
    funnel: { ...numericFields(summary.funnel, ['totalEvents', 'uniqueAcquisitionLeads', 'uniquePaidCustomers', 'excludedSyntheticCheckoutSessions']), stageCounts: numericFields(summary.funnel?.stageCounts, ['acquisition', 'activation', 'paid']), conversionRates: numericFields(summary.funnel?.conversionRates, ['acquisitionToActivation', 'activationToPaid', 'acquisitionToPaid']) },
    signups: numericFields(summary.signups, ['total', 'uniqueLeads', 'emailSignups', 'emailRecords', 'checkoutSessionsCreated']),
    revenue: { external: { ...numericFields(external, ['paidOrders', 'amountUnknownOrders', 'duplicates']), bookedRevenueByCurrency: currencies(external?.bookedRevenueByCurrency), refundedByCurrency: currencies(external?.refundedByCurrency), excluded: numericFields(external?.excluded, ['internal', 'test', 'unknown']) }, broadAccounting: { ...numericFields(summary.revenue, ['paidOrders', 'paidCustomers', 'amountKnownOrders', 'amountUnknownOrders']), bookedRevenueByCurrency: currencies(summary.revenue?.bookedRevenueByCurrency) } },
    trafficMetrics: numericFields(summary.trafficMetrics, ['visitors', 'sessions', 'pageViews', 'ctaClicks', 'checkoutStarts', 'checkoutPaidConfirmations']),
    attribution: { coverageRate: number(summary.dataQuality?.attributionCoverage) },
    dataQuality: { ...numericFields(summary.dataQuality, ['telemetryCoverage', 'attributionCoverage', 'amountKnownCoverage', 'unreconciledPaidEvents']), telemetryLogTruncated: summary.dataQuality?.telemetryLogTruncated === true, telemetryWindowComplete: summary.dataQuality?.telemetryWindowComplete === true },
    reconciliation: { status: ['ok', 'partial', 'timeout', 'unavailable', 'unconfigured'].includes(summary.reconciliation?.status) ? summary.reconciliation.status : 'unavailable', complete: summary.reconciliation?.complete === true },
    window: '30d',
  };
}

async function preflightAnalytics(root) {
  let total = 0;
  for (const source of billing.getBillingAnalyticsReadPaths()) {
    try {
      const stat = await fs.promises.stat(guardPath(root, source));
      total += stat.size;
      if (!stat.isFile() || total > JSON_LIMIT) throw failure('analytics_source_budget');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

async function collectObservability(deps, signal) {
  stopped(signal);
  let disk = null;
  const warnings = [];
  try {
    const stats = await fs.promises.statfs(guardPath(deps.feedbackDir, deps.feedbackDir));
    disk = { capacityBytes: stats.blocks * stats.bsize, freeBytes: stats.bavail * stats.bsize, usedBytes: (stats.blocks - stats.bfree) * stats.bsize, scope: 'volume_filesystem' };
  } catch { warnings.push('disk_unavailable'); }
  return envelope('current_process', { ...deps.health(), ...deps.runtime.snapshot(), deployment: { id: text(process.env.RAILWAY_DEPLOYMENT_ID, 128), commit: text(process.env.RAILWAY_GIT_COMMIT_SHA, 64), deployedAt: null, deploymentTimeStatus: 'unavailable', buildGeneratedAt: text(deps.buildMetadata?.generatedAt, 64) }, disk }, warnings);
}

function deadline(promise, ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => finish(reject, failure('collection_timeout'));
    const timer = setTimeout(abort, ms);
    const finish = (fn, value) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); fn(value); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    Promise.resolve(promise).then((value) => finish(resolve, value), (error) => finish(reject, error));
  });
}

const countMap = (value) => Object.fromEntries(Object.entries(object(value) ? value : {}).filter(([, n]) => Number.isFinite(n)).slice(0, 50).map(([key, n]) => [String(key).slice(0, 64), n]));

// Money board. Each block fails alone and reports null, never an invented zero.
async function collectMoney(deps, signal) {
  const ttl = deps.moneyCacheMs ?? MONEY_CACHE_MS;
  if (ttl > 0 && moneyCache && Date.now() - moneyCache.at < ttl) return moneyCache.value;
  const attempt = async (work) => { try { return { ok: true, value: await work() }; } catch { return { ok: false, value: null }; } };
  const ownerEmails = (deps.getOwnerEmails || require('./bot-detection').getOwnerEmails)();
  const stripe = () => (deps.getStripeClient || billing.getStripeClient)();

  const [summaryRun, checkoutRun, proRun] = await Promise.all([
    attempt(async () => {
      await preflightAnalytics(deps.feedbackDir);
      const summary = await (deps.getBillingSummaryLive || billing.getBillingSummaryLive)({ window: '30d', stripeReconciliationTimeoutMs: 8000 }, { signal });
      if (summary.error) throw failure('analytics_unavailable');
      return summary;
    }),
    attempt(async () => {
      const { listSessions, countSessions } = require('./checkout-session-count');
      const sessions = await deadline(billing.withStripeReadSlot(() => listSessions({ days: 7, stripe: stripe() }), { signal }), 8000, signal);
      return countSessions(sessions, { ownerEmails });
    }),
    attempt(async () => {
      const result = await deadline(billing.withStripeReadSlot(() => stripe().subscriptions.list({ status: 'active', limit: 100, expand: ['data.customer'] }, { timeout: 8000, maxNetworkRetries: 0 }), { signal }), 8000, signal);
      if (!Array.isArray(result?.data)) throw failure('provider_unavailable');
      const external = result.data.filter((row) => {
        const email = String(row.customer?.email || '').toLowerCase();
        return !(email && ownerEmails.some((owner) => email === String(owner).toLowerCase()));
      });
      return { count: external.length, complete: result.has_more !== true };
    }),
  ]);

  const summary = summaryRun.value;
  const external = summary?.revenue?.external;
  const checkouts = checkoutRun.value;
  const data = {
    windows: { revenue: '30d', checkouts: '7d', traffic: '30d', leads: '30d' },
    payingCustomers: summary ? number(external?.paidOrders) : null,
    payingCustomersBasis: 'external_paid_orders_30d',
    activePro: proRun.value ? proRun.value.count : null,
    activeProBasis: proRun.value ? (proRun.value.complete ? 'stripe_active_subscriptions_excluding_owner' : 'stripe_active_subscriptions_first_100_only') : 'unavailable',
    revenueLast30Days: summary ? currencies(external?.bookedRevenueByCurrency) : null,
    revenueReconciliation: summary ? (['ok', 'partial', 'timeout', 'unavailable', 'unconfigured'].includes(summary.reconciliation?.status) ? summary.reconciliation.status : 'unavailable') : null,
    checkouts7d: checkouts ? { started: checkouts.started, human: checkouts.nonCrawlerStarted, completedHuman: checkouts.nonCrawlerCompleted, paidHuman: checkouts.nonCrawlerPaid, bot: checkouts.excluded.bot, unclassified: checkouts.excluded.unclassified, unknownUserAgent: checkouts.excluded.unknownUa, internal: checkouts.excluded.internal } : null,
    traffic30d: summary ? numericFields(summary.trafficMetrics, ['visitors', 'sessions', 'pageViews', 'ctaClicks', 'checkoutStarts', 'checkoutPaidConfirmations']) : null,
    leadsBySource: summary ? {
      signups: countMap(summary.signups?.bySource),
      workflowSprint: { total: number(summary.pipeline?.workflowSprintLeads?.total), bySource: countMap(summary.pipeline?.workflowSprintLeads?.bySource) },
      newsletter: { total: number(summary.newsletter?.total), bySource: countMap(summary.newsletter?.bySource) },
      emailSignups: number(summary.signups?.emailSignups),
    } : null,
    notes: ['Crawler checkouts are refused before Stripe since the human gate, so the bot count is small by design.', 'Sessions created before the gate carry no user-agent class and are counted under unclassified, not human.'],
  };
  const warnings = [];
  if (!summaryRun.ok) warnings.push('billing_summary_unavailable');
  if (!checkoutRun.ok) warnings.push('checkout_list_unavailable');
  if (!proRun.ok) warnings.push('subscription_list_unavailable');
  if (summary && data.revenueReconciliation !== 'ok') warnings.push('stripe_reconciliation_' + data.revenueReconciliation);
  const value = envelope('billing_summary_and_stripe', data, warnings, warnings.length === 3 ? 'unavailable' : warnings.length ? 'partial' : 'ok');
  if (ttl > 0 && warnings.length === 0) moneyCache = { at: Date.now(), value };
  return value;
}

async function collectAdminSection(route, deps, externalSignal) {
  if (activeCollections >= 2) throw failure('collection_busy');
  activeCollections += 1;
  const controller = new AbortController();
  const abort = () => controller.abort();
  externalSignal?.addEventListener('abort', abort, { once: true });
  if (externalSignal?.aborted) abort();
  const timer = setTimeout(abort, deps.sectionTimeoutMs || 10000);
  try {
    const operation = async () => {
      stopped(controller.signal);
      if (route.section === 'overview') return envelope('current_process', { health: deps.health(), sections: ['stripe', 'data', 'analytics', 'observability'] });
      if (route.section === 'money') return collectMoney(deps, controller.signal);
      if (route.section === 'stripe') return collectStripe(route, deps, controller.signal);
      if (route.section === 'data') return collectData(route, deps, controller.signal);
      if (route.section === 'observability') return collectObservability(deps, controller.signal);
      await preflightAnalytics(deps.feedbackDir);
      stopped(controller.signal);
      const summary = await (deps.getBillingSummaryLive || billing.getBillingSummaryLive)({ window: '30d', stripeReconciliationTimeoutMs: 8000 }, { signal: controller.signal });
      stopped(controller.signal);
      if (summary.error) throw failure('analytics_unavailable');
      const data = projectAnalytics(summary);
      const warnings = data.reconciliation.status !== 'ok' || !data.reconciliation.complete ? ['stripe_reconciliation_' + data.reconciliation.status] : [];
      if (summary.sourceDiagnostics?.warnings?.length) warnings.push('source_quality_warning');
      if (!data.dataQuality.telemetryWindowComplete) warnings.push('telemetry_incomplete');
      return envelope('shared_billing_summary_30d', data, warnings);
    };
    return await deadline(operation(), deps.sectionTimeoutMs || 10000, controller.signal);
  } catch (error) {
    return envelope(route.section, null, [error.code === 'collection_timeout' ? 'collection_timeout' : error.code === 'analytics_source_budget' ? 'analytics_source_budget' : 'source_unavailable'], 'unavailable');
  } finally {
    abort(); clearTimeout(timer); externalSignal?.removeEventListener('abort', abort); activeCollections -= 1;
  }
}

module.exports = { PRIVATE_HEADERS, RESPONSE_LIMIT, adminPath, parseAdminRoute, readOwnerIdentity, readSessionState, collectMoney, collectAdminSection, createRuntimeObservations, projectAnalytics, projectStripe, readObject, countRecords, guardPath };
