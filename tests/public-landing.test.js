const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const landingPagePath = path.join(__dirname, '..', 'public', 'index.html');
const buyerIntentScriptPath = path.join(__dirname, '..', 'public', 'js', 'buyer-intent.js');

function readLandingPage() {
  return fs.readFileSync(landingPagePath, 'utf8');
}

function readBuyerIntentScript() {
  return fs.readFileSync(buyerIntentScriptPath, 'utf8');
}

test('public landing page keeps FAQPage JSON-LD parity for SEO and GEO', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /"@type": "SoftwareApplication"/);
  assert.match(landingPage, /"@type": "FAQPage"/);
  assert.match(landingPage, /How is ThumbGate different from model-training feedback loops\?/);
  assert.match(landingPage, /What is the ThumbGate tech stack\?/);
  assert.match(landingPage, /What AI agents does ThumbGate work with\?/);
  assert.match(landingPage, /How are pre-action gates different from prompt rules\?/);
  assert.match(landingPage, /behavioral immune system/i);
  assert.match(landingPage, /PreToolUse hook enforcement/i);
  assert.match(landingPage, /Thompson Sampling/i);
});

test('public landing page routes Pro buyers through the hosted checkout surface', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /\/checkout\/pro\?/);
  assert.match(landingPage, /Free Trial/);
  assert.doesNotMatch(landingPage, /gumroad\.com/);
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
});

test('public landing page includes pricing section with Free, Pro, and Team tiers', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /class="price-card"/);
  assert.match(landingPage, /class="price-card pro"/);
  assert.match(landingPage, /class="price-card team"/);
  assert.match(landingPage, /\$0/);
  assert.match(landingPage, /\$19/);
  assert.match(landingPage, /\/mo/);
  assert.match(landingPage, /\$12/);
  assert.match(landingPage, /\/seat\/mo/);
  assert.match(landingPage, /Forever free/);
  assert.match(landingPage, /CLI-first local enforcement for one developer/i);
  assert.match(landingPage, /solo side lane/i);
  assert.match(landingPage, /Shared enforcement/i);
  assert.match(landingPage, /Install Free/);
  assert.match(landingPage, /Free Trial/);
  assert.match(landingPage, /Start Workflow Hardening Sprint/);
});

test('public landing page includes Plausible analytics and search engine proof bar', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /plausible\.io\/js\/script\.js/);
  assert.match(landingPage, /Verification evidence/i);
  assert.match(landingPage, /Release confidence/i);
  assert.match(landingPage, /CI and proof lanes/i);
  assert.match(landingPage, /Claude Code · Cursor · Codex · Gemini · Amp · OpenCode/i);
});

test('public landing page includes the three-step how-it-works section', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /id="how-it-works"/);
  assert.match(landingPage, /Feedback/);
  assert.match(landingPage, /Rules/);
  assert.match(landingPage, /Gates/);
  assert.match(landingPage, /Pre-Action Gates/i);
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
  assert.match(landingPage, /Claude Code/);
  assert.match(landingPage, /Cursor/);
  assert.match(landingPage, /Codex/);
  assert.match(landingPage, /Gemini/);
  assert.match(landingPage, /Amp/);
  assert.match(landingPage, /OpenCode/);
  assert.doesNotMatch(landingPage, /mailto:/i);
  assert.doesNotMatch(landingPage, /official Anthropic partner/i);
});

test('public landing page hero features both thumbs up AND thumbs down prominently', () => {
  const landingPage = readLandingPage();

  // Hero big emoji must show BOTH thumbs — not just one
  assert.match(landingPage, /class="hero-thumbs">👍👎</);
  // Signal pills must show both
  assert.match(landingPage, /signal-pill signal-up/);
  assert.match(landingPage, /signal-pill signal-down/);
  assert.match(landingPage, /Repeated failure becomes enforcement before the next run/i);
  assert.match(landingPage, /Safe pattern reinforced across the shared workflow/i);
  // Persona targeting
  assert.match(landingPage, /class="hero-persona"/);
  assert.match(landingPage, /product teams/i);
});

test('public landing page exposes the free CLI wedge above the fold and keeps Pro secondary', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /Install Free CLI/i);
  assert.match(landingPage, /btn-install-link/);
  assert.match(landingPage, /team-first/i);
  assert.match(landingPage, /solo side lane/i);
});

test('public landing page Pro tier uses outcome-framed bullets that justify upgrade', () => {
  const landingPage = readLandingPage();

  // Pro bullets frame outcomes, not features
  assert.match(landingPage, /Visual gate debugger/i);
  assert.match(landingPage, /every blocked action and the gate that fired/i);
  assert.match(landingPage, /Auto-connect/i);
  assert.match(landingPage, /agents appear automatically/i);
  assert.match(landingPage, /DPO training data export/i);
  assert.match(landingPage, /ready-to-use preference pairs for fine-tuning/i);
  assert.match(landingPage, /Personal local dashboard/i);
  assert.match(landingPage, /export-ready evidence/i);
  // Persona targeting for Pro
  assert.match(landingPage, /individual operator/i);
  assert.match(landingPage, /without starting the team rollout motion/i);
  // Upgrade triggers
  assert.match(landingPage, /Choose Pro when:/i);
  assert.match(landingPage, /review-ready evidence/i);
});

test('public landing page includes an explicit Team rollout lane with shared workflow intake', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /<div class="tier">Team<\/div>/);
  assert.match(landingPage, /Shared enforcement memory/i);
  assert.match(landingPage, /Hosted review views/i);
  assert.match(landingPage, /Org dashboard/i);
  assert.match(landingPage, /Gate template library/i);
  assert.match(landingPage, /workflow-sprint-intake/);
  assert.match(landingPage, /Start Team Pilot Intake/i);
  assert.match(landingPage, /name="planId" value="team"/);
  assert.match(landingPage, /name="ctaId" value="workflow_sprint_intake"/);
});

