'use strict';

// Question router: classify a supervisor question to the right document source.
// LLM-classified when credentials exist; deterministic keyword fallback otherwise
// so the demo never dies on a network blip.

const { chat, activeProvider } = require('./llm');

const ROUTES = ['safety', 'maintenance', 'quality'];

const KEYWORDS = {
  safety: ['lockout', 'tagout', 'loto', 'confined space', 'spill', 'ppe', 'permit', 'evacuation', 'guard', 'interlock', 'safe', 'safety', 'hazard', 'bypass'],
  maintenance: ['maintenance', 'repair', 'replace', 'bearing', 'filter', 'belt', 'tracking', 'spindle', 'compressor', 'lubric', 'torque', 'service', 'pm ', 'press', 'hydraulic', 'manual'],
  quality: ['quality', 'inspection', 'tolerance', 'gauge', 'ncr', 'nonconform', 'defect', 'weld', 'coating', 'thickness', 'sample', 'spec'],
};

function keywordRoute(question) {
  const q = question.toLowerCase();
  const scores = Object.fromEntries(
    Object.entries(KEYWORDS).map(([route, words]) => [route, words.filter((w) => q.includes(w)).length])
  );
  const best = ROUTES.reduce((a, b) => (scores[b] > scores[a] ? b : a), 'safety');
  return { route: best, method: 'keyword', scores };
}

async function routeQuestion(question) {
  if (activeProvider() === 'none') return keywordRoute(question);
  try {
    const raw = await chat(
      [
        {
          role: 'system',
          content:
            'Classify the factory-floor question into exactly one documentation source. ' +
            'Reply with one word: safety, maintenance, or quality. ' +
            'safety = procedures, LOTO, permits, PPE, spills, guarding. ' +
            'maintenance = repairing/servicing equipment. ' +
            'quality = inspection, tolerances, nonconforming material.',
        },
        { role: 'user', content: question },
      ],
      { maxTokens: 10 }
    );
    const route = raw.trim().toLowerCase();
    if (ROUTES.includes(route)) return { route, method: 'llm' };
    return keywordRoute(question);
  } catch {
    return keywordRoute(question);
  }
}

module.exports = { routeQuestion, ROUTES };
