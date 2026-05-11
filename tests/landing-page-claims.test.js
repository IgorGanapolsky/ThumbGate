'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function staticPathExists(href) {
  const pathname = href.split('#')[0].split('?')[0];
  if (!pathname || pathname === '/') return true;
  const relative = pathname.replace(/^\//, '');
  const direct = path.join(publicDir, relative);
  const html = direct.endsWith('.html') ? direct : `${direct}.html`;
  const index = path.join(direct, 'index.html');
  return fs.existsSync(direct) || fs.existsSync(html) || fs.existsSync(index);
}

function isRuntimeRoute(href) {
  return /^\/(go|checkout|v1|api|ingest)(\/|\?|$)/.test(href);
}

function pricingCardText(cardClass) {
  const pattern = new RegExp(`<div class="card price-card ${cardClass}">([\\s\\S]*?)<a class="btn`, 'i');
  const match = indexHtml.match(pattern);
  assert.ok(match, `Missing ${cardClass} pricing card`);
  return visibleText(match[1]);
}

describe('homepage claims match shipped code', () => {
  test('Free tier copy matches rate-limiter constants', () => {
    const { FREE_TIER_LIMITS, FREE_TIER_MAX_GATES } = require(path.join(root, 'scripts', 'rate-limiter.js'));

    assert.equal(FREE_TIER_LIMITS.capture_feedback.lifetime, 3);
    assert.equal(FREE_TIER_LIMITS.prevention_rules.lifetime, 1);
    assert.equal(FREE_TIER_MAX_GATES, 1);
    assert.match(indexHtml, /3 feedback captures total/);
    assert.match(indexHtml, /1 active prevention rule/);
  });

  test('Free tier does not claim paid-only exports or team sync', () => {
    const text = pricingCardText('free');
    assert.match(text, /No DPO export, team sync, or hosted dashboard/);
    assert.doesNotMatch(text, /Unlimited/);
  });

  test('Pro tier claims have code-backed surfaces', () => {
    const server = fs.readFileSync(path.join(root, 'src', 'api', 'server.js'), 'utf8');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

    assert.ok(server.includes("'/v1/dpo/export'"), 'DPO export API must exist');
    assert.ok(pkg.files.includes('public/dashboard.html'), 'local dashboard must ship in npm package');
    assert.match(indexHtml, /Unlimited local feedback captures/);
    assert.match(indexHtml, /Unlimited local prevention rules/);
    assert.match(indexHtml, /Personal local dashboard/);
    assert.match(indexHtml, /DPO training data export/);
  });

  test('homepage does not contain unsupported services pricing', () => {
    const text = visibleText(indexHtml);
    assert.doesNotMatch(text, /\$499/);
    assert.doesNotMatch(text, /\$1500/);
    assert.doesNotMatch(text, /\$3997|\$3,997/);
    assert.doesNotMatch(text, /\$97/);
    assert.doesNotMatch(text, /income guarantee/i);
  });
});

describe('homepage links', () => {
  test('all local static homepage links resolve or use known runtime routes', () => {
    const hrefs = [...indexHtml.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    const broken = [];

    for (const href of hrefs) {
      if (!href.startsWith('/')) continue;
      if (href.startsWith('//')) continue;
      if (href.startsWith('/assets/') || href.startsWith('/brand/') || href === '/favicon.svg' || href === '/apple-touch-icon.png') {
        if (!staticPathExists(href)) broken.push(href);
        continue;
      }
      if (isRuntimeRoute(href)) continue;
      if (!staticPathExists(href)) broken.push(href);
    }

    assert.deepEqual(broken, []);
  });

  test('top-of-funnel CTAs use working runtime routes', () => {
    assert.match(indexHtml, /href="\/go\/install\?/);
    assert.match(indexHtml, /href="\/go\/pro\?/);
    assert.doesNotMatch(indexHtml, /thumbgate-production\.up\.railway\.app\/go\/install/);
    assert.doesNotMatch(indexHtml, /thumbgate-production\.up\.railway\.app\/go\/pro/);
  });
});
