'use strict';

/**
 * NVIDIA OpenShell (v0.1.8) + Adobe MAX Nov-2026 + Lovable AST Self-Correcting Design Engine.
 */
const PROVER_COVERAGE_DOMAINS = Object.freeze(['filesystem', 'network_l4', 'network_rest', 'process', 'landlock']);
const MODELED_PROTOCOLS = new Set(['tcp', 'rest']);
const OPAQUE_L4_BINARIES = new Set(['git', 'ssh', 'scp', 'sftp', 'nc', 'ncat', 'netcat', 'socat', 'openssl', 'telnet']);
const DB_OR_CACHE_PORTS = new Set([3306, 5432, 6379, 9200, 11211, 27017]);
const LAYERED_PROJECT_EXT_RE = /\.(psd|psb|ai|prproj|aep|indd|fig|sketch|svg)$/i;
const DESTRUCTIVE_ASSET_OP_RE = /(?:^|[^a-z])(flatten|rasterize|merge[-_ ]?visible|bake[-_ ]?layers|overwrite[-_ ]?master|strip[-_ ]?layers)(?:[^a-z]|$)/i;

const DEFAULT_FORBIDDEN_CROSS_BRAND_PATTERNS = Object.freeze([
  { id: 'realestate_conflation', pattern: /\b(tax[- ]deeds?|197\.552|5[- ]folio|miami[- ]dade|foreclosures?|real\s*estate|deals\.igorganapolsky\.com|bJe28rduQ5v82dz6i73sJ0n)\b/i },
  { id: 'corporate_airgap', pattern: /\b(ecisolutions\.com|ecinexus\.com|lore\.eciplatform\.net|psn[-_]stockservice|dist03)\b/i },
]);

function isAscii(value) {
  return typeof value === 'string' && /^[\x20-\x7E]*$/.test(value);
}

function isPrivateOrLinkLocalHost(host) {
  const h = String(host || '').trim().toLowerCase();
  if (!h) return { linkLocal: false, privateIp: false };
  if (['metadata.google.internal', 'metadata', '100.100.100.200', 'localhost', '::1'].includes(h) || /^(?:127\.|169\.254\.|fe80:)/i.test(h)) {
    return { linkLocal: true, privateIp: true };
  }
  if (/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|fc00:|fd)/i.test(h)) return { linkLocal: false, privateIp: true };
  return { linkLocal: false, privateIp: false };
}

function proverVerdict(result, exitCode, extra = {}) {
  return { result, exitCode, passed: result === 'within_boundary', coverage: { domains: [...PROVER_COVERAGE_DOMAINS] }, ...extra };
}

/**
 * NVIDIA OpenShell Formal Policy Boundary Check (`openshell-prover check`).
 * Only `within_boundary` (exitCode 0) passes; every other verdict fails closed.
 */
