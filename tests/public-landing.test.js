const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PRODUCTHUNT_URL } = require('../scripts/distribution-surfaces');

const landingPagePath = path.join(__dirname, '..', 'public', 'index.html');

function readLandingPage() {
  return fs.readFileSync(landingPagePath, 'utf8');
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

test('public landing page uses Stripe checkout links for Pro tier', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /\/checkout\/pro\?plan_id=pro/);
  assert.match(landingPage, /cta_id=hero_pro_trial/);
  assert.match(landingPage, /cta_id=pricing_pro_trial_email_gate/);
  assert.match(landingPage, /cta_id=final_pro_trial/);
  assert.match(landingPage, /buy\.stripe\.com/);
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
  assert.match(landingPage, /Local-only, single dev/);
  assert.match(landingPage, /Founder pricing/);
  assert.match(landingPage, /Shared lessons/i);
  assert.match(landingPage, /\$12/);
  assert.match(landingPage, /Install Free/);
  assert.match(landingPage, /Free Trial/);
  assert.match(landingPage, /Start Team Rollout/);
});

test('public landing page includes Plausible analytics and search engine proof bar', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /\/js\/analytics\.js/);
  assert.match(landingPage, /npm downloads/i);
  assert.match(landingPage, /tests passing/i);
  assert.ok(landingPage.includes(PRODUCTHUNT_URL));
  assert.match(landingPage, /MIT licensed/i);
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

test('public landing page positions ThumbGate as human-in-the-loop enforcement for AI agents', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /ThumbGate/);
  assert.match(landingPage, /Stop AI Coding Agents From Repeating Mistakes/i);
  assert.match(landingPage, /Human-in-the-Loop Enforcement/i);
  assert.match(landingPage, /immune system/i);
  assert.match(landingPage, /Claude Code/);
  assert.match(landingPage, /Cursor/);
  assert.match(landingPage, /Codex/);
  assert.match(landingPage, /Gemini/);
  assert.match(landingPage, /Amp/);
  assert.match(landingPage, /OpenCode/);
  assert.match(landingPage, /MCP-compatible agent/i);
  assert.match(landingPage, /SQLite\+FTS5/);
  assert.doesNotMatch(landingPage, /mailto:/i);
  assert.doesNotMatch(landingPage, /official Anthropic partner/i);
});

