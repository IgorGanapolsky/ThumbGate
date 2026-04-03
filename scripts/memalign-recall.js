'use strict';

/**
 * MemAlign dual-memory working memory construction.
 *
 * Combines:
 *   - Semantic memory (principles distilled from NL feedback)
 *   - Episodic memory (contextfs context packs)
 *
 * Budget split: 20% chars for principles, 80% for episodes.
 */

const { constructContextPack } = require('./contextfs');
const { getPrinciples } = require('./principle-extractor');

/**
 * Build a dual-memory working memory object.
 *
 * @param {object} opts
 * @param {string}   opts.query - Recall query.
 * @param {number}   [opts.maxItems=10] - Max episodic items.
 * @param {number}   [opts.maxChars=4000] - Total char budget.
 * @param {string[]} [opts.namespaces] - Episodic search namespaces.
 * @param {number}   [opts.maxPrinciples=5] - Max principles to include.
 * @returns {{ principles: object[], episodes: object, charBudget: { total: number, principles: number, episodes: number } }}
 */
function constructWorkingMemory({ query, maxItems = 10, maxChars = 4000, namespaces, maxPrinciples = 5 } = {}) {
  const principlesBudget = Math.floor(maxChars * 0.2);
  const episodesBudget = maxChars - principlesBudget;

  // Retrieve principles (semantic memory)
  const allPrinciples = getPrinciples({ limit: maxPrinciples });

  // Trim principles to char budget
  const selectedPrinciples = [];
  let usedPrincipleChars = 0;
  for (const p of allPrinciples) {
    const len = (p.text || '').length;
    if (usedPrincipleChars + len > principlesBudget) break;
    selectedPrinciples.push(p);
    usedPrincipleChars += len;
  }

  // Retrieve episodic context pack
  const episodes = constructContextPack({
    query: query || '',
    maxItems,
    maxChars: episodesBudget,
    namespaces,
  });

  return {
    principles: selectedPrinciples,
    episodes,
    charBudget: {
      total: maxChars,
      principles: principlesBudget,
      episodes: episodesBudget,
    },
  };
}

/**
 * Format a working memory object as markdown for context injection.
 *
 * @param {object} wm - Working memory from constructWorkingMemory.
 * @returns {string} Markdown string.
 */
function formatWorkingMemoryForContext(wm) {
  const lines = [];

  lines.push('## Principles (Semantic Memory)');
  lines.push('');
  if (wm.principles && wm.principles.length > 0) {
    for (const p of wm.principles) {
      lines.push(`- ${p.text}`);
    }
  } else {
    lines.push('_No principles extracted yet._');
  }

  lines.push('');
  lines.push('## Relevant Past Episodes (Episodic Memory)');
  lines.push('');
  if (wm.episodes && wm.episodes.retrieval && wm.episodes.retrieval.strategy === 'hierarchical') {
    const themes = Array.isArray(wm.episodes.retrieval.selectedThemes)
      ? wm.episodes.retrieval.selectedThemes.map((theme) => theme.replace(/-/g, ' '))
      : [];
    if (themes.length > 0) {
      lines.push(`Themes: ${themes.join(', ')}`);
      lines.push('');
    }
  }
  if (wm.episodes && Array.isArray(wm.episodes.items) && wm.episodes.items.length > 0) {
    for (const item of wm.episodes.items) {
      lines.push(`- **${item.title || item.id}**`);
      if (item.structuredContext && item.structuredContext.rawContent) {
        lines.push(`  ${item.structuredContext.rawContent.slice(0, 200)}`);
      }
    }
  } else {
    lines.push('_No relevant episodes found._');
  }

  return lines.join('\n');
}

module.exports = {
  constructWorkingMemory,
  formatWorkingMemoryForContext,
};
