const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const landingPagePath = path.join(__dirname, '..', 'public', 'index.html');
const codexPluginPagePath = path.join(__dirname, '..', 'public', 'codex-plugin.html');
const buyerIntentScriptPath = path.join(__dirname, '..', 'public', 'js', 'buyer-intent.js');

function readLandingPage() {
  return fs.readFileSync(landingPagePath, 'utf8');
}

function readBuyerIntentScript() {
  return fs.readFileSync(buyerIntentScriptPath, 'utf8');
}

function readCodexPluginPage() {
  return fs.readFileSync(codexPluginPagePath, 'utf8');
}

test('public landing page keeps FAQPage JSON-LD parity for SEO and GEO', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /"@type": "SoftwareApplication"/);
  assert.match(landingPage, /"@type": "FAQPage"/);
  assert.match(landingPage, /How is ThumbGate different from model-training feedback loops\?/);
  assert.match(landingPage, /What is the ThumbGate tech stack\?/);
  assert.match(landingPage, /What AI agents does ThumbGate work with\?/);
  assert.match(landingPage, /Do I have to chat inside the ThumbGate GPT for enforcement\?/);
  assert.match(landingPage, /How are pre-action checks different from prompt rules\?/);
  assert.match(landingPage, /behavioral immune system/i);
  assert.match(landingPage, /PreToolUse hook enforcement/i);
  assert.match(landingPage, /Thompson Sampling/i);
  assert.match(landingPage, /prompt evaluation/i);
});

test('public landing page routes Pro buyers through the hosted checkout surface', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /\/checkout\/pro\?/);
  assert.match(landingPage, /\/go\/pro\?utm_source=website/);
  assert.match(landingPage, /Free Trial|Upgrade to Pro/i);
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

  assert.match(landingPage, /class="price-card/);
  assert.match(landingPage, /class="price-card pro"/);
  assert.match(landingPage, /class="price-card team"/);
  assert.match(landingPage, /\$0/);
  assert.match(landingPage, /\$19/);
  assert.match(landingPage, /\/mo/);
  assert.match(landingPage, /\$49/);
  assert.match(landingPage, /\/seat\/mo/);
  assert.match(landingPage, /See how it works/);
  assert.match(landingPage, /3 captures.*1 rule.*1 agent/i);
  assert.match(landingPage, /solo side lane/i);
  assert.match(landingPage, /Shared enforcement/i);
  assert.match(landingPage, /Install Free/);
  assert.match(landingPage, /Free Trial|Upgrade to Pro/i);
  assert.match(landingPage, /7-DAY FREE TRIAL/i);
  assert.match(landingPage, /Start Workflow Hardening Sprint/);
});

test('public landing page includes Plausible analytics and search engine proof bar', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /plausible\.io\/js\/script\.js/);
  assert.match(landingPage, /Verification evidence/i);
  assert.match(landingPage, /Release confidence/i);
  assert.match(landingPage, /ThumbGate Bench/i);
  assert.match(landingPage, /Proof-backed CI/i);
  assert.match(landingPage, /CI and proof lanes/i);
  assert.match(landingPage, /Claude Code · Cursor · Codex · Gemini · Amp · Cline · OpenCode/i);
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
  assert.match(landingPage, /Claude Code/);
  assert.match(landingPage, /Cursor/);
  assert.match(landingPage, /Codex/);
  assert.match(landingPage, /Gemini/);
  assert.match(landingPage, /Amp/);
  assert.match(landingPage, /OpenCode/);
  assert.doesNotMatch(landingPage, /mailto:/i);
  assert.doesNotMatch(landingPage, /official Anthropic partner/i);
});

test('public landing page exposes browser-bridge safety buyer guides', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /\/guides\/browser-automation-safety/);
  assert.match(landingPage, /Browser Automation Safety for AI Agents/);
  assert.match(landingPage, /\/guides\/native-messaging-host-security/);
  assert.match(landingPage, /Native Messaging Host Security/);
  assert.match(landingPage, /cross-app bridges/i);
  assert.match(landingPage, /pre-authorized extension paths/i);
});

test('public landing page exposes AEO listicle for production AI agent safety', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /\/guides\/best-tools-stop-ai-agents-breaking-production/);
  assert.match(landingPage, /Best Tools to Stop AI Agents From Breaking Production/);
  assert.match(landingPage, /long-tail answer-engine page/i);
  assert.match(landingPage, /parallel coding agents/i);
});

