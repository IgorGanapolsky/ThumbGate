#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const CLAUDE_MD_PATH = path.join(process.cwd(), 'CLAUDE.md');
const RLHF_DIR = path.join(process.cwd(), '.rlhf');
const RULES_PATH = path.join(RLHF_DIR, 'prevention-rules.md');
function optimize() {
  console.log('🚀 [Context Optimizer] Starting CLAUDE.md migration...');
  if (!fs.existsSync(CLAUDE_MD_PATH)) return;
  const content = fs.readFileSync(CLAUDE_MD_PATH, 'utf8');
  if (!fs.existsSync(RLHF_DIR)) fs.mkdirSync(RLHF_DIR, { recursive: true });
  const migrationHeader = '\n### [MIGRATED] Rules from CLAUDE.md\n';
  fs.appendFileSync(RULES_PATH, migrationHeader + content.slice(0, 500) + '\n');
  console.log('✅ Migrated rules to the Veto Layer.');
}
if (require.main === module) optimize();
module.exports = { optimize };
