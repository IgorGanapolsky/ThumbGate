'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BRAND_STANDARDS_PATH = path.join(__dirname, '..', 'config', 'brand-standards.json');
const CREATIVE_EXT_RE = /\.(?:psd|psb|ai|indd|prproj|aep)$/i;
const CREATIVE_BACKUP_STEM_RE = /(?:[_.-](?:copy|backup|bak|draft|working)|\.copy)\.[a-z0-9]+$/i;
// [ \t]* (not \s*) after a line start keeps this linear on long runs of newlines (CodeQL js/polynomial-redos).
const LINE_LABEL_RE = /^[ \t]*(?:Problem|Solution|Fix|Note|TL;DR|Hook|CTA|Why it matters)[ \t]*:/m;
const PRICE_TOKEN_RE = /\$\d[\d,]*(?:\.\d{1,2})?(?:\s*\/\s*(?:mo|month|yr|year|seat))?/gi;
const URL_TOKEN_RE = /https?:\/\/[^\s<>()"'\]]+/gi;

const OUTBOUND_POST_CONTEXT_KEYWORDS = [
  'post', 'linkedin', 'bluesky', 'tweet', 'twitter', 'threads', 'reddit',
  'newsletter', 'substack', 'medium', 'social', 'copy', 'listing', 'pitch',
  'brand', 'voice', 'jargon', 'refund', 'guarantee', 'price', 'headline',
];

function loadBrandStandards(configPath = DEFAULT_BRAND_STANDARDS_PATH) {
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}

function detectBrandFromText(text, explicitBrand) {
  if (explicitBrand) {
    const norm = String(explicitBrand).trim().toLowerCase();
    if (norm === 'mac-yolo' || norm === 'macyolo') return 'mac-yolo';
    if (norm === 'thumbgate') return 'thumbgate';
  }
  const lower = String(text || '').toLowerCase();
  const mentionsMacYolo = lower.includes('mac yolo') || lower.includes('macyolosafeguards');
  const mentionsThumbGate = lower.includes('thumbgate');
  if (mentionsMacYolo && !mentionsThumbGate) return 'mac-yolo';
  return 'thumbgate';
}

function extractDistinctPrices(text) {
  const seen = [];
  const source = String(text || '');
  PRICE_TOKEN_RE.lastIndex = 0;
  let m = PRICE_TOKEN_RE.exec(source);
  while (m !== null) {
    const raw = m[0].replace(/\s+/g, '');
    // Ignore "<$50 card limit" threshold comparisons only? No — "$50" in "<$50" is a price figure,
    // but to match exact listed prices cleanly, ignore tokens immediately preceded by "<" or ">".
    const prevChar = m.index > 0 ? source[m.index - 1] : '';
    if (prevChar !== '<' && prevChar !== '>' && !seen.includes(raw)) {
      seen.push(raw);
    }
    m = PRICE_TOKEN_RE.exec(source);
  }
  return seen;
}

function extractUrls(text) {
  const urls = [];
  const source = String(text || '');
  URL_TOKEN_RE.lastIndex = 0;
  let m = URL_TOKEN_RE.exec(source);
  while (m !== null) {
    const cleaned = m[0].replace(/[.,;:!?)]+$/, '');
    if (!urls.includes(cleaned)) urls.push(cleaned);
    m = URL_TOKEN_RE.exec(source);
  }
  return urls;
}

function findCaseInsensitivePhrase(haystack, needle) {
  const lowerHay = haystack.toLowerCase();
  const lowerNeedle = String(needle || '').toLowerCase().trim();
  if (!lowerNeedle) return null;
  const idx = lowerHay.indexOf(lowerNeedle);
  if (idx === -1) return null;
  // Require word boundaries on alphanumeric edges so short tokens never substring-collide
  const startAlpha = /[a-z0-9]/i.test(lowerNeedle[0]);
  const endAlpha = /[a-z0-9]/i.test(lowerNeedle[lowerNeedle.length - 1]);
  if (startAlpha && idx > 0 && /[a-z0-9]/i.test(lowerHay[idx - 1])) return null;
  const afterIdx = idx + lowerNeedle.length;
  if (endAlpha && afterIdx < lowerHay.length && /[a-z0-9]/i.test(lowerHay[afterIdx])) return null;
  return haystack.slice(idx, afterIdx);
}

