#!/usr/bin/env node
'use strict';

function analyzeHardeningNeeds(feedbackLog) {
  const categories = {};
  feedbackLog.forEach(entry => {
    if (entry.signal === 'negative') {
      const cat = entry.category || 'general';
      categories[cat] = (categories[cat] || 0) + 1;
    }
  });

  const recommendations = [];
  Object.entries(categories).forEach(([cat, count]) => {
    if (count >= 5) {
      recommendations.push({
        category: cat,
        count,
        strategy: 'LoRA Fine-tuning',
        action: `Export DPO pairs for ${cat} and run training.`
      });
    } else {
      recommendations.push({
        category: cat,
        count,
        strategy: 'In-Context Guardrails',
        action: 'Continue using Pre-Action Gates.'
      });
    }
  });

  return recommendations;
}

if (require.main === module) {
  console.log(JSON.stringify(analyzeHardeningNeeds([])));
}

module.exports = { analyzeHardeningNeeds };
