#!/usr/bin/env node
/**
 * World-Class Revenue & Observability Dashboard for ThumbGate
 * Aggregates revenue from Stripe, Gumroad, and Plausible analytics
 *
 * Stolen FORMAT from: Datadog LLM Observability (4 practices), Fiddler Control Plane
 * Never vendor Datadog, never clone SaaS — implement locally
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const ENV = {};
const envFile = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    if (key && !key.startsWith('#')) ENV[key.trim()] = rest.join('=').trim();
  });
}


let cachedRevenueStatus = undefined;
function getHostedRevenueStatusFallback() {
  if (cachedRevenueStatus !== undefined) return cachedRevenueStatus;
  try {
    const raw = execSync('node scripts/revenue-status.js --json', {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
    });
    cachedRevenueStatus = JSON.parse(raw);
  } catch {
    cachedRevenueStatus = null;
  }
  return cachedRevenueStatus;
}
// ============================================================================
// 1. STRIPE REVENUE (via Stripe API)
// ============================================================================
async function getStripeRevenue() {
  const stripeKey = ENV.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    const hosted = getHostedRevenueStatusFallback();
    const lifetimeRev = hosted?.hostedAudit?.summaries?.lifetime?.revenue;
    const todayRev = hosted?.hostedAudit?.summaries?.today?.revenue;
    if (lifetimeRev) {
      return {
        source: 'stripe (via hosted-billing-summary)',
        available: true,
        lifetimeRevenue: (lifetimeRev.bookedRevenueCents || 0) / 100,
        todayRevenue: (todayRev?.bookedRevenueCents || 0) / 100,
        transactions: lifetimeRev.paidOrders || 0,
        currency: 'USD',
        latest: lifetimeRev.latestPaidAt
          ? { date: lifetimeRev.latestPaidAt, amount: (lifetimeRev.bookedRevenueCents || 0) / 100, type: 'charge' }
          : null,
      };
    }
    return { source: 'stripe', available: false, error: 'STRIPE_SECRET_KEY not set' };
  }

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.stripe.com',
      path: '/v1/balance_transaction',
      method: 'GET',
      headers: { Authorization: `Bearer ${stripeKey}` },
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const total = data.data.reduce((sum, tx) => sum + (tx.amount || 0), 0) / 100;
          resolve({
            source: 'stripe',
            available: true,
            lifetimeRevenue: total,
            transactions: data.data.length,
            currency: data.data[0]?.currency || 'USD',
            latest: data.data[0] ? {
              date: new Date(data.data[0].created * 1000).toISOString(),
              amount: data.data[0].amount / 100,
              type: data.data[0].type,
            } : null,
          });
        } catch(e) {
          resolve({ source: 'stripe', available: false, error: e.message });
        }
      });
    });
    req.on('error', (e) => resolve({ source: 'stripe', available: false, error: e.message }));
    req.end();
  });
}

// ============================================================================
// 2. GUMROAD REVENUE (via Gumroad API or browser inspection)
// ============================================================================
async function getGumroadRevenue() {
  const gumroadKey = ENV.GUMROAD_API_KEY || process.env.GUMROAD_API_KEY;
  
  if (gumroadKey) {
    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.gumroad.com',
        path: '/v2/products?token=' + gumroadKey,
        method: 'GET',
      }, (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            const products = data.products || [];
            let totalSales = 0;
            products.forEach(p => {
              totalSales += (p.sales || 0) * (p.price || 0);
            });
            resolve({
              source: 'gumroad (live API)',
              available: true,
              livePolled: true,
              products: products.length,
              totalSales,
              productsDetail: products.map(p => ({
                id: p.id, name: p.name, price: p.price, sales: p.sales, url: p.url
              })),
            });
          } catch(e) {
            resolve({ source: 'gumroad', available: false, error: e.message });
          }
        });
      });
      req.on('error', (e) => resolve({ source: 'gumroad', available: false, error: e.message }));
      req.end();
    });
  }
  
  // No API key — check local product list
  const productsFile = path.join(require('os').homedir(), 'Documents', 'AI-Agent-Sync', 'Projects', 'ThumbGate', 'Gumroad-Products', 'products.json');
  if (fs.existsSync(productsFile)) {
    const raw = JSON.parse(fs.readFileSync(productsFile, 'utf8'));
    const products = Array.isArray(raw) ? raw : (Array.isArray(raw.products) ? raw.products : []);
    const probed = await Promise.all(products.map(async (p) => {
      const url = p.gumroadUrl || p.url || '';
      let liveHttpStatus = null;
      let ssrSalesCount = null;
      let ssrRatingsCount = 0;
      if (url) {
        try {
          const res = await fetch(url);
          liveHttpStatus = res.status;
          const html = await res.text();
          const sm = html.match(/&quot;sales_count&quot;:(\d+)/) || html.match(/"sales_count":(\d+)/);
          const rm = html.match(/&quot;ratings&quot;:\{&quot;count&quot;:(\d+)/) || html.match(/"ratings":\{"count":(\d+)/);
          if (sm) ssrSalesCount = Number(sm[1]);
          if (rm) ssrRatingsCount = Number(rm[1]);
        } catch (_) {}
      }
      const sales = ssrSalesCount !== null ? ssrSalesCount : Number(p.sales || 0);
      const priceNum = Number(String(p.price || '0.99').replace(/[^0-9.]/g, '')) || 0.99;
      return {
        id: p.productId || p.id || '',
        name: p.title || p.name || 'Untitled',
        price: p.price || '$0.99',
        priceNum,
        sales,
        ssrRatingsCount,
        liveHttpStatus,
        url,
      };
    }));
    const liveReachableCount = probed.filter((p) => p.liveHttpStatus === 200).length;
    const totalSales = probed.reduce((acc, p) => acc + (p.sales * p.priceNum), 0);
    return {
      source: `gumroad (LIVE SSR PROBE ${liveReachableCount}/${probed.length} URLs HTTP 200)`,
      available: true,
      livePolled: liveReachableCount === probed.length && probed.length > 0,
      totalSales,
      products: probed.length,
      productsDetail: probed,
    };
  }
  
  return { source: 'gumroad', available: false, error: 'GUMROAD_API_KEY not set' };
}

// ============================================================================
// 3. PLAINSHOT WEBSITE ANALYTICS (via Plausible API)
// ============================================================================
async function getPlausibleAnalytics() {
  const apiKey = ENV.PLAUSIBLE_API_KEY || process.env.PLAUSIBLE_API_KEY;
  const siteId = ENV.PLAUSIBLE_SITE_ID || process.env.PLAUSIBLE_SITE_ID || 'thumbgate.ai';
  
  if (!apiKey) {
    const hosted = getHostedRevenueStatusFallback();
    const todayT = hosted?.hostedAudit?.summaries?.today?.trafficMetrics;
    const d30T = hosted?.hostedAudit?.summaries?.['30d']?.trafficMetrics;
    const d30Sources = hosted?.hostedAudit?.summaries?.['30d']?.ctas?.bySource || {};
    if (todayT && d30T) {
      return {
        source: 'plausible (via hosted-billing-summary)',
        available: true,
        siteId,
        today: {
          visitors: todayT.visitors || 0,
          pageviews: todayT.pageViews || 0,
          ctaClicks: todayT.ctaClicks || 0,
        },
        last7d: {
          visitors: d30T.visitors || 0,
          pageviews: d30T.pageViews || 0,
          windowLabel: '30d',
        },
        topSources: Object.entries(d30Sources)
          .slice(0, 5)
          .map(([source, visitors]) => ({ source, visitors })),
      };
    }
    return { source: 'plausible', available: false, error: 'PLAUSIBLE_API_KEY not set' };
  }

  function plausibleQuery(endpoint, params = {}) {
    const qs = new URLSearchParams({ site_id: siteId, ...params });
    return new Promise((resolve, reject) => {
      const req = https.request(
        `https://plausible.io/api/v1${endpoint}?${qs.toString()}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
        (res) => {
          let body = '';
          res.on('data', d => body += d);
          res.on('end', () => res.statusCode === 200 ? resolve(JSON.parse(body)) : reject(new Error(body)));
        }
      );
      req.on('error', reject);
      req.end();
    });
  }

  try {
    const today = await plausibleQuery('/stats/aggregate', {
      metrics: 'visitors,pageviews,bounce_rate,visit_duration',
      period: '1d',
    });
    
    const last7d = await plausibleQuery('/stats/aggregate', {
      metrics: 'visitors,pageviews',
      period: '7d',
    });
    
    const sources = await plausibleQuery('/stats/breakdown', {
      property: 'visit:source',
      metrics: 'visitors,events',
      period: '7d',
      limit: 10,
    });

    return {
      source: 'plausible',
      available: true,
      siteId,
      today: {
        visitors: today.results?.visitors || 0,
        pageviews: today.results?.pageviews || 0,
        bounceRate: today.results?.bounce_rate || 0,
        visitDuration: today.results?.visit_duration || 0,
      },
      last7d: {
        visitors: last7d.results?.visitors || 0,
        pageviews: last7d.results?.pageviews || 0,
      },
      topSources: sources.results?.slice(0, 5).map(r => ({
        source: r.visit?.source || r.source || 'unknown',
        visitors: r.visitors || 0,
      })) || [],
    };
  } catch(e) {
    return { source: 'plausible', available: false, error: e.message };
  }
}

// ============================================================================
// 4. COST ROUTER (AI agent budget observability)
// ============================================================================
function getCostRouterMetrics() {
  try {
    const ledgerPath = path.join(process.cwd(), '.claude', 'memory', 'feedback');
    if (!fs.existsSync(ledgerPath)) {
      return { source: 'cost-router', available: false, error: 'Feedback directory not found' };
    }
    
    const files = fs.readdirSync(ledgerPath).filter(f => f.endsWith('.json'));
    let totalFeedback = 0;
    let totalThumbsUp = 0;
    let totalThumbsDown = 0;
    
    files.forEach(f => {
      const data = JSON.parse(fs.readFileSync(path.join(ledgerPath, f), 'utf8'));
      const entries = Array.isArray(data) ? data : [data];
      entries.forEach(e => {
        totalFeedback++;
        if (e.signal === 'up') totalThumbsUp++;
        if (e.signal === 'down') totalThumbsDown++;
      });
    });
    
    return {
      source: 'cost-router',
      available: true,
      totalFeedbackEvents: totalFeedback,
      thumbsUp: totalThumbsUp,
      thumbsDown: totalThumbsDown,
      netScore: ((totalThumbsUp - totalThumbsDown) / Math.max(totalFeedback, 1) * 100).toFixed(1) + '%',
    };
  } catch(e) {
    return { source: 'cost-router', available: false, error: e.message };
  }
}

// ============================================================================
// 5. NPM REGISTRY DOWNLOADS & RAW TELEMETRY EXPORT FUNNEL RECONCILIATION
// ============================================================================
async function getNpmRegistryDownloads() {
  try {
    const [dayRes, weekRes, monthRes] = await Promise.all([
      fetch('https://api.npmjs.org/downloads/point/last-day/thumbgate'),
      fetch('https://api.npmjs.org/downloads/point/last-week/thumbgate'),
      fetch('https://api.npmjs.org/downloads/point/last-month/thumbgate'),
    ]);
    const [dayJson, weekJson, monthJson] = await Promise.all([
      dayRes.json().catch(() => ({})),
      weekRes.json().catch(() => ({})),
      monthRes.json().catch(() => ({})),
    ]);
    return {
      available: true,
      lastDay: Number(dayJson.downloads || 0),
      lastWeek: Number(weekJson.downloads || 0),
      lastMonth: Number(monthJson.downloads || 0),
    };
  } catch (e) {
    return { available: false, error: e.message };
  }
}

async function getRawTelemetryFunnelReconciliation() {
  try {
    const { loadOperatorConfig } = require('./operational-summary');
    const cfg = loadOperatorConfig() || {};
    const key = ENV.THUMBGATE_OPERATOR_KEY || process.env.THUMBGATE_OPERATOR_KEY || cfg.operatorKey || cfg.apiKey;
    if (!key) return { available: false, error: 'Operator key not configured' };
    const res = await fetch('https://thumbgate.ai/v1/telemetry/export?limit=1000', {
      headers: { authorization: `Bearer ${key}` },
    });
    if (!res.ok) return { available: false, error: `HTTP ${res.status}` };
    const j = await res.json();
    const rows = Array.isArray(j.telemetry?.rows) ? j.telemetry.rows : [];
    const todayPrefix = new Date().toISOString().slice(0, 10);
    const counts = {
      totalRows24h: rows.length,
      proDirectStripeToday: 0,
      proDirectStripe24h: 0,
      stripeRedirectStartedToday: 0,
      stripeRedirectStarted24h: 0,
      diagnosticConfirmedToday: 0,
      diagnosticConfirmed24h: 0,
      checkoutBootstrapToday: 0,
      checkoutBootstrap24h: 0,
      cancelPageViewsToday: 0,
      cancelPageViews24h: 0,
      interstitialAbandonedToday: 0,
      bundle49Clicks24h: 0,
      cliInits24h: 0,
    };
    for (const r of rows) {
      if (r.audience === 'bot' || r.audience === 'test') continue;
      const ev = String(r.eventType || r.event || '');
      const isToday = String(r.receivedAt || '').startsWith(todayPrefix);
      if (ev === 'pro_checkout_direct_stripe') {
        counts.proDirectStripe24h += 1;
        if (isToday) counts.proDirectStripeToday += 1;
      } else if (ev === 'stripe_redirect_started') {
        counts.stripeRedirectStarted24h += 1;
        if (isToday) counts.stripeRedirectStartedToday += 1;
      } else if (ev === 'diagnostic_checkout_confirmed') {
        counts.diagnosticConfirmed24h += 1;
        if (isToday) counts.diagnosticConfirmedToday += 1;
      } else if (ev === 'checkout_bootstrap') {
        counts.checkoutBootstrap24h += 1;
        if (isToday) counts.checkoutBootstrapToday += 1;
      } else if (ev === 'checkout_cancel_page_view') {
        counts.cancelPageViews24h += 1;
        if (isToday) counts.cancelPageViewsToday += 1;
      } else if (ev === 'checkout_interstitial_abandoned' && isToday) {
        counts.interstitialAbandonedToday += 1;
      } else if (ev === 'cli_init') {
        counts.cliInits24h += 1;
      }
      if (r.ctaId === 'pro_checkout_bundle_49') counts.bundle49Clicks24h += 1;
    }
    counts.trueCheckoutStartsToday = counts.proDirectStripeToday + counts.stripeRedirectStartedToday + counts.diagnosticConfirmedToday;
    counts.trueCheckoutStarts24h = counts.proDirectStripe24h + counts.stripeRedirectStarted24h + counts.diagnosticConfirmed24h;
    return { available: true, ...counts };
  } catch (e) {
    return { available: false, error: e.message };
  }
}

// ============================================================================
// MAIN DASHBOARD
// ============================================================================
async function main() {
  const json = process.argv.includes('--json');
  const dashboard = {};
  
  if (!json) {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║          THUMBGATE REVENUE & OBSERVABILITY DASHBOARD         ║');
    console.log('║          Real-time analytics across all revenue channels   ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log();
  }
  
  // 1. Stripe
  const stripe = await getStripeRevenue();
  dashboard.stripe = stripe;
  if (!json) {
    console.log('💳 Stripe Revenue:');
    if (stripe.available) {
      console.log(`   Lifetime revenue: $${stripe.lifetimeRevenue.toFixed(2)}`);
      console.log(`   Transactions: ${stripe.transactions}`);
      if (stripe.latest) console.log(`   Latest: $${stripe.latest.amount} on ${stripe.latest.date}`);
    } else {
      console.log(`   ⚠️  ${stripe.error}`);
      console.log('   (Set STRIPE_SECRET_KEY for live data)');
    }
    console.log();
  }
  
  // 2. Gumroad
  const gumroad = await getGumroadRevenue();
  dashboard.gumroad = gumroad;
  if (!json) {
    console.log(`🍮 Gumroad Revenue (${gumroad.livePolled ? 'LIVE API' : 'STATIC LOCAL CATALOG — GUMROAD_API_KEY not set'}):`);
    if (gumroad.available) {
      console.log(`   Products: ${gumroad.products}`);
      console.log(`   Total sales: $${gumroad.totalSales.toFixed(2)}`);
      if (gumroad.productsDetail) {
        gumroad.productsDetail.forEach(p => {
          console.log(`   - ${p.name}: $${String(p.price).replace(/^\$/, '')} × ${p.sales} sales (${p.url || 'local'})`);
        });
      }
    } else {
      console.log(`   ⚠️  ${gumroad.error || gumroad.note}`);
      if (gumroad.products) console.log(`   Products tracked locally: ${gumroad.products}`);
      console.log('   (Set GUMROAD_API_KEY for live data)');
    }
    console.log();
  }
  
  // 3. Plausible
  const plausible = await getPlausibleAnalytics();
  dashboard.plausible = plausible;
  if (!json) {
    console.log('📊 Plausible Web Analytics:');
    if (plausible.available) {
      console.log(`   Today: ${plausible.today.visitors} visitors, ${plausible.today.pageviews} pageviews`);
      console.log(`   Last ${plausible.last7d.windowLabel || '7d'}: ${plausible.last7d.visitors} visitors, ${plausible.last7d.pageviews} pageviews`);
      console.log(`   Top sources: ${plausible.topSources.map(s => `${s.source}(${s.visitors})`).join(', ')}`);
    } else {
      console.log(`   ⚠️  ${plausible.error}`);
      console.log('   (Set PLAUSIBLE_API_KEY for live data)');
    }
    console.log();
  }
  
  // 4. Cost Router
  const costRouter = getCostRouterMetrics();
  dashboard.costRouter = costRouter;
  if (!json) {
    console.log('💰 Agent Budget Observability:');
    if (costRouter.available) {
      console.log(`   Feedback events: ${costRouter.totalFeedbackEvents}`);
      console.log(`   👍 up: ${costRouter.thumbsUp}, 👎 down: ${costRouter.thumbsDown}`);
      console.log(`   Net score: ${costRouter.netScore}`);
    } else {
      console.log(`   ⚠️  ${costRouter.error}`);
    }
    console.log();
  }
  // 5. npm Registry Downloads + Raw Telemetry Export Reconciliation
  const [npmStats, rawFunnel] = await Promise.all([
    getNpmRegistryDownloads(),
    getRawTelemetryFunnelReconciliation(),
  ]);
  dashboard.npm = npmStats;
  dashboard.rawFunnelReconciliation = rawFunnel;
  if (!json) {
    console.log('📦 npm Package Adoption (api.npmjs.org/downloads/point/*/thumbgate):');
    if (npmStats.available) {
      console.log(`   Last 24h: ${npmStats.lastDay} downloads | Last 7d: ${npmStats.lastWeek} downloads | Last 30d: ${npmStats.lastMonth} downloads`);
    } else {
      console.log(`   ⚠️  ${npmStats.error}`);
    }
    console.log();
    console.log('🔀 Raw Telemetry Export Reconciliation (/v1/telemetry/export):');
    if (rawFunnel.available) {
      console.log(`   True Checkout Starts (Today / 24h): ${rawFunnel.trueCheckoutStartsToday} today / ${rawFunnel.trueCheckoutStarts24h} in 24h`);
      console.log(`   ├─ 1-Click Direct Stripe (/go/pro-direct): ${rawFunnel.proDirectStripeToday} today / ${rawFunnel.proDirectStripe24h} in 24h`);
      console.log(`   ├─ Interstitial Stripe Redirects:          ${rawFunnel.stripeRedirectStartedToday} today / ${rawFunnel.stripeRedirectStarted24h} in 24h`);
      console.log(`   ├─ $499 Diagnostic Checkout Redirects:     ${rawFunnel.diagnosticConfirmedToday} today / ${rawFunnel.diagnosticConfirmed24h} in 24h`);
      console.log(`   ├─ $49 Bundle Gumroad Clicks (24h):        ${rawFunnel.bundle49Clicks24h}`);
      console.log(`   └─ Stripe Cancel Returns (/cancel):        ${rawFunnel.cancelPageViewsToday} today / ${rawFunnel.cancelPageViews24h} in 24h`);
    } else {
      console.log(`   ⚠️  ${rawFunnel.error}`);
    }
    console.log();
  }

  // 6. Summary
  const totalRevenue = (stripe.available ? stripe.lifetimeRevenue : 0) +
                       (gumroad.available ? gumroad.totalSales : 0);
  if (!json) {
    console.log('══════════════════════════════════════════════════════════════');
    console.log('📈 SUMMARY');
    console.log('══════════════════════════════════════════════════════════════');
    console.log(`Total lifetime revenue: $${totalRevenue.toFixed(2)}`);
    console.log(`Revenue sources connected: ${[stripe.available, gumroad.available].filter(Boolean).length}/2`);
    console.log(`Analytics connected: ${[plausible.available].filter(Boolean).length}/1`);
    console.log(`Agent observability: ${costRouter.available ? '✅ active' : '⚠️  inactive'}`);
    
    if (totalRevenue === 0) {
      console.log('\n⚠️  NO REVENUE YET — Gumroad product published today, needs time for sales');
    } else if (totalRevenue < 1000) {
      console.log('\n💡 Revenue is from early adopters. Focus on Gumroad product launch to accelerate.');
    } else {
      console.log('\n🎯 On track for make $300/day, 24/7 target');
    }
    console.log('══════════════════════════════════════════════════════════════');
  }
  
  if (json) {
    console.log(JSON.stringify(dashboard, null, 2));
  }
}

main().catch(e => console.error(e));
