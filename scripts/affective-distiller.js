#!/usr/bin/env node
'use strict';

const AFFECTIVE_CONCEPTS = {
  FRUSTRATION: {
    patterns: [/\bstupid\b/i, /\bagain\b/i, /\bwrong\b/i, /\bwhy\b.*\?/i],
    gateMultiplier: 1.5,
    lessonWeight: 2.0
  },
  URGENCY: {
    patterns: [/\basap\b/i, /\bnow\b/i, /\burgent\b/i, /\bprod\b/i],
    gateMultiplier: 1.2,
    lessonWeight: 1.5
  },
  DESPERATION: {
    patterns: [/\bjust\b/i, /\bforce\b/i, /\bignore\b/i, /\bskip\b/i, /\bplease\b/i, /\bhelp\b/i],
    gateMultiplier: 2.0,
    lessonWeight: 1.2
  }
};

function analyzeAffectiveState(chatHistory) {
  if (!Array.isArray(chatHistory)) return { states: [], gateMultiplier: 1.0, lessonWeight: 1.0 };
  const detected = [];
  const text = chatHistory.map(m => m.content).join(' ');
  
  if (AFFECTIVE_CONCEPTS.FRUSTRATION.patterns.some(p => p.test(text))) detected.push('FRUSTRATION');
  if (AFFECTIVE_CONCEPTS.URGENCY.patterns.some(p => p.test(text))) detected.push('URGENCY');
  if (AFFECTIVE_CONCEPTS.DESPERATION.patterns.some(p => p.test(text))) detected.push('DESPERATION');

  const gateMultiplier = Math.max(1.0, ...detected.map(s => AFFECTIVE_CONCEPTS[s].gateMultiplier));
  const lessonWeight = Math.max(1.0, ...detected.map(s => AFFECTIVE_CONCEPTS[s].lessonWeight));

  return { states: detected, gateMultiplier, lessonWeight };
}

module.exports = { analyzeAffectiveState };