test('public landing page hero features both thumbs up AND thumbs down prominently', () => {
  const landingPage = readLandingPage();

  // Hero big emoji must show BOTH thumbs — not just one
  assert.match(landingPage, /class="hero-thumbs">👍👎</);
  // Headline: problem/resolution antithesis (Mem0-style, under 8 words)
  assert.match(landingPage, /AI agents repeat mistakes/i);
  assert.match(landingPage, /Yours won't/i);
  // "dangerous and dumb" moved to signal pill
  assert.match(landingPage, /dangerous and dumb mistakes/i);
  // Signal pills must show both
  assert.match(landingPage, /signal-pill signal-up/);
  assert.match(landingPage, /signal-pill signal-down/);
  assert.match(landingPage, /👍 reinforces what worked/);
  assert.match(landingPage, /👎 blocks dangerous and dumb mistakes/);
  // Persona targeting
  assert.match(landingPage, /class="hero-persona"/);
  assert.match(landingPage, /power users of Claude Code/i);
  // Plain-language value prop
  assert.match(landingPage, /immune system for your AI agent/i);
  assert.match(landingPage, /skipped tests/i);
  assert.match(landingPage, /destructive SQL/i);
  assert.match(landingPage, /force-pushes/i);
});

test('public landing page hero routes visitors into free, pro, and team lanes', () => {
  const landingPage = readLandingPage();
  const heroMatch = landingPage.match(/<section class="hero">[\s\S]*?<\/section>/);

  assert.ok(heroMatch, 'Hero section must exist');
  assert.match(heroMatch[0], /Install Free/);
  assert.match(heroMatch[0], /Start 7-Day Pro Trial/);
  assert.match(heroMatch[0], /no cloud account/i);
  assert.match(heroMatch[0], /Start the Team rollout/i);
  assert.match(heroMatch[0], /data-cta-id="hero_install_free"/);
  assert.match(heroMatch[0], /cta_id=hero_pro_trial/);
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
  assert.match(landingPage, /Founder-license support/i);
  // Persona targeting for Pro
  assert.match(landingPage, /individual operators/i);
  assert.match(landingPage, /personal local dashboard/i);
  // Upgrade triggers
  assert.match(landingPage, /Go Pro when:/i);
  assert.match(landingPage, /blocked 20\+ actions/i);
  assert.match(landingPage, /avoided rollback/i);
});

test('public landing page avoids unverified traction and pricing claims', () => {
  const landingPage = readLandingPage();

  assert.doesNotMatch(landingPage, /57% of PRs/i);
  assert.doesNotMatch(landingPage, /\$0\.10 per blocked mistake/i);
  assert.doesNotMatch(landingPage, /bootstraps \.rlhf/i);
  assert.match(landingPage, /\$19\/mo or \$149\/yr/i);
});

test('public landing page includes an explicit Team rollout lane with shared workflow intake', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /<div class="tier">Team<\/div>/);
  assert.match(landingPage, /Hosted shared lesson DB/i);
  assert.match(landingPage, /Generated hosted review views/i);
  assert.match(landingPage, /Org dashboard/i);
  assert.match(landingPage, /Gate template library/i);
  assert.match(landingPage, /workflow-sprint-intake/);
  assert.match(landingPage, /Submit Team Workflow Intake/i);
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
  assert.match(landingPage, /What does Pro cost\?/);
  assert.match(landingPage, /role="button"/);
  assert.match(landingPage, /tabindex="0"/);
  assert.match(landingPage, /aria-expanded="true"/);
  assert.match(landingPage, /aria-expanded="false"/);
  assert.match(landingPage, /onclick="toggleFaq\(this\)"/);
  assert.match(landingPage, /onkeydown="handleFaqKeydown\(event\)"/);
  assert.match(landingPage, /function toggleFaq\(el\)/);
  assert.match(landingPage, /function handleFaqKeydown\(event\)/);
  assert.match(landingPage, /personal local dashboard on your machine/i);
  assert.match(landingPage, /shared lesson database/i);
  assert.match(landingPage, /generated hosted review views/i);
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
  assert.match(landingPage, /trackClick\('.btn-team', 'workflow_sprint_intake_click'/);
  assert.match(landingPage, /trackClick\('.btn-free', 'install_click'/);
  assert.match(landingPage, /trackClick\('.btn-demo', 'dashboard_demo_click'/);
  assert.match(landingPage, /trackClick\('.nav-cta', 'view_pricing_click'/);
  assert.match(landingPage, /sendFirstPartyTelemetry/);
  assert.match(landingPage, /\/v1\/telemetry\/ping/);
  assert.match(landingPage, /eventType: 'cta_click'/);
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
  assert.match(landingPage, /How ThumbGate compares/i);
  assert.match(landingPage, /href="\/compare\/speclock"/);
  assert.match(landingPage, /href="\/compare\/mem0"/);
  assert.match(landingPage, /href="\/guides\/pre-action-gates"/);
  assert.match(landingPage, /href="\/guides\/claude-code-feedback"/);
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
});

test('landing page captures buyer-loss feedback before checkout bounce', () => {
  const html = readLandingPage();
  assert.ok(html.includes('buyer-loss-feedback'), 'must include buyer loss feedback card');
  assert.match(html, /Not buying yet\?/);
  assert.match(html, /data-reason="too_expensive"/);
  assert.match(html, /data-reason="need_team_approval"/);
  assert.match(html, /data-interest="high"/);
  assert.match(html, /eventType: 'reason_not_buying'/);
  assert.match(html, /plausible\('buyer_loss_feedback'/);
  assert.match(html, /landing_feedback/);
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

test('lessons page has rule cards with effectiveness metric', () => {
  const html = readLessonsPage();
  assert.match(html, /Prevented/i);
  assert.match(html, /Mistakes Prevented/i);
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
  assert.match(landingPage, /7-DAY FREE TRIAL/);
  assert.match(landingPage, /pro-email/);
  assert.match(landingPage, /handleProTrial/);
  assert.match(landingPage, /customer_email/);
  assert.match(landingPage, /pricing_pro_trial_email_gate/);
});

test('public landing page includes dashboard preview in Pro card', () => {
  const landingPage = readLandingPage();
  assert.match(landingPage, /dashboard-preview/);
  assert.match(landingPage, /What your Pro dashboard looks like/);
  assert.match(landingPage, /gate:no-force-push/);
});
