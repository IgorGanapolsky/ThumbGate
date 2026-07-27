#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { captureFeedback, getFeedbackPaths, readJSONL } = require('./feedback-loop');

const SEARCH_DIRS = [
  path.join(process.cwd(), 'memory'),
  path.join(process.cwd(), '.thumbgate'),
  process.cwd(),
  path.join(process.cwd(), '..'),
  path.join(process.cwd(), '..', 'memory'),
];

function ingestFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  const filename = path.basename(filePath);
  
  let signal = 'up';
  if (filename.includes('mistake') || content.includes('MISTAKE:')) signal = 'down';

  const result = captureFeedback({
    signal,
    context: content.slice(0, 500),
    whatWorked: signal === 'up' ? content : undefined,
    whatWentWrong: signal === 'down' ? content : undefined,
    reviewOrigin: 'imported',
    tags: ['manual-ingest', 'markdown-migration'],
  });

  if (result.accepted) {
    console.log(`✓ Ingested manual feedback: ${filename}`);
    fs.renameSync(filePath, `${filePath}.ingested`);
  }
}

function run() {
  const paths = getFeedbackPaths();
  const existingMemories = readJSONL(paths.MEMORY_LOG_PATH);
  const existingContent = new Set(existingMemories.map(m => m.content || m.submittedContext));

  for (const dir of SEARCH_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.startsWith('feedback_') && f.endsWith('.md'));
    for (const file of files) {
      const filePath = path.join(dir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      if (existingContent.has(content)) {
        fs.renameSync(filePath, `${filePath}.ingested`);
        continue;
      }
      ingestFile(filePath);
    }
  }
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  run();
}
