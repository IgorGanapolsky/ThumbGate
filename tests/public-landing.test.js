'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const landingPagePath = path.join(__dirname, '..', 'public', 'index.html');
const landingPage = fs.readFileSync(landingPagePath, 'utf8');

const HTML_ENTITY_REPLACEMENTS = new Map([
  ['&amp;', '&'],
  ['&quot;', '"'],
  ['&#39;', "'"],
  ['&apos;', "'"],
  ['&mdash;', '—'],
  ['&ndash;', '–'],
  ['&rsquo;', '’'],
  ['&ldquo;', '“'],
  ['&rdquo;', '”'],
]);

function normalizeHtmlText(value) {
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|quot|#39|apos|mdash|ndash|rsquo|ldquo|rdquo);/g, (entity) => (
      HTML_ENTITY_REPLACEMENTS.get(entity)
    ))
    .replace(/\s+/g, ' ')
    .trim();
}

function visibleBodyText(html) {
  const body = (html.match(/<body\b[^>]*>([\s\S]*?)<\/body\b[^>]*>/i) || [])[1] || '';
  return normalizeHtmlText(body
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, ' '));
}

function parseJsonLd(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script\b[^>]*>/g)]
    .map((match) => JSON.parse(match[1]));
}

function visibleFaqAnswers(html) {
  const entries = [...html.matchAll(
    /<button class="faq-q"[^>]*>([\s\S]*?)<\/button>\s*<div class="faq-a">([\s\S]*?)<\/div>/g
  )];
  return new Map(entries.map(([, question, answer]) => [
    normalizeHtmlText(question),
    normalizeHtmlText(answer),
  ]));
}

test('homepage has one priced offer and one checkout form', () => {
  const visibleText = visibleBodyText(landingPage);
  const prices = [...visibleText.matchAll(/\$\d[\d,]*/g)].map((match) => match[0]);
  const uniquePrices = [...new Set(prices)];

  assert.deepEqual(uniquePrices, ['$499']);
  assert.equal((landingPage.match(/data-primary-checkout/g) || []).length, 2);
  assert.equal((landingPage.match(/<form[^>]+action="\/go\/diagnostic-pay"/g) || []).length, 1);
  assert.match(landingPage, /method="POST"/);
  assert.match(landingPage, /name="customer_email"[^>]*required/);
  assert.match(landingPage, /name="plan_id" value="sprint_diagnostic"/);
});

test('visible text filtering consumes the complete script and style end tags', () => {
  const html = '<body>shown<script>hidden</script\t\n data-test>after<style>hidden</style extra>done</body>';
  assert.equal(visibleBodyText(html), 'shown after done');
});

test('homepage removes competing commercial funnels and conversion overlays', () => {
  assert.doesNotMatch(landingPage, /\/checkout\/pro|\/go\/sprint|href="[^"]*workflow-sprint-intake/i);
  assert.match(landingPage, /id="workflow-sprint-intake"[^>]*data-legacy-intake-alias/);
  assert.doesNotMatch(landingPage, /Start Pro|Upgrade to Pro|Enterprise pilot|newsletter/i);
  assert.doesNotMatch(landingPage, /offer-router|sticky-cta|buyer-intent\.js|revenue-assist-panel/i);
  assert.match(landingPage, /<body data-revenue-assist="off">/);
});

test('homepage stays human-scannable instead of becoming a product monorepo', () => {
  const visibleText = visibleBodyText(landingPage);
  const words = visibleText.split(/\s+/).filter(Boolean);
  const h2Count = (landingPage.match(/<h2\b/g) || []).length;
  const h3Count = (landingPage.match(/<h3\b/g) || []).length;

  assert.ok(words.length <= 900, `visible homepage is ${words.length} words`);
  assert.ok(h2Count <= 6, `homepage has ${h2Count} H2 headings`);
  assert.ok(h3Count <= 7, `homepage has ${h3Count} H3 headings`);
  for (const jargon of ['Thompson Sampling', 'DPO', 'LanceDB', 'ContextFS', 'MemAlign', 'FTS5']) {
    assert.doesNotMatch(visibleText, new RegExp(jargon, 'i'));
  }
});

test('hero names one buyer, one failure, and the enterprise entry outcome', () => {
  const hero = landingPage.slice(
    landingPage.indexOf('<!-- HERO -->'),
    landingPage.indexOf('</section>', landingPage.indexOf('<!-- HERO -->'))
  );
  const lede = normalizeHtmlText((hero.match(/<p class="hero-lede">([\s\S]*?)<\/p>/) || [])[1]);

  assert.match(landingPage, /Self-Improving Firewall for Your AI Agents/i);
  assert.match(hero, /<h1>Self-Improving Firewall for Your AI Agents\.<\/h1>/i);
  assert.match(hero, /engineering and security leads/);
  assert.match(hero, /Enterprise Workflow Gate/);
  assert.match(hero, /\$499 enterprise entry offer/);
  assert.match(hero, /Rank[\s\S]*lessons/i);
  assert.match(hero, /Promote[\s\S]*gates/i);
  assert.match(hero, /npx thumbgate init/);
  assert.ok(lede.split(/\s+/).length <= 30, `hero lede is ${lede.split(/\s+/).length} words`);
});

