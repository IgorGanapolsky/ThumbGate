#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const CLAUDE_MD_PATH = path.join(process.cwd(), 'CLAUDE.md');
const THUMBGATE_DIR = path.join(process.cwd(), '.thumbgate');
const RULES_PATH = path.join(THUMBGATE_DIR, 'prevention-rules.md');
function optimize() {
  console.log('🚀 [Context Optimizer] Starting CLAUDE.md migration...');
  if (!fs.existsSync(CLAUDE_MD_PATH)) return;
  const content = fs.readFileSync(CLAUDE_MD_PATH, 'utf8');
  if (!fs.existsSync(THUMBGATE_DIR)) fs.mkdirSync(THUMBGATE_DIR, { recursive: true });
  const migrationHeader = '\n### [MIGRATED] Rules from CLAUDE.md\n';
  fs.appendFileSync(RULES_PATH, migrationHeader + content.slice(0, 500) + '\n');
  console.log('✅ Migrated rules to the Pre-Action Gates.');
}
if (require.main === module) optimize();
module.exports = { optimize };
