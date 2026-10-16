#!/usr/bin/env node
'use strict';

/**
 * scripts/corporate-email-isolation-diode.js
 *
 * 1. Hard Pre-Action Security Firewall (`gate:security:eci_corporate_email_isolation`)
 *    preventing any personal/ThumbGate/Boardy/Viktor agent, Playwright script, or MCP tool
 *    from ever sending, drafting, replying, CC'ing, or referencing ECI corporate email
 *    domains (`@ecisolutions.com`, `@ecinexus.com`, `@eci.com`) or interacting with
 *    corporate Microsoft Outlook.
 *
 * 2. Obsidian Enveloppe (`enveloppe/obsidian-enveloppe`) Vault Egress & Censor Compiler
 *    (`compileEnveloppeVaultNoteForEgress`):
 *    - Enforces `share: true` default-deny opt-in frontmatter gate before any vault note
 *      can be published or shared externally.
 *    - Executes Enveloppe's two-pass `censorText` scrubbing pipeline (`before` and `after`
 *      WikiLink-to-Markdown conversion, respecting `inCodeBlocks`).
 *    - Hard-blocks cross-boundary repo/channel routing (any note with ECI/PSN/DIST03
 *      markers is refused egress to personal GitHub, Gmail, Boardy, or Viktor).
 */

const FORBIDDEN_CORP_PATTERNS = [
  /@ecisolutions\.com\b/i,
  /@ecinexus\.com\b/i,
  /@eci\.com\b/i,
  /\becisolutions\.com\b/i,
  /\becinexus\.com\b/i,
  /\bMicrosoft Outlook\.app\b/i,
];

const DEFAULT_ENVELOPPE_CENSOR_RULES = [
  { entry: '/[a-zA-Z0-9._%+-]+@(?:ecisolutions|ecinexus|eci)\\.com/gi', replace: '[REDACTED_CORP_EMAIL]', after: false, inCodeBlocks: true },
  { entry: '/\\b10\\.10\\.\\d{1,3}\\.\\d{1,3}\\b/g', replace: '[REDACTED_CORP_IP]', after: false, inCodeBlocks: true },
  { entry: '/\\bDIST03-\\d+\\b/gi', replace: '[REDACTED_CORP_TICKET]', after: true, inCodeBlocks: true },
];

function evaluateCorporateEmailIsolationGate({
  toolName = '',
  commandOrPayload = '',
  recipients = [],
} = {}) {
  const startNs = process.hrtime.bigint();
  const recipStr = Array.isArray(recipients) ? recipients.join(' ') : String(recipients || '');
  const payloadStr = typeof commandOrPayload === 'string' ? commandOrPayload : JSON.stringify(commandOrPayload || {});
  const blob = `${toolName} ${recipStr} ${payloadStr}`;

  let decision = 'allow';
  let gateId = 'gate:security:personal_boundary_verified';
  let reason = 'Verified zero corporate ECI email/domain contamination';

  for (const rx of FORBIDDEN_CORP_PATTERNS) {
    if (rx.test(blob)) {
      decision = 'block';
      gateId = 'gate:security:eci_corporate_email_isolation';
      reason = `CRITICAL SECURITY BLOCK: Corporate ECI domain/client matched (${rx}) — personal/ThumbGate/Boardy agents must NEVER touch @ecisolutions.com, @ecinexus.com, or corporate Outlook`;
      break;
    }
  }

  // Also block bare display-name "Igor Ganapolsky" without explicit @gmail.com / @ganapolsky.com in email To/Cc fields
  if (
    decision === 'allow' &&
    /(?:gmail|send_email|create_draft|view=cm)/i.test(blob) &&
    /\bto=Igor(?:\+|%20|\s)Ganapolsky\b/i.test(blob) &&
    !/(?:iganapolsky@gmail\.com|igor@ganapolsky\.com)/i.test(blob)
  ) {
    decision = 'block';
    gateId = 'gate:security:ambiguous_self_recipient_autocomplete';
    reason = 'Blocked bare display-name recipient "Igor Ganapolsky" (can autocomplete to corporate address); require explicit iganapolsky@gmail.com';
  }

  const latencyMs = Number((Number(process.hrtime.bigint() - startNs) / 1e6).toFixed(3));
  return {
    decision,
    allowed: decision === 'allow',
    gateId,
    latencyMs,
    reason,
  };
}

function createRegexFromEnveloppeEntry(toReplace, withFlag) {
  let flags = withFlag;
  if (!flags) {
    const flagsMatch = toReplace.match(/\/([gimy]+)$/);
    flags = flagsMatch ? Array.from(new Set(flagsMatch[1].split(''))).join('') : 'g';
  }
  const body = toReplace.replace(/^\/(.+)\/[gimy]*$/, '$1');
  return new RegExp(body, flags);
}

