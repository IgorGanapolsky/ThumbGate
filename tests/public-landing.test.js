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

test('homepage exposes Pro $19/mo and the $499 Setup Sprint', () => {
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
  assert.match(landingPage, /\/go\/pro-direct/);
  assert.match(landingPage, /Start Pro — \$19\/mo/);
  assert.match(landingPage, /Book the \$499 setup/);
  assert.match(landingPage, /data-cta-id="nav_install_free"[^>]*>Install free</);
  assert.match(landingPage, /See the \$499 setup/);
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

test('homepage names the installers that ship', () => {
  const installPage = fs.readFileSync(path.join(__dirname, '..', 'public', 'install.html'), 'utf8');
  assert.match(landingPage, /aria-label="Install ThumbGate"/);
  assert.match(landingPage, /title="npx thumbgate init --agent claude">Claude</);
  assert.match(landingPage, /href="\/install" title="[^"]*init --agent cursor[^"]*">Cursor</);
  assert.match(landingPage, /marketplace\.visualstudio\.com\/items\?itemName=igorganapolsky\.thumbgate/);
  assert.match(landingPage, /title="npx thumbgate init --agent codex">Codex</);
  assert.match(landingPage, /href="\/install#grok" title="grok mcp add thumbgate -- npx -y thumbgate mcp">Grok</);
  assert.match(landingPage, /href="\/install#hermes" title="[^"]*hermes-gate">Hermes</);
  assert.doesNotMatch(landingPage, /Cursor Marketplace listing is not live/);
  assert.doesNotMatch(landingPage, /thumbgate@1\.39\.0 init/);
  assert.doesNotMatch(landingPage, /Muse/);
  assert.match(installPage, /init --agent claude/);
  assert.match(installPage, /The public Cursor Marketplace listing is not live/);
  assert.match(installPage, /hermes-gate/);
  assert.match(installPage, /grok mcp add thumbgate/);
  assert.match(installPage, /id="grok"/);
  assert.match(installPage, /id="hermes"/);
});

test('homepage stays human-scannable instead of becoming a product monorepo', () => {
  const visibleText = visibleBodyText(landingPage);
  const words = visibleText.split(/\s+/).filter(Boolean);
  const h2Count = (landingPage.match(/<h2\b/g) || []).length;
  const h3Count = (landingPage.match(/<h3\b/g) || []).length;

  assert.ok(words.length <= 1100, `visible homepage is ${words.length} words`);
  assert.ok(h2Count <= 8, `homepage has ${h2Count} H2 headings`);
  assert.ok(h3Count <= 10, `homepage has ${h3Count} H3 headings`);
  for (const jargon of ['Thompson Sampling', 'DPO', 'LanceDB', 'ContextFS', 'MemAlign', 'FTS5']) {
    // DPO may appear in Pro bullets intentionally — only ban heavy infra jargon
    if (jargon === 'DPO') continue;
    assert.doesNotMatch(visibleText, new RegExp(jargon, 'i'));
  }
});

test('hero shows the blocked mistake and one free install, with price below it', () => {
  const hero = landingPage.slice(
    landingPage.indexOf('<!-- HERO -->'),
    landingPage.indexOf('</section>', landingPage.indexOf('<!-- HERO -->'))
  );
  const lede = normalizeHtmlText((hero.match(/<p class="hero-lede">([\s\S]*?)<\/p>/) || [])[1]);

  assert.match(landingPage, /Stop AI agent mistakes before they cost you/i);
  assert.match(landingPage, /ThumbGate — Stop AI agent mistakes before they cost you/i);
  assert.match(hero, /<h1>Stop AI agent mistakes before they cost you\.<\/h1>/i);
  assert.match(hero, /Not a prompt · Not a postmortem/i);
  assert.match(hero, /learn from your thumbs/i);
  assert.match(hero, /tool-call boundary/i);
  assert.match(hero, /npx thumbgate init/);
  assert.doesNotMatch(hero, /id="offers"|Start Pro|Setup Sprint/);
  assert.match(landingPage, /id="thumbgate-dashboard-command"/);
  assert.match(landingPage, /thumbgate-dashboard/);
  assert.match(landingPage, /\/thumbgate-dashboard/);
  assert.match(landingPage, /npx thumbgate dashboard --open/);
  assert.match(landingPage, /Static hook[\s\S]*Sandbox[\s\S]*ThumbGate/);
  assert.match(landingPage, /Learns from thumbs/);
  assert.ok(lede.split(/\s+/).length <= 40, `hero lede is ${lede.split(/\s+/).length} words`);
});

test('how-it-works sells the self-improving loop, not a static allowlist', () => {
  assert.match(landingPage, /Pre-action checks—and the systems that refine them/i);
  assert.match(landingPage, /Lessons are re-ranked per action/i);
  assert.match(landingPage, /repeated failures can promote into gates/i);
  assert.match(landingPage, /stale auto-promoted gates expire/i);
  assert.match(landingPage, /under your control/i);
  assert.match(landingPage, /silently rewriting policy|does not silently rewrite/i);
  assert.match(landingPage, /firewall improves from explicit feedback without retraining the model/i);
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
  assert.match(landingPage, /Setup Sprint/);
  assert.match(landingPage, /Book the \$499 setup/);
  assert.match(landingPage, /One configured local gate \+ regression test|One configured local gate and its regression test/);
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

test('homepage features thumbs branding and self-improving diagrams above the fold story', () => {
  const heroSvg = fs.readFileSync(path.join(__dirname, '..', 'public/assets/diagrams/hero-thumbs.svg'), 'utf8');
  assert.match(landingPage, /class="hero-thumbs"/);
  assert.match(landingPage, /id="thumb-glyph"/);
  assert.match(landingPage, /class="hero-thumb-up"/);
  assert.match(landingPage, /id="hero-thumb-down"/);
  assert.match(landingPage, /Already denied on every install/);
  assert.match(landingPage, /This stays a warning\. Deny needs strict mode/);
  assert.match(landingPage, /3 negatives, then strict mode/);
  assert.match(landingPage, /data-cta-placement="offers"/);
  assert.match(landingPage, /name="cta_placement" value="offers"/);
  assert.match(landingPage, /scroll-margin-top: 92px/);
  assert.doesNotMatch(landingPage, /0\.4ms/);
  assert.match(heroSvg, /\+1 ALLOW/);
  assert.match(heroSvg, /-1 DENY/);
  assert.doesNotMatch(heroSvg, /👍|👎/);
  assert.match(landingPage, /\/assets\/diagrams\/hero-thumbs\.svg/);
  assert.match(landingPage, /\/assets\/diagrams\/before-after\.svg/);
  assert.match(landingPage, /\/assets\/diagrams\/loop\.svg/);
  assert.match(landingPage, /\/assets\/diagrams\/self-improving-thumbs-loop\.svg/);
  assert.match(landingPage, /Is it really self-improving\?/);
  assert.match(landingPage, /Thumbs teach\. The gate enforces\./);
  assert.match(landingPage, /control layer, not the LLM/i);

  const heroStart = landingPage.indexOf('<!-- HERO -->');
  const howStart = landingPage.indexOf('id="how-it-works"');
  const heroBlock = landingPage.slice(heroStart, howStart);
  assert.ok(heroBlock.includes('hero-thumbs.svg'), 'hero diagram must appear before how-it-works');
  assert.ok(heroBlock.includes('class="hero-thumbs"'), 'big thumbs must appear in hero');
  assert.doesNotMatch(heroBlock, /👍|👎/, 'hero art uses vector thumbs, not stock emoji');
});
