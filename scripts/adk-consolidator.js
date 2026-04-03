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
const { compactContext } = require('./context-engine');
const { resolveModelRole } = require('./local-model-profile');
const { trackEvent, shouldInjectReminder, injectReminder } = require('./reminder-engine');
const { validateApiKey } = require('./billing');

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

const { createRuleProposal, createReasoningTrace } = require('./a2ui-engine');

function buildFakeConsolidation(anchorLogs, newLogs) {
  const combined = [...anchorLogs, ...newLogs].filter(Boolean);
  const connectedLogIds = combined.slice(0, 3).map((log) => log.id).filter(Boolean);
  const issueHints = combined
    .map((log) => log.whatWentWrong || log.context || '')
    .map((text) => String(text).trim())
    .filter(Boolean);

  const primaryHint = issueHints[0] || 'Environment and rollout checks were skipped';
  return {
    consolidatedInsights: [
      {
        pattern: primaryHint,
        rule: 'ALWAYS verify environment, approvals, and rollout prerequisites before executing workflow changes',
        severity: 'high',
        connectedLogIds,
      },
    ],
    a2uiPayload: {
      reasoningGraph: {
        summary: 'Synthetic consolidation used for hermetic test mode.',
        connections: connectedLogIds.slice(1).map((id) => ({
          from: connectedLogIds[0],
          to: id,
          label: 'Shared failure pattern',
        })),
      },
    },
  };
}