/**
 * Generates a plain-words rewrite following post-like-igor rules:
 * - Plain words, real full sentences, proper capitalization and periods
 * - Strips off-brand real-estate / cross-product / refund-guarantee / stacked-jargon sentences
 * - Strips line-start labels ("Problem:", "Fix:", etc.) and em-dashes
 * - Keeps at most ONE verified price and ONE canonical product link
 */
function rewriteInIgorVoice(rawText, options = {}) {
  const config = options.config || loadBrandStandards(options.configPath);
  const brandKey = detectBrandFromText(rawText, options.brand);
  const brandCfg = (config.brands && config.brands[brandKey]) || config.brands.thumbgate;

  const bannedPhrases = [];
  for (const rule of config.rules || []) {
    for (const p of rule.phrases || []) bannedPhrases.push(p);
  }
  for (const cp of brandCfg.crossProductForbidden || []) {
    bannedPhrases.push(cp);
  }

  // Split into candidate sentences while protecting decimal numbers (e.g. 0.5ms, 197.552, $9.99)
  const normalized = String(rawText || '')
    .replace(/^[ \t]*(?:Problem|Solution|Fix|Note|TL;DR|Hook|CTA|Why it matters)[ \t]*:[ \t]*/gim, '')
    .replace(/[\u2014\u2013]/g, ', ')
    .replace(/\r\n/g, '\n');

  const rawChunks = normalized
    .split(/\n+/)
    .flatMap((para) => para.split(/(?<=[.!?])\s+(?=[A-Z0-9"$])/))
    .map((s) => s.trim())
    .filter(Boolean);

  const keptSentences = [];
  let keptPrice = null;
  let keptUrl = null;

  for (let chunk of rawChunks) {
    // Drop any sentence containing real-estate, cross-product, unverified guarantee, or stacked-jargon phrases
    const hitsBanned = bannedPhrases.some((phrase) => findCaseInsensitivePhrase(chunk, phrase) !== null);
    if (hitsBanned) continue;

    // Enforce at most 1 URL
    const chunkUrls = extractUrls(chunk);
    if (chunkUrls.length > 0) {
      const allowedUrl = chunkUrls.find((u) =>
        (brandCfg.allowedDomains || []).some((dom) => u.toLowerCase().includes(dom.toLowerCase())),
      );
      if (!allowedUrl) continue;
      if (keptUrl && keptUrl !== allowedUrl) {
        chunk = chunk.replace(URL_TOKEN_RE, '').replace(/\s{2,}/g, ' ').trim();
      } else {
        keptUrl = allowedUrl;
        for (const extraUrl of chunkUrls) {
          if (extraUrl !== allowedUrl) {
            chunk = chunk.split(extraUrl).join('').replace(/\s{2,}/g, ' ').trim();
          }
        }
      }
    }

    // Enforce at most 1 verified price across the entire post
    const chunkPrices = extractDistinctPrices(chunk);
    if (chunkPrices.length > 0) {
      const firstVerified = chunkPrices.find((p) =>
        (brandCfg.verifiedPrices || []).some((vp) => vp.toLowerCase() === p.toLowerCase()),
      );
      if (!firstVerified || chunkPrices.length > 1 || (keptPrice && keptPrice !== firstVerified)) {
        continue;
      }
      keptPrice = firstVerified;
    }

    // Clean leftover punctuation/list prefixes and ensure proper capitalization + full stop
    chunk = chunk.replace(/^[-*•\d.)]+\s*/, '').replace(/\s{2,}/g, ' ').trim();
    if (!chunk) continue;
    chunk = chunk[0].toUpperCase() + chunk.slice(1);
    if (!/[.!?]$/.test(chunk)) chunk += '.';
    keptSentences.push(chunk);
  }

  if (keptSentences.length === 0) {
    if (brandKey === 'mac-yolo') {
      return `Mac YOLO Safeguards stops runaway local agent loops and swap exhaustion on macOS before your Mac freezes. See ${brandCfg.canonicalOrigin}.`;
    }
    return `ThumbGate checks shell, git, file, and MCP tool calls locally before they run, and turns thumbs-down feedback into local rules. Install free with npx thumbgate init at ${brandCfg.canonicalOrigin}.`;
  }

  const joined = keptSentences.slice(0, 3).join(' ');
  if (!extractUrls(joined).length && brandCfg.canonicalOrigin) {
    return `${joined} Learn more at ${brandCfg.canonicalOrigin}.`;
  }
  return joined;
}

/**
 * Evaluates outbound text against `config/brand-standards.json` plus voice rules
 * (stacked jargon, line-start labels, >1 price, unverified prices/claims, cross-product conflation).
 */
function evaluateBrandStandards(text, options = {}) {
  const content = String(text || '').trim();
  const config = options.config || loadBrandStandards(options.configPath);
  const brand = detectBrandFromText(content, options.brand);
  const brandCfg = (config.brands && config.brands[brand]) || config.brands.thumbgate;
  const violations = [];

  if (!content) {
    return { allowed: true, brand, violations: [], rewriteSuggestion: null, message: null };
  }

  // 1. Declarative phrase rules from config/brand-standards.json
  for (const rule of config.rules || []) {
    for (const phrase of rule.phrases || []) {
      const matched = findCaseInsensitivePhrase(content, phrase);
      if (matched) {
        violations.push({
          ruleId: rule.id,
          phrase: matched,
          description: rule.description,
        });
        break;
      }
    }
  }

  // 2. Cross-product conflation check
  for (const otherProduct of brandCfg.crossProductForbidden || []) {
    const matched = findCaseInsensitivePhrase(content, otherProduct);
    if (matched) {
      // Avoid duplicating if already caught by no-real-estate-or-tax-deed
      if (!violations.some((v) => v.phrase.toLowerCase() === matched.toLowerCase())) {
        violations.push({
          ruleId: 'no-cross-product-conflation',
          phrase: matched,
          description: `Do not mention other products (${matched}) in ${brandCfg.name} outbound copy.`,
        });
      }
    }
  }

  // 3. Voice check: line-start bot labels ("Problem:", "Fix:", etc.)
  const labelMatch = LINE_LABEL_RE.exec(content);
  if (labelMatch) {
    violations.push({
      ruleId: 'voice-no-line-labels',
      phrase: labelMatch[0].trim(),
      description: 'Do not start lines with bot-style labels like Problem:, Fix:, or Solution:.',
    });
  }

  // 4. Voice check: more than one price in a single post, or unverified price for the brand
  const prices = extractDistinctPrices(content);
  const maxPrices = Number.isFinite(config.maxPricesPerPost) ? config.maxPricesPerPost : 1;
  if (prices.length > maxPrices) {
    violations.push({
      ruleId: 'voice-single-price-per-post',
      phrase: prices.join(', '),
      description: `Use at most ${maxPrices} price in a single outbound post (found ${prices.length}: ${prices.join(', ')}).`,
    });
  }
  const verifiedLower = new Set((brandCfg.verifiedPrices || []).map((p) => p.toLowerCase()));
  for (const p of prices) {
    if (!verifiedLower.has(p.toLowerCase())) {
      violations.push({
        ruleId: 'voice-unverified-price-claim',
        phrase: p,
        description: `Price ${p} is not listed on ${brandCfg.canonicalOrigin}.`,
      });
    }
  }

  if (violations.length === 0) {
    return {
      allowed: true,
      brand,
      violations: [],
      rewriteSuggestion: null,
      message: null,
    };
  }

  const rewriteSuggestion = rewriteInIgorVoice(content, { config, brand });
  const ruleSummary = violations.map((v) => `${v.ruleId} ("${v.phrase}")`).join('; ');
  const message =
    `Brand standards gate denied outbound copy — violated ${ruleSummary}. ` +
    `Plain-words rewrite: ${rewriteSuggestion}`;

  return {
    allowed: false,
    brand,
    violations,
    rewriteSuggestion,
    message,
  };
}

function extractCliFlagValue(command, flagNames) {
  for (const flag of flagNames) {
    const idx = command.indexOf(flag);
    if (idx === -1) continue;
    let rest = command.slice(idx + flag.length).trimStart();
    if (rest.startsWith('=')) rest = rest.slice(1).trimStart();
    if (rest.startsWith('"') || rest.startsWith("'")) {
      const q = rest[0];
      let end = 1;
      while (end < rest.length && rest[end] !== q) {
        if (rest[end] === '\\') end += 2;
        else end += 1;
      }
      return rest.slice(1, end);
    }
    const sp = rest.search(/\s/);
    return sp === -1 ? rest : rest.slice(0, sp);
  }
  return null;
}

/**
 * Extracts outbound publish text (or Adobe Creative Cloud local MCP file targets)
 * from a proposed PreToolUse call. Returns null for non-outbound developer actions.
 */
function inspectOutboundOrCreativeToolCall(toolName, toolInput = {}) {
  const name = String(toolName || '').trim();
  const cmd = String(toolInput.command || '').trim();
  const filePath = String(toolInput.file_path || toolInput.path || toolInput.outputPath || '').trim();

  // 1. Creative file protection (Adobe Creative Cloud local MCP preview & native project files)
  const isCreativeTool = /(?:photoshop|illustrator|indesign|premiere|after[_-]?effects|adobe|creative)/i.test(name);
  const isExportOrPublish = /(?:export|publish|render|share)/i.test(`${name} ${String(toolInput.action || '')}`);

  if (isCreativeTool && isExportOrPublish) {
    return {
      kind: 'creative_export_publish',
      target: filePath || name,
    };
  }

  const isAdobeOrFileWrite = ['Write', 'Edit', 'MultiEdit'].includes(name) || isCreativeTool;
  if (isAdobeOrFileWrite && filePath && CREATIVE_EXT_RE.test(filePath)) {
    if (!CREATIVE_BACKUP_STEM_RE.test(path.basename(filePath)) && toolInput.savedCopyVerified !== true) {
      return {
        kind: 'creative_overwrite',
        filePath,
      };
    }
  }

  // Never treat local source-code Edit/Write/Read/Glob/Grep as outbound publishing
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Read', 'Glob', 'Grep', 'LS'].includes(name)) {
    return null;
  }

  // 2. MCP social / email / browser publish tools
  if (/^mcp__(?:zernio|linkedin|bluesky|threads|reddit|gmail|resend|substack|medium)/i.test(name)) {
    const body = [toolInput.text, toolInput.body, toolInput.content, toolInput.post, toolInput.caption, toolInput.subject]
      .filter(Boolean)
      .join('\n');
    if (body) return { kind: 'outbound_copy', text: body, brand: toolInput.brand };
  }

  if (/browseros[-_]neo|dayglass_browser_(?:type|fill)/i.test(name)) {
    const codeOrText = String(toolInput.code || toolInput.text || toolInput.value || '');
    const hitsSocialCompose = /(?:linkedin\.com\/(?:sharing|feed|posts)|bsky\.app|threads\.(?:com|net)|(?:x|twitter)\.com\/(?:compose|intent)|reddit\.com\/r\/.*\/submit|substack\.com|medium\.com)/i.test(
      `${codeOrText} ${String(toolInput.url || '')}`,
    );
    if (hitsSocialCompose && codeOrText) {
      return { kind: 'outbound_copy', text: codeOrText, brand: toolInput.brand };
    }
  }

  // 3. Bash outbound publishing commands
  if (name === 'Bash' && cmd) {
    // Skip local developer/test/git commands immediately
    if (/^(?:git|rg|grep|ls|cat|head|tail|wc|find)\b/.test(cmd) || /^node\s+--test\b/.test(cmd) || /^npm\s+(?:test|run\s+test)\b/.test(cmd)) {
      return null;
    }

    // gh issue comment / gh pr comment
    if (/\bgh\s+(?:issue|pr)\s+comment\b/.test(cmd)) {
      const body = extractCliFlagValue(cmd, ['--body', '-b']) || cmd;
      return { kind: 'outbound_copy', text: body, channel: 'github_comment' };
    }

    // Social / newsletter / email CLI publishers
    if (
      /(?:scripts\/(?:post-everywhere|publish-bluesky|social-post-hourly|publish-linkedin|social-analytics\/publishers|medium-weekly)|api\.linkedin\.com|ugcPosts|com\.atproto\.repo\.createRecord|dev\.to\/api\/articles|api\.medium\.com|sendmail\b|msmtp\b)/.test(
        cmd,
      )
    ) {
      const explicitText = extractCliFlagValue(cmd, ['--text', '--body', '--comment', '-d', '--data', '--data-raw']);
      return { kind: 'outbound_copy', text: explicitText || cmd };
    }
  }

  return null;
}

/**
 * PreToolUse hook adapter for `scripts/gates-engine.js`.
 */
function applyBrandStandardsPretool(toolName, toolInput = {}, options = {}) {
  const inspected = inspectOutboundOrCreativeToolCall(toolName, toolInput);
  if (!inspected) return null;

  if (inspected.kind === 'creative_overwrite') {
    return {
      decision: 'deny',
      gate: 'brand-standards-gate',
      ruleId: 'creative-no-overwrite-original',
      severity: 'critical',
      message: `Brand standards gate denied overwriting original creative project file "${inspected.filePath}" without a saved copy (e.g. write to *_copy${path.extname(inspected.filePath)} first).`,
      reasoning: ['rule: creative-no-overwrite-original', `target: ${inspected.filePath}`],
    };
  }

  if (inspected.kind === 'creative_export_publish') {
    return {
      decision: 'approve',
      gate: 'brand-standards-gate',
      ruleId: 'creative-export-publish-approval',
      severity: 'high',
      requiresApproval: true,
      message: `Exporting or publishing creative asset "${inspected.target}" via local MCP requires human approval.`,
      reasoning: ['rule: creative-export-publish-approval', `target: ${inspected.target}`],
    };
  }

  const verdict = evaluateBrandStandards(inspected.text, options);
  if (verdict.allowed) return null;

  return {
    decision: 'deny',
    gate: 'brand-standards-gate',
    ruleId: verdict.violations[0].ruleId,
    violations: verdict.violations,
    rewriteSuggestion: verdict.rewriteSuggestion,
    severity: 'critical',
    message: verdict.message,
    reasoning: verdict.violations.map((v) => `rule ${v.ruleId} matched "${v.phrase}"`),
  };
}

// ---------------------------------------------------------------------------
// Candidate Brand Rule Learning (held for human approval; never auto-applied)
// ---------------------------------------------------------------------------

function resolvePendingBrandRulesPath(options = {}) {
  const dir = options.feedbackDir || process.env.THUMBGATE_FEEDBACK_DIR || path.join(__dirname, '..', '.thumbgate', 'feedback');
  return path.join(dir, 'pending-brand-rules.json');
}

function listPendingBrandRules(options = {}) {
  const pendingPath = resolvePendingBrandRulesPath(options);
  if (!fs.existsSync(pendingPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePendingBrandRules(entries, options = {}) {
  const pendingPath = resolvePendingBrandRulesPath(options);
  fs.mkdirSync(path.dirname(pendingPath), { recursive: true });
  fs.writeFileSync(pendingPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
  return pendingPath;
}

function extractCandidatePhrase(blob) {
  // Prefer explicit quoted offending phrase ("7-day refund guarantee" or 'corporate-expensable')
  const dblIdx = blob.indexOf('"');
  if (dblIdx !== -1) {
    const closeIdx = blob.indexOf('"', dblIdx + 1);
    if (closeIdx > dblIdx + 2 && closeIdx - dblIdx <= 120) {
      return blob.slice(dblIdx + 1, closeIdx).trim();
    }
  }
  const sglIdx = blob.indexOf("'");
  if (sglIdx !== -1) {
    const closeIdx = blob.indexOf("'", sglIdx + 1);
    if (closeIdx > sglIdx + 2 && closeIdx - sglIdx <= 120) {
      return blob.slice(sglIdx + 1, closeIdx).trim();
    }
  }
  const cleaned = blob.replace(/^(?:never|do not|don't|stop)\s+(?:post|say|mention|include|promise)\s+/i, '').trim();
  return cleaned.slice(0, 80) || null;
}

function isBrandOrPostContentFeedback(feedbackEvent = {}) {
  const tags = Array.isArray(feedbackEvent.tags) ? feedbackEvent.tags.map((t) => String(t).toLowerCase()) : [];
  if (tags.some((t) => ['brand', 'post', 'social', 'linkedin', 'copy', 'voice', 'marketing'].includes(t))) {
    return true;
  }
  const combined = [
    feedbackEvent.context,
    feedbackEvent.whatWentWrong,
    feedbackEvent.whatToChange,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return OUTBOUND_POST_CONTEXT_KEYWORDS.some((kw) => findCaseInsensitivePhrase(combined, kw) !== null);
}

/**
 * Stages a candidate brand rule from a thumbs-down on post/copy content.
 * Held in `pending-brand-rules.json` with `status: 'pending_approval'` — NEVER auto-applied.
 */
function stageCandidateBrandRuleFromFeedback(feedbackEvent = {}, options = {}) {
  const signal = String(feedbackEvent.signal || '').toLowerCase();
  if (signal !== 'negative' && signal !== 'down') return null;
  if (!isBrandOrPostContentFeedback(feedbackEvent)) return null;

  const sourceText =
    feedbackEvent.whatWentWrong ||
    feedbackEvent.whatToChange ||
    feedbackEvent.context ||
    '';
  const candidatePhrase = extractCandidatePhrase(String(sourceText));
  if (!candidatePhrase || candidatePhrase.length < 3) return null;

  const existing = listPendingBrandRules(options);
  const dup = existing.find(
    (entry) =>
      entry.status === 'pending_approval' &&
      String(entry.phrase || '').toLowerCase() === candidatePhrase.toLowerCase(),
  );
  if (dup) return dup;

  const id = `brand_cand_${crypto.createHash('sha256').update(candidatePhrase.toLowerCase()).digest('hex').slice(0, 10)}`;
  const entry = {
    id,
    status: 'pending_approval',
    autoApplied: false,
    phrase: candidatePhrase,
    proposedRuleId: `learned-${candidatePhrase.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)}`,
    ruleChangePreview: `Rule change preview (tightening, held for human approval): outbound posts containing "${candidatePhrase}" will be denied before publish once approved.`,
    sourceFeedbackId: feedbackEvent.id || null,
    createdAt: new Date().toISOString(),
    approvedBy: null,
    approvedAt: null,
  };

  existing.push(entry);
  savePendingBrandRules(existing, options);
  return entry;
}

function approveCandidateBrandRule(candidateId, { approvedBy, feedbackDir, configPath = DEFAULT_BRAND_STANDARDS_PATH } = {}) {
  if (!approvedBy || !String(approvedBy).trim()) {
    throw new Error('approvedBy is required to approve a candidate brand rule');
  }
  const entries = listPendingBrandRules({ feedbackDir });
  const target = entries.find((e) => e.id === candidateId);
  if (!target) {
    throw new Error(`Candidate brand rule not found: ${candidateId}`);
  }
  target.status = 'approved';
  target.approvedBy = String(approvedBy).trim();
  target.approvedAt = new Date().toISOString();
  savePendingBrandRules(entries, { feedbackDir });

  const config = loadBrandStandards(configPath);
  config.rules = Array.isArray(config.rules) ? config.rules : [];
  config.rules.push({
    id: target.proposedRuleId,
    description: `Learned from human-approved feedback (${target.sourceFeedbackId || target.id}).`,
    phrases: [target.phrase],
  });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return target;
}

module.exports = {
  DEFAULT_BRAND_STANDARDS_PATH,
  loadBrandStandards,
  detectBrandFromText,
  extractDistinctPrices,
  rewriteInIgorVoice,
  evaluateBrandStandards,
  inspectOutboundOrCreativeToolCall,
  applyBrandStandardsPretool,
  listPendingBrandRules,
  stageCandidateBrandRuleFromFeedback,
  approveCandidateBrandRule,
};
