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

test('homepage exposes both Pro $19/mo and Enterprise $499 offers', () => {
  const visibleText = visibleBodyText(landingPage);
  const prices = [...visibleText.matchAll(/\$\d[\d,]*/g)].map((match) => match[0]);
  const uniquePrices = [...new Set(prices)];

  assert.ok(uniquePrices.includes('$19'), `expected $19 among ${uniquePrices.join(', ')}`);
  assert.ok(uniquePrices.includes('$499'), `expected $499 among ${uniquePrices.join(', ')}`);
  assert.equal((landingPage.match(/data-primary-checkout/g) || []).length, 2); // form attr + querySelector
  assert.equal((landingPage.match(/<form[^>]+action="\/go\/diagnostic-pay"/g) || []).length, 1);
  assert.match(landingPage, /method="POST"/);
  assert.match(landingPage, /name="customer_email"[^>]*required/);
  assert.match(landingPage, /name="plan_id" value="sprint_diagnostic"/);
  assert.match(landingPage, /\/checkout\/pro/);
  assert.match(landingPage, /Start Pro — \$19\/mo/);
  assert.match(landingPage, /Get Started — \$499 Diagnostic/);
  assert.match(landingPage, /Pro · \$19\/mo/);
  assert.match(landingPage, /Get Started · \$499/);
});

test('visible text filtering consumes the complete script and style end tags', () => {
  const html = '<body>shown<script>hidden</script\t\n data-test>after<style>hidden</style extra>done</body>';
  assert.equal(visibleBodyText(html), 'shown after done');
});

test('homepage keeps conversion noise off while offering both paid paths', () => {
  assert.match(landingPage, /id="workflow-sprint-intake"[^>]*data-legacy-intake-alias/);
  assert.doesNotMatch(landingPage, /Enterprise pilot|newsletter/i);
  assert.doesNotMatch(landingPage, /offer-router|sticky-cta|buyer-intent\.js|revenue-assist-panel/i);
  assert.match(landingPage, /<body data-revenue-assist="off">/);
});

test('homepage stays human-scannable instead of becoming a product monorepo', () => {
  const visibleText = visibleBodyText(landingPage);
  const words = visibleText.split(/\s+/).filter(Boolean);
  const h2Count = (landingPage.match(/<h2\b/g) || []).length;
  const h3Count = (landingPage.match(/<h3\b/g) || []).length;

  assert.ok(words.length <= 900, `visible homepage is ${words.length} words`);
  assert.ok(h2Count <= 8, `homepage has ${h2Count} H2 headings`);
  assert.ok(h3Count <= 14, `homepage has ${h3Count} H3 headings`);
  for (const jargon of ['Thompson Sampling', 'DPO', 'LanceDB', 'ContextFS', 'MemAlign', 'FTS5']) {
    // DPO may appear in Pro bullets intentionally — only ban heavy infra jargon
    if (jargon === 'DPO') continue;
    assert.doesNotMatch(visibleText, new RegExp(jargon, 'i'));
  }
});

test('hero names both paid paths and the self-improving product outcome', () => {
  const hero = landingPage.slice(
    landingPage.indexOf('<!-- HERO -->'),
    landingPage.indexOf('</section>', landingPage.indexOf('<!-- HERO -->'))
  );
  const lede = normalizeHtmlText((hero.match(/<p class="hero-lede">([\s\S]*?)<\/p>/) || [])[1]);

  assert.match(landingPage, /ThumbGate — Thumbs teach\. The gate enforces\./i);
  assert.match(hero, /<h1>Thumbs teach\. The gate enforces\.<\/h1>/i);
  assert.match(hero, /Self-improving firewall for AI agents/i);
  assert.match(hero, /next tool call is checked before it runs/i);
  assert.match(hero, /Pro \$19\/mo/);
  assert.match(hero, /\$499/);
  assert.match(hero, /repeat 3\/3[\s\S]*gate promoted[\s\S]*DENY before execution/i);
  assert.match(hero, /npx thumbgate init/);
  assert.match(hero, /thumbgate-dashboard/);
  assert.match(hero, /npx thumbgate dashboard --open/);
  assert.match(hero, /id="thumbgate-dashboard-command"/);
  assert.match(hero, /class="thumb-mark up"[\s\S]*class="thumb-mark down"/);
  assert.match(hero, /model weights unchanged/i);
  assert.match(hero, /audit receipt written/i);
  assert.doesNotMatch(hero, /receipt tg_/i);
  assert.ok(lede.split(/\s+/).length <= 40, `hero lede is ${lede.split(/\s+/).length} words`);
});

