'use strict';

/**
 * Public Trust Center pack (Oneleet-style hub, not a SOC 2 product clone).
 * Aggregates questionnaire + gate control-tag coverage + evidence links.
 * certification remains false — mapping is not an attestation.
 */

const fs = require('fs');
const path = require('path');
const {
  getSecurityQuestionnaire,
} = require('./security-questionnaire');

const UPDATED = '2026-08-23';
const DEFAULT_GATES_PATH = path.join(__dirname, '..', 'config', 'gates', 'default.json');

const FRAMEWORK_FAMILIES = [
  { id: 'SOC2', label: 'SOC 2 Trust Services (control tags)', prefix: 'SOC2-' },
  { id: 'NIST', label: 'NIST SP 800-53 (control tags)', prefix: 'NIST-' },
  { id: 'OWASP', label: 'OWASP Top 10 (control tags)', prefix: 'OWASP-' },
  { id: 'CWE', label: 'CWE (control tags)', prefix: 'CWE-' },
];

function loadDefaultGates(gatesPath = DEFAULT_GATES_PATH) {
  const raw = JSON.parse(fs.readFileSync(gatesPath, 'utf8'));
  return Array.isArray(raw.gates) ? raw.gates : [];
}

function summarizeComplianceCoverage(gates) {
  const familyCounts = Object.fromEntries(FRAMEWORK_FAMILIES.map((f) => [f.id, 0]));
  const tagCounts = {};
  let taggedGates = 0;

  for (const gate of gates) {
    const tags = Array.isArray(gate.compliance) ? gate.compliance : [];
    if (tags.length === 0) continue;
    taggedGates += 1;
    const seenFamilies = new Set();
    for (const tag of tags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      for (const family of FRAMEWORK_FAMILIES) {
        if (String(tag).startsWith(family.prefix) || String(tag) === family.id) {
          seenFamilies.add(family.id);
        }
      }
    }
    for (const id of seenFamilies) familyCounts[id] += 1;
  }

  const totalGates = gates.length;
  const frameworks = FRAMEWORK_FAMILIES.map((family) => {
    const gateCount = familyCounts[family.id];
    const coveragePct = totalGates === 0 ? 0 : Math.round((gateCount / totalGates) * 100);
    return {
      id: family.id,
      label: family.label,
      taggedGateCount: gateCount,
      totalGates,
      coveragePctOfShippedGates: coveragePct,
      attestation: false,
      note: 'Coverage of shipped default gates that carry this family tag. Not audit readiness or certification.',
    };
  });

  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([tag, count]) => ({ tag, gateCount: count }));

  return {
    totalGates,
    taggedGates,
    untaggedGates: Math.max(0, totalGates - taggedGates),
    frameworks,
    topTags,
  };
}

