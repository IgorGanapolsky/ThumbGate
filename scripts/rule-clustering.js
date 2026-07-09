'use strict';

/**
 * rule-clustering.js — surface LEVERAGE POINTS by grouping related prevention
 * rules (distinct symptoms of the same underlying habit) into clusters.
 *
 * The problem this solves: dedup (lesson-synthesis.js) merges *identical*
 * mistakes, so five DISTINCT symptoms of one bad habit become five separate
 * gates — rule sprawl / whack-a-mole, and the high-leverage single fix is never
 * surfaced. This module groups related-but-distinct rules so a human can decide
 * "one upstream fix" instead of maintaining N narrow gates.
 *
 * DELIBERATELY NOT a causal graph. It makes NO causal claim. It groups by
 * lexical/tag relatedness and *shows the evidence* (shared tags + shared terms)
 * for every grouping, and every suggestion is phrased as a candidate to confirm.
 * Causal attribution ("these distinct symptoms are caused by X") is a different,
 * interpretive layer and is out of scope on purpose — see the enforcement-vs-
 * interpretation boundary in the README.
 *
 * Fully deterministic: no LLM, no randomness. Same rules in → same clusters out.
 */

// Tags that carry no grouping signal (pipeline/plumbing labels, not topics).
const GENERIC_TAGS = new Set([
  'auto-promoted', 'synthesized', 'general', 'uncategorized', 'misc',
  'feedback', 'thumbgate', 'lesson', 'memory',
]);

// High-frequency / structural words stripped before token comparison, including
// the boilerplate that wraps captured mistakes ("NEVER …", "CRITICAL ERROR -
// User frustrated: …") so clustering keys on the actual mistake content.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did', 'not', 'dont',
  'this', 'that', 'it', 'you', 'your', 'when', 'if', 'then', 'after', 'before',
  'instead', 'never', 'always', 'error', 'user', 'frustrated', 'critical',
  'mistake', 'issue', 'problem', 'rule',
]);

// A pair of rules is "related" if they share at least one significant tag, OR
// their content token overlap (Jaccard) reaches this band. Kept BELOW the 0.6
// dedup threshold used in lesson-synthesis: above 0.6 they'd already be merged
// as the same mistake; this catches distinct-but-related ones.
const TOKEN_RELATEDNESS = 0.3;
const DEFAULT_MIN_CLUSTER_SIZE = 3;

function tokenize(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
  );
}

function significantTags(tags) {
  return new Set(
    (Array.isArray(tags) ? tags : [])
      .map((t) => String(t).toLowerCase().trim())
      .filter((t) => t && !GENERIC_TAGS.has(t))
  );
}

function intersectSize(a, b) {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  const union = new Set([...a, ...b]);
  return union.size ? intersectSize(a, b) / union.size : 0;
}

function ruleText(rule) {
  return rule.pattern || rule.text || rule.suggestedRule
    || (rule.rule && rule.rule.trigger && rule.rule.trigger.condition) || '';
}

function ruleSignature(rule) {
  return { tokens: tokenize(ruleText(rule)), tags: significantTags(rule.tags) };
}

function areRelated(sigA, sigB) {
  if (intersectSize(sigA.tags, sigB.tags) >= 1) return true;
  return jaccard(sigA.tokens, sigB.tokens) >= TOKEN_RELATEDNESS;
}

function buildCluster(members) {
  const tagCounts = new Map();
  const tokenCounts = new Map();
  for (const m of members) {
    for (const t of m._sig.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    for (const tk of m._sig.tokens) tokenCounts.set(tk, (tokenCounts.get(tk) || 0) + 1);
  }
  // Shared = appears in >=2 members; ordered by how many members share it.
  const sharedFrom = (map) => [...map.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([k]) => k);
  const sharedTags = sharedFrom(tagCounts);
  const sharedTokens = sharedFrom(tokenCounts);
  const totalOccurrences = members.reduce((s, m) => s + (Number(m.count) || 1), 0);
  const label = [...sharedTags.slice(0, 2), ...sharedTokens.slice(0, 3)].slice(0, 3).join(' / ')
    || 'related rules';
  return {
    size: members.length,
    memberIds: members.map((m) => m._id),
    members: members.map((m) => ({
      id: m._id,
      text: ruleText(m),
      count: Number(m.count) || 1,
      severity: m.severity,
    })),
    sharedTags,
    sharedTokens,
    totalOccurrences,
    label,
  };
}

/**
 * Cluster related rules via union-find over pairwise relatedness.
 * @param {Array<object>} rules - each may carry {id, pattern|text|suggestedRule, tags[], count, severity}
 * @returns {Array<object>} clusters (including singletons), most-impactful first
 */
function clusterRules(rules, _options = {}) {
  const list = (Array.isArray(rules) ? rules : []).map((r, i) => ({
    ...r,
    _id: r.id != null ? r.id : `r${i}`,
    _sig: ruleSignature(r),
  }));

  const parent = list.map((_, i) => i);
  const find = (x) => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    while (parent[x] !== root) { const next = parent[x]; parent[x] = root; x = next; }
    return root;
  };
  const union = (a, b) => { parent[find(a)] = find(b); };

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (areRelated(list[i]._sig, list[j]._sig)) union(i, j);
    }
  }

  const groups = new Map();
  list.forEach((r, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(r);
  });

  const clusters = [...groups.values()].map(buildCluster);
  clusters.sort((a, b) =>
    b.totalOccurrences - a.totalOccurrences
    || b.size - a.size
    || String(a.memberIds[0]).localeCompare(String(b.memberIds[0])));
  return clusters;
}

/**
 * Return only clusters worth a single upstream fix (size >= minClusterSize),
 * each with an auditable, human-confirmable suggestion.
 */
function surfaceLeveragePoints(rules, options = {}) {
  const minClusterSize = options.minClusterSize || DEFAULT_MIN_CLUSTER_SIZE;
  return clusterRules(rules, options)
    .filter((c) => c.size >= minClusterSize)
    .map((c) => {
      const grouping = c.sharedTags.length
        ? `shared tag(s): ${c.sharedTags.slice(0, 4).join(', ')}`
        : `common terms: ${c.sharedTokens.slice(0, 4).join(', ') || '(low overlap)'}`;
      return {
        ...c,
        suggestion: `${c.size} related rules (${c.totalOccurrences} total occurrences) likely share one `
          + `upstream habit around "${c.label}". Consider a single upstream fix instead of ${c.size} narrow `
          + `gates. Grouped by ${grouping} — candidate cluster, confirm before acting.`,
      };
    });
}

/** Render leverage points as markdown bullet lines for the rules report. */
function formatLeveragePoints(rules, options = {}) {
  const points = surfaceLeveragePoints(rules, options);
  const lines = [];
  for (const p of points) {
    lines.push(`- [${p.size} rules, ${p.totalOccurrences}x] ${p.label}`);
    lines.push(`  > ${p.suggestion}`);
    for (const m of p.members) {
      lines.push(`    - (${m.count}x) ${String(m.text).slice(0, 90)}`);
    }
  }
  return lines;
}

module.exports = {
  clusterRules,
  surfaceLeveragePoints,
  formatLeveragePoints,
  tokenize,
  significantTags,
  areRelated,
  ruleSignature,
  TOKEN_RELATEDNESS,
  DEFAULT_MIN_CLUSTER_SIZE,
};
