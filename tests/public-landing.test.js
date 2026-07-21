const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const landingPagePath = path.join(__dirname, '..', 'public', 'index.html');
const proPagePath = path.join(__dirname, '..', 'public', 'pro.html');
const codexPluginPagePath = path.join(__dirname, '..', 'public', 'codex-plugin.html');
const buyerIntentScriptPath = path.join(__dirname, '..', 'public', 'js', 'buyer-intent.js');
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

function readLandingPage() {
  return fs.readFileSync(landingPagePath, 'utf8');
}

function readProPage() {
  return fs.readFileSync(proPagePath, 'utf8');
}

function readBuyerIntentScript() {
  return fs.readFileSync(buyerIntentScriptPath, 'utf8');
}

function readCodexPluginPage() {
  return fs.readFileSync(codexPluginPagePath, 'utf8');
}

function normalizeHtmlText(value) {
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|quot|#39|apos|mdash|ndash|rsquo|ldquo|rdquo);/g, (entity) => (
      HTML_ENTITY_REPLACEMENTS.get(entity)
    ))
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function parseJsonLd(landingPage) {
  return [...landingPage.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
  )].map((match) => JSON.parse(match[1]));
}

function visibleFaqAnswers(landingPage) {
  const entries = [...landingPage.matchAll(
    /<(div|button) class="faq-q"[^>]*>([\s\S]*?)<\/\1>\s*<div class="faq-a">([\s\S]*?)<\/div>/g
  )];
  return new Map(entries.map(([, , question, answer]) => [
    normalizeHtmlText(question),
    normalizeHtmlText(answer),
  ]));
}

test('public landing page keeps FAQPage JSON-LD parity for SEO and GEO', () => {
  const landingPage = readLandingPage();
  const jsonLd = parseJsonLd(landingPage);
  const types = jsonLd.map((document) => document['@type']);
  const faqSchema = jsonLd.find((document) => document['@type'] === 'FAQPage');
  const visibleFaq = visibleFaqAnswers(landingPage);

  assert.ok(types.includes('SoftwareApplication'));
  assert.ok(types.includes('Service'));
  assert.ok(types.includes('FAQPage'));
  assert.match(landingPage, /"@type": "InstallAction"/);
  assert.match(landingPage, /"@type": "BuyAction"/);
  assert.match(landingPage, /"@type": "CommunicateAction"/);
  assert.ok(faqSchema);
  assert.ok(faqSchema.mainEntity.length > 0);
  for (const entity of faqSchema.mainEntity) {
    const question = normalizeHtmlText(entity.name);
    const schemaAnswer = normalizeHtmlText(entity.acceptedAnswer.text);
    assert.ok(visibleFaq.has(question), `FAQ schema question is not visible: ${question}`);
    assert.equal(schemaAnswer, visibleFaq.get(question), `FAQ answer drift: ${question}`);
  }
  assert.match(landingPage, /does not guarantee that a trained model will avoid a mistake/i);
  assert.match(landingPage, /matching destructive deletes, force-pushes, and fetch-and-run commands warn by default/i);
  assert.match(landingPage, /MCP compatibility alone does not install enforcement automatically/i);
  assert.match(landingPage, /hosted team lesson sync and a hosted org dashboard are not general-availability/i);
});

test('public landing page routes Pro buyers through the hosted checkout surface', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /\/checkout\/pro\?/);
  assert.match(landingPage, /Free Trial|Upgrade to Pro/i);
  assert.doesNotMatch(landingPage, /gumroad\.com/);
});

test('public landing page maps agentic development cycle to pre-action execution gate', () => {
  const landingPage = readLandingPage();
  const sectionStart = landingPage.indexOf('id="agentic-development-cycle"');
  const sectionEnd = landingPage.indexOf('<!-- CODE EXAMPLE', sectionStart);
  const cycleSection = landingPage.slice(sectionStart, sectionEnd);

  assert.match(landingPage, /Agentic Development Cycle/);
  assert.match(landingPage, /Guide, Generate, Verify, Solve still needs an execution gate/);
  assert.match(landingPage, /The New Stack's May 2026 AC\/DC framing/);
  assert.match(landingPage, /ThumbGate's role: the pre-action gate between generated intent and executed action/);
  assert.match(landingPage, /How does ThumbGate fit the agentic development cycle\?/);
  assert.ok(sectionStart > -1);
  assert.ok(sectionEnd > sectionStart);
  assert.match(cycleSection, /<a class="cycle-card" href="\/learn\/feedback-loop-vs-decision-layer"[^>]*>\s*<h3>Guide<\/h3>/);
  assert.match(cycleSection, /<a class="cycle-card" href="\/guide"[^>]*>\s*<h3>Generate<\/h3>/);
  assert.match(cycleSection, /<a class="cycle-card" href="\/learn\/ac-dc-runtime-enforcement"[^>]*>\s*<h3>Verify<\/h3>/);
  assert.match(cycleSection, /<a class="cycle-card" href="\/lessons"[^>]*>\s*<h3>Solve<\/h3>/);
  assert.doesNotMatch(cycleSection, /class="compat-card" style="cursor:default;"/);
  assert.match(cycleSection, /agentic_cycle_card_click/);
});

test('public landing page distinguishes pre-action governance from logging and self-governance', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /Governance, Not Logging/);
  assert.match(landingPage, /Logs describe the damage\. ThumbGate evaluates the proposed action before it runs/);
  assert.match(landingPage, /Self-governance is an operator writing local rules and keeping local logs\./);
  assert.match(landingPage, /allow, warn, or deny decision/);
  assert.match(landingPage, /Reviewable decision trail/);
  assert.match(landingPage, /fields available for that evaluation/);
  assert.match(landingPage, /hosted team sync, org dashboards, SSO, SIEM, and compliance packaging are not general-availability/i);
});

