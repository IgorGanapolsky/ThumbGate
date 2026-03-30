'use strict';

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'before', 'but', 'by',
  'for', 'from', 'had', 'has', 'have', 'into', 'its', 'more', 'not', 'now',
  'our', 'out', 'that', 'the', 'their', 'them', 'then', 'they', 'this', 'too',
  'was', 'were', 'what', 'when', 'with', 'without', 'your',
]);

const GENERIC_THEME_TAGS = new Set([
  'feedback',
  'positive',
  'negative',
  'rules',
  'prevention',
  'memory',
  'research',
  'paper',
  'hf-papers',
]);

function normalizeKey(input, fallback = 'general') {
  const value = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return value || fallback;
}

function uniqueList(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function tokenizeText(input) {
  return uniqueList(
    String(input || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2 && !STOPWORDS.has(token))
  );
}

function summarizeText(input, maxChars = 180) {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

function inferThemeKey(doc = {}) {
  const metadata = doc.metadata || {};
  const directCandidates = [
    metadata.theme,
    metadata.contentPillar,
    metadata.domain,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return normalizeKey(candidate);
    }
  }

  const tags = Array.isArray(doc.tags) ? doc.tags.map((tag) => String(tag).toLowerCase()) : [];
  const meaningfulTag = tags.find((tag) => !GENERIC_THEME_TAGS.has(tag));
  if (meaningfulTag) {
    return normalizeKey(meaningfulTag);
  }

  if (tags.length > 0) {
    return normalizeKey(tags[0]);
  }

  if (typeof doc.namespace === 'string' && doc.namespace.includes('memory/error')) return 'mistakes';
  if (typeof doc.namespace === 'string' && doc.namespace.includes('memory/learning')) return 'learnings';
  if (typeof doc.namespace === 'string' && doc.namespace.includes('raw_history')) return 'timeline';
  if (typeof doc.namespace === 'string' && doc.namespace.includes('rules')) return 'rules';

  const namespaceTail = String(doc.namespace || '').split('/').pop();
  return normalizeKey(namespaceTail, 'general');
}

function collectDocumentTokens(doc = {}) {
  return uniqueList([
    ...tokenizeText(doc.title),
    ...tokenizeText(summarizeText(doc.content, 240)),
    ...(Array.isArray(doc.tags) ? doc.tags.flatMap((tag) => tokenizeText(tag)) : []),
  ]);
}

function buildSemanticFingerprint(doc = {}) {
  const metadata = doc.metadata || {};
  if (typeof metadata.semanticKey === 'string' && metadata.semanticKey.trim()) {
    return normalizeKey(metadata.semanticKey, 'semantic');
  }

  const tokens = collectDocumentTokens(doc).slice(0, 6);
  if (tokens.length > 0) {
    return normalizeKey(tokens.join('-'), 'semantic');
  }

  return normalizeKey(doc.title || doc.id || 'semantic', 'semantic');
}

function scoreTokenOverlap(queryTokens = [], candidateTokens = []) {
  if (queryTokens.length === 0) return 0;
  const tokenSet = new Set(candidateTokens);
  let score = 0;

  for (const token of queryTokens) {
    if (tokenSet.has(token)) {
      score += token.length >= 7 ? 3 : 2;
    }
  }

  return score;
}

function recencyBoost(createdAt) {
  if (!createdAt) return 0;
  const createdMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdMs)) return 0;

  const ageHours = (Date.now() - createdMs) / 3_600_000;
  if (ageHours < 24) return 2;
  if (ageHours < 24 * 7) return 1;
  return 0;
}

function selectRepresentative(members = [], queryTokens = [], scorer = null) {
  return members
    .slice()
    .sort((left, right) => {
      const leftScore = scoreDocumentForSelection(left, queryTokens, scorer);
      const rightScore = scoreDocumentForSelection(right, queryTokens, scorer);
      return rightScore - leftScore;
    })[0] || null;
}

function scoreDocumentForSelection(doc, queryTokens = [], scorer = null) {
  const overlapScore = scoreTokenOverlap(queryTokens, collectDocumentTokens(doc));
  const baseScore = typeof scorer === 'function' ? scorer(doc, queryTokens) : 0;
  return overlapScore + baseScore + recencyBoost(doc.createdAt);
}