function getTrustCenterPack(options = {}) {
  const gates = options.gates || loadDefaultGates(options.gatesPath);
  const questionnaire = options.questionnaire || getSecurityQuestionnaire();
  const coverage = summarizeComplianceCoverage(gates);

  return {
    product: 'ThumbGate',
    updated: UPDATED,
    kind: 'trust-center',
    certification: false,
    theater: false,
    summary:
      'Buyer-facing trust hub: copy-paste security questionnaire, honest non-certification posture, and control-tag coverage of shipped default gates. Not a SOC 2 / ISO platform.',
    urls: {
      html: 'https://thumbgate.ai/trust',
      json: 'https://thumbgate.ai/trust.json',
      security: 'https://thumbgate.ai/security',
      securityJson: 'https://thumbgate.ai/security.json',
      privacy: 'https://thumbgate.ai/privacy',
      privacyChoices: 'https://thumbgate.ai/privacy#your-privacy-choices',
      health: 'https://thumbgate-production.up.railway.app/health',
      receiptSchema:
        'https://github.com/IgorGanapolsky/ThumbGate/blob/main/config/schemas/broker-execution-receipt.schema.json',
      source: 'https://github.com/IgorGanapolsky/ThumbGate',
    },
    contacts: {
      security: 'security@thumbgate.ai',
      privacy: 'privacy@thumbgate.ai',
      legal: 'legal@thumbgate.ai',
    },
    certifications: {
      soc2: false,
      iso27001: false,
      iso42001: false,
      hipaa: false,
      baaDefault: false,
      note: 'Do not treat control-tag mapping or marketing framework language as an attestation.',
    },
    questionnaire: {
      itemCount: Array.isArray(questionnaire.items) ? questionnaire.items.length : 0,
      updated: questionnaire.updated,
      copyPasteUrl: questionnaire.copyPasteUrl,
      htmlUrl: questionnaire.htmlUrl,
    },
    controlCoverage: coverage,
    evidence: [
      {
        id: 'security-questionnaire',
        title: 'Vendor security questionnaire (JSON)',
        url: '/security.json',
        kind: 'questionnaire',
      },
      {
        id: 'broker-receipt-schema',
        title: 'Broker execution receipt schema',
        url: 'https://github.com/IgorGanapolsky/ThumbGate/blob/main/config/schemas/broker-execution-receipt.schema.json',
        kind: 'schema',
      },
      {
        id: 'production-health',
        title: 'Production health (version + buildSha)',
        url: 'https://thumbgate-production.up.railway.app/health',
        kind: 'live-status',
      },
      {
        id: 'privacy-choices',
        title: 'Your Privacy Choices (GPC / DNT)',
        url: '/privacy#your-privacy-choices',
        kind: 'privacy',
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

function renderTrustCenterHtml(pack = getTrustCenterPack()) {
  const frameworkRows = pack.controlCoverage.frameworks.map((fw) => `
<tr>
  <td>${escapeHtml(fw.label)}</td>
  <td>${fw.taggedGateCount} / ${fw.totalGates}</td>
  <td>${fw.coveragePctOfShippedGates}%</td>
  <td>no</td>
</tr>`).join('');

  const tagList = pack.controlCoverage.topTags
    .map((t) => `<li><code>${escapeHtml(t.tag)}</code> — ${t.gateCount} gate(s)</li>`)
    .join('\n');

  const evidenceList = pack.evidence
    .map((e) => `<li><a href="${escapeHtml(e.url)}">${escapeHtml(e.title)}</a> <span class="meta">(${escapeHtml(e.kind)})</span></li>`)
    .join('\n');

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'ThumbGate Trust Center',
    description: pack.summary,
    url: pack.urls.html,
    isPartOf: { '@type': 'WebSite', name: 'ThumbGate', url: 'https://thumbgate.ai' },
  };

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Trust Center — ThumbGate</title>
<meta name="description" content="ThumbGate Trust Center: security questionnaire, honest non-certification posture, and control-tag coverage of shipped gates. Not a SOC 2 report.">
<link rel="canonical" href="https://thumbgate.ai/trust">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:880px;margin:0 auto;padding:32px 20px;line-height:1.55;color:#1f2937}
h1{font-size:28px;margin:0 0 8px}h2{font-size:18px;margin:28px 0 8px}p,li,td{font-size:15px}
.meta{color:#6b7280;font-size:14px;margin:0 0 24px}
.draft{border-left:3px solid #f59e0b;background:#fffbeb;padding:10px 14px;border-radius:0 8px 8px 0;margin:16px 0}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:16px 0}
.card{border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;background:#fafafa}
.card strong{display:block;margin-bottom:6px}table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{border:1px solid #e5e7eb;padding:8px 10px;text-align:left;font-size:14px}th{background:#f8fafc}
ul{padding-left:22px}li{margin:6px 0}a{color:#0066cc}code{font-size:13px}
footer{margin-top:40px;padding-top:20px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:14px}</style></head><body>
<h1>Trust Center</h1>
<p class="meta"><strong>ThumbGate</strong> · Last updated: ${escapeHtml(pack.updated)} · JSON: <a href="/trust.json">/trust.json</a></p>
<div class="draft"><strong>No compliance theater.</strong> This hub is not a SOC 2 Type I/II report, ISO 27001/42001 certificate, HIPAA eligibility, or BAA. Control-tag percentages below measure shipped default-gate tagging only — not audit readiness.</div>
<div class="cards">
  <div class="card"><strong>Certifications</strong>None claimed. <code>certification: false</code> in <a href="/trust.json">/trust.json</a>.</div>
  <div class="card"><strong>Questionnaire</strong>${pack.questionnaire.itemCount} paste-ready answers at <a href="/security">/security</a> · <a href="/security.json">JSON</a>.</div>
  <div class="card"><strong>Live build</strong><a href="${escapeHtml(pack.urls.health)}">/health</a> returns version + buildSha for deploy claims.</div>
  <div class="card"><strong>Vuln report</strong><a href="mailto:${escapeHtml(pack.contacts.security)}">${escapeHtml(pack.contacts.security)}</a> · 48h ack target.</div>
</div>
<h2>What buyers usually need first</h2>
<ul>
<li><a href="/security">Security questionnaire</a> (copy-paste) — also <a href="/security.json">/security.json</a></li>
<li><a href="/privacy">Privacy Policy</a> · <a href="/privacy#your-privacy-choices">Your Privacy Choices</a></li>
<li><a href="/legal">Legal index</a> · <a href="/legal/data-flow">Data-flow map</a></li>
<li>Signed broker execution receipts (schema linked below)</li>
</ul>
<h2>Cross-framework control-tag coverage</h2>
<p>Oneleet-style “one control maps across frameworks” idea, applied honestly to ThumbGate’s existing gate <code>compliance</code> tags. ${pack.controlCoverage.taggedGates} of ${pack.controlCoverage.totalGates} default gates carry at least one tag (${pack.controlCoverage.untaggedGates} untagged).</p>
<table>
<thead><tr><th>Framework family</th><th>Tagged gates</th><th>% of shipped gates</th><th>Attestation?</th></tr></thead>
<tbody>${frameworkRows}
</tbody></table>
<h2>Top control tags</h2>
<ul>
${tagList}
</ul>
<h2>Evidence links</h2>
<ul>
${evidenceList}
</ul>
<footer><a href="/">Home</a> · <a href="/security">Security questionnaire</a> · <a href="/privacy">Privacy</a> · <a href="/legal">Legal</a> · <a href="/support">Support</a></footer>
</body></html>`;
}

module.exports = {
  UPDATED,
  FRAMEWORK_FAMILIES,
  loadDefaultGates,
  summarizeComplianceCoverage,
  getTrustCenterPack,
  renderTrustCenterHtml,
};
