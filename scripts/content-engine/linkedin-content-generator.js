#!/usr/bin/env node

/**
 * LinkedIn Content Generator for ThumbGate Gates
 *
 * Usage:
 *   node scripts/content-engine/linkedin-content-generator.js
 *   node scripts/content-engine/linkedin-content-generator.js --preview
 *
 * Suggested package.json scripts:
 *   "content:linkedin": "node scripts/content-engine/linkedin-content-generator.js"
 *   "content:linkedin:preview": "node scripts/content-engine/linkedin-content-generator.js --preview"
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Read gate config
const configPath = path.join(__dirname, '../../config/gates/default.json');
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (err) {
  process.stderr.write(`Failed to load gate config from ${configPath}: ${err.message}\n`);
  process.exit(1);
}

// Select 7 diverse gates across severity levels
const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
const gatesBySeverity = {
  critical: [],
  high: [],
  medium: [],
  low: []
};

config.gates.forEach(gate => {
  const severity = gate.severity || 'low';
  if (gatesBySeverity[severity]) {
    gatesBySeverity[severity].push(gate);
  }
});

// Select one from each severity, then fill remaining from largest buckets
const selected = [];
['critical', 'high', 'medium', 'low'].forEach(severity => {
  if (gatesBySeverity[severity].length > 0) {
    selected.push(gatesBySeverity[severity][0]);
  }
});

// Fill remaining slots (7 total) — shuffle with crypto-secure randomness (Fisher-Yates)
const remaining = config.gates.filter(g => !selected.includes(g));
for (let i = remaining.length - 1; i > 0; i--) {
  const j = crypto.randomInt(i + 1);
  [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
}
while (selected.length < 7 && remaining.length > 0) {
  selected.push(remaining.pop());
}

// Generate LinkedIn post content
const posts = selected.map((gate, index) => {
  const hookLines = [
    '🚨 Your AI agents are running without guardrails.',
    '⚠️ One missing gate. One catastrophic mistake.',
    '🛡️ Even the best engineers miss edge cases.',
    '💥 Your deployment pipeline has a blind spot.',
    '🔓 Git operations—unguarded by default.',
    '🎯 Prevention beats firefighting.',
    '⏱️ How fast can your agent destroy a month of work?'
  ];

  const gateDescriptions = {
    'local-only-git-writes': 'Blocks git writes when local-only mode is active, preventing accidental remote pushes during development.',
    'task-scope-required': 'Enforces explicit task scoping before any git, PR, or publish operations can proceed.',
    'protected-file-approval-required': 'Requires human approval before modifying sensitive files like CLAUDE.md, configs, and skills.',
    'gh-pr-create-restricted': 'Restricts PR creation to explicitly approved workflows, preventing unvetted code changes.',
    'gh-pr-merge-restricted': 'Blocks PR merges without explicit permission, enforcing code review discipline.',
    'branch-governance-required': 'Demands branch governance context before release, deploy, or publish actions.',
    'force-push': 'Blocks destructive force-push operations—no exceptions.',
    'protected-branch-push': 'Prevents direct pushes to main/develop. All changes flow through PR review.',
    'release-readiness-required': 'Ensures releases only happen from releasable mainline commits with version alignment.',
    'admin-merge-bypass-blocked': 'Blocks admin merge bypass. Code review gates apply equally to everyone.',
    'push-without-thread-check': 'Forces thread review before pushing—prevents shipping unresolved feedback.',
    'env-file-edit': 'Warns when editing .env files—catches accidental token deletion.',
    'unverified-skill-use': 'Validates skill provenance before delegating to subagents in restricted modes.',
    'production-deploy-approval': 'Requires human sign-off on production deployments.',
    'schema-migration-approval': 'Demands approval for database schema migrations—no surprise breaking changes.',
    'supply-chain-dep-add': 'Audits package.json mutations for typosquatting and suspicious installs.',
    'deny-network-egress': 'Warns on unauthorized egress—catches exfiltration attempts early.'
  };

  const post = `
## Post ${index + 1}: ${gate.id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}

${hookLines[index % hookLines.length]}

${gateDescriptions[gate.id] || `Protects your workflow by ${gate.message.toLowerCase()}`}

The problem? AI agents run autonomously. A single unchecked operation—a force-push, an unapproved deploy, a dependency injection—can unwind days of work in seconds. Traditional CI won't catch it. Your human reviewer might miss it.

The solution? **Gate \`${gate.id}\`** in ThumbGate stops high-risk operations *before* they execute. No second chances. Just prevention.

This isn't about slowing down. It's about building trust in autonomous systems. Every gate is a rule learned from real failures.

🔒 Install ThumbGate today:
\`\`\`bash
npx thumbgate@latest init
\`\`\`

Then add this gate to your config and sleep better.

#AIGovernance #DevTools #AgentSafety #EngineeringTeams

---
`;
  return post;
});

// Generate output filename with today's date
const today = new Date();
const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
const outputDir = path.join(__dirname, 'output');
const outputFile = path.join(outputDir, `linkedin-posts-${dateStr}.md`);

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Generate markdown content
const markdown = `# LinkedIn Content: ThumbGate Gates (${dateStr})

Generated from: \`config/gates/default.json\`
Gate count in config: ${config.gates.length}
Posts generated: ${selected.length}

---
${posts.join('\n')}
`;

// Output or write file
const preview = process.argv.includes('--preview');
if (preview) {
  console.log(markdown);
  console.log(`\n✅ Preview mode (${selected.length} posts)`);
} else {
  fs.writeFileSync(outputFile, markdown, 'utf8');
  console.log(`✅ Generated ${selected.length} LinkedIn posts to: ${outputFile}`);
  console.log(`   Severities: ${selected.map(g => g.severity).sort().join(', ')}`);
  console.log(`   Gates: ${selected.map(g => g.id).join(', ')}`);
}