test('public landing page hero features both thumbs up AND thumbs down prominently', () => {
  const landingPage = readLandingPage();

  // Hero big emoji must show BOTH thumbs — not just one
  assert.match(landingPage, /class="hero-thumbs">👍👎</);
  // Signal pills must show both
  assert.match(landingPage, /signal-pill signal-up/);
  assert.match(landingPage, /signal-pill signal-down/);
  assert.match(landingPage, /Block repeat hallucinations/i);
  assert.match(landingPage, /Thumbs-down once, blocked forever/i);
  assert.match(landingPage, /reliable operator/i);
  // Persona targeting
  assert.match(landingPage, /class="hero-persona"/);
  assert.match(landingPage, /product teams/i);
});

test('public landing page exposes the free CLI wedge above the fold and keeps Pro secondary', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /Install Free CLI/i);
  assert.match(landingPage, /btn-install-link/);
  assert.match(landingPage, /Install free\./i);
  assert.match(landingPage, /solo side lane/i);
});

test('public landing page gives cold users a first-dollar activation path', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /Block your first repeated AI mistake in 5 minutes/i);
  assert.match(landingPage, /First-Dollar Activation Path/i);
  assert.match(landingPage, /Prove one blocked repeat before asking anyone to buy/i);
  assert.match(landingPage, /Native ChatGPT rating buttons are not the ThumbGate capture path/i);
  assert.match(landingPage, /Give <code>thumbs up<\/code> when the agent follows your standards/i);
  assert.match(landingPage, /thumbs up: this review named exact files/i);
  assert.match(landingPage, /thumbs down: the answer ignored my request/i);
  assert.match(landingPage, /Upgrade after one real blocked repeat/i);
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
});

test('public landing page Pro tier uses outcome-framed bullets that justify upgrade', () => {
  const landingPage = readLandingPage();

  // Pro bullets frame outcomes, not features
  assert.match(landingPage, /Visual check debugger/i);
  assert.match(landingPage, /every blocked action and the check that fired/i);
  assert.match(landingPage, /Auto-connect/i);
  assert.match(landingPage, /agents appear automatically/i);
  assert.match(landingPage, /DPO training data export/i);
  assert.match(landingPage, /ready-to-use preference pairs for fine-tuning/i);
  assert.match(landingPage, /Personal local dashboard/i);
  assert.match(landingPage, /Review-ready workflow support/i);
  // Persona targeting for Pro
  assert.match(landingPage, /individual operator/i);
  // Model hardening and HuggingFace export
  assert.match(landingPage, /Model Hardening Advisor/i);
  assert.match(landingPage, /HuggingFace dataset export/i);
});

test('public landing page includes an explicit Team rollout lane with shared workflow intake', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /<div class="tier">Team<\/div>/);
  assert.match(landingPage, /Shared enforcement memory/i);
  assert.match(landingPage, /Hosted review views/i);
  assert.match(landingPage, /Org dashboard/i);
  assert.match(landingPage, /Check template library/i);
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
  assert.match(landingPage, /shared enforcement memory/i);
  assert.match(landingPage, /hosted review views/i);
  assert.match(landingPage, /org dashboard/i);
});