function provePolicyBoundary(candidate, boundary) {
  if (!candidate || typeof candidate !== 'object' || !boundary || typeof boundary !== 'object') {
    return proverVerdict('error', 2, { reason_code: 'invalid_policy_object', reason: 'Both candidate and boundary policies must be objects.' });
  }
  const candRules = Array.isArray(candidate.network_policies) ? candidate.network_policies : [];
  const boundRules = Array.isArray(boundary.network_policies) ? boundary.network_policies : [];
  const totalEndpoints = [...candRules, ...boundRules].reduce((acc, r) => acc + (Array.isArray(r?.endpoints) ? r.endpoints.length : 0), 0);
  if (candRules.length + boundRules.length > 1024 || totalEndpoints > 4096) {
    return proverVerdict('inconclusive', 3, { reason_code: 'resource_limit', reason: 'Policy exceeds 1,024 network rules or 4,096 endpoints.' });
  }

  // 1. Landlock check
  const cLandlock = candidate.landlock?.compatibility;
  if (boundary.landlock?.compatibility === 'hard_requirement' && cLandlock && cLandlock !== 'hard_requirement') {
    return proverVerdict('exceeds_boundary', 1, { reason_code: 'landlock_downgrade', counterexample: `landlock compatibility ${cLandlock}` });
  }
  for (const field of ['run_as_user', 'run_as_group']) {
    const cVal = candidate.process_policy?.[field];
    const bVal = boundary.process_policy?.[field];
    if (cVal !== undefined && bVal !== undefined && String(cVal) !== String(bVal)) {
      const cRoot = String(cVal) === '0' || String(cVal).toLowerCase() === 'root';
      const bRoot = String(bVal) === '0' || String(bVal).toLowerCase() === 'root';
      if (cRoot && !bRoot) return proverVerdict('exceeds_boundary', 1, { reason_code: 'privilege_escalation_root', counterexample: `process ${field} ${cVal}` });
      return proverVerdict('unsupported', 3, { reason_code: 'uid_remap_unverifiable', reason: `Cannot verify ${field} remap '${bVal}' -> '${cVal}'.` });
    }
  }
  const cRo = new Set(candidate.filesystem_policy?.read_only || []);
  const cRw = new Set(candidate.filesystem_policy?.read_write || []);
  const bRo = new Set(boundary.filesystem_policy?.read_only || []);
  const bRw = new Set(boundary.filesystem_policy?.read_write || []);
  const bAllRead = new Set([...bRo, ...bRw]);
  for (const p of [...cRo, ...cRw]) {
    if (!String(p).startsWith('/')) return proverVerdict('unsupported', 3, { reason_code: 'workdir_relative_path', reason: `Relative path '${p}'.` });
  }
  for (const p of cRw) {
    if (bRw.has('/') || bRw.has(p)) continue;
    if (bRw.size === 0 || bRo.has(p)) return proverVerdict('exceeds_boundary', 1, { reason_code: 'filesystem_write_exceeds', counterexample: `filesystem write ${p}` });
    return proverVerdict('unsupported', 3, { reason_code: 'symlink_subpath_unverifiable', reason: `Unverifiable write subpath '${p}'.` });
  }
  for (const p of cRo) {
    if (bAllRead.has('/') || bAllRead.has(p)) continue;
    if (bAllRead.size === 0) return proverVerdict('exceeds_boundary', 1, { reason_code: 'filesystem_read_exceeds', counterexample: `filesystem read ${p}` });
    return proverVerdict('unsupported', 3, { reason_code: 'symlink_subpath_unverifiable', reason: `Unverifiable read subpath '${p}'.` });
  }

  // 4 & 5. Network L4 + REST checks
  const bEndpoints = [];
  for (const rule of boundRules) {
    const bins = Array.isArray(rule?.binaries) ? rule.binaries.map((b) => b.path || b) : [];
    for (const ep of rule?.endpoints || []) {
      bEndpoints.push({ ...ep, binaries: bins, ruleName: rule.name || 'boundary_rule' });
    }
  }

  for (const rule of candRules) {
    const cBins = Array.isArray(rule?.binaries) ? rule.binaries.map((b) => b.path || b) : [];
    for (const ep of rule?.endpoints || []) {
      const proto = String(ep.protocol || 'tcp').toLowerCase();
      if (!MODELED_PROTOCOLS.has(proto)) {
        return proverVerdict('unsupported', 3, { reason_code: 'unsupported_policy_shape', reason: `Protocol '${proto}' unmodeled; only tcp and rest supported.` });
      }
      if (!ep.host || (ep.port !== undefined && ep.ports !== undefined) || String(ep.host).includes(':') || !isAscii(ep.host)) {
        return proverVerdict('unsupported', 3, { reason_code: 'unsupported_endpoint_shape', reason: `Unsupported endpoint '${ep.host || '(missing)'}'.` });
      }
      if (proto === 'rest' && ep.enforcement && ep.enforcement !== 'enforce') {
        return proverVerdict('unsupported', 3, { reason_code: 'audit_mode_non_enforcing', reason: `REST endpoint '${ep.host}' is non-enforcing.` });
      }
      const port = Number(ep.port || 443);
      const matchingBoundary = bEndpoints.find((b) => b.host === ep.host && Number(b.port || 443) === port);
      if (!matchingBoundary) {
        const wildcardOverlap = bEndpoints.find((b) => Number(b.port || 443) === port && (String(b.host).startsWith('*.') || String(ep.host).startsWith('*.')));
        if (wildcardOverlap && (!ep.allowed_ips || !wildcardOverlap.allowed_ips)) {
          return proverVerdict('unsupported', 3, { reason_code: 'wildcard_host_overlap', reason: `Wildcard host overlap on port ${port}.` });
        }
        return proverVerdict('exceeds_boundary', 1, { reason_code: 'network_destination_exceeds', counterexample: `network ${proto} ${ep.host}:${port}` });
      }
      for (const cb of cBins) {
        if (matchingBoundary.binaries.length > 0 && !matchingBoundary.binaries.includes(cb)) {
          const globMatch = matchingBoundary.binaries.find((bb) => String(bb).endsWith('*') && String(cb).startsWith(String(bb).slice(0, -1)));
          if (globMatch) return proverVerdict('unsupported', 3, { reason_code: 'binary_glob_symlink_unverifiable', reason: `Glob '${globMatch}' unverifiable.` });
          return proverVerdict('exceeds_boundary', 1, { reason_code: 'binary_exceeds_boundary', counterexample: `binary ${cb} -> ${ep.host}:${port}` });
        }
      }
      if (proto === 'rest') {
        if (String(matchingBoundary.protocol || 'tcp').toLowerCase() !== 'rest') {
          return proverVerdict('unsupported', 3, { reason_code: 'mixed_rest_and_l4_endpoint', reason: `Mixed REST/L4 on '${ep.host}:${port}'.` });
        }
        const bAllows = (matchingBoundary.rules || []).filter((r) => r.allow).map((r) => r.allow);
        for (const r of ep.rules || []) {
          if (!r.allow) continue;
          const method = String(r.allow.method || 'GET').toUpperCase();
          const rPath = String(r.allow.path || '/');
          if (rPath.includes('?') || rPath.includes('[')) return proverVerdict('unsupported', 3, { reason_code: 'unsupported_rest_path_matcher', reason: `Unsupported path '${rPath}'.` });
          const covered = bAllows.some((ba) => {
            const bm = String(ba.method || '*').toUpperCase();
            if (bm !== '*' && bm !== method) return false;
            const bp = String(ba.path || '/');
            if (bp === '/**' || bp === rPath) return true;
            if (bp.endsWith('/**')) {
              const prefix = bp.slice(0, -3);
              return rPath === prefix || rPath.startsWith(`${prefix}/`);
            }
            return false;
          });
          if (!covered) {
            return proverVerdict('exceeds_boundary', 1, {
              reason_code: 'rest_method_or_path_exceeds',
              counterexample: `network rest ${method} ${ep.host}:${port}${rPath}`,
            });
          }
        }
      }
    }
  }

  return proverVerdict('within_boundary', 0, { reason_code: 'ok' });
}

