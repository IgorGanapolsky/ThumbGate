#!/usr/bin/env node
/**
 * Agent Development Kit (ADK) Memory Consolidator
 * 
 * 'Always-On' background service that reads disparate feedback logs and uses 
 * Gemini (Flash-Lite/Flash) to actively consolidate, compress, and dream up 
 * generalized prevention rules. This moves the system from 'passive logging' 
 * to 'active semantic memory consolidation'.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const PROJECT_ROOT = path.join(__dirname, '..');
const { getFeedbackPaths, readJSONL } = require('./feedback-loop');

// Keep track of the last processed ID to avoid re-consolidating the exact same logs
const STATE_FILE = process.env.ADK_STATE_FILE || path.join(PROJECT_ROOT, '.rlhf', 'adk-state.json');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    } catch {
      return { lastProcessedFeedbackId: null };
    }
  }
  return { lastProcessedFeedbackId: null };
}

function saveState(state) {
  ensureDir(path.dirname(STATE_FILE));
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function consolidateMemory() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[ADK Consolidator] GEMINI_API_KEY is not set. Skipping active consolidation.');
    return;
  }

  const ai = new GoogleGenAI({ apiKey });
  const paths = getFeedbackPaths();
  const state = loadState();

  const allLogs = readJSONL(paths.FEEDBACK_LOG_PATH);
  
  if (allLogs.length === 0) {
    console.log('[ADK Consolidator] No logs to consolidate.');
    return;
  }

  // Find where we left off
  let newLogs = [];
  if (state.lastProcessedFeedbackId) {
    const lastIdx = allLogs.findIndex(l => l.id === state.lastProcessedFeedbackId);
    if (lastIdx !== -1) {
      newLogs = allLogs.slice(lastIdx + 1);
    } else {
      // If we can't find it (log rotation?), just take the last 50
      newLogs = allLogs.slice(-50);
    }
  } else {
    // First time running, process up to last 50 entries
    newLogs = allLogs.slice(-50);
  }

  if (newLogs.length === 0) {
    console.log('[ADK Consolidator] No new logs since last consolidation cycle.');
    return;
  }

  console.log(`[ADK Consolidator] Found ${newLogs.length} new feedback events. Activating Gemini for semantic consolidation...`);

  const prompt = `
You are the Agent Development Kit (ADK) 'Always-On' Memory Consolidator.
Your job is to read the raw, disparate feedback logs of an AI agent and synthesize them into high-level, generalized prevention rules and learned intuitions.
Unlike standard systems that just count regex matches, you must semantically connect different failures (e.g., an API timeout and a missing import might both stem from 'rushing execution without verifying environment').

Here are the latest feedback events (JSON):
${JSON.stringify(newLogs.map(l => ({ signal: l.signal, context: l.context, tags: l.tags, whatWentWrong: l.whatWentWrong, whatWorked: l.whatWorked })), null, 2)}

Existing Prevention Rules (if any):
${fs.existsSync(paths.PREVENTION_RULES_PATH) ? fs.readFileSync(paths.PREVENTION_RULES_PATH, 'utf-8').slice(0, 2000) : 'None yet.'}

Output ONLY a valid JSON object with the following structure, representing the new synthesized insights:
{
  "consolidatedInsights": [
    {
      "pattern": "Description of the underlying behavioral flaw or success pattern you detected.",
      "rule": "A clear, actionable directive starting with 'ALWAYS' or 'NEVER' that should be added to prevention rules.",
      "severity": "critical|high|medium|low"
    }
  ],
  "reasoning": "A short summary of how you connected the dots between these logs."
}
`;

  try {
    // We use gemini-2.5-flash as the proxy for Flash-Lite/Flash efficiency
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    const result = JSON.parse(response.text);
    console.log(`[ADK Consolidator] Consolidation complete. Reasoning: ${result.reasoning}`);

    if (result.consolidatedInsights && result.consolidatedInsights.length > 0) {
      appendRules(result.consolidatedInsights, paths.PREVENTION_RULES_PATH);
    }

    // Update state
    state.lastProcessedFeedbackId = newLogs[newLogs.length - 1].id;
    saveState(state);

  } catch (err) {
    console.error('[ADK Consolidator] Consolidation failed:', err.message);
  }
}

function appendRules(insights, rulesPath) {
  let existingContent = '';
  if (fs.existsSync(rulesPath)) {
    existingContent = fs.readFileSync(rulesPath, 'utf-8');
  } else {
    existingContent = '# Prevention Rules\n\nGenerated from active semantic memory consolidation.\n\n';
  }

  let newRulesBlock = '\n## ADK Semantic Consolidations\n';
  const timestamp = new Date().toISOString();
  insights.forEach(insight => {
    newRulesBlock += `- [${insight.severity.toUpperCase()}] **${insight.pattern}**\n  - Rule: ${insight.rule} *(Consolidated at ${timestamp})*\n`;
  });

  const updatedContent = existingContent + newRulesBlock;
  ensureDir(path.dirname(rulesPath));
  fs.writeFileSync(rulesPath, updatedContent);
  console.log(`[ADK Consolidator] Appended ${insights.length} new consolidated rules to ${rulesPath}`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const isWatchMode = args.includes('--watch');

  if (isWatchMode) {
    console.log('[ADK Consolidator] Started in Always-On Watch Mode (interval: 5 minutes)');
    consolidateMemory(); // Run once immediately
    setInterval(() => {
      consolidateMemory();
    }, 5 * 60 * 1000); // Check every 5 minutes
  } else {
    consolidateMemory().then(() => {
      console.log('[ADK Consolidator] Cycle finished.');
      process.exit(0);
    });
  }
}

module.exports = { consolidateMemory };
