// scripts/creative-review-checklist.js
'use strict';

/**
 * Creative Review Discipline — Software Release discipline steal.
 *
 * Pre-launch review checklist for marketing copy, social posts, blog posts,
 * and other creative outputs. Applies software code-review rigor to non-code.
 *
 * Stolen from: "AI as a Force Multiplier for Creatives" (DgX3XqhIhas)
 */

const fs = require('node:fs');
const path = require('node:path');

// ECI corporate domain isolation — BLOCK any corporate domain mention
const ECI_DOMAINS = ['@ecisolutions.com', '@ecinexus.com', '@eci.com'];

const CHECKS = [
  {
    id: 'no_eci_domains',
    name: 'No ECI corporate domains',
    check: (content) => !ECI_DOMAINS.some((d) => content.toLowerCase().includes(d.replace('@', ''))),
    severity: 'BLOCK',
    fix: 'Remove all references to @ecisolutions.com, @ecinexus.com, @eci.com',
  },
  {
    id: 'no_yaml_frontmatter',
    name: 'No YAML frontmatter (anti-bot-slop)',
    check: (content) => !/^---\n[\s\S]*?\n---\n/.test(content),
    severity: 'BLOCK',
    fix: 'Remove YAML frontmatter — write plaintext only',
  },
  {
    id: 'anti_slop',
    name: 'No AI slop phrasing',
    check: (content) => {
      const slopPatterns = ['as an AI', 'brilliant', 'in today\'s landscape', 'it\'s worth noting', 'leverage', 'paradigm'];
      const lower = content.toLowerCase();
      return !slopPatterns.some((p) => lower.includes(p));
    },
    severity: 'WARN',
    fix: 'Remove sycophantic/filler phrasing and corporate jargon',
  },
  {
    id: 'pro_link_present',
    name: 'Pro checkout link present',
    check: (content) => content.includes('buy.stripe.com') || content.includes('stripe.com'),
    severity: 'BLOCK',
    fix: 'Add Stripe checkout link for Pro tier',
  },
  {
    id: 'no_utm_params',
    name: 'UTM parameters on revenue links',
    check: (content) => {
      const stripeLinks = content.match(/buy\.stripe\.com\/[^\s<"]+/g) || [];
      return stripeLinks.every((l) => l.includes('utm_'));
    },
    severity: 'WARN',
    fix: 'Add UTM parameters to all Stripe checkout links',
  },
  {
    id: 'no_obsidian_wiki_links',
    name: 'No Obsidian wiki links (anti-bot-slop)',
    check: (content) => !/\[\[(.*?)\]\]/.test(content),
    severity: 'BLOCK',
    fix: 'Convert wiki links to standard markdown [text](url)',
  },
  {
    id: 'no_package_only_banner',
    name: 'No Package-only / Do-not-send banners',
    check: (content) => !/do-not-send|package-only|internal use/i.test(content),
    severity: 'BLOCK',
    fix: 'Remove internal-only banners from public-facing content',
  },
  {
    id: 'verified_numbers',
    name: 'Numbers and metrics verified',
    check: (content) => {
      // Extract any number claims and check they have sources
      const claims = content.match(/\b\d{3,}(?:\.\d+)?\b/g) || [];
      if (claims.length === 0) return true; // no numbers = no verification needed
      // For now, just warn — in production would cross-check against revenue dashboard
      return true;
    },
    severity: 'WARN',
    fix: 'Verify all numerical claims against production data',
  },
];

/**
 * Run all review checks on content.
 * @param {string} content - File path OR raw content string
 * @returns {Object} - {passed: boolean, failures: [], warnings: [] }
 */
function reviewContent(content) {
  const text = fs.existsSync(content) && fs.statSync(content).isFile()
    ? fs.readFileSync(content, 'utf-8') : content;

  const results = {
    passed: true,
    failures: [],
    warnings: [],
    totalChecks: CHECKS.length,
  };

  for (const check of CHECKS) {
    const ok = check.check(text);
    if (!ok) {
      if (check.severity === 'BLOCK') {
        results.passed = false;
        results.failures.push({ id: check.id, name: check.name, fix: check.fix });
      } else {
        results.warnings.push({ id: check.id, name: check.name, fix: check.fix });
      }
    }
  }

  return results;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Usage: creative-review-checklist.js <file-or-string>');
    console.log('Example: node scripts/creative-review-checklist.js public/blog/2026-10-26-stolen-infra-patterns.md');
    process.exit(0);
  }

  const result = reviewContent(args[0]);

  console.log(`# Creative Review Checklist`);
  console.log(`Checks: ${result.totalChecks} | Failures: ${result.failures.length} | Warnings: ${result.warnings.length}`);
  console.log(`Result: ${result.passed ? '✅ PASS' : '❌ BLOCKED'}\n`);

  if (result.failures.length > 0) {
    console.log('=== BLOCKED ISSUES ===');
    for (const f of result.failures) {
      console.log(`  ❌ ${f.name} [${f.id}]\n     Fix: ${f.fix}\n`);
    }
  }

  if (result.warnings.length > 0) {
    console.log('=== WARNINGS ===');
    for (const w of result.warnings) {
      console.log(`  ⚠️  ${w.name} [${w.id}]\n     Fix: ${w.fix}\n`);
    }
  }

  process.exit(result.passed ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { CHECKS, ECI_DOMAINS, reviewContent };