/**
 * NVIDIA OpenShell Policy Advisor Proposal Risk Check.
 */
function evaluateProposalRisk(currentPolicy, proposedRule, options = {}) {
  const providers = Array.isArray(options.providers) ? options.providers : [];
  const approvalMode = options.approvalMode === 'auto' ? 'auto' : 'manual';
  const globalPolicyActive = Boolean(options.globalPolicyActive);

  if (!proposedRule || typeof proposedRule !== 'object' || !Array.isArray(proposedRule.endpoints) || proposedRule.endpoints.length === 0) {
    return { valid: false, status: 'validation_unavailable', autoApproved: false, findings: ['invalid_proposal_shape'], securityFlags: [] };
  }

  const findings = new Set();
  const securityFlags = new Set();
  let neverApprovable = false;

  const currentEndpoints = new Map();
  for (const r of currentPolicy?.network_policies || []) {
    for (const ep of r?.endpoints || []) {
      const key = `${String(ep.host || '').toLowerCase()}:${Number(ep.port || 443)}`;
      const methods = new Set((ep.rules || []).filter((x) => x.allow?.method).map((x) => String(x.allow.method).toUpperCase()));
      currentEndpoints.set(key, { methods });
    }
  }

  const credentialHosts = new Set();
  for (const p of providers) {
    for (const ep of p?.endpoints || []) {
      credentialHosts.add(`${String(ep.host || '').toLowerCase()}:${Number(ep.port || 443)}`);
    }
  }

  const binNames = (proposedRule.binaries || []).map((b) => String(b.path || b || '').split('/').pop().toLowerCase());

  for (const ep of proposedRule.endpoints) {
    const proto = String(ep.protocol || '').toLowerCase();
    if (proto === 'tcp' || ep.tls === 'skip') {
      return {
        valid: false,
        status: 'rejected_uninspectable',
        autoApproved: false,
        neverApprovable: true,
        findings: ['uninspectable_protocol_or_tls_skip'],
        securityFlags: [],
      };
    }
    const host = String(ep.host || '').trim().toLowerCase();
    const port = Number(ep.port || 443);
    const hostKey = `${host}:${port}`;
    const ipCheck = isPrivateOrLinkLocalHost(host);
    if (ipCheck.linkLocal) {
      findings.add('link_local_reach');
      neverApprovable = true;
    }
    if (ipCheck.privateIp) securityFlags.add('private_ip_host');
    if (host.startsWith('*.') || host === '*') securityFlags.add('wildcard_host');
    if (port > 49152) securityFlags.add('ephemeral_port_gt_49152');
    if (DB_OR_CACHE_PORTS.has(port)) securityFlags.add('database_or_cache_port');

    const hasCred = credentialHosts.has(hostKey);
    if (hasCred) {
      if (binNames.some((b) => OPAQUE_L4_BINARIES.has(b))) {
        findings.add('l7_bypass_credentialed');
      }
      const existing = currentEndpoints.get(hostKey);
      if (!existing) {
        findings.add('credential_reach_expansion');
      } else {
        for (const r of ep.rules || []) {
          const m = String(r.allow?.method || '').toUpperCase();
          if (m && !existing.methods.has(m) && !existing.methods.has('*')) {
            findings.add('capability_expansion');
          }
        }
      }
    }
  }

  const findingsList = [...findings];
  const flagsList = [...securityFlags];
  const autoApproved = !neverApprovable && !globalPolicyActive && approvalMode === 'auto' && findingsList.length === 0 && flagsList.length === 0;
  return {
    valid: true,
    status: neverApprovable ? 'blocked_never_approvable' : (autoApproved ? 'auto_approved' : 'pending_human_review'),
    autoApproved, neverApprovable, findings: findingsList, securityFlags: flagsList,
  };
}

