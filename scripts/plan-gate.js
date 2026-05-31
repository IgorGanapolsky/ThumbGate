#!/usr/bin/env node
'use strict';

/**
 * Plan Gate — implementing the CodeRabbit "Planning-First" pattern.
 *
 * Intercepts high-risk tool calls and ensures a structured 'PLAN.md' 
 * exists and is being followed. Surfaces implicit assumptions before
 * execution begins.
 */

const fs = require('fs');
const path = require('path');

const RISK_TOOLS = ['Bash', 'Write', 'Edit', 'Deploy'];

/**
 * Evaluates the planning state for the current tool call.
 */
function evaluatePlanGate(toolName, toolInput, options = {}) {
  if (!RISK_TOOLS.includes(toolName)) return null;

  const projectRoot = options.projectRoot || process.cwd();
  const planPath = path.join(projectRoot, 'PLAN.md');

  // Tier 1: Existence Check
  if (!fs.existsSync(planPath)) {
    return {
      decision: 'warn',
      gate: 'plan-gate-missing',
      message: '⚠️ THUMBGATE: High-risk tool call without a PLAN.md. Please create a plan documenting your intent and assumptions.',
      severity: 'high'
    };
  }

  // Tier 2: Alignment Check (Simple)
  const planContent = fs.readFileSync(planPath, 'utf8');
  const action = toolName === 'Bash' ? toolInput.command : toolInput.filePath;
  
  if (action && !planContent.toLowerCase().includes(path.basename(action).toLowerCase())) {
    return {
      decision: 'warn',
      gate: 'plan-gate-drift',
      message: `⚠️ THUMBGATE: Strategic Drift detected. The action "${action}" is not mentioned in your PLAN.md.`,
      severity: 'medium'
    };
  }

  // Tier 3: Implicit Assumption Extraction
  const assumptions = extractAssumptions(planContent);
  if (assumptions.length > 0) {
    return {
      decision: 'warn',
      gate: 'plan-gate-assumptions',
      message: '🔍 THUMBGATE: Explicitly verify these implicit assumptions before proceeding:\n- ' + assumptions.join('\n- '),
      severity: 'medium'
    };
  }

  return null;
}

/**
 * Scans plan content for "Assumes" or "Implicit" keywords.
 */
function extractAssumptions(content) {
  const lines = content.split('\n');
  const assumptions = [];
  const regex = /(?:assume|assumption|implicit|pre-requisite|depends on)s?[:\-]?\s*(.*)/i;
  
  for (const line of lines) {
    const match = line.match(regex);
    if (match && match[1].trim()) {
      assumptions.push(match[1].trim());
    }
  }
  return assumptions.slice(0, 5);
}

module.exports = {
  evaluatePlanGate,
  extractAssumptions
};
