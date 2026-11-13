'use strict';

/**
 * Omnichannel Connectors Marketplace & SaaS Portfolio Engine
 *
 * Powers ThumbGate's distribution and 1-click connection across:
 *   1. Claude Connectors Marketplace (iOS, Web & Desktop .mcpb)
 *   2. Cursor Marketplace (.cursor-plugin/marketplace.json & cursor:// deep link)
 *   3. Gemini Extensions & Gemini on iPhone (com.google.gemini & gemini-extension.json)
 *   4. ChatGPT Connectors & GPT Actions (OpenAPI 3.1.0 + Remote MCP)
 *   5. xAI Grok (Grok Build & Grok Studio .mcp.json + Remote MCP)
 *   6. Perplexity (Perplexity Mac App & Hybrid Personal Computer MCP)
 *
 * Also enforces our SaaS-only product positioning across social/directory surfaces:
 *   - Dayglass (https://dayglass.io)
 *   - ThumbGate (https://thumbgate.ai)
 *   - Mac YOLO Safeguards (https://iganapolsky.gumroad.com/l/vcrho)
 */

const SAAS_PORTFOLIO = Object.freeze([
  {
    id: 'dayglass',
    name: 'Dayglass',
    tagline: 'Local-first macOS AI screen & meeting intelligence',
    url: 'https://dayglass.io',
    category: 'macOS Productivity & Memory SaaS',
  },
  {
    id: 'thumbgate',
    name: 'ThumbGate',
    tagline: 'Sub-0.5ms PreToolUse execution firewall & Remote MCP connector for AI agents',
    url: 'https://thumbgate.ai',
    proCheckoutUrl: 'https://thumbgate.ai/go/pro-direct',
    diagnosticCheckoutUrl: 'https://thumbgate.ai/go/diagnostic-direct',
    category: 'AI Agent Governance & Security SaaS',
  },
  {
    id: 'mac_yolo_safeguards',
    name: 'Mac YOLO Safeguards',
    tagline: 'Deterministic macOS autonomous agent guardrails & $49 Corporate Rule-Pack',
    url: 'https://iganapolsky.gumroad.com/l/vcrho',
    priceUsd: 49,
    category: 'Developer Security & Policy Pack',
  },
]);

const OMNICHANNEL_CONNECTORS = Object.freeze([
  {
    id: 'claude',
    name: 'Claude Connectors (iOS, Web & Code)',
    vendor: 'Anthropic',
    badge: 'CC',
    transport: 'streamable-http + stdio + .mcpb',
    remoteMcpUrl: 'https://thumbgate.ai/mcp',
    discoveryManifestUrl: 'https://thumbgate.ai/.well-known/mcp/server-card.json',
    cliInstallCommand: 'claude mcp add --transport http thumbgate https://thumbgate.ai/mcp',
    stdioFallbackCommand: 'claude mcp add thumbgate -- npx -y thumbgate@latest serve',
    mobileInstructions: 'In Claude iOS/Web → Settings → Connections → Add Custom Connector → enter https://thumbgate.ai/mcp',
    desktopBundleArtifact: '.artifacts/claude-desktop/thumbgate-claude-plugin-review-v1.39.0.zip',
  },
  {
    id: 'cursor',
    name: 'Cursor Marketplace & Composer',
    vendor: 'Anysphere',
    badge: 'CU',
    transport: 'streamable-http + stdio',
    remoteMcpUrl: 'https://thumbgate.ai/mcp',
    discoveryManifestUrl: 'https://thumbgate.ai/.well-known/mcp.json',
    cliInstallCommand: 'npx -y thumbgate@latest init --agent cursor',
    deepLinkUrl: 'cursor://anysphere.cursor-deeplink/mcp/install?name=thumbgate&config=eyJ1cmwiOiJodHRwczovL3RodW1iZ2F0ZS5haS9tY3AifQ==',
    marketplaceManifestPath: '.cursor-plugin/marketplace.json',
  },
  {
    id: 'gemini',
    name: 'Gemini (iPhone, CLI & Workspace)',
    vendor: 'Google',
    badge: 'GM',
    transport: 'streamable-http + function-declarations + usb-codriver',
    remoteMcpUrl: 'https://thumbgate.ai/mcp',
    discoveryManifestUrl: 'https://thumbgate.ai/.well-known/mcp.json',
    cliInstallCommand: 'gemini extensions install https://github.com/IgorGanapolsky/ThumbGate',
    adapterPath: 'adapters/gemini/function-declarations.json',
    iphoneBundleId: 'com.google.gemini',
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT Connectors & GPT Actions',
    vendor: 'OpenAI',
    badge: 'GP',
    transport: 'openapi-3.1 + streamable-http',
    remoteMcpUrl: 'https://thumbgate.ai/mcp',
    openApiSchemaUrl: 'https://thumbgate.ai/openapi.json',
    discoveryManifestUrl: 'https://thumbgate.ai/.well-known/mcp.json',
    cliInstallCommand: 'codex mcp install thumbgate https://thumbgate.ai/mcp',
    adapterPath: 'adapters/chatgpt/openapi.yaml',
  },
  {
    id: 'grok',
    name: 'Grok (Grok Build & Studio)',
    vendor: 'xAI',
    badge: 'GK',
    transport: 'streamable-http + stdio',
    remoteMcpUrl: 'https://thumbgate.ai/mcp',
    discoveryManifestUrl: 'https://thumbgate.ai/.well-known/mcp.json',
    cliInstallCommand: 'npx -y thumbgate@latest init --agent claude',
    adapterPath: 'adapters/xai-grok/README.md',
  },
  {
    id: 'perplexity',
    name: 'Perplexity (Mac App & Hybrid PC)',
    vendor: 'Perplexity AI',
    badge: 'PX',
    transport: 'streamable-http + stdio',
    remoteMcpUrl: 'https://thumbgate.ai/mcp',
    discoveryManifestUrl: 'https://thumbgate.ai/.well-known/mcp.json',
    cliInstallCommand: 'npx -y thumbgate@latest serve',
    adapterPath: 'adapters/perplexity/.mcp.json',
  },
]);

function getConnectorById(id) {
  const key = String(id || '').trim().toLowerCase();
  return OMNICHANNEL_CONNECTORS.find((c) => c.id === key) || null;
}

function validateSaaSProfileCompliance(profileText = '') {
  const text = String(profileText || '');
  const hasDayglass = /dayglass/i.test(text);
  const hasThumbGate = /thumbgate/i.test(text);
  const hasMacYolo = /yolo/i.test(text);
  const hasRealEstate = /tax[- ]deed|foreclosure|broward|miami-dade|bird dog/i.test(text);

  return {
    compliant: hasDayglass && hasThumbGate && hasMacYolo && !hasRealEstate,
    hasDayglass,
    hasThumbGate,
    hasMacYolo,
    hasRealEstate,
  };
}

module.exports = {
  SAAS_PORTFOLIO,
  OMNICHANNEL_CONNECTORS,
  getConnectorById,
  validateSaaSProfileCompliance,
};