test('public landing page includes compatibility section for AI agent surfaces', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /id="compatibility"/);
  assert.match(landingPage, /AI CLIs/i);
  assert.match(landingPage, /MCP-compatible agent/i);
  assert.match(landingPage, /pre-action checks/i);
  assert.match(landingPage, /enforcement out of the box/i);
  assert.match(landingPage, /Claude Desktop plugin/i);
  assert.match(landingPage, /Editor workflows/i);
  assert.match(landingPage, /Claude Code Skill/i);
  assert.match(landingPage, /\/thumbgate/);
  assert.match(landingPage, /compatibility-grid/);
  // Arrow copy evolved when cards moved off GitHub source links in 1.5.8.
  // Intent preserved: the compat grid must promise a setup guide + a Claude
  // Desktop install action. Download-verbed arrows satisfy this.
  assert.match(landingPage, /(View|Open|Read) (the )?setup guide|setup guide →/i);
  assert.match(landingPage, /(Get|Download) (the )?(Claude plugin|\.mcpb bundle|Claude Extension)/i);
  assert.match(landingPage, /thumbgate-marketplace/);
  assert.match(landingPage, /\/plugin marketplace add IgorGanapolsky\/ThumbGate/);
  assert.match(landingPage, /ChatGPT GPT Actions/);
  assert.match(landingPage, /\/go\/gpt\?utm_source=website/);
  assert.match(landingPage, /Open ThumbGate GPT/);
  assert.match(landingPage, /Live ThumbGate GPT for ChatGPT/);
  assert.match(landingPage, /ChatGPT Entry Point/);
  assert.match(landingPage, /Use the GPT as a preflight desk for risky commands, refunds, deploys, and PR actions\./);
  assert.match(landingPage, /No, you do not have to chat inside the GPT forever/);
  assert.match(landingPage, /ChatGPT is the discovery and memory surface/);
  assert.match(landingPage, /Do not rely on ChatGPT's native rating buttons for ThumbGate memory/);
  assert.match(landingPage, /Explore GPTs/);
  assert.match(landingPage, /choose the GPT by Igor Ganapolsky/i);
  assert.match(landingPage, /Programming/);
  assert.match(landingPage, /Do I have to chat inside the ThumbGate GPT for enforcement\?/);
  assert.match(landingPage, /capture thumbs-up\/down lessons/i);
  assert.match(landingPage, /Real blocking for coding agents still runs locally/);
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
  assert.match(landingPage, /\/go\/github\?utm_source=website/);

  // trackClick wires up CTA events by selector and event name
  assert.match(landingPage, /trackClick\('.btn-pro', 'checkout_start'/);
  assert.match(landingPage, /trackClick\('.btn-gpt-page:not\(.btn-install-hero\)', 'chatgpt_gpt_click'/);
  assert.match(landingPage, /trackClick\('.btn-install-hero', 'install_guide_click'/);
  assert.match(landingPage, /trackClick\('.btn-install-link', 'install_guide_click'/);
  assert.match(landingPage, /trackClick\('.btn-team', 'workflow_sprint_intake_click'/);
  assert.match(landingPage, /trackClick\('.btn-free', 'install_click'/);
  assert.match(landingPage, /trackClick\('.btn-demo-link', 'demo_click'/);
  assert.match(landingPage, /trackClick\('.nav-cta', 'chatgpt_gpt_click'/);
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
  assert.match(landingPage, /href="\/guides\/pre-action-checks"/);
  assert.match(landingPage, /href="\/guides\/agent-harness-optimization"/);
  assert.match(landingPage, /href="\/guides\/ai-search-topical-presence"/);
  assert.match(landingPage, /href="\/guides\/relational-knowledge-ai-recommendations"/);
  assert.match(landingPage, /href="\/guides\/claude-code-feedback"/);
  assert.match(landingPage, /href="\/guides\/stop-repeated-ai-agent-mistakes"/);
  assert.match(landingPage, /href="\/guides\/cursor-agent-guardrails"/);
  assert.match(landingPage, /href="\/guides\/codex-cli-guardrails"/);
  assert.match(landingPage, /href="\/guides\/gemini-cli-feedback-memory"/);
  assert.match(landingPage, /href="\/guides\/autoresearch-agent-safety"/);
  assert.match(landingPage, /Autoresearch Safety for Self-Improving Agents/);
  assert.match(landingPage, /AI Agent Harness Optimization/);
  assert.match(landingPage, /AI Search Topical Presence/);
  assert.match(landingPage, /Relational Knowledge in AI Recommendations/);
  // No internal marketing jargon visible to customers
  assert.doesNotMatch(landingPage, /GSD Pages/);
  assert.doesNotMatch(landingPage, /Bottom of funnel/i);
  assert.doesNotMatch(landingPage, /Category creation/i);
  assert.doesNotMatch(landingPage, /convert.*search.*demand/i);
});

test('public landing page promotes the Autoresearch safety pack', () => {
  const landingPage = readLandingPage();

  assert.match(landingPage, /id="autoresearch-pack"/);
  assert.match(landingPage, /Autoresearch Safety Pack/);
  assert.match(landingPage, /Stop self-improving coding loops from hacking the benchmark/);
  assert.match(landingPage, /holdout tests/i);
  assert.match(landingPage, /reward hacking/i);
  assert.match(landingPage, /verification evidence/i);
  assert.match(landingPage, /cta_id=autoresearch_pro_trial/);
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
  assert.match(codexPage, /plugins\/codex-profile\/INSTALL\.md/);
  assert.match(codexPage, /Pre-Action Checks/);
  assert.match(codexPage, /Codex settings/);
  assert.match(codexPage, /Bare "thumbs down" is intentionally too vague/);
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
  assert.match(buyerIntentScript, /initializeBehaviorAnalytics/);
  assert.match(buyerIntentScript, /buyer_email_abandon/);
  assert.match(landingPage, /initializeBehaviorAnalytics/);
  assert.match(landingPage, /pricing_pro_trial/);
  assert.match(buyerIntentScript, /dataset\.baseHref/);
  assert.doesNotMatch(buyerIntentScript, /setAttribute\('href'/);
  assert.doesNotMatch(landingPage, /props:\s*\{\s*email:/);
});

test('public landing page includes dashboard preview in Pro card', () => {
  const landingPage = readLandingPage();
  assert.match(landingPage, /dashboard-preview/);
  assert.match(landingPage, /What your Pro dashboard looks like/);
  assert.match(landingPage, /check:no-force-push/);
});
