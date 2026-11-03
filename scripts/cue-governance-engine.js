/**
 * CueGovernanceEngine: Permission-Aware, Role-Based Experience (RBE)
 * Stolen from Interact's "Cue AI Intranet".
 * 
 * Core Principles:
 * 1. One Shared Context: Search flows into conversation without restart.
 * 2. Permission-Aware: Never quotes or surfaces content user cannot access.
 * 3. Identity-Driven Layout: Experience reshapes based on Role, Team, Location, Moment.
 * 4. SoR Action Bridge: Acts directly in Systems of Record (Tickets, Approvals).
 */

class CueGovernanceEngine {
  constructor(options = {}) {
    this.identityStore = options.identityStore || {}; // Mock directory (Role, Team, Location)
    this.permissionMap = options.permissionMap || {}; // Document -> Allowed Roles
  }

  /**
   * Filters content based on the user's identity and existing permissions.
   * @param {string} userId - Unique user identifier.
   * @param {Array} contents - Array of content objects {id, text, requiredRole}.
   */
  filterByPermission(userId, contents) {
    const userIdentity = this.identityStore[userId] || { role: 'guest' };
    const userRole = userIdentity.role;

    return contents.filter(item => {
      const requiredRole = item.requiredRole || 'guest';
      return requiredRole === 'guest' || requiredRole === userRole || userIdentity.isAdmin;
    });
  }

  /**
   * Reshapes the "Experience Layout" based on identity and moment.
   * @param {string} userId - Unique user identifier.
   * @param {string} moment - Current context (e.g., 'onboarding', 'incident_response', 'review').
   */
  getRoleBasedLayout(userId, moment) {
    const identity = this.identityStore[userId] || { role: 'guest' };
    const role = identity.role;

    const layoutTemplates = {
      'manager': {
        priority: ['Approvals', 'Team Status', 'Revenue Dashboard'],
        focus: 'Management'
      },
      'engineer': {
        priority: ['Active Tickets', 'CI/CD Status', 'API Docs'],
        focus: 'Execution'
      },
      'guest': {
        priority: ['Public Roadmap', 'Welcome Guide'],
        focus: 'Discovery'
      }
    };

    const baseLayout = layoutTemplates[role] || layoutTemplates['guest'];
    
    // Adapt for 'moment'
    if (moment === 'incident_response') {
      return {
        ...baseLayout,
        priority: ['Incident Log', 'War Room', 'On-Call Schedule'],
        focus: 'Urgency'
      };
    }

    return baseLayout;
  }

  /**
   * Continuous Context: Bridges Search and Conversation.
   * @param {Object} searchContext - Result of a previous search.
   * @param {string} query - The follow-up conversational query.
   */
  bridgeSearchToConversation(searchContext, query) {
    return {
      contextId: searchContext.contextId,
      mergedPrompt: `Based on the search results for "${searchContext.originalQuery}", ${query}`,
      retainedState: searchContext.state,
      action: 'CONTINUE_CONVERSATION'
    };
  }

  /**
   * SoR Action Bridge: Maps intent to System of Record actions.
   * @param {string} intent - User intent (e.g., 'approve leave', 'open ticket').
   * @param {Object} params - Action parameters.
   */
  mapToSystemOfRecord(intent, params) {
    const actionMap = {
      'approve_leave': { system: 'HRIS', action: 'POST /api/leave/approve' },
      'open_ticket': { system: 'ITSM', action: 'POST /api/tickets/create' },
      'acknowledge_policy': { system: 'Compliance', action: 'POST /api/policy/ack' }
    };

    const mapped = actionMap[intent];
    if (!mapped) return { error: 'Intent not mapped to any System of Record' };

    return {
      ...mapped,
      payload: params,
      executionMode: 'AGENT_DELEGATED'
    };
  }
}

module.exports = { CueGovernanceEngine };
