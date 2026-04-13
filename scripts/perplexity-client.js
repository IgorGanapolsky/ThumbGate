'use strict';

const DEFAULT_BASE_URL = 'https://api.perplexity.ai';
const DEFAULT_TIMEOUT_MS = 120000;

class PerplexityApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'PerplexityApiError';
    this.status = details.status || null;
    this.path = details.path || null;
    this.body = details.body || null;
  }
}

function redactSecrets(value) {
  return String(value || '')
    .replace(/pplx-[A-Za-z0-9_-]+/g, 'pplx-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***');
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function ensureLeadingSlash(value) {
  return String(value || '').startsWith('/') ? String(value) : `/${value}`;
}

function buildUrl(baseUrl, path) {
  return `${trimTrailingSlash(baseUrl || DEFAULT_BASE_URL)}${ensureLeadingSlash(path)}`;
}

function timeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

function parseJsonSafe(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function normalizeSearchResults(response) {
  const candidates =
    response?.results ||
    response?.data ||
    response?.output?.flatMap((item) => item.results || []) ||
    [];

  return candidates
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      rank: Number(item.rank || item.id || index + 1),
      title: String(item.title || item.name || 'Untitled result'),
      url: String(item.url || item.link || ''),
      snippet: String(item.snippet || item.summary || item.text || ''),
      source: String(item.source || ''),
      date: item.date || item.published_date || item.last_updated || null,
    }))
    .filter((item) => item.url);
}

function extractChatText(response) {
  return String(response?.choices?.[0]?.message?.content || '');
}

function extractAgentText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  if (typeof response?.text === 'string') return response.text;
  const output = Array.isArray(response?.output) ? response.output : [];
  const textParts = [];

  for (const item of output) {
    if (typeof item?.content === 'string') textParts.push(item.content);
    if (Array.isArray(item?.content)) {
      for (const part of item.content) {
        if (typeof part?.text === 'string') textParts.push(part.text);
        if (typeof part?.content === 'string') textParts.push(part.content);
      }
    }
    if (typeof item?.text === 'string') textParts.push(item.text);
  }

  return textParts.join('\n').trim();
}

function extractCitations(response) {
  const citations = response?.citations || response?.search_results || [];
  return Array.isArray(citations) ? citations : [];
}

class PerplexityClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.PERPLEXITY_API_KEY || '';
    this.baseUrl = options.baseUrl || process.env.PERPLEXITY_BASE_URL || DEFAULT_BASE_URL;
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.timeoutMs = Number(options.timeoutMs || process.env.PERPLEXITY_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

    if (typeof this.fetchFn !== 'function') {
      throw new PerplexityApiError('fetch is not available in this Node runtime');
    }
  }

  hasApiKey() {
    return Boolean(this.apiKey);
  }

  async requestJson(path, body, options = {}) {
    if (!this.apiKey) {
      throw new PerplexityApiError('PERPLEXITY_API_KEY is required for live Perplexity calls', { path });
    }

    const response = await this.fetchFn(buildUrl(this.baseUrl, path), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      body: JSON.stringify(body),
      signal: timeoutSignal(options.timeoutMs || this.timeoutMs),
    });

    const text = await response.text();
    const json = parseJsonSafe(text);
    if (!response.ok) {
      throw new PerplexityApiError(`Perplexity API ${response.status} on ${path}: ${redactSecrets(text)}`, {
        status: response.status,
        path,
        body: json,
      });
    }
    return json;
  }

  chatCompletion({ model = 'sonar-pro', messages, options = {} }) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new PerplexityApiError('chatCompletion requires at least one message');
    }
    return this.requestJson('/chat/completions', {
      model,
      messages,
      ...options,
    });
  }

  search({ query, maxResults = 5, maxTokensPerPage = 1024, options = {} }) {
    if (!query) throw new PerplexityApiError('search requires a query');
    return this.requestJson('/search', {
      query,
      max_results: maxResults,
      max_tokens_per_page: maxTokensPerPage,
      ...options,
    });
  }

  agentResponse({
    model = 'openai/gpt-5.4',
    input,
    instructions,
    tools,
    maxOutputTokens,
    options = {},
  }) {
    if (!input) throw new PerplexityApiError('agentResponse requires input');
    return this.requestJson('/v1/agent', {
      model,
      input,
      ...(instructions ? { instructions } : {}),
      ...(tools ? { tools } : {}),
      ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
      ...options,
    });
  }
}

module.exports = {
  DEFAULT_BASE_URL,
  PerplexityApiError,
  PerplexityClient,
  buildUrl,
  extractAgentText,
  extractChatText,
  extractCitations,
  normalizeSearchResults,
  redactSecrets,
};
