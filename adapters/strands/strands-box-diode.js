'use strict';

/**
 * Strands Box & Dogwood Policy Diode — AWS Strands Box Format Steal
 *
 * Implements OS containment + contextual Dogwood policy enforcement:
 * - State-aware event history across tools (fs:read, fs:write, fs:delete, http:request, mcp:call)
 * - Exfiltration diode & taint tracking (block outbound network after sensitive file read)
 * - Credential injection gateway (agent sees placeholder token; gateway attaches secret on egress)
 * - Sliding-window rate limiters (e.g. max 3 external alerts / 10 min)
 * - Sub-1ms local CPU execution
 */

const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');

const EVENT_FS_READ = 'fs:read';
const EVENT_FS_WRITE = 'fs:write';
const EVENT_FS_DELETE = 'fs:delete';
const EVENT_HTTP_REQUEST = 'http:request';
const EVENT_MCP_CALL = 'mcp:call';
const EVENT_SHELL_EXEC = 'shell:exec';

const DEFAULT_SENSITIVE_PATTERNS = [
  /\.env(?:\..+)?$/,
  /credentials(?:\.json|\.txt)?$/i,
  /id_rsa|id_ed25519/,
  /token|secret|password|customer[-_]data/i
];

/**
 * Creates an isolated Strands Box governance session.
 *
 * @param {Object} opts
 * @param {string} [opts.id]
 * @param {string} opts.name
 * @param {string} opts.workspace
 * @param {Array<RegExp|string>} [opts.sensitivePatterns]
 * @param {Array<Object>} [opts.credentialRoutes]
 * @param {Object} [opts.rateLimits]
 * @returns {Object} Box session instance
 */