function buildSemanticDigest(members = []) {
  if (members.length === 0) return '';
  const titles = uniqueList(members.map((member) => member.title).filter(Boolean)).slice(0, 2);
  const summary = summarizeText(members[0].content, 140);
  return [titles.join(' | '), summary].filter(Boolean).join(' | ');
}

function buildXMemoryHierarchy(documents = [], { query = '', scorer = null } = {}) {
  const queryTokens = tokenizeText(query);
  const themeMap = new Map();

  for (const doc of documents) {
    const themeKey = inferThemeKey(doc);
    const semanticKey = `${themeKey}::${buildSemanticFingerprint(doc)}`;
    const docTokens = collectDocumentTokens(doc);

    let theme = themeMap.get(themeKey);
    if (!theme) {
      theme = {
        id: themeKey,
        label: themeKey.replace(/-/g, ' '),
        tokens: [],
        semantics: new Map(),
        documents: [],
      };
      themeMap.set(themeKey, theme);
    }

    theme.tokens = uniqueList([...theme.tokens, ...docTokens, ...tokenizeText(theme.label)]);
    theme.documents.push(doc);

    let semantic = theme.semantics.get(semanticKey);
    if (!semantic) {
      semantic = {
        id: semanticKey,
        themeId: themeKey,
        tokens: [],
        members: [],
      };
      theme.semantics.set(semanticKey, semantic);
    }

    semantic.tokens = uniqueList([...semantic.tokens, ...docTokens]);
    semantic.members.push(doc);
  }

  const themes = Array.from(themeMap.values()).map((theme) => {
    const semantics = Array.from(theme.semantics.values()).map((semantic) => {
      const representative = selectRepresentative(semantic.members, queryTokens, scorer);
      const score = scoreTokenOverlap(queryTokens, semantic.tokens)
        + recencyBoost(representative && representative.createdAt);

      return {
        ...semantic,
        memberCount: semantic.members.length,
        digest: buildSemanticDigest(semantic.members),
        representative,
        score,
      };
    }).sort((left, right) => right.score - left.score);

    const topSemanticScore = semantics[0] ? semantics[0].score : 0;
    const score = scoreTokenOverlap(queryTokens, theme.tokens)
      + topSemanticScore
      + recencyBoost(theme.documents[0] && theme.documents[0].createdAt);

    return {
      id: theme.id,
      label: theme.label,
      tokens: theme.tokens,
      semanticCount: semantics.length,
      documentCount: theme.documents.length,
      score,
      semantics,
    };
  }).sort((left, right) => right.score - left.score);

  return {
    query,
    queryTokens,
    themeCount: themes.length,
    semanticCount: themes.reduce((sum, theme) => sum + theme.semanticCount, 0),
    documentCount: documents.length,
    themes,
  };
}

function computeQueryCoverage(queryTokens = [], nodes = []) {
  if (queryTokens.length === 0) return 1;

  const tokenSet = new Set();
  for (const node of nodes) {
    for (const token of node.tokens || []) {
      tokenSet.add(token);
    }
  }

  const covered = queryTokens.filter((token) => tokenSet.has(token)).length;
  return Number((covered / queryTokens.length).toFixed(4));
}

function shouldUseHierarchicalRetrieval(namespaces = []) {
  if (!Array.isArray(namespaces) || namespaces.length === 0) return true;
  return !namespaces.every((namespace) => namespace === 'research');
}

