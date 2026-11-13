'use strict';

/**
 * ThumbGate Permission-Aware Context Retrieval Diode
 *
 * Architectural Steal: BoxWorks + NVIDIA Nemotron Retriever (Aaron Levie & Jensen Huang)
 * "Box Context Retrieval powered by NVIDIA Nemotron Retriever: designed to help agents
 * find relevant information across enterprise content while respecting existing permissions...
 * Because retrieval respects live box permissions, the context available to an agent always
 * reflects what a person is allowed to see. Connecting more data doesn't automatically create
 * better decisions. Relevant context, reliable sources, and clear access boundaries matter far more."
 */

class PermissionAwareRetriever {
  constructor(documents = []) {
    this.documents = documents; // Array of { id, title, content, allowedRoles, classification, source }
  }

  /**
   * Adds or updates an enterprise document in the retrieval index.
   */
  addDocument(doc) {
    this.documents.push({
      id: doc.id || `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: doc.title || 'Untitled',
      content: doc.content || '',
      allowedRoles: Array.isArray(doc.allowedRoles) ? doc.allowedRoles : ['all'],
      classification: doc.classification || 'internal', // public, internal, confidential, restricted
      source: doc.source || 'box_enterprise',
      updatedAt: Date.now(),
    });
  }

  /**
   * Filters and retrieves passages respecting the agent/user permission context.
   */
  retrieveContext(query, authContext = {}) {
    const {
      userRole = 'engineer',
      userEmail = 'dev@company.com',
      maxPassages = 3,
      minScore = 0.1,
    } = authContext;

    const queryTokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    const candidatePassages = [];
    const deniedDocuments = [];

    for (const doc of this.documents) {
      // 1. Permission Gate: check if userRole or userEmail is permitted
      const roleAllowed = doc.allowedRoles.includes('all') ||
        doc.allowedRoles.includes(userRole) ||
        (Array.isArray(doc.allowedUsers) && doc.allowedUsers.includes(userEmail));

      if (!roleAllowed) {
        deniedDocuments.push({
          id: doc.id,
          title: doc.title,
          requiredRoles: doc.allowedRoles,
          reason: `Access denied: role '${userRole}' does not satisfy document policy [${doc.allowedRoles.join(', ')}]`,
        });
        continue;
      }

      // 2. Lexical & Semantic matching simulation (Nemotron hybrid scoring)
      const docLower = (doc.title + ' ' + doc.content).toLowerCase();
      let matchCount = 0;
      for (const token of queryTokens) {
        if (docLower.includes(token)) matchCount++;
      }

      const score = queryTokens.length > 0 ? Number((matchCount / queryTokens.length).toFixed(3)) : 0;
      if (score >= minScore) {
        candidatePassages.push({
          id: doc.id,
          title: doc.title,
          content: doc.content,
          classification: doc.classification,
          source: doc.source,
          score,
        });
      }
    }

    // Rank passages by relevance score descending
    candidatePassages.sort((a, b) => b.score - a.score);
    const topPassages = candidatePassages.slice(0, maxPassages);

    return {
      query,
      userRole,
      retrievedCount: topPassages.length,
      passages: topPassages,
      deniedCount: deniedDocuments.length,
      denied: deniedDocuments,
      promptContext: topPassages.map(p => `[SOURCE: ${p.title} (${p.classification})]\n${p.content}`).join('\n\n'),
    };
  }
}

module.exports = {
  PermissionAwareRetriever,
};