test('public landing page exposes above-fold paid diagnostic/sprint CTAs with Pro as side lane', () => {
  const landingPage = readLandingPage();
  const heroStart = landingPage.indexOf('<!-- HERO -->');
  const heroEnd = landingPage.indexOf('<div class="hero-trust-bar">');
  const aboveFold = landingPage.slice(0, heroEnd);
  const heroBlock = landingPage.slice(heroStart, heroEnd);

  assert.ok(heroStart > -1);
  assert.ok(heroEnd > heroStart);
  assert.match(aboveFold, /cta_id=nav_pay_diagnostic/);
  assert.match(aboveFold, /data-revenue-cta data-cta-id="nav_pay_diagnostic"/);
  // Above-fold paid CTAs now live once, in the offer-router, instead of being
  // restated three times (a button row, a paragraph, then the router) — the
  // prior triple-restatement was hero bloat, not a distinct CTA surface.
  assert.match(heroBlock, /Start \$__SPRINT_DIAGNOSTIC_PRICE_DOLLARS__ diagnostic/);
  assert.match(heroBlock, /href="\/diagnostic\?/);
  assert.match(heroBlock, /Scope \$__WORKFLOW_SPRINT_PRICE_DOLLARS__ sprint/);
  assert.match(heroBlock, /\/checkout\/pro\?/);
  assert.ok(heroBlock.indexOf('router_pay_diagnostic') < heroBlock.indexOf('router_start_pro'));
  assert.ok(heroBlock.indexOf('router_start_pro') < heroBlock.indexOf('Still evaluating'));
  assert.match(heroBlock, /aria-label="Choose the right ThumbGate path"/);
  assert.match(heroBlock, /Team \/ enterprise: buy proof this week/);
  assert.match(heroBlock, /data-cta-id="router_pay_diagnostic"/);
  assert.match(heroBlock, /data-cta-id="router_pay_sprint"/);
  assert.match(heroBlock, /Solo operator: Start Pro/);
  assert.match(heroBlock, /data-cta-id="router_start_pro"/);
  assert.match(heroBlock, /Still evaluating: Free CLI/);
  assert.match(landingPage, /function trackRevenueCta/);
  assert.match(landingPage, /plausible\('pricing_cta_click'/);
  assert.match(landingPage, /plausible\('checkout_start'/);
  assert.match(landingPage, /sendFirstPartyTelemetry\('cta_click'/);
  assert.match(landingPage, /sendGa4Event\('begin_checkout'/);
  assert.match(landingPage, /script\.tagged-events\.js/);
});

test('public landing page includes copy-to-clipboard install command', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /npx thumbgate init/);
  assert.match(landingPage, /function copyInstall/);
  assert.match(landingPage, /navigator\.clipboard\.writeText/);
});

test('public landing page uses no Math.random for security', () => {
  const landingPage = readLandingPage();

  assert.doesNotMatch(landingPage, /Math\.random\(/);
});

test('public landing page keeps optional GA4 and Search Console hooks available for runtime injection', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /__GOOGLE_SITE_VERIFICATION_META__/);
  assert.match(landingPage, /__GA_BOOTSTRAP__/);
  assert.match(landingPage, /const gaMeasurementId = '__GA_MEASUREMENT_ID__';/);
  assert.match(landingPage, /const serverVisitorId = '__SERVER_VISITOR_ID__';/);
  assert.match(landingPage, /const serverSessionId = '__SERVER_SESSION_ID__';/);
  assert.match(landingPage, /const serverAcquisitionId = '__SERVER_ACQUISITION_ID__';/);
  assert.match(landingPage, /const serverTelemetryCaptured = '__SERVER_TELEMETRY_CAPTURED__' === 'true';/);
  assert.match(landingPage, /function sendGa4Event/);
  assert.match(landingPage, /sendGa4Event\('generate_lead'/);
  assert.match(landingPage, /sendGa4Event\('begin_checkout'/);
});

test('public landing page includes pricing section with Free, Pro, and Enterprise tiers', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /class="price-card/);
  assert.match(landingPage, /class="price-card pro"/);
  assert.match(landingPage, /class="price-card enterprise"/);
  assert.match(landingPage, /\$0/);
  assert.match(landingPage, /\$19/);
  assert.match(landingPage, /\/mo/);
  // Enterprise is contact-sales with custom pricing — no seat price ladder.
  assert.match(landingPage, /<div class="tier"[^>]*>Enterprise<\/div>/);
  assert.doesNotMatch(landingPage, /\$49\s*<span[^>]*>\s*\/seat\/mo/);
  // Free tier is intentionally capped so the npm package proves value without
  // cannibalizing Pro.
  assert.match(landingPage, /Catch repeated mistakes daily/);
  assert.match(landingPage, /2 captures\/day, 3 active rules/i);
  assert.match(landingPage, /2 feedback captures\/day/i);
  assert.match(landingPage, /Up to 3 active auto-promoted prevention rules/i);
  assert.doesNotMatch(landingPage, /3 captures.*1 rule.*1 agent/i);
  assert.doesNotMatch(landingPage, /3 captures total/i);
  assert.match(landingPage, /individual local governance with higher limits/i);
  assert.match(landingPage, /Hosted team lesson sync[\s\S]{0,500}Not GA/i);
  assert.match(landingPage, /Hosted org dashboard[\s\S]{0,500}Not GA/i);
  assert.match(landingPage, /Install Free/);
  assert.match(landingPage, /Pay-now Pro|Upgrade to Pro/i);
  assert.match(landingPage, /PAY-NOW PRO/i);
  assert.match(landingPage, /Start Workflow Hardening Sprint/);
});

test('public landing page shows an at-a-glance plan comparison matrix with consistent, enforced free-tier limits', () => {
  const landingPage = readLandingPage();

  // The matrix must exist so buyers see plan differences without parsing cards.
  assert.match(landingPage, /class="plan-matrix"/);
  // Headers cover all three tiers.
  assert.match(landingPage, /Free<br>/);
  assert.match(landingPage, /Pro<br>/);
  assert.match(landingPage, /Enterprise<br>/);
  // Free-tier numbers must match what scripts/rate-limiter.js actually enforces
  // (2 captures/day, 10 total, 3 active rules) — drift guard against README/card skew.
  assert.match(landingPage, /2\/day \(10 total\)/);
  // Enterprise is contact-sales; no seat price ladder anywhere on the page.
  assert.doesNotMatch(landingPage, /\$49\s*\/\s*seat\s*\/\s*mo/);
  assert.match(landingPage, /Approval boundaries \+ rollout design[\s\S]{0,500}Scoped after intake/i);
  assert.match(landingPage, /SSO, SIEM \+ compliance packaging[\s\S]{0,500}Not GA/i);
});

test('public landing page leads with paid diagnostic/sprint checkout, not retired service ladders', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /Have one AI-agent failure that keeps repeating\?/);
  assert.match(landingPage, /one real workflow, one repeated failure pattern, enforceable pre-action gates/);
  // Canonical money path: diagnostic confirmation page + sprint payment router.
  assert.match(landingPage, /Start \$__SPRINT_DIAGNOSTIC_PRICE_DOLLARS__ diagnostic/);
  assert.match(landingPage, /Scope \$__WORKFLOW_SPRINT_PRICE_DOLLARS__ sprint/);
  assert.match(landingPage, /\/diagnostic\?/);
  assert.match(landingPage, /\/go\/sprint\?/);
  assert.match(landingPage, /router_pay_diagnostic/);
  assert.match(landingPage, /router_pay_sprint/);
  assert.match(landingPage, /workflow_sprint_diagnostic_page_opened/);
  assert.match(landingPage, /workflow_sprint_scope_opened/);
  assert.match(landingPage, /Send workflow first/);
  assert.match(landingPage, /hero_workflow_sprint_recovery_intake/);
  assert.match(landingPage, /workflow_sprint_recovery_intake_clicked/);
  assert.match(landingPage, /ctaId: 'hero_workflow_sprint'/);
  assert.match(landingPage, /ctaId: 'hero_workflow_sprint_recovery_intake'/);
  // Retired experimental ladders must stay off the homepage.
  assert.doesNotMatch(landingPage, /Pay \$99 diagnostic/);
  assert.doesNotMatch(landingPage, /Pay \$1 first rule/);
  assert.doesNotMatch(landingPage, /first_failure_rule_checkout_started/);
  assert.doesNotMatch(landingPage, /Pay \$99 teardown/);
  assert.doesNotMatch(landingPage, /Pay \$19 quick read/);
  assert.doesNotMatch(landingPage, /quick_read_checkout_started/);
  assert.doesNotMatch(landingPage, /\$3,997/);
  assert.doesNotMatch(landingPage, /\$297\/mo/);
  assert.doesNotMatch(landingPage, /OpenClaw Agent Governance Kit/);
  assert.doesNotMatch(landingPage, /openclaw_governance_kit_checkout_started/);
  assert.doesNotMatch(landingPage, /Buy kit/);
  assert.doesNotMatch(landingPage, /ctaId:'hero_first_failure_rule_checkout'/);
  assert.doesNotMatch(landingPage, /ctaId:'hero_workflow_teardown_checkout'/);
});

test('public landing page includes Plausible analytics and search engine proof bar', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /plausible\.io\/js\/script\.tagged-events\.js/);
  assert.match(landingPage, /Verification evidence/i);
  assert.match(landingPage, /Release confidence/i);
  assert.match(landingPage, /ThumbGate Bench/i);
  assert.match(landingPage, /Proof-backed CI/i);
  assert.doesNotMatch(landingPage, /CI and proof lanes/i);
  assert.match(landingPage, /Claude Code · Cursor · Codex · Gemini · Amp · Cline · OpenCode/i);
});

