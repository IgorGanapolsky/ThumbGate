#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');

function getResendKey() {
  try {
    return execSync('security find-generic-password -s "RESEND_API_KEY" -w', { encoding: 'utf-8' }).trim();
  } catch (err) {
    return process.env.RESEND_API_KEY || '';
  }
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const resendKey = getResendKey();

  if (!resendKey && !isDryRun) {
    console.error('Error: RESEND_API_KEY not found in Keychain or environment.');
    process.exit(1);
  }

  const proposal = {
    to: 'iganapolsky@gmail.com',
    clientEmail: 'nandanadileep29@gmail.com',
    subject: 'Proposal: ThumbGate Outcome-Based AI Reliability Gateways for Mycelium (Nandana Dileep)',

    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; color: #1a1a1a; line-height: 1.6;">
        <h2 style="color: #0f172a;">Hi Nandana,</h2>

        <p>Following up on your interest in durable AI-agent side-effect transitions and hard-block reconciliation for <strong>Mycelium</strong>, I've put together a structured, outcome-based pricing framework designed to deliver production-grade reliability without ongoing engineering bloat.</p>

        <h3 style="color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">Outcome Packages for Mycelium</h3>

        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
          <h4 style="margin-top: 0; color: #0f172a;">Option 1: Workflow Hardening Diagnostic — $499 (One-Time)</h4>
          <p><strong>Deliverable:</strong> Complete side-effect audit, failure mapping, block/warn matrix, and proof packet for one core Mycelium transition path within 2 business days.</p>
          <a href="https://thumbgate.ai/diagnostic?utm_source=gmail&utm_medium=proposal&utm_campaign=mycelium_proposal" style="display: inline-block; background: #0f172a; color: #ffffff; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-weight: 600;">Start Diagnostic ($499)</a>
        </div>

        <div style="background: #eff6ff; border: 2px solid #3b82f6; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
          <span style="background: #3b82f6; color: #ffffff; text-transform: uppercase; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px;">Recommended</span>
          <h4 style="margin-top: 8px; color: #1e3a8a;">Option 2: Hardening Sprint — $1,500 (One-Time)</h4>
          <p><strong>Deliverable:</strong> Hands-on implementation of local interdiction gates, zero-secret leak protection, 65% token footprint compaction, regression test suite, and rollback runbooks.</p>
          <a href="https://thumbgate.ai/go/sprint?utm_source=gmail&utm_medium=proposal&utm_campaign=mycelium_proposal" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-weight: 600;">Lock Hardening Sprint ($1,500)</a>
        </div>

        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
          <h4 style="margin-top: 0; color: #0f172a;">Option 3: Reliability & Operations Engine — $1,499 / month</h4>
          <p><strong>Deliverable:</strong> Continuous governance, monthly proof review packets, auto-promoted DPO prevention rules, priority SLAs, and managed adapter updates for up to 5 agent workflows.</p>
          <a href="https://thumbgate.ai/pricing?utm_source=gmail&utm_medium=proposal&utm_campaign=mycelium_proposal" style="display: inline-block; background: #0f172a; color: #ffffff; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-weight: 600;">View Operations Retainer</a>
        </div>

        <p>Let me know which option aligns best with your roadmap, or if you'd like to jump on a quick 15-minute call to review the diagnostic scope.</p>

        <p style="margin-top: 32px; font-size: 14px; color: #64748b;">
          Best regards,<br>
          <strong>Igor Ganapolsky</strong><br>
          Founder & CTO, ThumbGate / hermes.ai<br>
          <a href="https://thumbgate.ai" style="color: #2563eb;">https://thumbgate.ai</a>
        </p>
      </div>
    `,
  };

  if (isDryRun) {
    console.log('--- DRY RUN: PROPOSAL EMAIL ---');
    console.log(`To: ${proposal.to}`);
    console.log(`Subject: ${proposal.subject}`);
    console.log('Body HTML generated cleanly.');
    return;
  }

  console.log(`Sending proposal email to ${proposal.to} via Resend...`);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Igor Ganapolsky <onboarding@resend.dev>',
      to: [proposal.to],
      subject: proposal.subject,
      html: proposal.html,
    }),
  });

  const resData = await response.json();
  if (!response.ok) {
    console.error('Failed to send email:', resData);
    process.exit(1);
  }

  console.log('Successfully dispatched proposal email! Resend ID:', resData.id);
}

main().catch(console.error);