async function consolidateMemory() {
  const requestedFakeConsolidation = process.env.ADK_FAKE_CONSOLIDATION === 'true';
  const useFakeConsolidation = requestedFakeConsolidation && process.env.NODE_ENV === 'test';
  const apiKey = process.env.GEMINI_API_KEY;
  if (requestedFakeConsolidation && !useFakeConsolidation) {
    console.warn('[ADK Consolidator] Ignoring ADK_FAKE_CONSOLIDATION outside test mode.');
  }
  if (!useFakeConsolidation && !apiKey) {
    console.warn('[ADK Consolidator] GEMINI_API_KEY is not set. Skipping active consolidation.');
    return;
  }

  const ai = useFakeConsolidation ? null : new GoogleGenAI({ apiKey });
  const paths = getFeedbackPaths();
  const state = loadState();

  const allLogs = readJSONL(paths.FEEDBACK_LOG_PATH);
  
  if (allLogs.length === 0) {
    console.log('[ADK Consolidator] No logs to consolidate.');
    return;
  }

  // 1. Anchor-Memories: Always include the first 5 "foundational" logs of the session.
  // These act as 'attention sinks' that provide global context and numerical anchors
  // for the model's reasoning stability.
  const anchorLogs = allLogs.slice(0, 5);

  // 2. Incremental Window: Find where we left off
  const hasPriorState = Boolean(state.lastProcessedFeedbackId);
  let newLogs = [];
  if (hasPriorState) {
    const lastIdx = allLogs.findIndex(l => l.id === state.lastProcessedFeedbackId);
    if (lastIdx !== -1) {
      newLogs = allLogs.slice(lastIdx + 1);
    } else {
      newLogs = allLogs.slice(-50);
    }
  } else {
    newLogs = allLogs.slice(-50);
  }

  // Filter anchors out of newLogs if they overlap to save tokens
  const rawNewLogs = newLogs.filter(nl => !anchorLogs.some(al => al.id === nl.id));

  if (rawNewLogs.length === 0 && anchorLogs.length > 0 && hasPriorState) {
    console.log('[ADK Consolidator] No new logs since last consolidation cycle.');
    return;
  }

  // Adaptive context compaction: reduce prompt size before sending to Gemini
  const compactionResult = compactContext(rawNewLogs, anchorLogs, { windowSize: 30, perEntryMaxChars: 512 });
  const filteredNewLogs = compactionResult.entries.filter(e => !anchorLogs.some(a => a.id === e.id));
  if (compactionResult.compacted) {
    console.log(`[ADK Consolidator] Context compacted: removed ${compactionResult.removedCount} entries (stage ${compactionResult.stage}).`);
  }

  // Resolve model via role router instead of hardcoding
  const modelConfig = resolveModelRole('normal');
  const activationLabel = useFakeConsolidation ? `Gemini test stub (${modelConfig.model})` : `Gemini (${modelConfig.model})`;
  console.log(`[ADK Consolidator] Activating ${activationLabel} with ${anchorLogs.length} anchors and ${filteredNewLogs.length} new events...`);

  const prompt = `
You are the Agent Development Kit (ADK) 'Always-On' Memory Consolidator.
Synthesize the latest feedback into generalized prevention rules AND dynamic A2UI components.

Foundational Anchors (Numerical Sinks):
${JSON.stringify(anchorLogs.map(l => ({ id: l.id, signal: l.signal, context: l.context, whatWentWrong: l.whatWentWrong })), null, 2)}

Latest Feedback Events (Spikes):
${JSON.stringify(filteredNewLogs.map(l => ({ id: l.id, signal: l.signal, context: l.context, whatWentWrong: l.whatWentWrong })), null, 2)}

Output ONLY valid JSON:
{
  "consolidatedInsights": [
    {
      "pattern": "Underlying flaw",
      "rule": "ALWAYS/NEVER directive",
      "severity": "critical|high|medium|low",
      "connectedLogIds": ["fb_1", "fb_2"]
    }
  ],
  "a2uiPayload": {
    "reasoningGraph": {
      "summary": "Synthesis summary",
      "connections": [{"from": "fb_1", "to": "fb_2", "label": "Same environment issue"}]
    }
  }
}
`;

  try {
    const result = useFakeConsolidation
      ? buildFakeConsolidation(anchorLogs, filteredNewLogs)
      : JSON.parse((await ai.models.generateContent({
        model: modelConfig.model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      })).text);
    console.log('[ADK Consolidator] Consolidation complete.');

    if (result.consolidatedInsights) {
      // Append to markdown (legacy fallback)
      appendRules(result.consolidatedInsights, paths.PREVENTION_RULES_PATH);

      // Track guardrail spikes and emit reminders when threshold is met
      const criticalInsights = result.consolidatedInsights.filter(
        i => i.severity === 'critical' || i.severity === 'high',
      );
      if (criticalInsights.length > 0) {
        trackEvent('guardrail_spike');
        if (shouldInjectReminder('guardrail_spike')) {
          const topRule = criticalInsights[0].rule;
          const reminderTurns = injectReminder([], 'guardrail_spike', { rule: topRule });
          const reminderPath = path.join(PROJECT_ROOT, '.rlhf', `reminder_${Date.now()}.json`);
          fs.writeFileSync(reminderPath, JSON.stringify(reminderTurns[0], null, 2));
          console.log(`[ADK Consolidator] Emitted system reminder: ${reminderPath}`);
        }
      }

      // Emit A2UI components (New Model)
      result.consolidatedInsights.forEach(insight => {
        const proposal = createRuleProposal(insight.pattern, insight.rule, insight.severity);
        const a2uiPath = path.join(PROJECT_ROOT, '.rlhf', `a2ui_proposal_${Date.now()}.json`);
        fs.writeFileSync(a2uiPath, JSON.stringify(proposal, null, 2));
        console.log(`[ADK Consolidator] Emitted A2UI Proposal: ${a2uiPath}`);
      });
    }

    state.lastProcessedFeedbackId = newLogs[newLogs.length - 1].id;
    saveState(state);

    // Hosted consolidation can run with a valid cloud key, but it is not metered usage billing.
    const cloudKey = process.env.RLHF_API_KEY;
    if (cloudKey) {
      const validation = validateApiKey(cloudKey);
      if (validation.valid) {
        console.log(`[ADK Consolidator] Hosted key validated for customer: ${validation.customerId}`);
      }
    }

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