function verifyProviderCredentialEgress(request, providers = []) {
  let parsed;
  try { parsed = new URL(String(request?.url || '')); } catch { return { allowed: false, reason: 'invalid_destination_url' }; }
  const host = parsed.hostname.toLowerCase();
  const port = Number(parsed.port || (parsed.protocol === 'http:' ? 80 : 443));
  const method = String(request?.method || 'GET').toUpperCase();
  const placeholderMatch = JSON.stringify(request?.headers || {}).match(/tg_cred:\/\/([a-z0-9_-]+)\/([A-Za-z0-9_]+)/i);
  const providerName = request?.provider || (placeholderMatch ? placeholderMatch[1] : null);
  if (!providerName) return { allowed: true, injected: false };
  const provider = providers.find((p) => p && p.name === providerName);
  if (!provider || !Array.isArray(provider.endpoints) || provider.endpoints.length === 0) return { allowed: false, reason: 'profileless_or_unknown_provider' };
  const endpointOk = provider.endpoints.some((ep) => (
    String(ep.host || '').toLowerCase() === host
    && Number(ep.port || 443) === port
    && (!Array.isArray(ep.methods) || ep.methods.length === 0 || ep.methods.map((m) => m.toUpperCase()).includes(method))
    && (!ep.pathPrefix || parsed.pathname.startsWith(ep.pathPrefix))
  ));
  if (!endpointOk) {
    return { allowed: false, reason: 'credential_destination_mismatch', detail: `Provider '${providerName}' credential cannot be sent to ${method} ${host}:${port}${parsed.pathname}` };
  }
  return { allowed: true, injected: true, provider: providerName };
}

function verifyNonDestructiveProjectEdit(action = {}) {
  const targetPath = String(action.targetPath || action.file || '').trim();
  const outputPath = String(action.outputPath || '').trim();
  const operation = String(action.operation || action.command || '').trim();
  if (!LAYERED_PROJECT_EXT_RE.test(targetPath)) return { allowed: true, nonDestructive: true };
  if (DESTRUCTIVE_ASSET_OP_RE.test(operation) && (!outputPath || outputPath === targetPath) && action.preserveLayers !== true) {
    const ext = targetPath.match(LAYERED_PROJECT_EXT_RE)[0];
    return { allowed: false, reason: 'destructive_layer_flatten_blocked', suggestedPatch: { preserveLayers: true, outputPath: `${targetPath.slice(0, -ext.length)}.export${ext}` } };
  }
  return { allowed: true, nonDestructive: true };
}

function evaluateBrandAdherence(content, policy = {}) {
  const text = String(content || '');
  const violations = [];
  const forbidden = Array.isArray(policy.forbiddenPatterns) ? policy.forbiddenPatterns : DEFAULT_FORBIDDEN_CROSS_BRAND_PATTERNS;
  for (const rule of forbidden) {
    const m = rule.pattern.exec(text);
    if (m) violations.push({ id: rule.id, matched: m[0] });
  }
  for (const phrase of policy.disallowedClaims || []) {
    if (phrase && text.toLowerCase().includes(String(phrase).toLowerCase())) {
      violations.push({ id: 'unverified_product_claim', matched: phrase });
    }
  }
  if (policy.requireDisclosure && !/disclosure:\s*i\s+build\s+it/i.test(text)) {
    violations.push({ id: 'missing_builder_disclosure', matched: null });
  }
  return { compliant: violations.length === 0, violations };
}

const TAILWIND_HEX_PALETTE = Object.freeze({
  'slate-950': '#020617', 'slate-900': '#0f172a', 'slate-800': '#1e293b', 'slate-700': '#334155',
  'slate-600': '#475569', 'slate-500': '#64748b', 'slate-400': '#94a3b8', 'slate-300': '#cbd5e1',
  'slate-200': '#e2e8f0', 'slate-100': '#f1f5f9', 'slate-50': '#f8fafc',
  'gray-900': '#111827', 'gray-700': '#374151', 'gray-500': '#6b7280', 'gray-400': '#9ca3af',
  'gray-300': '#d1d5db', 'gray-200': '#e5e7eb', 'gray-100': '#f3f4f6', 'gray-50': '#f9fafb',
  white: '#ffffff', black: '#000000',
});

function parseHexColor(input) {
  const raw = String(input || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(raw)) return [0, 1, 2].map((i) => parseInt(raw[i] + raw[i], 16));
  if (/^[0-9a-f]{6}$/i.test(raw)) return [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16));
  return null;
}

