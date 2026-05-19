'use strict';

/**
 * Agent Memory Defragmentation Pipeline (Multi-Agent System Lessons)
 * 
 * Implements the "llm-fuse" and memory compaction lessons from Shopify.
 * Agents write their own memories, which accumulate noise. This engine
 * periodically "defrags" (compacts and deduplicates) agent memories 
 * so the context window remains pristine across long-running projects.
 */

function defragAgentMemories(memories, threshold = 0.8) {
  if (!Array.isArray(memories) || memories.length === 0) return [];

  // Group by scope
  const grouped = {};
  for (const m of memories) {
    const scope = m.scope || 'global';
    if (!grouped[scope]) grouped[scope] = [];
    grouped[scope].push(m);
  }

  const defragged = [];
  
  for (const [scope, items] of Object.entries(grouped)) {
    if (items.length <= 1) {
      defragged.push(...items);
      continue;
    }

    // Sort by importance (highest first)
    items.sort((a, b) => (b.importance || 0) - (a.importance || 0));

    // Keep the highest importance items that exceed threshold,
    // merge the rest into a consolidated summary.
    const keep = [];
    const merge = [];

    for (const item of items) {
      if ((item.importance || 0) >= threshold && keep.length < 2) {
        keep.push(item);
      } else {
        merge.push(item);
      }
    }

    defragged.push(...keep);

    if (merge.length > 0) {
      const mergedText = merge.map(m => m.text).join(' | ');
      defragged.push({
        id: `merged_${Date.now()}`,
        type: 'consolidated_summary',
        scope,
        text: `Consolidated ${merge.length} memories: ${mergedText.slice(0, 100)}...`,
        importance: Math.max(...merge.map(m => m.importance || 0.5)),
        supersedes: merge.map(m => m.id)
      });
    }
  }

  return defragged;
}

module.exports = {
  defragAgentMemories
};