function createBoxSession(opts = {}) {
  const sessionId = opts.id || `box_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const name = opts.name || 'default-box';
  const workspace = opts.workspace || process.cwd();
  const sensitivePatterns = opts.sensitivePatterns || DEFAULT_SENSITIVE_PATTERNS;
  const credentialRoutes = opts.credentialRoutes || [];
  const rateLimits = opts.rateLimits || {};

  return {
    id: sessionId,
    name,
    workspace,
    sensitivePatterns,
    credentialRoutes,
    rateLimits,
    history: [],
    taintedSources: new Set(),
    isTainted: false,
    rateCounters: new Map() // key -> array of timestamps
  };
}

/**
 * Decomposes a shell command into concrete Dogwood events.
 *
 * @param {string} command - Shell command string
 * @returns {Array<{type: string, target: string, operation: string}>}
 */
function decomposeCommand(command = '') {
  const trimmed = String(command).trim();
  const events = [];

  // Match destructive deletes: rm -rf path, rm path
  const rmMatch = trimmed.match(/^rm\s+(?:-[a-zA-Z]+\s+)*(.+)$/);
  if (rmMatch) {
    const targets = rmMatch[1].split(/\s+/).filter(Boolean);
    for (const t of targets) {
      events.push({ type: EVENT_FS_DELETE, target: t, operation: 'delete' });
    }
    return events;
  }

  // Match network egress: curl, wget, fetch
  const curlMatch = trimmed.match(/^(?:curl|wget)\s+(?:-[a-zA-Z0-9-]+\s+)*(https?:\/\/[^\s'"]+)/i);
  if (curlMatch) {
    events.push({ type: EVENT_HTTP_REQUEST, target: curlMatch[1], operation: 'network_egress' });
    return events;
  }

  // Generic execution
  events.push({ type: EVENT_SHELL_EXEC, target: trimmed, operation: 'shell_exec' });
  return events;
}

/**
 * Checks sliding window rate limit for an action key.
 *
 * @param {Object} session
 * @param {string} actionKey
 * @param {number} maxCount
 * @param {number} windowSeconds
 * @returns {boolean} True if within limit, false if exceeded
 */
function checkRateLimit(session, actionKey, maxCount, windowSeconds) {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  let timestamps = session.rateCounters.get(actionKey) || [];

  // Filter timestamps within current sliding window
  timestamps = timestamps.filter(ts => (now - ts) <= windowMs);
  session.rateCounters.set(actionKey, timestamps);

  if (timestamps.length >= maxCount) {
    return false;
  }

  timestamps.push(now);
  return true;
}

/**
 * Evaluates an operation through Strands Box & Dogwood policies.
 *
 * @param {Object} session - The box session created by createBoxSession
 * @param {Object} action - Action descriptor
 * @param {string} action.type - Event type (fs:read, fs:write, fs:delete, http:request, mcp:call, shell:exec)
 * @param {string} action.target - Path, URL, or identifier
 * @param {Object} [action.params] - Parameters or request headers
 * @returns {Object} Evaluation verdict
 */
function evaluateBoxAction(session, action = {}) {
  const start = performance.now();
  const type = action.type || 'unknown';
  const target = String(action.target || '').trim();
  const params = action.params || {};

  // 1. Compound Command Decomposition
  if (type === EVENT_SHELL_EXEC) {
    const subEvents = decomposeCommand(target);
    for (const sub of subEvents) {
      if (sub.type !== EVENT_SHELL_EXEC) {
        const subVerdict = evaluateBoxAction(session, {
          type: sub.type,
          target: sub.target,
          params
        });
        if (!subVerdict.allowed) {
          return subVerdict;
        }
      }
    }
  }

  // 2. Sensitive File Access & Taint Propagation (fs:read)
  if (type === EVENT_FS_READ) {
    for (const pattern of session.sensitivePatterns) {
      const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
      if (regex.test(target)) {
        session.isTainted = true;
        session.taintedSources.add(target);
        session.history.push({
          type,
          target,
          timestamp: Date.now(),
          verdict: 'ALLOW_WITH_TAINT',
          tainted: true
        });
        const elapsed = performance.now() - start;
        return {
          allowed: true,
          decision: 'ALLOW',
          reason: 'SENSITIVE_DATA_READ_TAINT_PROPAGATED',
          tainted: true,
          taintedSources: Array.from(session.taintedSources),
          latencyMs: Number(elapsed.toFixed(3))
        };
      }
    }
  }

  // 3. Destructive Deletion Guard (fs:delete)
  if (type === EVENT_FS_DELETE) {
    const isRootOrSystem = /^\/(?:etc|var|usr|bin|boot|System|Library|Users)?$/i.test(target) || target === '/';
    const isParentEscaped = target.includes('..') && !target.startsWith(session.workspace);
    if (isRootOrSystem || isParentEscaped) {
      const elapsed = performance.now() - start;
      return {
        allowed: false,
        decision: 'BLOCK',
        reason: 'CRITICAL_DELETION_CONTAINMENT_BREACH',
        target,
        latencyMs: Number(elapsed.toFixed(3))
      };
    }
  }

  // 4. Exfiltration Prevention & Network Egress Diode (http:request)
  if (type === EVENT_HTTP_REQUEST) {
    // If session holds tainted sensitive data, block untrusted egress
    if (session.isTainted) {
      const allowlistedHosts = ['127.0.0.1', 'localhost', 'api.thumbgate.ai'];
      let isAllowlisted = false;
      try {
        const urlObj = new URL(target.startsWith('http') ? target : `http://${target}`);
        isAllowlisted = allowlistedHosts.some(h => urlObj.hostname === h || urlObj.hostname.endsWith(`.${h}`));
      } catch {
        isAllowlisted = false;
      }

      if (!isAllowlisted) {
        const elapsed = performance.now() - start;
        return {
          allowed: false,
          decision: 'BLOCK',
          reason: 'EXFILTRATION_DIODE_TRIGGERED',
          detail: 'Outbound request blocked because session contains tainted sensitive file reads',
          taintedSources: Array.from(session.taintedSources),
          target,
          latencyMs: Number(elapsed.toFixed(3))
        };
      }
    }

    // Rate limiting for external requests
    const rateLimitConfig = session.rateLimits[target] || session.rateLimits['http:request'] || session.rateLimits['default'];
    if (rateLimitConfig) {
      const withinLimit = checkRateLimit(
        session,
        `http:${target}`,
        rateLimitConfig.maxCount,
        rateLimitConfig.windowSeconds
      );
      if (!withinLimit) {
        const elapsed = performance.now() - start;
        return {
          allowed: false,
          decision: 'BLOCK',
          reason: 'RATE_LIMIT_EXCEEDED',
          detail: `Exceeded ${rateLimitConfig.maxCount} requests per ${rateLimitConfig.windowSeconds}s`,
          target,
          latencyMs: Number(elapsed.toFixed(3))
        };
      }
    }

    // 5. Credential Injection Diode (Zero-Secret-Egress)
    let transformedParams = { ...params };
    let injectedAuth = false;

    for (const route of session.credentialRoutes) {
      if (target.includes(route.match)) {
        // Strip dummy placeholder token if present
        if (transformedParams.headers) {
          const headers = { ...transformedParams.headers };
          if (headers.Authorization && headers.Authorization.includes('placeholder')) {
            headers.Authorization = route.inject;
            injectedAuth = true;
          } else if (route.header && route.inject) {
            headers[route.header] = route.inject;
            injectedAuth = true;
          }
          transformedParams.headers = headers;
        } else if (route.header && route.inject) {
          transformedParams.headers = { [route.header]: route.inject };
          injectedAuth = true;
        }
      }
    }

    session.history.push({
      type,
      target,
      timestamp: Date.now(),
      verdict: 'ALLOW',
      credentialInjected: injectedAuth
    });

    const elapsed = performance.now() - start;
    return {
      allowed: true,
      decision: 'ALLOW',
      reason: 'EGRESS_POLICY_PERMITTED',
      injectedAuth,
      transformedParams: injectedAuth ? transformedParams : undefined,
      latencyMs: Number(elapsed.toFixed(3))
    };
  }

  // 6. Default allow for conforming operations within workspace
  session.history.push({
    type,
    target,
    timestamp: Date.now(),
    verdict: 'ALLOW'
  });

  const elapsed = performance.now() - start;
  return {
    allowed: true,
    decision: 'ALLOW',
    reason: 'ACTION_PERMITTED_IN_BOX',
    latencyMs: Number(elapsed.toFixed(3))
  };
}

module.exports = {
  createBoxSession,
  decomposeCommand,
  checkRateLimit,
  evaluateBoxAction,
  EVENT_FS_READ,
  EVENT_FS_WRITE,
  EVENT_FS_DELETE,
  EVENT_HTTP_REQUEST,
  EVENT_MCP_CALL,
  EVENT_SHELL_EXEC
};
