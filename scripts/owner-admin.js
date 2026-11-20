'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const billing = require('./billing');
const ownerTelemetry = require('./owner-telemetry');
const opsLog = require('./ops-log');
const opsReport = require('./ops-report');

const JSON_LIMIT = 8 * 1024 * 1024;
const LOG_LIMIT = 16 * 1024 * 1024;
const RESPONSE_LIMIT = 1024 * 1024;
const RESOURCES = Object.freeze({ customers: 'cus', subscriptions: 'sub', payments: 'ch', refunds: 're', products: 'prod', prices: 'price', 'subscription-items': 'si' });
const SECTIONS = new Set(['overview', 'money', 'data', 'analytics', 'observability', 'summary']);
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
    // The page takes no options: any query string (for example ?product=dayglass) is ignored and the ThumbGate board is served.
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
  const timings = new Map();
  const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
  return {
    // Response time per route category, kept for the newest 1,000 requests of each. Resets when the server restarts.
    recordTiming(route, ms) {
      if (!Number.isFinite(ms) || ms < 0) return;
      const list = timings.get(route) || [];
      list.push(ms);
      if (list.length > 1000) list.shift();
      timings.set(route, list);
    },
    speed() {
      const out = {};
      for (const [route, list] of timings) {
        const sorted = list.slice().sort((a, b) => a - b);
        out[route] = { samples: sorted.length, p50: Math.round(percentile(sorted, 0.5)), p95: Math.round(percentile(sorted, 0.95)) };
      }
      return out;
    },
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

async function collectObservability(deps, signal) {
  stopped(signal);
  let disk = null;
  const warnings = [];
  try {
    const stats = await fs.promises.statfs(guardPath(deps.feedbackDir, deps.feedbackDir));
    disk = { capacityBytes: stats.blocks * stats.bsize, freeBytes: stats.bavail * stats.bsize, usedBytes: (stats.blocks - stats.bfree) * stats.bsize, scope: 'volume_filesystem' };
  } catch { warnings.push('disk_unavailable'); }
  const health = deps.health();
  const snapshot = deps.runtime.snapshot();
  const now = Date.now();
  let events = [];
  let beats = [];
  try {
    events = (await opsLog.readLog(deps.feedbackDir, opsLog.EVENTS_FILE, { now, days: 30, signal })).rows;
    beats = (await opsLog.readLog(deps.feedbackDir, opsLog.HEARTBEAT_FILE, { now, days: 30, signal })).rows.map((row) => row.time);
  } catch (error) { if (error.code === 'collection_timeout') throw error; warnings.push('ops_log_unavailable'); }
  const sha = text(deps.buildMetadata?.buildSha, 64) || text(health.buildSha, 64);
  let commitTitle = null;
  let commitTitleReason = null;
  if (sha && typeof deps.lookupCommitTitle === 'function') {
    try { commitTitle = (await deps.lookupCommitTitle(sha, signal)) || null; } catch { commitTitle = null; }
    if (!commitTitle) commitTitleReason = 'GitHub did not return the commit title.';
  } else if (sha) commitTitleReason = 'The commit title lookup is not set up on this server.';
  const report = opsReport.buildReport({
    now, events, beats, disk,
    speed: typeof deps.runtime.speed === 'function' ? deps.runtime.speed() : null,
    startedAt: snapshot.processStartedAt,
    uptimeSeconds: health.uptime,
    sha, commitTitle, commitTitleReason,
    repo: deps.githubRepo === undefined ? 'IgorGanapolsky/ThumbGate' : deps.githubRepo,
  });
  return envelope('current_process', { ...health, ...snapshot, deployment: { id: text(process.env.RAILWAY_DEPLOYMENT_ID, 128), commit: text(process.env.RAILWAY_GIT_COMMIT_SHA, 64), deployedAt: null, deploymentTimeStatus: 'unavailable', buildGeneratedAt: text(deps.buildMetadata?.generatedAt, 64) }, disk, report }, warnings);
}

const commitTitleCache = new Map();
// The first line of a commit message from GitHub's public API, cached an hour. Returns null on any failure.
async function githubCommitTitle(sha, signal, repo = 'IgorGanapolsky/ThumbGate') {
  if (!/^[0-9a-f]{7,64}$/i.test(sha)) return null;
  const cached = commitTitleCache.get(sha);
  if (cached && Date.now() - cached.at < 3600000) return cached.title;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    signal?.addEventListener?.('abort', () => controller.abort(), { once: true });
    const response = await fetch('https://api.github.com/repos/' + repo + '/commits/' + sha, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'thumbgate-owner-console' }, signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return null;
    const body = await response.json();
    const title = text(String(body?.commit?.message || '').split('\n')[0], 200);
    if (title) commitTitleCache.set(sha, { at: Date.now(), title });
    return title;
  } catch { return null; }
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

// The shared billing summary reads about 97 MB of ledgers on the hosted volume, so it never runs in the request:
// a child process computes it, the result is cached, and tabs that need it say "refreshing" until it lands.
// Telemetry (visitors, page views, clicks, checkouts) never waits for it: it is streamed from the log tail.
const SUMMARY_TTL_MS = 10 * 60 * 1000;
const TELEMETRY_CACHE_MS = 60000;
const SUMMARY_WORKER = `
const admin = require(process.argv[1]);
const billing = require(process.argv[2]);
billing.getBillingSummaryLive({ window: '30d', stripeReconciliationTimeoutMs: 3000 }, { signal: AbortSignal.timeout(60000) }).then((s) => {
  if (!s || s.error) process.exit(2);
  process.stdout.write(JSON.stringify(admin.summaryParts(s)));
  process.exit(0);
}).catch(() => process.exit(3));
`;
let summarySnapshot = { at: 0, value: null, inflight: null, failed: false };
const trafficCache = new Map();

function summaryParts(summary) {
  return {
    analytics: projectAnalytics(summary),
    leads: {
      signups: countMap(summary.signups?.bySource),
      workflowSprint: { total: number(summary.pipeline?.workflowSprintLeads?.total), bySource: countMap(summary.pipeline?.workflowSprintLeads?.bySource) },
      newsletter: { total: number(summary.newsletter?.total), bySource: countMap(summary.newsletter?.bySource) },
      emailSignups: number(summary.signups?.emailSignups),
    },
  };
}

function startSummaryWorker() {
  if (summarySnapshot.inflight) return;
  summarySnapshot.inflight = new Promise((resolve) => {
    require('node:child_process').execFile(process.execPath, ['-e', SUMMARY_WORKER, require.resolve('./owner-admin'), require.resolve('./billing')], { timeout: 90000, maxBuffer: 4 * 1024 * 1024, env: process.env }, (error, stdout) => {
      summarySnapshot.failed = Boolean(error);
      if (!error) { try { summarySnapshot.value = JSON.parse(stdout); summarySnapshot.at = Date.now(); } catch { summarySnapshot.failed = true; } }
      resolve();
    });
  }).finally(() => { summarySnapshot.inflight = null; });
}

async function readSummary(deps, signal) {
  if (deps.getBillingSummaryLive) {
    const injected = await deps.getBillingSummaryLive({ window: '30d', stripeReconciliationTimeoutMs: 8000 }, { signal });
    if (!injected || injected.error) throw failure('analytics_unavailable');
    return { value: summaryParts(injected), state: 'ok', collectedAt: new Date().toISOString() };
  }
  const fresh = summarySnapshot.value && Date.now() - summarySnapshot.at < SUMMARY_TTL_MS;
  if (!fresh) startSummaryWorker();
  // First visit after a restart: wait for the worker a few seconds instead of answering "not ready".
  if (!summarySnapshot.value && summarySnapshot.inflight) {
    await Promise.race([summarySnapshot.inflight, new Promise((resolve) => { const timer = setTimeout(resolve, 7000); timer.unref?.(); })]);
  }
  const state = summarySnapshot.value ? (fresh ? 'ok' : 'stale') : (summarySnapshot.failed ? 'failed' : 'refreshing');
  return { value: summarySnapshot.value, state, collectedAt: summarySnapshot.at ? new Date(summarySnapshot.at).toISOString() : null };
}

// 30 days of site traffic, streamed from the newest end of the telemetry log. Cached for a minute.
async function readTraffic(deps, signal) {
  const ttl = deps.telemetryCacheMs ?? TELEMETRY_CACHE_MS;
  const key = String(deps.feedbackDir);
  const hit = trafficCache.get(key);
  if (ttl > 0 && hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await ownerTelemetry.readTrafficWindow({ feedbackDir: guardPath(deps.feedbackDir, deps.feedbackDir), days: 30, signal, maxBytes: deps.telemetryMaxBytes });
  value.collectedAt = new Date().toISOString();
  if (ttl > 0) trafficCache.set(key, { at: Date.now(), value });
  return value;
}

// Why the Money board used to say "Stripe is busy": every list held one of the account's two read slots for its whole run
// (a 30-day checkout list is about six pages), a read that found both taken failed at once, and a read that timed out kept
// running and kept its slot. Now each page waits for a slot until one shared deadline, a stopped list stops between pages,
// and a block that still fails shows its last good result for five minutes.
const STRIPE_DEADLINE_MS = 8500;
const LAST_GOOD_MS = 5 * 60 * 1000;
const lastGood = new Map();
const pause = (ms, signal) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  timer.unref?.();
  signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

async function withSlot(work, signal) {
  for (;;) {
    stopped(signal);
    try { return await billing.withStripeReadSlot(work, { signal }); } catch (error) {
      if (error?.code !== 'provider_busy') throw error;
      await pause(100, signal);
    }
  }
}

// Pages a Stripe list with starting_after, 100 rows at a time, newest first. `complete` is false when the page cap was hit.
async function listAll({ list, params, keep = () => true, maxPages = 40, signal, until }) {
  const rows = [];
  let after = null;
  for (let page = 0; ; page += 1) {
    stopped(signal);
    if (page >= maxPages) return { rows, complete: false };
    const left = Math.max(1, until - Date.now());
    const result = await deadline(withSlot(() => list({ ...params, limit: 100, ...(after ? { starting_after: after } : {}) }, { timeout: Math.min(8000, left), maxNetworkRetries: 0 }), signal), left, signal);
    if (!Array.isArray(result?.data)) throw failure('provider_unavailable');
    for (const row of result.data) if (keep(row)) rows.push(row);
    if (result.has_more !== true || !result.data.length) return { rows, complete: true };
    after = result.data.at(-1).id;
  }
}

const thumbgateSession = (row) => /thumbgate/i.test(String(row.success_url || ''));

// Why a Stripe source failed, in words a person can act on. Never a bare "Unknown".
function stripeReason(error) {
  if (/STRIPE_SECRET_KEY is missing/i.test(String(error?.message || ''))) return 'Stripe key missing';
  if (error?.code === 'collection_timeout') return 'Stripe did not answer in time';
  if (error?.code === 'provider_busy') return 'Stripe is busy, refresh in a moment';
  return 'Stripe unavailable';
}

const attempt = async (work, reasonOf) => {
  try { return { ok: true, value: await work(), reason: null }; } catch (error) { return { ok: false, value: null, reason: reasonOf(error) }; }
};
const telemetryReason = (error) => (error?.code === 'collection_timeout' ? 'telemetry read timed out' : 'telemetry read failed');

const trafficFields = (read) => ({ visitors: read.traffic.visitors, realVisitors: read.traffic.realVisitors, botOrInternalVisitors: read.traffic.botOrInternalVisitors, pageViewers: read.traffic.pageViewers, checkoutStartsByType: read.traffic.checkoutStartsByType, sessions: read.traffic.sessions, pageViews: read.traffic.pageViews, ctaClicks: read.traffic.ctaClicks, checkoutStarts: read.traffic.checkoutStarts, checkoutPaidConfirmations: read.traffic.checkoutPaidConfirmations });

// Money board. Each block fails alone: its fields are null and a plain-words reason is returned beside them.
// Stripe answers paying customers, revenue and checkouts; our own page-view telemetry answers visitors.
async function collectMoney(deps, signal) {
  const ttl = deps.moneyCacheMs ?? MONEY_CACHE_MS;
  if (ttl > 0 && moneyCache && Date.now() - moneyCache.at < ttl) return moneyCache.value;
  const ownerEmails = (deps.getOwnerEmails || require('./bot-detection').getOwnerEmails)();
  const stripe = () => (deps.getStripeClient || billing.getStripeClient)();
  const { countSessions, classifySession, BOT_CHECK_BEGAN_AT, BOT_CHECK_BEGAN_LABEL } = require('./checkout-session-count');
  // A test may move the date; production always uses the date the human-click gate went live.
  const botCheckBeganAt = deps.botCheckBeganAt || BOT_CHECK_BEGAN_AT;
  const botCheckBeganLabel = deps.botCheckBeganAt ? deps.botCheckBeganAt : BOT_CHECK_BEGAN_LABEL;
  const nowSeconds = Math.floor(Date.now() / 1000);

  // One deadline for all of Stripe's reads, shared by every block below.
  const stripeMs = deps.stripeDeadlineMs ?? STRIPE_DEADLINE_MS;
  const until = Date.now() + stripeMs;
  const shared = new AbortController();
  const stopShared = () => shared.abort();
  signal?.addEventListener('abort', stopShared, { once: true });
  const sharedTimer = setTimeout(stopShared, stripeMs);
  if (signal?.aborted) stopShared();
  const keepMs = deps.lastGoodMs ?? LAST_GOOD_MS;
  const staleBlocks = {};
  // A block that fails shows its last good result when that is under five minutes old, and says so.
  const withLastGood = async (key, work) => {
    const run = await attempt(work, stripeReason);
    if (run.ok) { if (keepMs > 0) lastGood.set(key, { at: Date.now(), value: run.value }); return run; }
    const kept = keepMs > 0 ? lastGood.get(key) : null;
    if (kept && Date.now() - kept.at < keepMs) { staleBlocks[key] = kept.at; return { ok: true, value: kept.value, reason: null }; }
    return run;
  };
  const listIt = (list, params, keep, maxPages) => listAll({ list, params, keep, maxPages, signal: shared.signal, until });

  // Two lanes: one lists paid checkouts then subscriptions, the other lists checkout sessions. Each page waits for a free slot.
  const paidAndProLane = (async () => {
    const paidResult = await withLastGood('paid', async () => {
      const result = await listIt((params, options) => stripe().checkout.sessions.list(params, options),
        { status: 'complete', created: { gte: nowSeconds - 365 * 86400 }, expand: ['data.payment_intent.latest_charge'] },
        (row) => row.status === 'complete' && thumbgateSession(row), 10);
      // Paid and not refunded in full, owner and test purchases excluded. A partial refund comes off the revenue.
      const charge = (row) => (object(row.payment_intent) && object(row.payment_intent.latest_charge) ? row.payment_intent.latest_charge : null);
      const paid = result.rows.filter((row) => row.payment_status === 'paid' && classifySession(row, { ownerEmails }) !== 'internal' && charge(row)?.refunded !== true);
      const customers = new Set(paid.map((row) => id(row.customer) || String(row.customer_details?.email || row.customer_email || row.id).toLowerCase()));
      const revenue = {};
      for (const row of paid) {
        if (!(row.created >= nowSeconds - 30 * 86400) || !Number.isSafeInteger(row.amount_total) || !/^[a-z]{3}$/i.test(row.currency || '')) continue;
        const code = row.currency.toUpperCase();
        const refunded = Number.isSafeInteger(charge(row)?.amount_refunded) ? charge(row).amount_refunded : 0;
        revenue[code] = (revenue[code] || 0) + row.amount_total - refunded;
      }
      return { customers, revenue, complete: result.complete };
    });
    const proResult = await withLastGood('subscriptions', async () => {
      const result = await listIt((params, options) => stripe().subscriptions.list(params, options), { status: 'active', expand: ['data.customer'] }, () => true, 5);
      const external = result.rows.filter((row) => {
        const email = String(row.customer?.email || '').toLowerCase();
        return !(email && ownerEmails.some((owner) => email === String(owner).toLowerCase()));
      });
      const customers = new Set(external.map((row) => id(row.customer) || String(row.customer?.email || row.id).toLowerCase()));
      return { count: external.length, customers, complete: result.complete };
    });
    return [paidResult, proResult];
  })();
  let paidAndPro; let sessionRun; let trafficRun; let summaryRun;
  try {
    [paidAndPro, sessionRun, trafficRun, summaryRun] = await Promise.all([
      paidAndProLane,
      withLastGood('checkouts', async () => {
        const result = await listIt((params, options) => stripe().checkout.sessions.list(params, options), { created: { gte: nowSeconds - 30 * 86400 } }, thumbgateSession, 40);
        const since7 = nowSeconds - 7 * 86400;
        // Sessions made before the bot check carry no user-agent class, so they are reported apart from the ones after it.
        const botCheckSeconds = Date.parse(botCheckBeganAt) / 1000;
        const beforeBotCheck = (row) => Boolean(row.created) && row.created < botCheckSeconds;
        const classified = result.rows.filter((row) => row.metadata?.uaClass && row.created).map((row) => row.created);
        return {
          d30: countSessions(result.rows, { ownerEmails }),
          d7: countSessions(result.rows.filter((row) => !row.created || row.created >= since7), { ownerEmails }),
          before: countSessions(result.rows.filter(beforeBotCheck), { ownerEmails }),
          since: countSessions(result.rows.filter((row) => !beforeBotCheck(row)), { ownerEmails }),
          firstClassifiedAt: classified.length ? new Date(Math.min(...classified) * 1000).toISOString() : null,
          complete: result.complete,
        };
      }),
      attempt(() => readTraffic(deps, signal), telemetryReason),
      attempt(() => readSummary(deps, signal), () => 'lead ledgers failed'),
    ]);
  } finally {
    clearTimeout(sharedTimer);
    signal?.removeEventListener('abort', stopShared);
    stopShared();
  }
  const [paidRun, proRun] = paidAndPro;

  const parts = summaryRun.value?.value || null;
  const leadsReason = parts ? null : summaryRun.ok && summaryRun.value.state === 'refreshing' ? 'lead ledgers still calculating, refresh in a minute' : 'lead ledgers failed';
  const trafficRead = trafficRun.value;
  const trafficReason = !trafficRun.ok ? trafficRun.reason : trafficRead.empty ? 'telemetry store empty' : null;
  const paid = paidRun.value;
  const sessions = sessionRun.value;
  const sessionBuckets = (counts) => (counts ? {
    started: counts.started,
    human: counts.nonCrawlerStarted,
    completedHuman: counts.nonCrawlerCompleted,
    paidHuman: counts.nonCrawlerPaid,
    bot: counts.excluded.bot,
    notClassified: counts.excluded.unclassified + counts.excluded.unknownUa,
    internal: counts.excluded.internal,
  } : null);
  const bothStripe = paid && proRun.value;
  // The checkout panel: sessions with no bot check on record come first, then people, bots and owner only for sessions
  // created after the bot check began, then the gap between the site's own start events and Stripe's sessions.
  const checkoutBotCheck = (counts, traffic) => {
    if (!counts) return null;
    const stripeSessions = counts.d30.started;
    const siteStarts = traffic ? traffic.traffic.checkoutStarts : null;
    const difference = siteStarts === null ? null : siteStarts - stripeSessions;
    return {
      window: '30d',
      botCheckBeganAt,
      botCheckBeganLabel,
      firstClassifiedAt: counts.firstClassifiedAt,
      notClassified: sessionBuckets(counts.d30).notClassified,
      beforeBotCheck: sessionBuckets(counts.before),
      sinceBotCheck: sessionBuckets(counts.since),
      siteVersusStripe: siteStarts === null ? null : {
        siteStarts,
        siteStartsByType: traffic.traffic.checkoutStartsByType || {},
        stripeSessions,
        difference,
        status: difference === 0 ? 'match' : 'unexplained',
        reason: difference === 0 ? 'The two counts match.'
          : 'Unexplained. The site count adds up four kinds of start events (listed here); Stripe counts the sessions it created. They are not matched one to one, so the gap is not itemised.',
      },
    };
  };
  // When each source was last read. A block showing its last good value reports that older time and `stale: true`.
  const blockTime = (key) => ({ collectedAt: new Date(staleBlocks[key] || Date.now()).toISOString(), stale: Object.hasOwn(staleBlocks, key) });
  const freshness = {
    paid: blockTime('paid'),
    subscriptions: blockTime('subscriptions'),
    checkouts: blockTime('checkouts'),
    traffic: { collectedAt: trafficRead?.collectedAt || null, stale: false },
    leads: { collectedAt: summaryRun.value?.collectedAt || null, stale: summaryRun.value?.state === 'stale' },
    displayRefreshedAt: new Date().toISOString(),
  };
  const data = {
    windows: { revenue: '30d', checkouts: '7d', traffic: '30d', leads: '30d' },
    freshness,
    // Counted straight from Stripe: people with a paid, unrefunded checkout in the past year plus active subscribers, once each.
    payingCustomers: bothStripe ? new Set([...paid.customers, ...proRun.value.customers]).size : null,
    payingCustomersSource: 'stripe',
    payingCustomersBasis: bothStripe ? (paid.complete && proRun.value.complete ? 'stripe_paid_and_active' : 'stripe_paid_and_active_partial') : 'unavailable',
    activePro: proRun.value ? proRun.value.count : null,
    activeProBasis: proRun.value ? (proRun.value.complete ? 'stripe_active_subscriptions_excluding_owner' : 'stripe_active_subscriptions_first_100_only') : 'unavailable',
    revenueLast30Days: paid ? paid.revenue : null,
    revenueBasis: 'stripe_paid_checkouts_after_refunds',
    checkouts7d: sessionBuckets(sessions?.d7),
    checkouts30d: sessionBuckets(sessions?.d30),
    checkoutBotCheck: checkoutBotCheck(sessions, trafficReason ? null : trafficRead),
    traffic30d: trafficReason ? null : { ...trafficFields(trafficRead), partial: trafficRead.partial },
    leadsBySource: parts ? parts.leads : null,
    reasons: {
      payingCustomers: bothStripe ? null : (paidRun.reason || proRun.reason),
      activePro: proRun.value ? null : proRun.reason,
      revenue: paid ? null : paidRun.reason,
      checkouts: sessions ? null : sessionRun.reason,
      visitors: trafficReason,
      leads: leadsReason,
    },
    notes: ['Every started checkout is counted once: real people, bots, not classified, or owner and test.', 'Sessions created before the bot check carry no browser class, so they are counted as not classified.'],
  };
  const staleLabel = { paid: 'paying customers and revenue', subscriptions: 'active subscriptions', checkouts: 'checkout counts' };
  for (const [key, at] of Object.entries(staleBlocks)) {
    const minutes = Math.max(1, Math.round((Date.now() - at) / 60000));
    data.notes.push(`Showing the last good ${staleLabel[key]} from ${minutes} minute${minutes === 1 ? '' : 's'} ago, because Stripe did not answer this time.`);
  }
  if (sessions && sessions.complete === false) data.notes.push('The 30-day checkout list was cut short at 4,000 sessions, so the 30-day counts are a lower bound.');
  const warnings = [];
  if (Object.keys(staleBlocks).length) warnings.push('showing_last_good_stripe_numbers');
  if (sessions && sessions.complete === false) warnings.push('checkout_list_partial');
  if (!paidRun.ok) warnings.push('paid_checkout_list_unavailable');
  if (!sessionRun.ok) warnings.push('checkout_list_unavailable');
  if (!proRun.ok) warnings.push('subscription_list_unavailable');
  if (trafficReason) warnings.push('telemetry_unavailable');
  if (leadsReason) warnings.push('leads_unavailable');
  const failed = [paidRun, sessionRun, proRun].filter((run) => !run.ok).length;
  const value = envelope('stripe_and_telemetry', data, warnings, failed === 3 && trafficReason ? 'unavailable' : warnings.length ? 'partial' : 'ok');
  if (ttl > 0 && warnings.length === 0) moneyCache = { at: Date.now(), value };
  return value;
}

// Analytics: 30 days of traffic streamed from the telemetry tail (never refused for size), a daily series, and the
// billing totals from the cached child-process summary when it is ready.
async function collectAnalytics(deps, signal) {
  const [trafficRun, summaryRun] = await Promise.all([
    attempt(() => readTraffic(deps, signal), telemetryReason),
    attempt(() => readSummary(deps, signal), () => 'billing totals failed'),
  ]);
  const parts = summaryRun.value?.value || null;
  const trafficRead = trafficRun.value;
  if (!trafficRun.ok && !parts) throw Object.assign(new Error('analytics_unavailable'), { code: trafficRun.reason === 'telemetry read timed out' ? 'collection_timeout' : 'analytics_unavailable' });
  const data = parts?.analytics ? { ...parts.analytics } : { window: '30d' };
  const hasTraffic = trafficRun.ok && !trafficRead.empty;
  data.trafficMetrics = hasTraffic ? trafficFields(trafficRead) : (data.trafficMetrics || null);
  data.daily = hasTraffic ? trafficRead.daily : [];
  data.dataQuality = { ...(data.dataQuality || {}), telemetryWindowComplete: hasTraffic ? !trafficRead.partial : false, telemetryBytesRead: trafficRead ? trafficRead.bytesRead : 0, telemetrySizeBytes: trafficRead ? trafficRead.size : 0 };
  const warnings = [];
  if (data.reconciliation && (data.reconciliation.status !== 'ok' || !data.reconciliation.complete)) warnings.push('stripe_reconciliation_' + data.reconciliation.status);
  if (!parts) warnings.push(summaryRun.ok && summaryRun.value.state === 'refreshing' ? 'billing_totals_refreshing' : 'billing_totals_unavailable');
  if (!hasTraffic) warnings.push(trafficRun.ok ? 'telemetry_store_empty' : 'telemetry_unavailable');
  else if (trafficRead.partial) warnings.push('telemetry_incomplete');
  return envelope('telemetry_tail_and_billing_summary_30d', data, warnings);
}

// One metric of the read-only summary: its value, where it came from, when that source was read, and one of these states:
//   ok            a number from a source that answered in full
//   verified_zero a zero from a source that answered in full
//   partial       a number from a source that answered only in part (a lower bound)
//   stale         the last good value, with lastVerifiedAt; the source failed this time
//   unavailable   the source failed and there is no earlier value
//   unresolved    the source answered but the metric cannot be settled yet (still calculating)
function metric(label, value, { source, collectedAt = null, reason = null, partial = false, stale = false, unresolved = false }) {
  const missing = value === null || value === undefined;
  let status = 'ok';
  if (missing) status = unresolved ? 'unresolved' : 'unavailable';
  else if (stale) status = 'stale';
  else if (partial) status = 'partial';
  else if (value === 0) status = 'verified_zero';
  const out = { label, value: missing ? null : value, source, collectedAt, status };
  if (reason && (missing || stale || partial)) out.reason = reason;
  if (stale && !missing) out.lastVerifiedAt = collectedAt;
  return out;
}

// GET /v1/admin/summary: the numbers the Money and Analytics tabs show, as JSON an agent can read instead of scraping HTML.
async function collectSummary(deps, signal) {
  const [moneyRun, analyticsRun] = await Promise.all([
    attempt(() => collectMoney(deps, signal), () => 'Money collection failed'),
    attempt(() => collectAnalytics(deps, signal), () => 'Analytics collection failed'),
  ]);
  const money = moneyRun.ok ? moneyRun.value.data : null;
  const analytics = analyticsRun.ok ? analyticsRun.value.data : null;
  const why = money?.reasons || {};
  const fresh = money?.freshness || {};
  const refreshed = money?.freshness?.displayRefreshedAt || new Date().toISOString();
  const stripeOpts = (key, reason) => ({ source: 'stripe', collectedAt: fresh[key]?.collectedAt || null, stale: Boolean(fresh[key]?.stale), reason });
  const trafficOpts = { source: 'site_telemetry', collectedAt: fresh.traffic?.collectedAt || null, reason: why.visitors, partial: money?.traffic30d?.partial === true };
  const leadOpts = { source: 'lead_ledgers', collectedAt: fresh.leads?.collectedAt || null, reason: why.leads, stale: Boolean(fresh.leads?.stale), unresolved: /still calculating/i.test(why.leads || '') };
  const fields = {};
  const add = (key, label, value, options) => { fields[key] = metric(label, value, options); };
  const buckets = (prefix, label, block, reason) => {
    for (const [name, words] of [['started', 'started'], ['human', 'browser-classified'], ['bot', 'bot-classified'], ['notClassified', 'with insufficient classification evidence'], ['internal', 'owner and test']]) add(`${prefix}.${name}`, `Checkout sessions ${words} (${label})`, block ? block[name] : null, stripeOpts('checkouts', why.checkouts));
  };

  if (money) {
    add('money.paying_customers', 'Paying customers', money.payingCustomers, { ...stripeOpts('paid', why.payingCustomers), partial: money.payingCustomersBasis === 'stripe_paid_and_active_partial' });
    add('money.active_pro', 'Active Pro subscriptions', money.activePro, { ...stripeOpts('subscriptions', why.activePro), partial: money.activeProBasis === 'stripe_active_subscriptions_first_100_only' });
    add('money.revenue_30d', 'Booked revenue, past 30 days, by currency', money.revenueLast30Days, stripeOpts('paid', why.revenue));
    buckets('money.checkouts_7d', '7 days', money.checkouts7d);
    buckets('money.checkouts_30d', '30 days', money.checkouts30d);
    const panel = money.checkoutBotCheck;
    add('money.checkout_bot_check', 'Checkout sessions split at the bot check (30 days)', panel, stripeOpts('checkouts', why.checkouts));
    add('money.signups_by_source', 'Signups by source', money.leadsBySource?.signups ?? null, leadOpts);
    add('money.workflow_sprint_leads', 'Setup Sprint leads', money.leadsBySource?.workflowSprint ?? null, leadOpts);
    add('money.newsletter', 'Newsletter signups', money.leadsBySource?.newsletter ?? null, leadOpts);
  }
  const traffic = analytics?.trafficMetrics || money?.traffic30d || null;
  const trafficField = (key, label, name) => add(key, label, traffic ? traffic[name] ?? null : null, trafficOpts);
  trafficField('traffic.visitor_identifiers_all_30d', 'All observed visitor identifiers (30 days)', 'visitors');
  if (money?.traffic30d) add('traffic.visitor_identifiers_excluding_flagged_30d', 'Observed visitor identifiers, excluding bot, internal and test (30 days)', money.traffic30d.realVisitors, trafficOpts);
  trafficField('traffic.landing_page_views_30d', 'Landing page views (30 days)', 'pageViews');
  trafficField('traffic.cta_clicks_30d', 'Call to action clicks (30 days)', 'ctaClicks');
  trafficField('traffic.checkout_starts_30d', 'Checkout starts seen on the site (30 days)', 'checkoutStarts');
  trafficField('traffic.paid_confirmations_30d', 'Paid confirmations (30 days)', 'checkoutPaidConfirmations');
  add('traffic.daily_30d', 'Daily traffic, past 30 days', analytics ? analytics.daily : null, trafficOpts);
  const billingOpts = { source: 'billing_summary', collectedAt: fresh.leads?.collectedAt || null, reason: analyticsRun.ok ? null : analyticsRun.reason, unresolved: !analytics?.signups };
  add('analytics.email_signups', 'Email signups', analytics?.signups?.emailSignups ?? null, billingOpts);
  add('analytics.external_paid_orders', 'External paid orders', analytics?.revenue?.external?.paidOrders ?? null, billingOpts);
  add('analytics.external_booked_revenue_30d', 'External booked revenue, past 30 days, by currency', analytics?.revenue?.external?.bookedRevenueByCurrency ?? null, billingOpts);

  const states = Object.values(fields).map((entry) => entry.status);
  const bad = states.filter((state) => state === 'unavailable').length;
  const overall = !money && !analytics ? 'unavailable' : states.every((state) => state === 'ok' || state === 'verified_zero') ? 'ok' : 'partial';
  return envelope('owner_console_summary', { generatedAt: refreshed, readOnly: true, windows: { checkouts: '7d and 30d', traffic: '30d', revenue: '30d' }, freshness: { displayRefreshedAt: refreshed, stripeCollectedAt: fresh.checkouts?.collectedAt || null, telemetryCollectedAt: fresh.traffic?.collectedAt || null, leadsCollectedAt: fresh.leads?.collectedAt || null, telemetryCacheSeconds: Math.round((deps.telemetryCacheMs ?? TELEMETRY_CACHE_MS) / 1000), billingSummaryCacheSeconds: Math.round(SUMMARY_TTL_MS / 1000) }, fields, unavailableFields: bad }, [], overall);
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
      if (route.section === 'summary') return collectSummary(deps, controller.signal);
      if (route.section === 'stripe') return collectStripe(route, deps, controller.signal);
      if (route.section === 'data') return collectData(route, deps, controller.signal);
      if (route.section === 'observability') return collectObservability(deps, controller.signal);
      return collectAnalytics(deps, controller.signal);
    };
    return await deadline(operation(), deps.sectionTimeoutMs || 10000, controller.signal);
  } catch (error) {
    return envelope(route.section, null, [error.code === 'collection_timeout' ? 'collection_timeout' : 'source_unavailable'], 'unavailable');
  } finally {
    abort(); clearTimeout(timer); externalSignal?.removeEventListener('abort', abort); activeCollections -= 1;
  }
}

module.exports = { PRIVATE_HEADERS, RESPONSE_LIMIT, adminPath, parseAdminRoute, readOwnerIdentity, readSessionState, collectMoney, collectAnalytics, collectSummary, summaryParts, collectAdminSection, createRuntimeObservations, githubCommitTitle, collectObservability, projectAnalytics, projectStripe, readObject, countRecords, guardPath };