function applyEnveloppeCensorPass(text, censorRules = DEFAULT_ENVELOPPE_CENSOR_RULES, after = false) {
  let out = String(text || '');
  const activeRules = censorRules.filter(r => Boolean(r.after) === Boolean(after));
  for (const censor of activeRules) {
    if (!censor.entry || !censor.entry.trim()) continue;
    const isRegex = /^\/.+\/[gimy]*$/.test(censor.entry);
    const pattern = isRegex ? createRegexFromEnveloppeEntry(censor.entry, censor.flags) : censor.entry;
    if (censor.inCodeBlocks) {
      out = out.replace(pattern, censor.replace);
    } else {
      // Replace only outside fenced/inline code blocks (stolen from Enveloppe replaceText)
      const parts = out.split(/(```[\s\S]*?```|`[^`]*`)/g);
      out = parts
        .map(segment => (segment.startsWith('`') ? segment : segment.replace(pattern, censor.replace)))
        .join('');
    }
  }
  return out;
}

function convertWikiLinksToMarkdown(text) {
  return String(text || '').replace(/(?<!!)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => {
    const label = (alias || target).trim();
    const slug = target.trim().replace(/\s+/g, '-').toLowerCase();
    return `[${label}](./${slug}.md)`;
  });
}

const SENSITIVE_EMBED_OR_CFO_RX =
  /(?:@ecisolutions\.com|@ecinexus\.com|@eci\.com|\bStockService\b|\bDIST03-\d+\b|\b10\.10\.20\.|\bDebts\b|\bBudget\b|\baccount_mask\b|\bbalance_usd\b|\bapr_pct\b)/i;

/**
 * Compile and gate an Obsidian vault note for external publishing (Enveloppe steal).
 * Supports:
 * - Default-deny `share: true` (or repo-specific `shareKey`, e.g., `share_thumbgate: true`)
 * - Disjoint corporate vs. personal `shareKey` isolation
 * - Transitive embed/transclusion diode (`![[ChildNote]]` inspected against `vaultNotes` and sensitive markers)
 * - Two-pass `censorText` scrubbing (`before` and `after` WikiLink conversion, respecting `inCodeBlocks`)
 */
function compileEnveloppeVaultNoteForEgress({
  frontmatter = {},
  body = '',
  targetRepo = 'IgorGanapolsky/ThumbGate',
  shareKey = 'share',
  vaultNotes = {},
  censorRules = DEFAULT_ENVELOPPE_CENSOR_RULES,
} = {}) {
  // 1. Default-deny: must explicitly set the configured shareKey: true
  if (frontmatter[shareKey] !== true) {
    return {
      allowed: false,
      gateId: 'gate:enveloppe:share_false_default_deny',
      reason: `Vault note has ${shareKey} !== true; default-deny prevents accidental external publishing`,
    };
  }

  // 2. Cross-boundary repo & shareKey check: never allow ECI/PSN/StockService/CFO notes onto personal GitHub
  const rawBlob = `${JSON.stringify(frontmatter)} ${body}`;
  if (
    /IgorGanapolsky/i.test(targetRepo) &&
    (frontmatter.share_eci === true ||
      /(?:@ecisolutions\.com|@ecinexus\.com|@eci\.com|\bStockService\b|\bDIST03-\d+\b|\b10\.10\.20\.)/i.test(rawBlob))
  ) {
    return {
      allowed: false,
      gateId: 'gate:enveloppe:corp_to_personal_repo_blocked',
      reason: `Blocked corporate ECI/PSN note from publishing to personal target '${targetRepo}'`,
    };
  }

  if (/\b(?:account_mask|balance_usd|apr_pct)\b|\[\[(?:Debts|Budget|Institutions)\]\]/i.test(rawBlob)) {
    return {
      allowed: false,
      gateId: 'gate:enveloppe:cfo_finance_diode_blocked',
      reason: `Blocked private CFO financial note from publishing to '${targetRepo}'`,
    };
  }

  // 3. Transitive Embed / Transclusion Diode (`![[Target]]`)
  const embedMatches = Array.from(String(body || '').matchAll(/!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g));
  for (const m of embedMatches) {
    const rawTarget = m[1].trim();
    if (/\.base$/i.test(rawTarget)) continue; // .base views are stripped before publish
    const child = vaultNotes[rawTarget] || vaultNotes[`${rawTarget}.md`];
    if (child) {
      const childFm = child.frontmatter || {};
      const childBlob = `${JSON.stringify(childFm)} ${child.body || ''}`;
      if (childFm[shareKey] !== true || SENSITIVE_EMBED_OR_CFO_RX.test(childBlob)) {
        return {
          allowed: false,
          gateId: 'gate:enveloppe:transitive_embed_leak_blocked',
          reason: `Blocked transitive embed '![[${rawTarget}]]' because child note is not ${shareKey}:true or contains isolated corporate/financial data`,
        };
      }
    } else if (SENSITIVE_EMBED_OR_CFO_RX.test(rawTarget)) {
      return {
        allowed: false,
        gateId: 'gate:enveloppe:transitive_embed_leak_blocked',
        reason: `Blocked sensitive transitive embed target '![[${rawTarget}]]'`,
      };
    }
  }

  // 4. Strip private Enveloppe comments (`%% ... %%`, `<!-- enveloppe:private:start -->...`) & `.base` embeds
  const strippedBody = String(body || '')
    .replace(/<!--\s*enveloppe:private:start\s*-->[\s\S]*?<!--\s*enveloppe:private:end\s*-->/gi, '')
    .replace(/%%[\s\S]*?%%/g, '')
    .replace(/!\[\[[^\]]+\.base\]\]\n?/gi, '');

  // 5. Pass 1 censor (before link compilation) -> WikiLink compilation -> Pass 2 censor (after)
  const pass1 = applyEnveloppeCensorPass(strippedBody, censorRules, false);
  const compiledLinks = convertWikiLinksToMarkdown(pass1);
  const compiledBody = applyEnveloppeCensorPass(compiledLinks, censorRules, true);

  return {
    allowed: true,
    gateId: 'gate:enveloppe:verified_egress',
    targetRepo,
    shareKey,
    compiledBody,
  };
}

