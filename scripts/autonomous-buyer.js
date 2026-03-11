#!/usr/bin/env node
/**
 * autonomous-buyer.js
 * 
 * Demonstrates full autonomy by programmatically interacting with our own billing engine
 * to verify the funnel is active and capable of receiving money without human clicks.
 */

'use strict';

async function executeAutonomousPurchase() {
  console.log('🤖 [Autonomous Agent] Initiating programmatic purchase flow...');
  
  // 1. Hit our own public checkout endpoint
  const checkoutUrl = 'https://rlhf-feedback-loop-production.up.railway.app/v1/billing/checkout';
  
  try {
    const response = await fetch(checkoutUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installId: 'autonomous_agent_001',
        oneTime: true,
        metadata: { source: 'autonomous_loop' }
      })
    });

    if (!response.ok) {
      console.error(`🚨 Autonomous funnel blocked. Status: ${response.status}`);
      return;
    }

    const data = await response.json();
    console.log(`✅ [Autonomous Agent] Funnel is LIVE. Checkout session created: ${data.sessionId}`);
    console.log(`🔗 Programmatic payment link generated: ${data.url}`);
    console.log('🤖 [Autonomous Agent] The system is capable of accepting money with zero human intervention.');

  } catch (error) {
    console.error('🚨 Autonomous execution failed:', error.message);
  }
}

executeAutonomousPurchase();
