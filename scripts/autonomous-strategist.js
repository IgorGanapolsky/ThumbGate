#!/usr/bin/env node
/**
 * autonomous-strategist.js
 * 
 * Implements "Planning-Based" AI.
 * First reasons about the system state, then constructs a plan, then acts.
 */

'use strict';

const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { withReasoningPrompt } = require('./code-reasoning');
const { getBillingSummary } = require('./billing');

async function generateStrategy() {
  console.log('🧠 [Strategist Agent] Analyzing current system state and billing control plane...');

  const summary = getBillingSummary();

  const rawPrompt = `
    System State:
    - Billing Coverage: ${summary.coverage.source}
    - Booked Revenue Tracking: ${summary.coverage.tracksBookedRevenue ? 'enabled' : 'not yet instrumented'}
    - Funnel Stage Counts: acquisition=${summary.funnel.stageCounts.acquisition}, activation=${summary.funnel.stageCounts.activation}, paid=${summary.funnel.stageCounts.paid}
    - First Paid Event At: ${summary.funnel.firstPaidAt || 'none'}
    - Last Paid Event: ${summary.funnel.lastPaidEvent ? summary.funnel.lastPaidEvent.event : 'none'}
    - Active Keys: ${summary.keys.active}
    - Active Customers: ${summary.keys.activeCustomers}
    - Total Usage Count: ${summary.keys.totalUsage}
    - Key Sources: ${JSON.stringify(summary.keys.bySource)}
    - Infrastructure: Stripe Live, AWS Handshake verified, Perplexity Max SEO injected.
    - Active Channels: X.com (17M impressionsLever), GitHub (Always-On Loop).
    - Latest Milestone: Pro plan at $29/mo recurring.

    Goal: Capture the first real external paid event in the next 60 minutes.

    TASKS:
    1. Reason about the current bottleneck.
    2. Construct a 3-step execution plan for the session.
    3. Identify the highest-ROI message to dispatch to X.com.
  `;

  const prompt = withReasoningPrompt(rawPrompt, 'Chief Strategy Officer');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-3-flash-preview"
    });
    const result = await model.generateContent(prompt);
    const strategy = result.response.text().trim();
    const strategyPath = path.join(__dirname, '../.planning/STATE.md');
    
    fs.writeFileSync(strategyPath, `# 🧠 Autonomous Strategy: ${new Date().toLocaleDateString()}\n\n${strategy}`);
    console.log('✅ Strategy generated and saved to .planning/STATE.md');
    return strategy;

  } catch (err) {
    console.error('🚨 Strategist failed:', err.message);
  }
}

generateStrategy();