test('public landing page includes FAQ section with accordion interaction', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /id="faq"/);
  assert.match(landingPage, /Common questions/);
  assert.match(landingPage, /How is ThumbGate different from model-training feedback loops\?/);
  assert.match(landingPage, /What's the tech stack\?/);
  assert.match(landingPage, /What AI agents and editors does this work with\?/);
  assert.match(landingPage, /Do I need a cloud account\?/);
  assert.match(landingPage, /How are (?:pre-action )?gates different from prompt rules\?/);
  assert.match(landingPage, /What are the buying paths\?/);
  assert.match(landingPage, /role="button"/);
  assert.match(landingPage, /tabindex="0"/);
  assert.match(landingPage, /aria-expanded="true"/);
  assert.match(landingPage, /aria-expanded="false"/);
  assert.match(landingPage, /onclick="toggleFaq\(this\)"/);
  assert.match(landingPage, /onkeydown="handleFaqKeydown\(event\)"/);
  assert.match(landingPage, /function toggleFaq\(el\)/);
  assert.match(landingPage, /function handleFaqKeydown\(event\)/);
  assert.match(landingPage, /personal local dashboard/i);
  assert.match(landingPage, /shared enforcement memory/i);
  assert.match(landingPage, /hosted review views/i);
  assert.match(landingPage, /org dashboard/i);
});

test('public landing page includes compatibility section for AI agent surfaces', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /id="compatibility"/);
  assert.match(landingPage, /AI CLIs/i);
  assert.match(landingPage, /MCP-compatible agent/i);
  assert.match(landingPage, /pre-action gates/i);
  assert.match(landingPage, /enforcement out of the box/i);
  assert.match(landingPage, /Claude Desktop plugin/i);
  assert.match(landingPage, /Editor workflows/i);
  assert.match(landingPage, /Claude Code Skill/i);
  assert.match(landingPage, /\/thumbgate/);
  assert.match(landingPage, /compatibility-grid/);
  assert.match(landingPage, /View setup guide/);
  assert.match(landingPage, /Get the Claude plugin/);
  assert.match(landingPage, /Browse plugins/);
  assert.match(landingPage, /View skill on GitHub/);
});

test('public landing page includes Plausible custom event tracking for all CTAs', () => {
  const landingPage = readLandingPage();

  // install_copy fires directly in copyInstall function
  assert.match(landingPage, /plausible\('install_copy'\)/);

  // trackClick wires up CTA events by selector and event name
  assert.match(landingPage, /trackClick\('.btn-pro', 'checkout_start'/);
  assert.match(landingPage, /trackClick\('.btn-install-link', 'install_guide_click'/);
  assert.match(landingPage, /trackClick\('.btn-team', 'workflow_sprint_intake_click'/);
  assert.match(landingPage, /trackClick\('.btn-free', 'install_click'/);
  assert.match(landingPage, /trackClick\('.btn-demo-link', 'demo_click'/);
  assert.match(landingPage, /trackClick\('.nav-cta', 'workflow_sprint_intake_click'/);
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
  assert.match(landingPage, /Popular Buyer Questions/i);
  assert.match(landingPage, /How buyers discover ThumbGate/i);
  assert.match(landingPage, /href="\/compare\/speclock"/);
  assert.match(landingPage, /href="\/compare\/mem0"/);
  assert.match(landingPage, /href="\/guides\/pre-action-gates"/);
  assert.match(landingPage, /href="\/guides\/claude-code-feedback"/);
  assert.match(landingPage, /href="\/guides\/stop-repeated-ai-agent-mistakes"/);
  assert.match(landingPage, /href="\/guides\/cursor-agent-guardrails"/);
  assert.match(landingPage, /href="\/guides\/codex-cli-guardrails"/);
  assert.match(landingPage, /href="\/guides\/gemini-cli-feedback-memory"/);
  // No internal marketing jargon visible to customers
  assert.doesNotMatch(landingPage, /GSD Pages/);
  assert.doesNotMatch(landingPage, /Bottom of funnel/i);
  assert.doesNotMatch(landingPage, /Category creation/i);
  assert.doesNotMatch(landingPage, /convert.*search.*demand/i);
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
  assert.ok(html.includes('Log everything'), 'must include "Log everything" card');
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
  assert.match(html, /href="https:\/\/x\.com\/[^"]+"/, 'footer must link to X/Twitter');
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
  assert.match(html, /Local Pro connected/i);
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

test('public landing page includes 7-day free trial and email capture gate', () => {
  const landingPage = readLandingPage();
  const buyerIntentScript = readBuyerIntentScript();
  assert.match(landingPage, /7-DAY FREE TRIAL/);
  assert.match(landingPage, /pro-email/);
  assert.match(landingPage, /handleProTrial/);
  assert.match(landingPage, /\/js\/buyer-intent\.js/);
  assert.match(buyerIntentScript, /customer_email/);
  assert.match(buyerIntentScript, /submitNewsletterSignup/);
  assert.match(buyerIntentScript, /dataset\.baseHref/);
  assert.doesNotMatch(buyerIntentScript, /setAttribute\('href'/);
  assert.doesNotMatch(landingPage, /props:\s*\{\s*email:/);
});

test('public landing page includes dashboard preview in Pro card', () => {
  const landingPage = readLandingPage();
  assert.match(landingPage, /dashboard-preview/);
  assert.match(landingPage, /What your Pro dashboard looks like/);
  assert.match(landingPage, /gate:no-force-push/);
});
