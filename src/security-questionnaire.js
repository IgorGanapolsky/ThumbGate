'use strict';

/**
 * Public vendor-security questionnaire.
 * Answers are taken from existing public legal docs only.
 * This is not a SOC 2 report or certification claim.
 */

const UPDATED = '2026-08-18';

function getSecurityQuestionnaire() {
  return {
    product: 'ThumbGate',
    updated: UPDATED,
    certification: false,
    copyPasteUrl: 'https://thumbgate.ai/security.json',
    htmlUrl: 'https://thumbgate.ai/security',
    items: [
      {
        id: 'what',
        question: 'What does ThumbGate do?',
        answer: 'ThumbGate is a local-first pre-action control layer for AI coding agents. Gates can allow, warn, require approval, or hard-deny tool calls. It is not a guarantee that every unsafe action is detected.',
        source: '/security and docs/legal/SECURITY_AND_INCIDENT.md',
      },
      {
        id: 'soc2',
        question: 'Do you have SOC 2, ISO 27001, ISO 42001, HIPAA, or a default BAA?',
        answer: 'No. ThumbGate does not have a SOC 2 Type I/II report, ISO 27001 or ISO 42001 certificate, HIPAA eligibility, or a default BAA. Do not treat marketing “control mapping” language as an attestation.',
        source: 'docs/legal/SECURITY_AND_INCIDENT.md §7',
      },
      {
        id: 'source-code',
        question: 'Where does customer workspace source code live?',
        answer: 'On the customer machine by default. The local engine does not fetch or render workspace source on public marketing dashboards. Hosted surfaces process account, billing, pairing, and runner operational logs — not local workspace contents unless the customer sends them.',
        source: '/privacy and docs/legal/PRIVACY_POLICY.md §1–2',
      },
      {
        id: 'training',
        question: 'Do you train models on customer data?',
        answer: 'We do not share local-engine workspace source with model trainers. Hosted features only process content the customer sends to those features.',
        source: 'docs/legal/PRIVACY_POLICY.md §3',
      },
      {
        id: 'subprocessors',
        question: 'Who are your subprocessors?',
        answer: 'Operational list: Stripe (payments), Railway (hosting), Plausible (web analytics), PostHog (product analytics where configured), Resend (transactional email where configured), PayPal (alternate payment rail where used), GitHub (repo/issues/Marketplace). Presence on the list is not a claim that every enterprise questionnaire or SCC is complete.',
        source: 'docs/legal/PRIVACY_POLICY.md §4',
      },
      {
        id: 'encryption',
        question: 'Is data encrypted in transit?',
        answer: 'Hosted endpoints are served over HTTPS/TLS. This is engineering practice, not a certified control.',
        source: 'docs/legal/SECURITY_AND_INCIDENT.md §3',
      },
      {
        id: 'auth',
        question: 'How is hosted access controlled?',
        answer: 'Sensitive hosted routes use API keys or operator auth. Stripe webhooks are HMAC-verified. Production secrets live in the host secret store, not git.',
        source: 'docs/legal/SECURITY_AND_INCIDENT.md §3',
      },
      {
        id: 'audit',
        question: 'What audit artifact exists for a consequential agent action?',
        answer: 'A signed broker execution receipt. Agents cannot mint a valid signature. Public schema: https://github.com/IgorGanapolsky/ThumbGate/blob/main/config/schemas/broker-execution-receipt.schema.json',
        source: 'docs/BROKER_EXECUTION_RECEIPTS.md',
      },
      {
        id: 'gpc',
        question: 'Do you honor Global Privacy Control, DNT, and CCPA 1798.135?',
        answer: 'Yes on marketing surfaces. Sec-GPC: 1 or DNT: 1 discards first-party /v1/telemetry/ping (still 204) and omits Plausible/GA bootstrap. Privacy notice describes analytics as pseudonymous, not anonymous, and exposes Your Privacy Choices.',
        source: '/privacy#your-privacy-choices and PR #3514',
      },
      {
        id: 'sale',
        question: 'Do you sell personal information?',
        answer: 'No.',
        source: 'docs/legal/PRIVACY_POLICY.md §2',
      },
      {
        id: 'deletion',
        question: 'How do we delete hosted account data?',
        answer: 'Email privacy@thumbgate.ai or the contact on /privacy. Verified hosted-account deletion requests are processed within 30 days except legal holds. Local data is deleted by removing local directories.',
        source: 'docs/legal/PRIVACY_POLICY.md §6',
      },
      {
        id: 'incident',
        question: 'What is the incident notification target?',
        answer: 'For enterprise customers under a signed agreement that includes incident terms: notify the designated contact within 72 hours after confirming a personal-data or confidential hosted-content breach affecting that customer. Self-serve users without that schedule get commercially reasonable notice, not a contractual 72-hour SLA.',
        source: 'docs/legal/SECURITY_AND_INCIDENT.md §5',
      },
      {
        id: 'vuln',
        question: 'How do we report a vulnerability?',
        answer: 'Email security@thumbgate.ai with “Security” in the subject. Do not file public GitHub issues for active vulnerabilities. Acknowledgement target: 48 hours.',
        source: '/security',
      },
      {
        id: 'inspect',
        question: 'Can we inspect the control layer?',
        answer: 'Yes. The public runtime is MIT-licensed at https://github.com/IgorGanapolsky/ThumbGate. Hosted operation, adapter coverage, and dashboard state are what a subscription buys — not a private intelligence split.',
        source: 'MOAT.md and /legal/licensing',
      },
      {
        id: 'health',
        question: 'How do we verify the live hosted build?',
        answer: 'GET https://thumbgate-production.up.railway.app/health returns version and buildSha. Production claims require that buildSha to match the intended main commit.',
        source: 'CLAUDE.md Deployment Verification Gate',
      },
    ],
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toMarkdown(pack = getSecurityQuestionnaire()) {
  const lines = [
    `# ThumbGate security questionnaire`,
    ``,
    `Updated: ${pack.updated}`,
    `This is not a SOC 2 report, pen-test certificate, or compliance certification.`,
    `Machine-readable: ${pack.copyPasteUrl}`,
    ``,
  ];
  for (const item of pack.items) {
    lines.push(`## ${item.question}`);
    lines.push(item.answer);
    lines.push(`Source: ${item.source}`);
    lines.push('');
  }
  return lines.join('\n');
}

function renderSecurityOverviewHtml(pack = getSecurityQuestionnaire()) {
  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: pack.items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };

  const itemsHtml = pack.items.map((item) => `
<article class="qa" id="${escapeHtml(item.id)}">
  <h3>${escapeHtml(item.question)}</h3>
  <p>${escapeHtml(item.answer)}</p>
  <p class="src">Source: ${escapeHtml(item.source)}</p>
</article>`).join('\n');

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Security questionnaire — ThumbGate</title>
<meta name="description" content="Copy-paste vendor security answers for ThumbGate. Local-first control layer, no SOC 2 claim, GPC/DNT honored, public receipt schema.">
<link rel="canonical" href="https://thumbgate.ai/security">
<script type="application/ld+json">${JSON.stringify(faqLd)}</script>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:820px;margin:0 auto;padding:32px 20px;line-height:1.55;color:#1f2937}
h1{font-size:28px;margin:0 0 8px}h2{font-size:18px;margin:28px 0 8px}h3{font-size:16px;margin:0 0 8px}p,li{font-size:15px}
.meta{color:#6b7280;font-size:14px;margin:0 0 24px}
.draft{border-left:3px solid #f59e0b;background:#fffbeb;padding:10px 14px;border-radius:0 8px 8px 0;margin:16px 0}
.qa{border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin:12px 0}
.src{color:#6b7280;font-size:13px;margin:8px 0 0}
pre{background:#0f172a;color:#e2e8f0;padding:12px 14px;border-radius:8px;overflow:auto;font-size:13px}
ul{padding-left:22px}li{margin:6px 0}a{color:#0066cc}
footer{margin-top:40px;padding-top:20px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:14px}</style></head><body>
<h1>Security overview</h1>
<p class="meta"><strong>ThumbGate</strong> · Last updated: ${escapeHtml(pack.updated)} · JSON: <a href="/security.json">/security.json</a></p>
<div class="draft">This page is a product security summary for buyers and partners. It is not a SOC 2 report, pen-test certificate, or compliance certification. Paste <a href="/security.json">/security.json</a> into a vendor review instead of waiting on a custom write-up.</div>
<h2>Control layer model</h2>
<p>ThumbGate provides pre-action control for AI agents: allow, warn, require approval, or hard-deny tool calls based on configured rules. It is not a guarantee that every unsafe action is detected.</p>
<h2>Local-first boundary</h2>
<p>The default local engine keeps workspace source and local lessons on your machine. Hosted surfaces process account, billing, device pairing, and runner operational logs as described in the <a href="/privacy">Privacy Policy</a>.</p>
<h2>Vendor questionnaire</h2>
<p>Standard startup security-review questions, answered from existing public docs. Copy the JSON or the markdown block below.</p>
${itemsHtml}
<h2>Copy as markdown</h2>
<pre>${escapeHtml(toMarkdown(pack))}</pre>
<h2>Incident notification posture</h2>
<p>For enterprise customers under a signed agreement that includes incident terms, the draft contractual target is notification within <strong>72 hours</strong> after confirming a personal-data or confidential hosted-content breach affecting that customer.</p>
<h2>Vulnerability disclosure</h2>
<p>Email <a href="mailto:security@thumbgate.ai">security@thumbgate.ai</a> with “Security” in the subject. Do not file public issues for active vulnerabilities. Acknowledgement target: 48 hours.</p>
<footer><a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/privacy#your-privacy-choices">Your Privacy Choices</a> · <a href="/trust">Trust Center</a> · <a href="/support">Support</a> · <a href="/legal">Legal index</a></footer>
</body></html>`;
}

module.exports = {
  getSecurityQuestionnaire,
  renderSecurityOverviewHtml,
  toMarkdown,
};
