'use strict';

/**
 * Gumroad Poller — tracks product sales, views, and revenue via Gumroad API.
 * Integrates with the social-analytics store for daily polling.
 *
 * Required environment variables:
 *   GUMROAD_API_KEY  — Gumroad API access token (from https://gumroad.com/api)
 */

const https = require('https');
const { initDb, upsertMetric } = require('../store');

const GUMROAD_BASE = 'https://api.gumroad.com/v2';

/**
 * Builds a Gumroad API request and returns parsed JSON.
 * @param {string} endpoint - Path under /v2 (e.g. '/products')
 * @param {string} apiKey - Gumroad API access token
 * @returns {Promise<object>} Parsed JSON response.
 */
function gumroadQuery(endpoint, apiKey) {
  const qs = new URLSearchParams({ access_token: apiKey });
  const url = `${GUMROAD_BASE}${endpoint}?${qs.toString()}`;

  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode !== 200) reject(new Error(`Gumroad API ${res.statusCode}: ${body}`));
        try { resolve(JSON.parse(body)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Fetch all products and their sales data.
 * @returns {Promise<object>} Products with sales, revenue, and views.
 */
async function getProducts() {
  const apiKey = process.env.GUMROAD_API_KEY;
  if (!apiKey) throw new Error('GUMROAD_API_KEY is not set');

  const data = await gumroadQuery('/products', apiKey);
  const products = (data.products || []).map(p => ({
    id: p.id,
    name: p.name,
    url: p.url,
    price: p.price,
    sales: p.sales || 0,
    salesSum: parseInt(p.sales_sum || '0', 10) / 100,
    views: p.views || 0,
    published: p.published || false,
    createdAt: p.created_at,
  }));
  return products;
}

/**
 * Main polling entry point. Fetches product metrics and stores in DB.
 * @param {object} db - SQLite database instance
 * @returns {Promise<object>} Aggregated metrics.
 */
async function pollGumroad(db) {
  try {
    const products = await getProducts();
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toISOString();

    for (const p of products) {
      upsertMetric(db, {
        platform: 'gumroad',
        content_type: 'product',
        post_id: p.id,
        metric_date: today,
        fetched_at: now,
        metrics: JSON.stringify({
          views: p.views,
          sales: p.sales,
          revenue: p.salesSum,
          price: p.price,
          published: p.published,
        }),
      });
    }

    const totalSales = products.reduce((s, p) => s + p.salesSum, 0);
    const totalViews = products.reduce((s, p) => s + p.views, 0);
    const totalRevenue = totalSales;

    return {
      source: 'gumroad',
      available: true,
      products,
      metrics: {
        totalProducts: products.length,
        totalRevenue,
        totalViews,
        totalSales: products.reduce((s, p) => s + p.sales, 0),
        avgConversion: totalViews > 0 ? (products.reduce((s, p) => s + p.sales, 0) / totalViews * 100) : 0,
      },
    };
  } catch(e) {
    return {
      source: 'gumroad',
      available: false,
      error: e.message,
    };
  }
}

module.exports = { pollGumroad, getProducts, gumroadQuery };

// Allow running directly: node scripts/social-analytics/pollers/gumroad.js
if (require.main === module) {
  const db = initDb();
  pollGumroad(db).then(results => {
    console.log(JSON.stringify(results, null, 2));
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