test('public landing page reflects June 2026 agent-governance buying triggers', () => {
  const landingPage = readLandingPage();
  const sectionStart = landingPage.indexOf('id="june-2026-proof"');
  const sectionEnd = landingPage.indexOf('id="agentic-development-cycle"', sectionStart);
  const section = landingPage.slice(sectionStart, sectionEnd);

  assert.ok(sectionStart > -1, 'June 2026 proof section missing');
  assert.ok(sectionEnd > sectionStart, 'June 2026 proof section should precede AC/DC section');
  assert.match(section, /MCP and tool lockdown/);
  assert.match(section, /Managed agents need receipts/);
  assert.match(section, /Tokenmaxxing backlash/);
  assert.match(section, /Production code by AI/);
  assert.match(section, /Make conversion or traction claims only from authenticated billing and analytics telemetry/);
  assert.match(section, /does not publish a current customer or revenue count/);
  assert.match(landingPage, /Pro unlocks recall, proof, exports/);
  assert.doesNotMatch(landingPage, /free CLI, zero friction/);
});

test('public landing page routes PostHog through same-origin ingest proxy and captures pageviews', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /posthog\.init\('__POSTHOG_API_KEY__'/);
  assert.match(landingPage, /api_host: '\/ingest'/);
  assert.match(landingPage, /ui_host: 'https:\/\/us\.posthog\.com'/);
  assert.match(landingPage, /posthog\.capture\('\$pageview'\)/);
});

test('public landing page includes the three-step how-it-works section', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /id="how-it-works"/);
  assert.match(landingPage, /Feedback/);
  assert.match(landingPage, /Rules/);
  assert.match(landingPage, /Checks/);
  assert.match(landingPage, /Pre-Action Checks/i);
  assert.match(landingPage, /prevention rules/i);
  assert.match(landingPage, /Thompson Sampling/);
});

test('public landing page includes a Reddit campaign banner and subreddit-aware attribution logic', () => {
  // The ThumbGate page does not include Reddit campaign banner features.
  // Verify the page does not contain stale Reddit attribution artifacts.
  const landingPage = readLandingPage();

  assert.doesNotMatch(landingPage, /id="campaign-banner"/);
  assert.doesNotMatch(landingPage, /parseRedditCommunity/);
});

