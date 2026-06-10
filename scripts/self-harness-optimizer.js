#!/usr/bin/env node
/**
 * Self-Harness Optimizer
 * 
 * Implements the continuous self-improving loop from the "Self-Harness" paradigm (arXiv:2606.09498):
 * 1. Weakness Mining: Reads auto-promoted gates from repeated failures (.thumbgate/auto-promoted-gates.json)
 * 2. Harness Proposal: Generates technical rules and injects them directly into system prompts (AGENTS.md & GEMINI.md)
 * 3. Validation: Runs quick test suites to ensure prompt updates do not introduce regressions.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const GATES_PATH = path.join(ROOT, '.thumbgate', 'auto-promoted-gates.json');
const AGENTS_MD_PATH = path.join(ROOT, 'AGENTS.md');
const GEMINI_MD_PATH = path.join(ROOT, 'GEMINI.md');

const RULE_SECTION_HEADER = '## 🛡️ Self-Harness Prevention Rules (Auto-Generated)';

function readGates() {
  if (!fs.existsSync(GATES_PATH)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(GATES_PATH, 'utf-8'));
    return Array.isArray(data.gates) ? data.gates : [];
  } catch (err) {
    console.error('Failed to parse auto-promoted-gates.json:', err);
    return [];
  }
}

function generateRuleSection(gates) {
  if (gates.length === 0) {
    return `${RULE_SECTION_HEADER}\n\n- No active auto-generated prevention rules at this time.\n`;
  }

  const lines = [
    RULE_SECTION_HEADER,
    '',
    '> [!IMPORTANT]',
    '> The following rules were automatically derived from execution failures and thumbs-down feedback.',
    '> You MUST follow these constraints strictly to prevent repeated errors.',
    ''
  ];

  gates.forEach(gate => {
    // Extract rule message or pattern
    const ruleText = gate.message ? gate.message.replace('Automatically blocked due to repeated failures: ', '') : `NEVER match pattern: ${gate.pattern}`;
    lines.push(`- **Rule [${gate.id}]**: ${ruleText}`);
  });

  lines.push('');
  return lines.join('\n');
}

function updatePromptFile(filePath, newSection) {
  if (!fs.existsSync(filePath)) {
    console.warn(`Prompt file not found: ${filePath}`);
    return null;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const backup = content;

  let newContent;
  const index = content.indexOf(RULE_SECTION_HEADER);
  if (index !== -1) {
    // Replace existing section till the end or next major section
    const before = content.substring(0, index);
    const remainder = content.substring(index);
    
    // Find next header (e.g. '## ')
    const nextHeaderIndex = remainder.slice(RULE_SECTION_HEADER.length).search(/\n## /);
    if (nextHeaderIndex !== -1) {
      const after = remainder.substring(RULE_SECTION_HEADER.length + nextHeaderIndex + 1);
      newContent = before + newSection + after;
    } else {
      newContent = before + newSection;
    }
  } else {
    // Append to the end of the file
    newContent = content.trim() + '\n\n' + newSection;
  }

  fs.writeFileSync(filePath, newContent, 'utf-8');
  return backup;
}

function validateAndRollback(backups) {
  console.log('Running quick validation suite...');
  try {
    execSync('npm run verify:quick', { cwd: ROOT, stdio: 'inherit' });
    console.log('✅ Validation succeeded! No regressions detected.');
    
    // Auto-commit prompt updates to git if validation succeeds
    try {
      execSync('git add AGENTS.md GEMINI.md', { cwd: ROOT, stdio: 'ignore' });
      execSync('git commit -m "chore(prompt): auto-update self-harness prevention rules [auto-commit]"', { cwd: ROOT, stdio: 'ignore' });
      console.log('✅ Prompt updates auto-committed to git.');
    } catch (gitErr) {
      console.warn('⚠️ Git commit failed or no changes to commit:', gitErr.message);
    }
    
    return true;
  } catch (err) {
    console.error('❌ Validation failed! Reverting prompt changes.');
    for (const [filePath, backupContent] of Object.entries(backups)) {
      if (backupContent) {
        fs.writeFileSync(filePath, backupContent, 'utf-8');
        console.log(`Reverted: ${path.basename(filePath)}`);
      }
    }
    return false;
  }
}

function main() {
  console.log('Mining weaknesses from auto-promoted gates...');
  const gates = readGates();
  console.log(`Found ${gates.length} active gates.`);

  const newSection = generateRuleSection(gates);
  const backups = {};

  console.log('Updating AGENTS.md...');
  backups[AGENTS_MD_PATH] = updatePromptFile(AGENTS_MD_PATH, newSection);

  console.log('Updating GEMINI.md...');
  backups[GEMINI_MD_PATH] = updatePromptFile(GEMINI_MD_PATH, newSection);

  const success = validateAndRollback(backups);
  if (!success) {
    process.exit(1);
  }
  console.log('Self-Harness optimization complete.');
}

if (require.main === module) {
  main();
}