/**
 * Reconcile downstream repository files when vault notes are depublished (`share: false`) or deleted
 * (stolen from Enveloppe's `autoClean` + `autoclean.excluded` architecture).
 */
function reconcileEnveloppeAutoClean({
  vaultNotes = [],
  publishedRepoPaths = [],
  excludedPaths = ['README.md', 'docs/index.md', 'CLAUDE.md', 'AGENTS.md'],
  shareKey = 'share',
} = {}) {
  const activeSharedPaths = new Set(
    vaultNotes
      .filter(n => n && n.frontmatter && n.frontmatter[shareKey] === true && n.targetPath)
      .map(n => String(n.targetPath).replace(/^\/+/, ''))
  );
  const excludedSet = new Set(excludedPaths.map(p => String(p).replace(/^\/+/, '')));

  const toDelete = [];
  const retained = [];
  for (const rawPath of publishedRepoPaths) {
    const cleanPath = String(rawPath).replace(/^\/+/, '');
    if (excludedSet.has(cleanPath) || activeSharedPaths.has(cleanPath)) {
      retained.push(cleanPath);
    } else {
      toDelete.push(cleanPath);
    }
  }
  return {
    autoCleanEnabled: true,
    activeSharedCount: activeSharedPaths.size,
    retained,
    toDelete,
  };
}

const ENVELOPPE_STEAL_MAP = [
  {
    enveloppeFeature: 'Opt-in frontmatter share:true + per-repo shareKey (multipleRepo / shortRepo)',
    thumbgateRail: 'compileEnveloppeVaultNoteForEgress() + disjoint shareKey (share vs share_eci)',
    securityGuarantee: 'Default-deny; corporate ECI notes (share_eci) can never route to personal repos/Gmail/Boardy',
  },
  {
    enveloppeFeature: 'Two-pass regex censorText (before & after WikiLink conversion, inCodeBlocks)',
    thumbgateRail: 'applyEnveloppeCensorPass() + DEFAULT_ENVELOPPE_CENSOR_RULES',
    securityGuarantee: 'Scrubs @ecisolutions.com, @ecinexus.com, 10.10.*.*, and DIST03-* before & after link compilation',
  },
  {
    enveloppeFeature: 'Transclusion / embed baking (![[Note]]) & private %% comment stripping',
    thumbgateRail: 'Transitive Embed Diode (gate:enveloppe:transitive_embed_leak_blocked)',
    securityGuarantee: 'Blocks any share:true note that embeds a share:false, corporate ECI, or CFO financial note',
  },
  {
    enveloppeFeature: 'autoClean depublish pruning with autoclean.excluded path protection',
    thumbgateRail: 'reconcileEnveloppeAutoClean()',
    securityGuarantee: 'Automatically prunes depublished notes from downstream repos without touching README/AGENTS.md',
  },
];

if (require.main === module) {
  const args = process.argv.slice(2);
  const mapOnly = args.includes('--map-only');
  const sampleCheck = evaluateCorporateEmailIsolationGate({
    toolName: 'gmail_send',
    recipients: ['iganapolsky@ecisolutions.com'],
  });
  const payload = {
    status: 'ok',
    source: 'https://github.com/enveloppe/obsidian-enveloppe',
    stealMap: ENVELOPPE_STEAL_MAP,
    ...(mapOnly ? {} : { sampleCorporateIsolationCheck: sampleCheck }),
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

module.exports = {
  FORBIDDEN_CORP_PATTERNS,
  DEFAULT_ENVELOPPE_CENSOR_RULES,
  ENVELOPPE_STEAL_MAP,
  evaluateCorporateEmailIsolationGate,
  applyEnveloppeCensorPass,
  convertWikiLinksToMarkdown,
  compileEnveloppeVaultNoteForEgress,
  reconcileEnveloppeAutoClean,
};