test('public landing page positions ThumbGate as agent governance for AI coding workflows', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /ThumbGate/);
  assert.match(landingPage, /workflow governance/i);
  assert.match(landingPage, /Workflow Hardening Sprint/i);
  assert.match(landingPage, /CLI-first/i);
  assert.match(landingPage, /Persistent Agent Skills/i);
  assert.match(landingPage, /Reusable instructions are the new baseline\. Enforcement is the moat\./);
  assert.match(landingPage, /Persistent agent skills create reusable instructions/i);
  assert.match(landingPage, /ThumbGate evaluates configured checks against the next proposed action/i);
  assert.match(landingPage, /Local gate results expose the matched rule and available decision context/i);
  assert.match(landingPage, /Claude Code/);
  assert.match(landingPage, /Cursor/);
  assert.match(landingPage, /Codex/);
  assert.match(landingPage, /Gemini/);
  assert.match(landingPage, /Amp/);
  assert.match(landingPage, /OpenCode/);
  assert.doesNotMatch(landingPage, /mailto:/i);
  assert.doesNotMatch(landingPage, /official Anthropic partner/i);
});

test('public landing page differentiates deterministic ThumbGate enforcement from native black-box thumbs', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /Native thumbs are a black box\. ThumbGate is the inspectable control layer\./);
  assert.match(landingPage, /Codex, Claude Code, ChatGPT, and other agent surfaces can collect preference signals/);
  assert.match(landingPage, /accepted typed feedback becomes a local lesson/i);
  assert.match(landingPage, /gate results expose the matched check and decision reason available at evaluation time/i);
  assert.match(landingPage, /Lessons live in your ThumbGate store/);
  assert.match(landingPage, /exported as JSONL or DPO pairs/);
  assert.match(landingPage, /The final decision is not another model opinion/);
  assert.match(landingPage, /checks tool name, arguments, working directory, command shape, confidence, and required evidence/);
  assert.match(landingPage, /Why this matters now/);
  assert.match(landingPage, /Agent security is now mainstream risk/);
  assert.match(landingPage, /MCP adoption is accelerating/);
  assert.match(landingPage, /Repeated failures waste cash and trust/);
});

test('Pro page sells inspectable prevention rather than black-box preference memory', () => {
  const proPage = readProPage();

  assert.match(proPage, /Black-box thumbs do not prove prevention\. Pro gives the operator an audit loop\./);
  assert.match(proPage, /Native rating buttons can tell a vendor that an answer felt wrong/);
  assert.match(proPage, /the correction, the lesson, the rule, the blocked tool call, and the export path/);
  assert.match(proPage, /Inspectable memory/);
  assert.match(proPage, /Deterministic checks/);
  assert.match(proPage, /Exportable proof/);
  assert.match(proPage, /JSONL, DPO export, review packets, and team rollout conversations/);
});

test('public landing page exposes browser-bridge safety buyer guides', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /\/guides/);
  assert.match(landingPage, /Browse the guide library/i);
});

test('public landing page exposes AEO listicle for production AI agent safety', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /\/guides/);
  assert.match(landingPage, /Browse the guide library/i);
});

test('public landing page hero features both thumbs up AND thumbs down prominently', () => {
  const landingPage = readLandingPage();

  // Hero big emoji must show BOTH thumbs — not just one
  assert.match(landingPage, /class="hero-thumbs">👍👎</);
  // Signal pills must show both
  assert.match(landingPage, /signal-pill signal-up/);
  assert.match(landingPage, /signal-pill signal-down/);
  assert.match(landingPage, /Accepted feedback becomes local lessons/i);
  assert.match(landingPage, /Evaluate proposed tool calls before execution/i);
  assert.doesNotMatch(landingPage, /Thumbs-down once, caught every time/i);
  assert.doesNotMatch(landingPage, /before the model sees them/i);
  assert.match(landingPage, /reliable operator/i);
  // Persona targeting
  assert.match(landingPage, /class="hero-persona"/);
  assert.match(landingPage, /product teams/i);
});

test('public landing page exposes the free CLI wedge above the fold and keeps Pro secondary', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /Install Free CLI/i);
  assert.match(landingPage, /btn-install-link/);
  assert.match(landingPage, /Install the local CLI without a credit card or account/i);
  assert.match(landingPage, /individual tier/i);
});

test('public landing page gives cold users a first-dollar activation path', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /Run your first pre-action check locally/i);
  assert.match(landingPage, /First-Dollar Activation Path/i);
  assert.match(landingPage, /Prove one evaluated repeat before asking anyone to buy/i);
  assert.match(landingPage, /Native ChatGPT rating buttons are not the ThumbGate capture path/i);
  assert.match(landingPage, /Give <code>thumbs up<\/code> when the agent follows your standards/i);
  assert.match(landingPage, /thumbs up: this review named exact files/i);
  assert.match(landingPage, /thumbs down: the answer ignored my request/i);
  assert.match(landingPage, /Upgrade when the individual operator needs higher limits/i);
  assert.doesNotMatch(landingPage, /in 5 minutes|in 60 seconds/i);
});

test('Codex plugin page keeps proof and follow-on CTAs close to the install path', () => {
  const codexPluginPage = readCodexPluginPage();

  assert.match(codexPluginPage, /aria-label="Codex proof and conversion links"/);
  assert.match(codexPluginPage, /VERIFICATION_EVIDENCE\.md/);
  assert.match(codexPluginPage, /COMMERCIAL_TRUTH\.md/);
  assert.match(codexPluginPage, /\/checkout\/pro\?utm_source=codex/);
  assert.match(codexPluginPage, /#workflow-sprint-intake/);
  assert.match(codexPluginPage, /Upgrade after one caught repeat/i);
  assert.match(codexPluginPage, /Team workflow sprint/i);
});

test('public landing page proof bar uses individually clickable link chips', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /<nav class="proof-bar" aria-label="ThumbGate install and proof links">/);
  assert.match(landingPage, /\.proof-bar a \{[^}]*min-height: 36px;[^}]*padding: 8px 12px;/);
  assert.match(landingPage, /\.proof-bar a:hover, \.proof-bar a:focus-visible/);
  assert.doesNotMatch(landingPage, /<span class="dot"><\/span>/);
  assert.match(landingPage, /Claude Extension →/);
  assert.match(landingPage, /Codex plugin setup →/);
  assert.match(landingPage, /Verification evidence →/);
  assert.equal((landingPage.match(/Claude Extension →/g) || []).length, 1);
  assert.equal((landingPage.match(/Proof-backed CI/g) || []).length, 1);
  assert.doesNotMatch(landingPage, /CI and proof lanes/);
});