test('how-it-works sells the self-improving loop, not a static allowlist', () => {
  assert.match(landingPage, /The gate gets better\. Your model stays untouched/i);
  assert.match(landingPage, /Reviewed outcomes refine local rules/i);
  assert.match(landingPage, /Repeated failures can promote/i);
  assert.match(landingPage, /stale gates expire/i);
  assert.match(landingPage, /under your control/i);
  assert.match(landingPage, /policy without review/i);
  assert.match(landingPage, /feedback changes enforcement/i);
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
  assert.match(landingPage, /That is “self-improving”/);
  assert.match(landingPage, /data-loop-step="1"/);
  assert.match(landingPage, /data-loop-step="4"/);
  assert.match(landingPage, /id="loop-panel"/);
  assert.match(landingPage, /Under the hood/);
  assert.match(landingPage, /initLoopDemos|data-loop-step/);
  assert.match(landingPage, /THUMBGATE_STRICT_ENFORCEMENT|warn-by-default/);
  // Valid interactive cards: div[role=tab], not <button> wrapping <h3>/<div>
  // (invalid nesting auto-closes the control and breaks clicks in browsers).
  assert.match(landingPage, /<div class="loop-step" role="tab" tabindex="0"/);
  assert.doesNotMatch(landingPage, /<button[^>]*class="loop-step"/);
});

test('paid wedge includes managed implementation, regression, and rollout proof', () => {
  assert.match(landingPage, /Get Started · \$499/);
  assert.match(landingPage, /Get Started — \$499 Diagnostic/);
  assert.match(landingPage, /One configured local gate \+ regression test|One configured local gate and its regression test/);
  assert.match(landingPage, /Rollout and rollback proof within two business days/);
  assert.match(landingPage, /If the workflow cannot be reduced to one supported gate, the order is refunded/);
  assert.match(landingPage, /Multi-system implementation[\s\S]*require separate scope/);
});

test('enforcement promise distinguishes default denies from strict-mode blocks', () => {
  assert.match(landingPage, /Detected secret exfiltration and gate-process bypass attempts are denied by default/i);
  assert.match(landingPage, /Supported unapproved financial mutations are denied/i);
  assert.match(landingPage, /Matching destructive actions warn by default and deny in strict mode/i);
  assert.match(landingPage, /does not mean every free install blocks every risky command/i);
  assert.match(landingPage, /mode\s+strict enforcement[\s\S]*decision\s+<span class="red">DENY<\/span>/i);
});

test('FAQPage JSON-LD matches the three visible buyer questions', () => {
  const jsonLd = parseJsonLd(landingPage);
  const faqSchema = jsonLd.find((document) => document['@type'] === 'FAQPage');
  const visibleFaq = visibleFaqAnswers(landingPage);

  assert.ok(jsonLd.some((document) => document['@type'] === 'SoftwareApplication'));
  assert.ok(jsonLd.some((document) => document['@type'] === 'Service'));
  assert.ok(faqSchema);
  assert.equal(faqSchema.mainEntity.length, 3);
  assert.equal(visibleFaq.size, 3);
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
  assert.match(landingPage, /selectedPlan === 'pro' \? 19 : 499/);
  assert.match(landingPage, /pro_offer_click/);
  assert.match(landingPage, /install_copy/);
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

test('homepage uses vector thumbs and one product-shaped incident replay instead of redundant diagrams', () => {
  assert.match(landingPage, /class="thumb-pair"/);
  assert.match(landingPage, /aria-label="Thumbs up"[\s\S]*aria-label="Thumbs down"/);
  assert.match(landingPage, /class="incident-console"/);
  assert.match(landingPage, /incident replay/i);
  assert.match(landingPage, /Thumbs teach\. The gate enforces\./);
  assert.doesNotMatch(landingPage, /\/assets\/diagrams\/(?:hero-thumbs|before-after|loop|self-improving-thumbs-loop)\.svg/);

  const heroStart = landingPage.indexOf('<!-- HERO -->');
  const howStart = landingPage.indexOf('id="how-it-works"');
  const heroBlock = landingPage.slice(heroStart, howStart);
  assert.ok(heroBlock.includes('class="incident-console"'), 'product replay must appear before how-it-works');
  assert.ok(heroBlock.includes('class="thumb-pair"'), 'vector thumbs must appear in hero');
});

test('homepage proves four incident classes and differentiates the execution layer', () => {
  assert.match(landingPage, /data-scenario="git"[\s\S]*protect-main[\s\S]*DENY/i);
  assert.match(landingPage, /data-scenario="secret"[\s\S]*credential egress[\s\S]*DENY/i);
  assert.match(landingPage, /data-scenario="claim"[\s\S]*row count is 1,284[\s\S]*1,283[\s\S]*BLOCK RESPONSE/i);
  assert.match(landingPage, /data-scenario="spend"[\s\S]*Apollo[\s\S]*none this turn[\s\S]*DENY/i);
  assert.match(landingPage, /Not a prompt\. Not a judge\. Not a postmortem\./i);
  assert.match(landingPage, /Checks configured boundaries before execution/i);
});