test('how-it-works sells the self-improving loop, not a static allowlist', () => {
  assert.match(landingPage, /Pre-action checks—and the systems that refine them/i);
  assert.match(landingPage, /Lessons are re-ranked per action/i);
  assert.match(landingPage, /repeated failures can promote into gates/i);
  assert.match(landingPage, /stale auto-promoted gates expire/i);
  assert.match(landingPage, /firewall improves without retraining the model/i);
  assert.match(landingPage, /source\s+core protection · strict mode/i);
});

test('homepage explains the product with one four-stage self-improving loop', () => {
  assert.match(landingPage, /id="how-it-works"/);
  assert.match(landingPage, /Capture feedback/);
  assert.match(landingPage, /Remember locally/);
  assert.match(landingPage, /Rank and refine/);
  assert.match(landingPage, /Gate the next action/);
  assert.match(landingPage, />ALLOW</);
  assert.match(landingPage, />WARN</);
  assert.match(landingPage, />DENY</);
  assert.match(landingPage, /Each reviewed outcome closes the loop/);
});

test('paid wedge includes managed implementation, regression, and rollout proof', () => {
  assert.match(landingPage, /Enterprise gate · \$499/);
  assert.match(landingPage, /enterprise entry offer for one workflow/i);
  assert.match(landingPage, /One configured local gate and its regression test/);
  assert.match(landingPage, /Rollout and rollback proof within two business days/);
  assert.match(landingPage, /If the workflow cannot be reduced to one supported gate, the order is refunded/);
  assert.match(landingPage, /Multi-system implementation[\s\S]*require separate scope/);
});

test('enforcement promise distinguishes default denies from strict-mode blocks', () => {
  assert.match(landingPage, /Detected secret exfiltration[\s\S]*denied by default/i);
  assert.match(landingPage, /Matching destructive actions warn by default and deny in strict mode/i);
  assert.match(landingPage, /not a claim that every free install blocks every risky command automatically/i);
  assert.match(landingPage, /mode\s+strict enforcement[\s\S]*decision\s+<span class="red">DENY<\/span>/i);
});

test('FAQPage JSON-LD matches the five visible buyer questions', () => {
  const jsonLd = parseJsonLd(landingPage);
  const faqSchema = jsonLd.find((document) => document['@type'] === 'FAQPage');
  const visibleFaq = visibleFaqAnswers(landingPage);

  assert.ok(jsonLd.some((document) => document['@type'] === 'SoftwareApplication'));
  assert.ok(jsonLd.some((document) => document['@type'] === 'Service'));
  assert.ok(faqSchema);
  assert.equal(faqSchema.mainEntity.length, 5);
  assert.equal(visibleFaq.size, 5);
  for (const entity of faqSchema.mainEntity) {
    const question = normalizeHtmlText(entity.name);
    const answer = normalizeHtmlText(entity.acceptedAnswer.text);
    assert.equal(visibleFaq.get(question), answer, `FAQ drift: ${question}`);
  }
});

test('checkout intent keeps first-party, Plausible, and optional GA4 telemetry', () => {
  assert.match(landingPage, /function sendFirstPartyTelemetry/);
  assert.match(landingPage, /\/v1\/telemetry\/ping/);
  assert.doesNotMatch(landingPage, /\/v1\/telemetry\/event/);
  assert.match(landingPage, /window\.plausible\('checkout_start'/);
  assert.match(landingPage, /sendGa4Event\('begin_checkout'/);
  assert.match(landingPage, /sendFirstPartyTelemetry\('checkout_start'/);
  assert.match(landingPage, /planId: 'sprint_diagnostic'/);
  assert.match(landingPage, /const serverTelemetryCaptured = '__SERVER_TELEMETRY_CAPTURED__' === 'true'/);
});

test('homepage preserves brand, version, repository, and deployment placeholders', () => {
  assert.match(landingPage, /class="nav-logo"[^>]*>[\s\S]*src="\/assets\/brand\/thumbgate-mark-inline-v3\.svg"/);
  assert.match(landingPage, /<span class="logo-text">ThumbGate<\/span>/);
  assert.match(landingPage, /<link rel="icon"[^>]*href="\/thumbgate-icon\.png"/);
  assert.match(landingPage, /<meta name="thumbgate-version" content="\d+\.\d+\.\d+">/);
  assert.match(landingPage, /MIT License · npm v\d+\.\d+\.\d+/);
  assert.match(landingPage, /https:\/\/github\.com\/IgorGanapolsky\/ThumbGate/);
  assert.match(landingPage, /__GOOGLE_SITE_VERIFICATION_META__/);
  assert.match(landingPage, /__GA_BOOTSTRAP__/);
  assert.doesNotMatch(landingPage, /Math\.random\(/);
});