function rgbToHex([r, g, b]) {
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

function relativeLuminance(rgb) {
  const chan = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

function computeContrastRatio(fgHex, bgHex) {
  const fg = parseHexColor(fgHex);
  const bg = parseHexColor(bgHex);
  if (!fg || !bg) return null;
  const [l1, l2] = [relativeLuminance(fg), relativeLuminance(bg)];
  return Number(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2));
}

function solveAccessibleForeground(fgHex, bgHex, minRatio = 4.5) {
  const fg = parseHexColor(fgHex);
  const bg = parseHexColor(bgHex);
  if (!fg || !bg) return { hex: '#f8fafc', tailwindClass: 'text-slate-50', ratio: 15.0 };
  const bgLum = relativeLuminance(bg);
  const targetTowardWhite = bgLum < 0.5;
  const anchor = targetTowardWhite ? [255, 255, 255] : [0, 0, 0];

  let solvedHex = targetTowardWhite ? '#ffffff' : '#000000';
  for (let step = 1; step <= 40; step++) {
    const t = step / 40;
    const candidateRgb = fg.map((c, idx) => c + (anchor[idx] - c) * t);
    const hex = rgbToHex(candidateRgb);
    if (computeContrastRatio(hex, bgHex) >= minRatio) {
      solvedHex = hex;
      break;
    }
  }

  // Prefer clean Tailwind slate token if one satisfies minRatio in the same polarity
  const preferredTokens = targetTowardWhite
    ? ['slate-300', 'slate-200', 'slate-100', 'slate-50', 'white']
    : ['slate-700', 'slate-800', 'slate-900', 'slate-950', 'black'];
  let tailwindClass = `text-[${solvedHex}]`;
  for (const tok of preferredTokens) {
    if (computeContrastRatio(TAILWIND_HEX_PALETTE[tok], bgHex) >= minRatio) {
      tailwindClass = `text-${tok}`;
      break;
    }
  }
  return {
    hex: solvedHex,
    tailwindClass,
    ratio: computeContrastRatio(solvedHex, bgHex),
  };
}

const VOID_HTML_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function parseStyleEntries(attrsRaw) {
  const jsxMatch = /\bstyle=\{\{([^}]*)\}\}/.exec(attrsRaw || '');
  if (jsxMatch) {
    const map = {};
    for (const part of jsxMatch[1].split(',')) {
      const m = /^\s*([a-zA-Z]+)\s*:\s*(?:'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?))\s*$/.exec(part);
      if (m) map[m[1]] = m[4] !== undefined ? `${m[4]}px` : (m[2] ?? m[3]);
    }
    return { kind: 'jsx', rawMatch: jsxMatch[0], map };
  }
  const cssMatch = /\bstyle=(?:"([^"]*)"|'([^']*)')/.exec(attrsRaw || '');
  if (cssMatch) {
    const map = {};
    for (const decl of (cssMatch[1] ?? cssMatch[2] ?? '').split(';')) {
      const idx = decl.indexOf(':');
      if (idx > 0) map[decl.slice(0, idx).trim().toLowerCase()] = decl.slice(idx + 1).trim();
    }
    return { kind: 'css', rawMatch: cssMatch[0], map };
  }
  return { kind: null, rawMatch: null, map: {} };
}

function serializeStyleAttr(kind, map) {
  const entries = Object.entries(map).filter(([, v]) => v !== undefined && v !== '');
  if (kind === 'jsx') {
    const toCamel = (k) => k.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    return `style={{ ${entries.map(([k, v]) => `${toCamel(k)}: '${v}'`).join(', ')} }}`;
  }
  const toKebab = (k) => k.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
  return `style="${entries.map(([k, v]) => `${toKebab(k)}: ${v}`).join('; ')}"`;
}