function retrieveHierarchicalDocuments({
  documents = [],
  query = '',
  maxItems = 8,
  maxChars = 6000,
  scorer = null,
  measureDocument = null,
  coverageTarget = 0.6,
} = {}) {
  const hierarchy = buildXMemoryHierarchy(documents, { query, scorer });
  const queryTokens = hierarchy.queryTokens;
  const selectedDocuments = [];
  const selectedSemantics = [];
  const selectedDocumentIds = new Set();
  const selectedSemanticIds = new Set();
  let usedChars = 0;
  let skippedByMaxChars = 0;

  const semanticBudget = Math.max(1, Math.min(maxItems, Math.ceil(maxItems * 0.6)));
  const rankedThemes = hierarchy.themes.filter((theme) => queryTokens.length === 0 || theme.score > 0);
  const themeCursor = rankedThemes.map(() => 0);

  function getDocumentChars(doc) {
    if (typeof measureDocument === 'function') {
      return measureDocument(doc);
    }
    return `${doc.title || ''}\n${doc.content || ''}`.length;
  }

  function trySelectDocument(doc) {
    if (!doc || selectedDocumentIds.has(doc.id) || selectedDocuments.length >= maxItems) {
      return false;
    }

    const docChars = getDocumentChars(doc);
    if (usedChars + docChars > maxChars) {
      skippedByMaxChars += 1;
      return false;
    }

    selectedDocuments.push(doc);
    selectedDocumentIds.add(doc.id);
    usedChars += docChars;
    return true;
  }

  function computeDocumentCoverage(candidateDocs) {
    return computeQueryCoverage(
      queryTokens,
      candidateDocs.map((doc) => ({ tokens: collectDocumentTokens(doc) }))
    );
  }

  while (selectedSemantics.length < semanticBudget && rankedThemes.length > 0) {
    let progress = false;

    for (let i = 0; i < rankedThemes.length; i += 1) {
      const theme = rankedThemes[i];
      const semantics = theme.semantics;
      while (themeCursor[i] < semantics.length && selectedSemanticIds.has(semantics[themeCursor[i]].id)) {
        themeCursor[i] += 1;
      }

      const semantic = semantics[themeCursor[i]];
      if (!semantic) continue;

      themeCursor[i] += 1;
      if (!trySelectDocument(semantic.representative)) {
        continue;
      }

      selectedSemanticIds.add(semantic.id);
      selectedSemantics.push(semantic);
      progress = true;

      if (selectedSemantics.length >= semanticBudget) {
        break;
      }
    }

    if (!progress) break;
    if (selectedDocuments.length >= maxItems) break;
  }

  let queryCoverage = computeDocumentCoverage(selectedDocuments);
  const initialCoverage = queryCoverage;
  const expansionCandidates = [];

  for (const semantic of selectedSemantics) {
    for (const member of semantic.members) {
      if (member.id === (semantic.representative && semantic.representative.id)) continue;
      const memberTokens = collectDocumentTokens(member);
      const newCoverage = computeQueryCoverage(queryTokens, [
        ...selectedDocuments.map((doc) => ({ tokens: collectDocumentTokens(doc) })),
        { tokens: memberTokens },
      ]);

      expansionCandidates.push({
        doc: member,
        semanticId: semantic.id,
        coverageGain: Number((newCoverage - queryCoverage).toFixed(4)),
        score: scoreDocumentForSelection(member, queryTokens, scorer),
      });
    }
  }

  expansionCandidates.sort((left, right) => {
    if (right.coverageGain !== left.coverageGain) {
      return right.coverageGain - left.coverageGain;
    }
    return right.score - left.score;
  });

  let expandedEpisodes = 0;
  for (const candidate of expansionCandidates) {
    if (selectedDocuments.length >= maxItems) break;
    if (queryCoverage >= coverageTarget && candidate.coverageGain <= 0) break;
    if (!trySelectDocument(candidate.doc)) continue;
    queryCoverage = computeDocumentCoverage(selectedDocuments);
    expandedEpisodes += 1;
  }

  return {
    items: selectedDocuments,
    usedChars,
    skippedByMaxChars,
    hierarchy,
    retrieval: {
      strategy: 'hierarchical',
      themeCount: hierarchy.themeCount,
      semanticCount: hierarchy.semanticCount,
      selectedThemes: uniqueList(selectedSemantics.map((semantic) => semantic.themeId)),
      selectedSemanticGroups: selectedSemantics.map((semantic) => semantic.id),
      representativeCount: Math.min(selectedSemantics.length, selectedDocuments.length),
      expandedEpisodes,
      queryCoverage,
      initialCoverage,
      coverageTarget,
    },
  };
}

module.exports = {
  buildXMemoryHierarchy,
  buildSemanticFingerprint,
  collectDocumentTokens,
  computeQueryCoverage,
  inferThemeKey,
  normalizeKey,
  retrieveHierarchicalDocuments,
  shouldUseHierarchicalRetrieval,
  summarizeText,
  tokenizeText,
};