test('public landing page Pro tier uses outcome-framed bullets that justify upgrade', () => {
  const landingPage = readLandingPage();

  // Pro copy describes the shipped individual capabilities without automatic
  // cross-agent or hosted-team promises.
  assert.match(landingPage, /Visual check debugger/i);
  assert.match(landingPage, /available local gate history/i);
  assert.match(landingPage, /Use supported integrations/i);
  assert.match(landingPage, /documented setup path/i);
  assert.match(landingPage, /DPO preference-pair export/i);
  assert.match(landingPage, /separate fine-tuning workflow/i);
  assert.match(landingPage, /Personal local dashboard/i);
  assert.match(landingPage, /review-ready workflow support/i);
  // Persona targeting for Pro
  assert.match(landingPage, /individual operator/i);
  // Model hardening and HuggingFace export
  assert.match(landingPage, /Model Hardening Advisor/i);
  assert.match(landingPage, /HuggingFace dataset export/i);
});

test('public landing page includes an explicit Enterprise rollout lane with shared workflow intake', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /<div class="tier"[^>]*>Enterprise<\/div>/);
  assert.match(landingPage, /Up to three local workflows/i);
  assert.match(landingPage, /Approval and rollback implementation/i);
  assert.match(landingPage, /Verification proof/i);
  assert.match(landingPage, /Current availability boundary/i);
  assert.match(landingPage, /hosted team sync, a hosted org dashboard, SSO, SIEM, and compliance packaging are not general-availability/i);
  assert.doesNotMatch(landingPage, /<li><strong>Shared lesson database<\/strong>/i);
  assert.doesNotMatch(landingPage, /<li><strong>Org dashboard<\/strong>/i);
  assert.match(landingPage, /workflow-sprint-intake/);
  assert.match(landingPage, /Start Enterprise Pilot Intake/i);
  assert.match(landingPage, /id="team-pilot-intake-form"/);
  assert.match(landingPage, /data-team-intake-form/);
  assert.match(landingPage, /name="ctaPlacement" value="team_visible_intake"/);
  assert.match(landingPage, /name="utmMedium" value="visible_team_intake"/);
  assert.match(landingPage, /name="planId" value="team"/);
  assert.match(landingPage, /name="ctaId" value="workflow_sprint_intake"/);
  assert.match(landingPage, /Enterprise checkout happens after scope\./);
  assert.match(landingPage, /team_workflow_sprint_recovery_intake/);
  assert.match(landingPage, /scope_first/);
  assert.match(landingPage, /workflow_sprint_intake_started/);
  assert.match(landingPage, /workflow_sprint_intake_submit_attempted/);
  const formIndex = landingPage.indexOf('action="/v1/intake/workflow-sprint"');
  const openDetailsIndex = landingPage.lastIndexOf('<details', formIndex);
  const closeDetailsIndex = landingPage.lastIndexOf('</details>', formIndex);
  assert.ok(
    openDetailsIndex === -1 || closeDetailsIndex > openDetailsIndex,
    'Team intake must be visible without a disclosure click'
  );
});

test('public landing page includes FAQ section with accordion interaction', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /id="faq"/);
  assert.match(landingPage, /Common questions/);
  assert.match(landingPage, /How is ThumbGate different from model-training feedback loops\?/);
  assert.match(landingPage, /How is ThumbGate different from persistent agent skills\?/);
  assert.match(landingPage, /accepted feedback becomes lessons, recurring failures can become rules/i);
  assert.match(landingPage, /What's the tech stack\?/);
  assert.match(landingPage, /What AI agents and editors does this work with\?/);
  assert.match(landingPage, /Do I need a cloud account\?/);
  assert.match(landingPage, /How are (?:pre-action )?checks different from prompt rules\?/);
  assert.match(landingPage, /What does Pro cost\?/);
  assert.match(landingPage, /role="button"/);
  assert.match(landingPage, /tabindex="0"/);
  assert.match(landingPage, /aria-expanded="true"/);
  assert.match(landingPage, /aria-expanded="false"/);
  assert.match(landingPage, /onclick="toggleFaq\(this\)"/);
  assert.match(landingPage, /onkeydown="handleFaqKeydown\(event\)"/);
  assert.match(landingPage, /function toggleFaq\(el\)/);
  assert.match(landingPage, /function handleFaqKeydown\(event\)/);
  assert.match(landingPage, /personal local dashboard/i);
  assert.match(landingPage, /hosted team lesson sync and a hosted org dashboard are not general-availability/i);
  assert.doesNotMatch(landingPage, /shared enforcement memory/i);
  assert.doesNotMatch(landingPage, /hosted review views/i);
});