function resolveColorFromNode(classes, styleMap, kind) {
  const styleVal = kind === 'fg' ? styleMap.color : (styleMap.backgroundColor || styleMap['background-color'] || styleMap.background);
  const styleHex = styleVal && /(#[0-9a-fA-F]{3,6})\b/.exec(String(styleVal));
  if (styleHex) return { hex: styleHex[1], token: null, fromStyle: true };
  const prefix = kind === 'fg' ? 'text-' : 'bg-';
  for (const cls of classes) {
    if (!cls.startsWith(prefix)) continue;
    const suffix = cls.slice(prefix.length);
    const arb = /^\[(#[0-9a-fA-F]{3,6})\]$/.exec(suffix);
    if (arb) return { hex: arb[1], token: cls, fromStyle: false };
    if (TAILWIND_HEX_PALETTE[suffix]) return { hex: TAILWIND_HEX_PALETTE[suffix], token: cls, fromStyle: false };
  }
  return null;
}

/**
 * Parse HTML/JSX markup into a hierarchical Element AST with line/offset spans & inherited background context.
 */
function parseDesignAst(source, defaultBgHex = '#0f172a') {
  const text = String(source || '');
  const lineAt = (offset) => text.slice(0, offset).split('\n').length;
  const root = { type: 'Root', astPath: 'root', inheritedBgHex: defaultBgHex, children: [] };
  const stack = [root];
  const nodes = [];
  // Each alternative starts with a different character, so the attribute run cannot backtrack exponentially.
  const tokenRe = /<(\/?)([a-zA-Z][a-zA-Z0-9.-]*)(\s(?:[^<>"'{}]|\{\{[^}]*\}\}|"[^"]*"|'[^']*')*)?(\/?)>/g;
  let m;
  while ((m = tokenRe.exec(text)) !== null) {
    const [, closing, tagName, attrsRaw = '', selfClose] = m;
    if (closing) {
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].tagName === tagName) { stack.length = i; break; }
      }
      continue;
    }
    const parent = stack[stack.length - 1];
    const idMatch = /\bid=(?:"([^"]+)"|'([^']+)')/.exec(attrsRaw);
    const classMatch = /\b(class|className)=(?:"([^"]*)"|'([^']*)')/.exec(attrsRaw);
    const classes = classMatch ? (classMatch[2] ?? classMatch[3] ?? '').trim().split(/\s+/).filter(Boolean) : [];
    const styleInfo = parseStyleEntries(attrsRaw);
    const ownBg = resolveColorFromNode(classes, styleInfo.map, 'bg');
    const effectiveBgHex = ownBg ? ownBg.hex : parent.inheritedBgHex;
    const siblingIdx = parent.children.filter((c) => c.tagName === tagName).length;
    const id = idMatch ? (idMatch[1] ?? idMatch[2]) : null;
    const selector = id ? `#${id}` : (classes[0] && !classes[0].includes('[') && !classes[0].includes(':') ? `${tagName}.${classes[0]}` : tagName);
    const seg = `${tagName}${id ? `#${id}` : (classes[0] ? `.${classes[0]}` : '')}[${siblingIdx}]`;
    const node = {
      type: 'Element',
      tagName,
      id,
      selector,
      astPath: parent === root ? seg : `${parent.astPath} > ${seg}`,
      openTag: m[0],
      attrsRaw,
      selfClose,
      startOffset: m.index,
      endOffset: m.index + m[0].length,
      startLine: lineAt(m.index),
      endLine: lineAt(m.index + m[0].length),
      classAttrName: classMatch ? classMatch[1] : 'className',
      classRawMatch: classMatch ? classMatch[0] : null,
      classes,
      styleInfo,
      ownBgHex: ownBg ? ownBg.hex : null,
      inheritedBgHex: effectiveBgHex,
      children: [],
    };
    parent.children.push(node);
    nodes.push(node);
    if (!selfClose && !VOID_HTML_TAGS.has(tagName.toLowerCase())) stack.push(node);
  }
  return { root, nodes };
}

function normalizeVisualFindings(findings = []) {
  const list = Array.isArray(findings) ? findings : (findings ? [findings] : []);
  return list.map((item) => {
    if (typeof item === 'string') {
      const selMatch = /(#[a-zA-Z0-9_-]+|\.[a-zA-Z0-9_-]+|\b(?:button|a|p|span|h[1-6]|div|section|img|input)(?:\.[a-zA-Z0-9_-]+)?)/i.exec(item);
      const issue = /contrast/i.test(item) ? 'low_contrast'
        : /tap|touch|target|44px|small\s+button/i.test(item) ? 'undersized_tap_target'
          : /overflow|clip|viewport|horizontal/i.test(item) ? 'fixed_width_mobile_overflow'
            : /focus|outline|ring/i.test(item) ? 'missing_focus_ring'
              : /cls|shift|aspect|dimension/i.test(item) ? 'cls_unsized_media' : 'low_contrast';
      return { selector: selMatch ? selMatch[1] : null, issue, raw: item };
    }
    return { ...item, issue: String(item.issue || item.type || 'low_contrast') };
  });
}

function nodeMatchesSelector(node, sel) {
  if (!sel) return true;
  const s = String(sel).trim();
  if (s === node.astPath || s === node.selector || s === node.tagName) return true;
  if (s.startsWith('#')) return node.id === s.slice(1);
  if (s.startsWith('.')) return node.classes.includes(s.slice(1));
  const [tag, cls] = s.split('.');
  return (!tag || node.tagName.toLowerCase() === tag.toLowerCase()) && (!cls || node.classes.includes(cls));
}

/**
 * Lovable Active Self-Correcting AST Design Engine: inspects AST + visual-model findings
 * and outputs inline AST code edits, exact CSS override rules, Tailwind utility adjustments, and `patchedSource`.
 */
function inspectAndPatchDesignSource(source, options = {}) {
  const minContrast = Number(options.minContrast || 4.5);
  const defaultBg = options.defaultBgHex || '#0f172a';
  const ast = parseDesignAst(source, defaultBg);
  const visualQueue = normalizeVisualFindings(options.visualFindings);
  const patches = [];
  const inlineEdits = [];
  const cssOverrides = [];
  const tailwindAdjustments = [];

  for (const node of ast.nodes) {
    let classes = [...node.classes];
    const styleMap = { ...node.styleInfo.map };
    let mutatedClasses = false;
    let mutatedStyle = false;
    const nodeCssProps = {};
    const matchedVisuals = visualQueue.filter((vf) => nodeMatchesSelector(node, vf.selector));

    // 1. Contrast AST check + visual-model `low_contrast` remediation (uses ancestor-inherited bg!)
    const fgInfo = resolveColorFromNode(classes, styleMap, 'fg');
    const vfContrast = matchedVisuals.find((v) => /contrast/i.test(v.issue));
    const effFgHex = vfContrast?.fgHex || fgInfo?.hex;
    const effBgHex = vfContrast?.bgHex || node.inheritedBgHex || defaultBg;
    if (effFgHex || vfContrast) {
      const startFg = effFgHex || '#64748b';
      const currentRatio = computeContrastRatio(startFg, effBgHex);
      if (vfContrast || (currentRatio !== null && currentRatio < minContrast)) {
        const solved = solveAccessibleForeground(startFg, effBgHex, Number(vfContrast?.minContrast || minContrast));
        nodeCssProps.color = solved.hex;
        if (fgInfo?.fromStyle || node.styleInfo.kind) {
          styleMap.color = solved.hex;
          mutatedStyle = true;
        } else {
          classes = fgInfo?.token ? classes.map((c) => (c === fgInfo.token ? solved.tailwindClass : c)) : [...classes, solved.tailwindClass];
          mutatedClasses = true;
        }
        const twPatch = { remove: fgInfo?.token ? [fgInfo.token] : [], add: [solved.tailwindClass] };
        tailwindAdjustments.push({ selector: node.selector, astPath: node.astPath, ...twPatch });
        patches.push({
          type: 'low_contrast',
          element: node.tagName,
          selector: node.selector,
          astPath: node.astPath,
          measuredRatio: currentRatio,
          targetRatio: minContrast,
          fixedRatio: solved.ratio,
          cssOverride: `color: ${solved.hex};`,
          tailwindPatch: twPatch,
        });
      }
    }

    // 2. Interactive tap-target (<44px) AST check + visual-model remediation
    const isInteractive = /^(button|a|input|select)$/i.test(node.tagName) || /\brole=["']button["']/i.test(node.attrsRaw);
    const vfTap = matchedVisuals.find((v) => /tap|target/i.test(v.issue));
    if (isInteractive || vfTap) {
      const smallTw = classes.filter((c) => /^(h-[45678]|p-[01]|py-(?:0|0\.5|1)|px-(?:1|1\.5)|text-\[(?:9|10)px\])$/.test(c));
      const cssHeightPx = styleMap.height ? parseFloat(styleMap.height) : null;
      if (vfTap || smallTw.length > 0 || (cssHeightPx !== null && cssHeightPx < 44)) {
        nodeCssProps['min-height'] = '44px';
        nodeCssProps['min-width'] = '44px';
        const addTw = ['min-h-11', 'min-w-11', 'px-4', 'py-2.5'];
        if (node.styleInfo.kind && cssHeightPx !== null && cssHeightPx < 44) {
          delete styleMap.height;
          styleMap.minHeight = '44px';
          styleMap.minWidth = '44px';
          mutatedStyle = true;
        } else {
          classes = classes.filter((c) => !smallTw.includes(c));
          for (const cls of addTw) if (!classes.includes(cls)) classes.push(cls);
          mutatedClasses = true;
        }
        const twPatch = { remove: smallTw, add: addTw };
        tailwindAdjustments.push({ selector: node.selector, astPath: node.astPath, ...twPatch });
        patches.push({
          type: 'undersized_tap_target',
          element: node.tagName,
          selector: node.selector,
          astPath: node.astPath,
          cssOverride: 'min-height: 44px; min-width: 44px; padding: 0.625rem 1rem;',
          tailwindPatch: twPatch,
        });
      }
      const vfFocus = matchedVisuals.find((v) => /focus|ring/i.test(v.issue));
      if (vfFocus || (classes.includes('outline-none') && !classes.some((c) => c.startsWith('focus-visible:ring') || c.startsWith('focus:ring')))) {
        const ringClasses = ['focus-visible:ring-2', 'focus-visible:ring-cyan-400', 'focus-visible:ring-offset-2'];
        for (const rc of ringClasses) if (!classes.includes(rc)) classes.push(rc);
        mutatedClasses = true;
        nodeCssProps.outline = '2px solid #22d3ee';
        tailwindAdjustments.push({ selector: node.selector, astPath: node.astPath, remove: [], add: ringClasses });
        patches.push({
          type: 'missing_focus_ring',
          element: node.tagName,
          selector: node.selector,
          astPath: node.astPath,
          cssOverride: 'outline: 2px solid #22d3ee; outline-offset: 2px;',
          tailwindPatch: { remove: [], add: ringClasses },
        });
      }
    }

    // 3. Mobile horizontal overflow AST check + visual-model remediation
    const fixedTw = classes.find((c) => /^w-\[(\d+)px\]$/.test(c) && Number(/^w-\[(\d+)px\]$/.exec(c)[1]) >= 360);
    const cssWidthPx = styleMap.width && /^\d+(?:\.\d+)?px$/.test(styleMap.width) ? Number.parseFloat(styleMap.width) : null;
    const vfOverflow = matchedVisuals.find((v) => /overflow/i.test(v.issue));
    if (vfOverflow || (fixedTw && !classes.includes('max-w-full')) || (cssWidthPx !== null && cssWidthPx >= 360 && !styleMap.maxWidth && !styleMap['max-width'])) {
      const px = fixedTw ? /^w-\[(\d+)px\]$/.exec(fixedTw)[1] : String(cssWidthPx || vfOverflow?.measuredWidthPx || 640);
      nodeCssProps.width = '100%';
      nodeCssProps['max-width'] = `${px}px`;
      nodeCssProps['box-sizing'] = 'border-box';
      if (node.styleInfo.kind && cssWidthPx !== null) {
        styleMap.width = '100%';
        styleMap.maxWidth = `${px}px`;
        mutatedStyle = true;
      } else {
        classes = fixedTw ? classes.map((c) => (c === fixedTw ? 'w-full' : c)) : [...classes, 'w-full'];
        if (!classes.includes(`max-w-[${px}px]`)) classes.push(`max-w-[${px}px]`);
        mutatedClasses = true;
      }
      const twPatch = { remove: fixedTw ? [fixedTw] : [], add: ['w-full', `max-w-[${px}px]`] };
      tailwindAdjustments.push({ selector: node.selector, astPath: node.astPath, ...twPatch });
      patches.push({
        type: 'fixed_width_mobile_overflow',
        element: node.tagName,
        selector: node.selector,
        astPath: node.astPath,
        cssOverride: `width: 100%; max-width: ${px}px; box-sizing: border-box;`,
        tailwindPatch: twPatch,
      });
    }

    if (mutatedClasses || mutatedStyle) {
      let updatedAttrs = node.attrsRaw;
      if (mutatedClasses) {
        const serializedClass = `${node.classAttrName}="${classes.join(' ')}"`;
        updatedAttrs = node.classRawMatch ? updatedAttrs.replace(node.classRawMatch, serializedClass) : `${updatedAttrs} ${serializedClass}`;
      }
      if (mutatedStyle) {
        const serializedStyle = serializeStyleAttr(node.styleInfo.kind || 'css', styleMap);
        updatedAttrs = node.styleInfo.rawMatch ? updatedAttrs.replace(node.styleInfo.rawMatch, serializedStyle) : `${updatedAttrs} ${serializedStyle}`;
      }
      const afterTag = `<${node.tagName}${updatedAttrs}${node.selfClose}>`;
      inlineEdits.push({
        astPath: node.astPath,
        selector: node.selector,
        startOffset: node.startOffset,
        endOffset: node.endOffset,
        startLine: node.startLine,
        endLine: node.endLine,
        before: node.openTag,
        after: afterTag,
      });
      if (Object.keys(nodeCssProps).length > 0) {
        const decls = Object.entries(nodeCssProps).map(([k, v]) => `${k}: ${v};`).join(' ');
        cssOverrides.push({ selector: node.selector, properties: nodeCssProps, cssRule: `${node.selector} { ${decls} }` });
      }
    }
  }

  let patchedSource = String(source || '');
  for (const edit of [...inlineEdits].sort((a, b) => b.startOffset - a.startOffset)) {
    patchedSource = patchedSource.slice(0, edit.startOffset) + edit.after + patchedSource.slice(edit.endOffset);
  }

  return {
    changed: inlineEdits.length > 0,
    issueCount: patches.length,
    patches,
    inlineEdits,
    cssOverrides,
    stylesheetOverride: cssOverrides.map((r) => r.cssRule).join('\n'),
    tailwindAdjustments,
    patchedSource,
  };
}

function remediateVisualFindings(source, visualFindings = [], options = {}) {
  return inspectAndPatchDesignSource(source, { ...options, visualFindings });
}

module.exports = {
  PROVER_COVERAGE_DOMAINS,
  provePolicyBoundary,
  evaluateProposalRisk,
  verifyProviderCredentialEgress,
  verifyNonDestructiveProjectEdit,
  evaluateBrandAdherence,
  computeContrastRatio,
  solveAccessibleForeground,
  parseDesignAst,
  inspectAndPatchDesignSource,
  remediateVisualFindings,
};
