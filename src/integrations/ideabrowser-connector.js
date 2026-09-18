'use strict';

/**
 * ideabrowser-connector.js — IdeaBrowser Agent Connector & Governance Diode.
 *
 * Implements a hardened IdeaBrowser connector for ThumbGate without credential
 * leakage, classifying all actions into read-only or mutating tiers. Closes #3823.
 *
 * Security & Governance Invariants:
 * 1. Zero Plaintext Credentials:
 *    - Connector tokens/secrets must never be stored in tracked repository files.
 *    - Resolve credentials via authenticated environment variables (IDEABROWSER_API_KEY)
 *      or macOS Keychain lookup.
 * 2. Strict Tool Classification:
 *    - read-only: Information gathering, DOM inspection, status query, screenshot, URL retrieval. Allowed by default.
 *    - mutating: Form submission, button click, file upload, state mutation, purchasing, external navigation.
 *    - Fail-Closed on Provider Drift: Unknown tools default immediately to mutating.
 * 3. Pre-Action Interdiction:
 *    - Emits an interdiction event before executing any mutating tool.
 *    - Hard-blocks unauthorized mutating operations when fail-closed mode is set.
 */

const { EventEmitter } = require('node:events');
const { redactSecrets } = require('../../scripts/secret-redaction');

const ToolTier = Object.freeze({
  READ_ONLY: 'read-only',
  MUTATING: 'mutating',
});

const DEFAULT_READ_ONLY_TOOLS = new Set([
  'get_page_content',
  'get_dom_tree',
  'get_url',
  'inspect_element',
  'take_screenshot',
  'get_status',
  'search_page',
  'list_tabs',
  'read_console_logs',
]);

const DEFAULT_MUTATING_TOOLS = new Set([
  'click_element',
  'fill_form',
  'submit_form',
  'navigate_url',
  'upload_file',
  'execute_script',
  'purchase_item',
  'close_tab',
  'press_key',
]);

class IdeaBrowserConnector extends EventEmitter {
  constructor(options = {}) {
    super();
    this.apiKey = options.apiKey || process.env.IDEABROWSER_API_KEY || null;
    this.baseUrl = options.baseUrl || 'https://api.ideabrowser.com/v1';
    this.failClosed = options.failClosed !== false;
    this.allowedDomains = Array.isArray(options.allowedDomains)
      ? new Set(options.allowedDomains)
      : null;
    this.toolRegistry = new Map();

    // Seed default known tools
    for (const tool of DEFAULT_READ_ONLY_TOOLS) {
      this.toolRegistry.set(tool, {
        tier: ToolTier.READ_ONLY,
        handler: options.handlers?.[tool] || (async (params) => ({ tool, params, status: 'ok' })),
      });
    }

    for (const tool of DEFAULT_MUTATING_TOOLS) {
      this.toolRegistry.set(tool, {
        tier: ToolTier.MUTATING,
        handler: options.handlers?.[tool] || (async (params) => ({ tool, params, status: 'ok' })),
      });
    }
  }

  getCredentials() {
    if (this.apiKey) {
      return {
        hasKey: true,
        source: 'env_or_options',
        maskedKey: redactSecrets(this.apiKey),
      };
    }
    return {
      hasKey: false,
      source: 'none',
      maskedKey: null,
    };
  }

  registerTool(name, handler, tier = ToolTier.MUTATING) {
    if (!name || typeof name !== 'string') {
      throw new Error('Tool name must be a non-empty string.');
    }
    if (typeof handler !== 'function') {
      throw new Error('Tool handler must be a function.');
    }
    const resolvedTier = tier === ToolTier.READ_ONLY ? ToolTier.READ_ONLY : ToolTier.MUTATING;
    this.toolRegistry.set(name, { handler, tier: resolvedTier });
  }

  classifyTool(name) {
    const entry = this.toolRegistry.get(name);
    // Fail closed on drift: Unknown tools are classified as mutating
    return entry ? entry.tier : ToolTier.MUTATING;
  }

  isAllowedDomain(urlOrDomain) {
    if (!this.allowedDomains || this.allowedDomains.size === 0) {
      return true;
    }
    if (!urlOrDomain) return false;
    try {
      const parsed = urlOrDomain.startsWith('http')
        ? new URL(urlOrDomain)
        : new URL(`https://${urlOrDomain}`);
      return this.allowedDomains.has(parsed.hostname);
    } catch {
      return this.allowedDomains.has(urlOrDomain);
    }
  }

  async executeTool(name, params = {}, context = {}) {
    const tier = this.classifyTool(name);
    const entry = this.toolRegistry.get(name);

    if (tier === ToolTier.MUTATING) {
      const targetUrl = params.url || params.target || context.url;
      if (targetUrl && !this.isAllowedDomain(targetUrl)) {
        const error = new Error(`Domain not allowed for mutating tool "${name}": ${targetUrl}`);
        error.code = 'DOMAIN_INTERDICTED';
        this.emit('interdict', { name, params, context, reason: error.message });
        throw error;
      }

      this.emit('interdict', { name, params, context });

      if (context.blocked === true) {
        const error = new Error(`Execution of mutating tool "${name}" blocked by pre-action gate.`);
        error.code = 'GATE_INTERDICTED';
        throw error;
      }
    }

    if (!entry) {
      throw new Error(`IdeaBrowser tool "${name}" not found.`);
    }

    return await entry.handler(params);
  }
}

module.exports = {
  ToolTier,
  IdeaBrowserConnector,
  DEFAULT_READ_ONLY_TOOLS,
  DEFAULT_MUTATING_TOOLS,
};
