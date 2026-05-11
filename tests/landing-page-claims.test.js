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
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
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
  return /^\/(go|checkout|v1|api|ingest|compare|guides)(\/|\?|$)/.test(href);
}

function homepageAnchors() {
  return [...indexHtml.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((match) => ({
      href: match[1],
      text: visibleText(match[2]),
    }));
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

    assert.equal(FREE_TIER_LIMITS.capture_feedback.lifetime, Infinity);
    assert.equal(FREE_TIER_LIMITS.prevention_rules.lifetime, Infinity);
    assert.equal(FREE_TIER_MAX_GATES, 5);
    assert.match(indexHtml, /Unlimited local feedback captures/);
    assert.match(indexHtml, /5 active prevention rules/);
  });

  test('Free tier does not claim paid-only exports or team sync', () => {
    const text = pricingCardText('free');
    assert.match(text, /No DPO export, team sync, or hosted dashboard/);
    assert.doesNotMatch(text, /DPO training data export/);
    assert.doesNotMatch(text, /Personal local dashboard/);
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

  test('homepage presents the branded domain instead of raw deployment URLs', () => {
    assert.doesNotMatch(indexHtml, /thumbgate-production\.up\.railway\.app/);
    assert.doesNotMatch(indexHtml, /railway\.app/);
    assert.match(indexHtml, /data-domain="thumbgate\.ai"/);
  });

  test('homepage does not imply third-party integrations or claims that are not implemented', () => {
    const text = visibleText(indexHtml);
    assert.doesNotMatch(text, /Cloudflare Artifacts/i);
    assert.doesNotMatch(text, /GPT-5\.5/i);
    assert.doesNotMatch(text, /Dreaming/i);
    assert.doesNotMatch(text, /AWS Rex/i);
    assert.doesNotMatch(text, /TOON/i);
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

  test('top-of-funnel CTAs resolve directly without ambiguous homepage loops', () => {
    const ctas = homepageAnchors().filter((anchor) => (
      /install free|go pro/i.test(anchor.text)
    ));

    assert.ok(ctas.length >= 4, 'expected nav, hero, and pricing CTAs');
    assert.ok(
      ctas.some((anchor) => anchor.text === 'Install free' && anchor.href.startsWith('/guide?')),
      'install CTAs must open the setup guide directly'
    );
    assert.ok(
      ctas.some((anchor) => anchor.text === 'Go Pro - $19/mo' && anchor.href.startsWith('/checkout/pro?confirm=1')),
      'Pro CTAs must open confirmed checkout directly'
    );
    assert.doesNotMatch(indexHtml, /href="\/go\/install\?/);
    assert.doesNotMatch(indexHtml, /href="\/go\/pro\?/);
    assert.doesNotMatch(indexHtml, /thumbgate-production\.up\.railway\.app\/go\/install/);
    assert.doesNotMatch(indexHtml, /thumbgate-production\.up\.railway\.app\/go\/pro/);
  });
});
