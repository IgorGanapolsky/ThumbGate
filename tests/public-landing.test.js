'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const landingPagePath = path.join(root, 'public', 'index.html');
const landingPage = fs.readFileSync(landingPagePath, 'utf8');

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

test('public landing page is narrowed to the Claude Code beachhead', () => {
  assert.match(landingPage, /Stop Claude Code from force-pushing to main\./);
  assert.match(landingPage, /For Claude Code users shipping real repos/);
  assert.match(landingPage, /PreToolUse rule/);
  assert.match(landingPage, /Memory reminds an agent\. ThumbGate gates it\./);
  assert.doesNotMatch(landingPage, /Workflow Hardening Sprint/i);
  assert.doesNotMatch(landingPage, /Reliable AI Agent Governance Setup/i);
  assert.doesNotMatch(landingPage, /OpenClaw Agent Governance Kit/i);
});

test('public landing page contains no visible internal CTA or analytics leakage', () => {
  const text = visibleText(landingPage);
  assert.doesNotMatch(text, /marketing-test-copy/);
  assert.doesNotMatch(text, /hero_workflow_sprint_diagnostic_checkout/);
  assert.doesNotMatch(text, /workflow_sprint_checkout_started/);
  assert.doesNotMatch(text, /ctaId:\s*'/);
});

test('public landing page keeps copy-to-clipboard install command', () => {
  assert.match(landingPage, /npx thumbgate init/);
  assert.match(landingPage, /function copyInstall/);
  assert.match(landingPage, /navigator\.clipboard\.writeText/);
  assert.match(landingPage, /install_command_copied/);
});

test('public landing page keeps optional first-party, GA4, Plausible, and PostHog hooks', () => {
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
  assert.match(landingPage, /plausible\.io\/js\/script\.js/);
  assert.match(landingPage, /posthog\.init\('__POSTHOG_API_KEY__'/);
  assert.match(landingPage, /api_host: '\/ingest'/);
  assert.match(landingPage, /posthog\.capture\('\$pageview'\)/);
});

test('public landing page pricing is simple and claim-backed', () => {
  assert.match(landingPage, /class="card price-card free"/);
  assert.match(landingPage, /class="card price-card pro"/);
  assert.match(landingPage, /3 feedback captures total/);
  assert.match(landingPage, /1 active prevention rule/);
  assert.match(landingPage, /No DPO export, team sync, or hosted dashboard/);
  assert.match(landingPage, /\$19 <small>\/mo<\/small>/);
  assert.match(landingPage, /Annual option: \$149\/year/);
  assert.doesNotMatch(landingPage, /class="[^"]*team/);
  assert.doesNotMatch(landingPage, /\$49\/seat/);
  assert.doesNotMatch(landingPage, /Pay \$499/);
  assert.doesNotMatch(landingPage, /Pay \$1500/);
  assert.doesNotMatch(landingPage, /\$3,997/);
  assert.doesNotMatch(landingPage, /\$97/);
});

test('public landing page is honest about scope', () => {
  assert.match(landingPage, /recognizable tool calls and repeated patterns/);
  assert.match(landingPage, /does not magically understand every bad judgment/);
  assert.match(landingPage, /Keep tests, code review, and human approval/);
  assert.doesNotMatch(landingPage, /stops every bad AI coding decision/i);
});

test('public landing page explains current buying pressure without unsupported vendor claims', () => {
  assert.match(landingPage, /Repeated agent mistakes are getting more expensive\./);
  assert.match(landingPage, /Token and cash pressure/);
  assert.match(landingPage, /Versioned proof/);
  assert.match(landingPage, /Data-layer accountability/);
  assert.match(landingPage, /the next tool call/);
  assert.doesNotMatch(landingPage, /Cloudflare Artifacts/i);
  assert.doesNotMatch(landingPage, /GPT-5\.5/i);
  assert.doesNotMatch(landingPage, /Dreaming/i);
  assert.doesNotMatch(landingPage, /Rex/i);
  assert.doesNotMatch(landingPage, /TOON/i);
});

test('public landing page keeps SEO JSON-LD for the trimmed offer', () => {
  assert.match(landingPage, /"@type": "SoftwareApplication"/);
  assert.match(landingPage, /"@type": "FAQPage"/);
  assert.match(landingPage, /"name": "ThumbGate Free"/);
  assert.match(landingPage, /"name": "ThumbGate Pro"/);
});

test('public landing page uses no Math.random for security or IDs', () => {
  assert.doesNotMatch(landingPage, /Math\.random\(/);
});