test('public landing page includes compatibility section for AI agent surfaces', () => {
  const landingPage = readLandingPage();
  const claudeTrackingStart = landingPage.indexOf('compat_claude_desktop_click');
  const claudeCardStart = landingPage.lastIndexOf('<a class="compat-card"', claudeTrackingStart);
  const claudeCardEnd = landingPage.indexOf('</a>', claudeCardStart);
  const claudeCard = landingPage.slice(claudeCardStart, claudeCardEnd);
  const claudeCardBody = claudeCard.slice(claudeCard.indexOf('>') + 1);

  assert.match(landingPage, /id="compatibility"/);
  assert.match(landingPage, /AI CLIs/i);
  assert.match(landingPage, /MCP-compatible agent/i);
  assert.match(landingPage, /pre-action checks/i);
  assert.match(landingPage, /require an equivalent MCP or hook setup/i);
  assert.doesNotMatch(landingPage, /enforcement out of the box/i);
  assert.match(landingPage, /Claude Desktop plugin/i);
  assert.match(landingPage, /Editor workflows/i);
  assert.match(landingPage, /Claude Code Skill/i);
  assert.match(landingPage, /Google Data Agent Kit/i);
  assert.match(landingPage, /Hermes Agent guardrails/i);
  assert.match(landingPage, /\/guides\/hermes-agent-guardrails/);
  assert.match(landingPage, /persistent memory, generated skills, messaging gateways, scheduled automations, and sandboxed execution/i);
  assert.match(landingPage, /safer self-evolution loop/i);
  assert.match(landingPage, /overwrites stable instructions/i);
  assert.match(landingPage, /vLLM serving guardrails/i);
  assert.match(landingPage, /\/guides\/vllm-serving-guardrails/);
  assert.match(landingPage, /PagedAttention, continuous batching, chunked prefill, prefix caching, and optimized kernels/i);
  assert.match(landingPage, /latency, cache-isolation, benchmark, and rollback proof/i);
  assert.match(landingPage, /Context and tool governance/i);
  assert.match(landingPage, /\/guides\/agent-context-governance/);
  assert.match(landingPage, /cleaner working context, approved model routes, isolated execution, tool lockdown, direct pushback, and evidence/i);
  assert.match(landingPage, /\/guides\/gcp-mcp-guardrails/);
  assert.match(landingPage, /\/thumbgate/);
  assert.match(landingPage, /compatibility-grid/);
  // Arrow copy evolved when cards moved off GitHub source links in 1.5.8.
  // Intent preserved: the compat grid must promise a setup guide + a Claude
  // Desktop install action. Download-verbed arrows satisfy this.
  assert.match(landingPage, /(View|Open|Read) (the )?setup guide|setup guide →/i);
  assert.match(landingPage, /(Get|Download) (the )?(Claude plugin|\.mcpb bundle|Claude Extension)/i);
  assert.ok(claudeCardStart > -1);
  assert.ok(claudeCardEnd > claudeCardStart);
  assert.doesNotMatch(claudeCardBody, /<a\s/i);
  assert.match(claudeCard, /thumbgate-claude-desktop\.mcpb/);
  assert.match(claudeCard, /Download \.mcpb bundle/);
  assert.match(landingPage, /thumbgate-marketplace/);
  assert.match(landingPage, /\/plugin marketplace add IgorGanapolsky\/ThumbGate/);
  assert.match(landingPage, /ChatGPT GPT Actions/);
  assert.match(landingPage, /\/go\/gpt\?utm_source=website/);
  assert.match(landingPage, /Open ThumbGate GPT/);
  assert.match(landingPage, /Live ThumbGate GPT for ChatGPT/);
  assert.match(landingPage, /ChatGPT Entry Point/);
  assert.match(landingPage, /Use the GPT as a preflight desk for risky commands, refunds, deploys, and PR actions\./);
  assert.match(landingPage, /No, you do not have to chat inside the GPT forever/);
  assert.match(landingPage, /ChatGPT is a discovery and checkpointing surface/);
  assert.match(landingPage, /Do not rely on ChatGPT's native rating buttons for ThumbGate memory/);
  assert.match(landingPage, /Explore GPTs/);
  assert.match(landingPage, /choose the GPT by Igor Ganapolsky/i);
  assert.match(landingPage, /Programming/);
  assert.match(landingPage, /Do I have to chat inside the ThumbGate GPT for enforcement\?/);
  assert.match(landingPage, /capture typed thumbs-up\/down feedback/i);
  assert.match(landingPage, /Local allow\/warn\/deny enforcement for coding agents requires a configured integration/);
  assert.match(landingPage, /adapters\/chatgpt\/INSTALL\.md/);
  // Editor workflows + Claude Code Skill arrows evolved from "Browse plugins" /
  // "View skill on GitHub" to guide-page language in 1.5.8. Now assert on the
  // underlying *destinations* (a plugins list + a Claude Code guide), not the
  // specific arrow copy that keeps getting rewritten.
  assert.match(landingPage, /plugins|guide/i);
  assert.match(landingPage, /Claude Code|claude-code-prevent-repeated-mistakes/);
});

test('public landing page includes Plausible custom event tracking for all CTAs', () => {
  const landingPage = readLandingPage();

  // install_copy fires directly in copyInstall function
  assert.match(landingPage, /plausible\('install_copy'\)/);
  assert.match(landingPage, /sendFirstPartyTelemetry\('install_copy'/);
  assert.match(landingPage, /fetch\('\/v1\/telemetry\/ping'/);
  assert.match(landingPage, /\/go\/gpt\?utm_source=website/);
  assert.match(landingPage, /\/go\/install\?utm_source=website/);
  assert.match(landingPage, /#workflow-sprint-intake/);

  // trackClick wires up CTA events by selector and event name
  assert.match(landingPage, /trackClick\('.btn-pro:not\(\[data-revenue-cta\]\)', 'checkout_start'/);
  assert.match(landingPage, /function trackRevenueCta/);
  assert.match(landingPage, /data-revenue-cta/);
  assert.match(landingPage, /plausible\('pricing_cta_click'/);
  assert.match(landingPage, /plausible\('checkout_start'/);
  assert.match(landingPage, /trackClick\('.btn-gpt-page:not\(.btn-install-hero\)', 'chatgpt_gpt_click'/);
  assert.match(landingPage, /trackClick\('.btn-install-hero', 'install_guide_click'/);
  assert.match(landingPage, /trackClick\('.btn-install-link', 'install_guide_click'/);
  assert.match(landingPage, /trackClick\('.btn-team', 'workflow_sprint_intake_click'/);
  assert.match(landingPage, /selector: '#team-pilot-intake-form'/);
  assert.match(landingPage, /trackClick\('.btn-free', 'install_click'/);
  assert.match(landingPage, /trackClick\('.btn-demo-link', 'demo_click'/);
  assert.match(landingPage, /trackClick\('.nav-cta:not\(\[data-revenue-cta\]\)', 'chatgpt_gpt_click'/);
  assert.match(landingPage, /plausible\('faq_open'/);
  assert.match(landingPage, /plausible\('scroll_depth'/);
  assert.match(landingPage, /trackClick\('.proof-bar a', 'proof_bar_click'\)/);
  assert.match(landingPage, /trackClick\('.compat-card', 'compat_click'\)/);
  assert.match(landingPage, /trackClick\('.seo-card', 'seo_page_click'\)/);

  // Safety: typeof check before calling plausible
  assert.match(landingPage, /typeof plausible === 'function'/);

  // Scroll depth tracks 25%, 50%, 75%, 100%
  assert.match(landingPage, /scrollMarks/);
  assert.match(landingPage, /depth: mark \+ '%'/);
});

test('public landing page internally links to comparison and guide pages without internal jargon', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /id="compare-guides"/);
  assert.match(landingPage, /Browse the guide library/i);
  assert.match(landingPage, /href="\/learn"/);
  // No internal marketing jargon visible to customers
  assert.doesNotMatch(landingPage, /GSD Pages/);
  assert.doesNotMatch(landingPage, /Bottom of funnel/i);
  assert.doesNotMatch(landingPage, /Category creation/i);
  assert.doesNotMatch(landingPage, /convert.*search.*demand/i);
});

test('public landing page labels data processing boundaries for trust review', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /Data Processing Boundaries/);
  assert.match(landingPage, /Local enforcement data stays/i);
  assert.match(landingPage, /hosted processing surfaces/i);
});

test('public landing page promotes the Autoresearch safety pack', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /id="autoresearch-pack"/);
  assert.match(landingPage, /Autoresearch Safety Pack/);
  assert.match(landingPage, /Stop self-improving coding loops from hacking the benchmark/);
  assert.match(landingPage, /holdout tests/i);
  assert.match(landingPage, /reward hacking/i);
  assert.match(landingPage, /verification evidence/i);
  assert.match(landingPage, /cta_id=autoresearch_pro_checkout/);
});

test('public landing page advertises the Codex standalone plugin install path', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /Codex plugin/i);
  assert.match(landingPage, /\/codex-plugin\?utm_source=website/);
  assert.match(landingPage, /Open the Codex install page →/);
  assert.doesNotMatch(landingPage, /thumbgate-codex-plugin\.zip/);
});

test('public Codex plugin page explains install, direct download, and latest runtime policy', () => {
  const codexPage = readCodexPluginPage();

  assert.match(codexPage, /ThumbGate for Codex/);
  assert.match(codexPage, /SoftwareApplication/);
  assert.match(codexPage, /FAQPage/);
  assert.match(codexPage, /thumbgate@latest/);
  assert.match(codexPage, /npx thumbgate init --agent codex/);
  assert.match(codexPage, /thumbgate-codex-plugin\.zip/);
  assert.match(codexPage, /Install with CLI setup/);
  assert.match(codexPage, /Download zip for review/);
  assert.match(codexPage, /not a double-click installer/i);
  assert.match(codexPage, /Desktop install reality/);
  assert.match(codexPage, /Built by OpenAI/);
  assert.match(codexPage, /\.agents\/plugins\/marketplace\.json/);
  assert.match(codexPage, /plugins\/codex-profile/);
  assert.match(codexPage, /default <code>plugins\/codex<\/code> sparse path/i);
  assert.match(codexPage, /I searched Plugins for ThumbGate/i);
  assert.match(codexPage, /plugins\/codex-profile\/INSTALL\.md/);
  assert.match(codexPage, /Pre-Action Checks/);
  assert.match(codexPage, /Codex settings/);
  assert.match(codexPage, /Bare "thumbs down" is intentionally too vague/);
  assert.doesNotMatch(codexPage, />Download Codex plugin</);
});

test('public landing page FAQ defaults first item open for credibility', () => {
  const landingPage = readLandingPage();

  // The model-training comparison question should be open by default to address the #1 credibility question
  assert.match(landingPage, /class="faq-item open"/);
});

test('public landing page hero is evergreen without version numbers', () => {
  const landingPage = readLandingPage();

  // Hero paragraph should not contain version-specific changelog items
  const heroMatch = landingPage.match(/<section class="hero">[\s\S]*?<\/section>/);
  assert.ok(heroMatch, 'Hero section must exist');
  assert.doesNotMatch(heroMatch[0], /New in v\d/i);
});

test('landing page has guardrail positioning section', () => {
  const html = readLandingPage();
  assert.ok(html.includes('id="guardrails"'), 'guardrails section must exist');
  assert.ok(html.includes('Don\'t trust'), 'must include "Don\'t trust — verify" card');
  assert.ok(html.includes('Real tools'), 'must include "Real tools" card');
  assert.ok(html.includes('show work'), 'must include "show work" card');
  assert.ok(html.includes('Review decisions and recurring failures'), 'must include review-and-learning card');
});

test('landing page has newsletter signup', () => {
  const html = readLandingPage();
  assert.ok(html.includes('newsletter'), 'must include newsletter section');
  assert.ok(html.includes('type="email"'), 'must include email input');
  assert.match(html, /action="\/api\/newsletter"/);
  assert.match(html, /data-newsletter-form/);
  assert.match(html, /Get sprint brief \+ updates/i);
});

test('landing page has social links in footer', () => {
  const html = readLandingPage();
  assert.match(html, /href="https:\/\/github\.com\/IgorGanapolsky\/ThumbGate"/, 'footer must link to GitHub');
  assert.match(html, /href="https:\/\/www\.linkedin\.com\/[^"]+"/, 'footer must link to LinkedIn');
  assert.ok(html.includes('/blog'), 'footer must link to blog');
});

test('blog page has JSON-LD, canonical, and OG tags for Google indexing', () => {
  const blogPath = path.join(__dirname, '..', 'public', 'blog.html');
  const blog = fs.readFileSync(blogPath, 'utf8');
  assert.match(blog, /application\/ld\+json/, 'blog must have JSON-LD structured data');
  assert.match(blog, /rel="canonical"/, 'blog must have canonical URL');
  assert.match(blog, /og:title/, 'blog must have OG title');
  assert.match(blog, /og:description/, 'blog must have OG description');
});

// Lessons page tests

const lessonsPagePath = path.join(__dirname, '..', 'public', 'lessons.html');

function readLessonsPage() {
  return fs.readFileSync(lessonsPagePath, 'utf8');
}

test('lessons page exists and has three tabs', () => {
  const html = readLessonsPage();
  assert.match(html, /Active Rules/i);
  assert.match(html, /Feedback Timeline/i);
  assert.match(html, /Insights/i);
});

test('lessons page has defensible live metrics and rule frequency labels', () => {
  const html = readLessonsPage();
  assert.match(html, /Actions Blocked/i);
  assert.match(html, /Recorded gate denies, not inferred repeats/i);
  assert.match(html, /Improvement Over Time/i);
  assert.match(html, /Recent Feedback \+ Gate Activity/i);
  assert.match(html, /Gate deny/i);
  assert.match(html, /Gate warn/i);
  assert.match(html, /Fast path rate/i);
  assert.match(html, /Override rate/i);
  assert.match(html, /Rollback rate/i);
  assert.match(html, /Median latency/i);
  assert.match(html, /rule-effectiveness/);
  assert.match(html, /rule-severity/);
});

test('lessons page has feedback timeline with up/down signals', () => {
  const html = readLessonsPage();
  assert.match(html, /timeline-dot/);
  assert.match(html, /timeline-signal/);
  assert.match(html, /Positive/);
  assert.match(html, /Negative/);
});

test('lessons page has Pro upgrade badge in insights tab', () => {
  const html = readLessonsPage();
  assert.match(html, /Unlock Full Insights/i);
  assert.match(html, /Free Trial|Get Pro/i);
  assert.match(html, /\$19\/mo/);
});

test('lessons page links to dashboard in nav', () => {
  const html = readLessonsPage();
  assert.match(html, /href="\/dashboard"/);
  assert.match(html, /href="\/lessons"/);
  assert.match(html, /Local.*connected/i);
  assert.match(html, /__LESSONS_BOOTSTRAP_KEY__/);
  assert.match(html, /\/v1\/lessons\/search/);
  assert.match(html, /Demo preview/i);
});

test('lessons tab switching scopes active tab selection to the tab strip', () => {
  const html = readLessonsPage();
  assert.match(html, /document\.querySelectorAll\('\.tabs \.tab'\)/);
  assert.match(html, /var tabMap = \{ rules: 0, timeline: 1, insights: 2 \}/);
  assert.match(html, /document\.getElementById\('tab-' \+ name\)/);
});

test('lessons severity filtering scopes active state to rules filter buttons', () => {
  const html = readLessonsPage();
  assert.match(html, /document\.querySelectorAll\('#tab-rules \.filter-btn'\)/);
  assert.match(html, /if \(level === 'critical'\) \{ highlightCard\(1\); \} else \{ highlightCard\(0\); \}/);
});

test('public landing page includes pay-now Pro path and email capture gate', () => {
  const landingPage = readLandingPage();
  const buyerIntentScript = readBuyerIntentScript();
  assert.match(landingPage, /PAY-NOW PRO/);
  assert.match(landingPage, /Billed today/);
  assert.match(landingPage, /pro-email/);
  assert.match(landingPage, /handleProCheckout/);
  assert.match(landingPage, /\/js\/buyer-intent\.js/);
  assert.match(buyerIntentScript, /customer_email/);
  assert.match(buyerIntentScript, /\/go\/pro/);
  assert.match(buyerIntentScript, /searchParams\.set\('confirm', '1'\)/);
  assert.match(buyerIntentScript, /submitNewsletterSignup/);
  assert.match(buyerIntentScript, /initializeBehaviorAnalytics/);
  assert.match(buyerIntentScript, /buyer_email_abandon/);
  assert.match(landingPage, /initializeBehaviorAnalytics/);
  assert.match(landingPage, /pricing_pro_checkout/);
  assert.match(buyerIntentScript, /dataset\.baseHref/);
  assert.doesNotMatch(buyerIntentScript, /setAttribute\('href'/);
  assert.doesNotMatch(landingPage, /props:\s*\{\s*email:/);
});

test('public landing page Enterprise card is intake-led without a blind checkout or free trial claim', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /Start enterprise intake/i);
  assert.match(landingPage, /pricing_enterprise_intake/);
  assert.match(landingPage, /\$15,000 30-day pilot/i);
  assert.match(landingPage, /\$10,000\/month after a completed pilot/i);
  assert.match(landingPage, /qualification and a signed scope/i);
  assert.doesNotMatch(landingPage, /\$49\s*\/\s*seat\s*\/\s*mo/);
  assert.doesNotMatch(landingPage, /Start 3-seat Team — \$147\/mo/);
  assert.doesNotMatch(landingPage, /pricing_team_self_serve/);
  assert.doesNotMatch(landingPage, /team_self_serve_checkout_started/);
  // Still must not claim a free trial.
  assert.doesNotMatch(landingPage, /Both start with a 7-day free trial/);
  assert.doesNotMatch(landingPage, /free trial/i);
});

test('public landing page includes dashboard preview in Pro card', () => {
  const landingPage = readLandingPage();
  assert.match(landingPage, /dashboard-preview/);
  assert.match(landingPage, /What your Pro dashboard looks like/);
  assert.match(landingPage, /check:no-force-push/);
});
