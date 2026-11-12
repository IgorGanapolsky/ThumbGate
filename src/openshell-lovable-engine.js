'use strict';

/**
 * NVIDIA OpenShell (v0.1.8) + Adobe MAX Nov-2026 + Lovable AST Self-Correcting Design Engine.
 */
const fs = require('node:fs');
const path = require('node:path');
const { computeChunkHash, evaluateHashAnchoredEdit } = require('./hash-anchored-edit');

const PROVER_COVERAGE_DOMAINS = Object.freeze(['filesystem', 'network_l4', 'network_rest', 'process', 'landlock']);
const MODELED_PROTOCOLS = new Set(['tcp', 'rest']);
const OPAQUE_L4_BINARIES = new Set(['git', 'ssh', 'scp', 'sftp', 'nc', 'ncat', 'netcat', 'socat', 'openssl', 'telnet']);
const DB_OR_CACHE_PORTS = new Set([3306, 5432, 6379, 9200, 11211, 27017]);
const LAYERED_PROJECT_EXT_RE = /\.(psd|psb|ai|prproj|aep|indd|fig|sketch|svg)$/i;
const DESTRUCTIVE_ASSET_OP_RE = /(?:^|[^a-z])(flatten|rasterize|merge[-_ ]?visible|bake[-_ ]?layers|overwrite[-_ ]?master|strip[-_ ]?layers)(?:[^a-z]|$)/i;

const DEFAULT_FORBIDDEN_CROSS_BRAND_PATTERNS = Object.freeze([
  { id: 'other_business_conflation', pattern: /\b(tax[- ]deeds?|197\.552|5[- ]folio|miami[- ]dade|foreclosures?|real\s*estate|deals\.igorganapolsky\.com|bJe28rduQ5v82dz6i73sJ0n)\b/i },
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

  // 1. Landlock check (fails closed if boundary hard_requirement is downgraded or omitted)
  const cLandlock = candidate.landlock?.compatibility;
  if (boundary.landlock?.compatibility === 'hard_requirement' && cLandlock !== 'hard_requirement') {
    return proverVerdict('exceeds_boundary', 1, { reason_code: 'landlock_downgrade', counterexample: `landlock compatibility ${cLandlock || '(missing)'}` });
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
      const bProto = String(matchingBoundary.protocol || 'tcp').toLowerCase();
      if (proto !== bProto) {
        return proverVerdict('exceeds_boundary', 1, {
          reason_code: 'protocol_mismatch_exceeds',
          counterexample: `network protocol mismatch ${proto} -> boundary ${bProto} on ${ep.host}:${port}`,
        });
      }
      if (proto === 'rest') {
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
  'gray-950': '#030712', 'gray-900': '#111827', 'gray-800': '#1f2937', 'gray-700': '#374151',
  'gray-600': '#4b5563', 'gray-500': '#6b7280', 'gray-400': '#9ca3af', 'gray-300': '#d1d5db',
  'gray-200': '#e5e7eb', 'gray-100': '#f3f4f6', 'gray-50': '#f9fafb',
  'zinc-950': '#09090b', 'zinc-900': '#18181b', 'zinc-800': '#27272a', 'zinc-700': '#3f3f46',
  'zinc-600': '#52525b', 'zinc-500': '#71717a', 'zinc-400': '#a1a1aa', 'zinc-300': '#d4d4d8',
  'zinc-200': '#e4e4e7', 'zinc-100': '#f4f4f5', 'zinc-50': '#fafafa',
  'red-800': '#991b1b', 'red-700': '#b91c1c', 'red-600': '#dc2626', 'red-400': '#f87171', 'red-200': '#fecaca',
  'amber-800': '#92400e', 'amber-700': '#b45309', 'amber-400': '#fbbf24', 'amber-200': '#fde68a',
  'emerald-800': '#065f46', 'emerald-700': '#047857', 'emerald-400': '#34d399', 'emerald-300': '#6ee7b7', 'emerald-200': '#a7f3d0',
  'cyan-800': '#155e75', 'cyan-700': '#0e7490', 'cyan-400': '#22d3ee', 'cyan-300': '#67e8f9', 'cyan-200': '#a5f3fc',
  'blue-800': '#1e40af', 'blue-700': '#1d4ed8', 'blue-600': '#2563eb', 'blue-400': '#60a5fa', 'blue-300': '#93c5fd', 'blue-200': '#bfdbfe',
  'indigo-700': '#4338ca', 'indigo-400': '#818cf8', 'indigo-300': '#a5b4fc', 'indigo-200': '#c7d2fe',
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

function rgbToHsl([r, g, b]) {
  const rn = r / 255; const gn = g / 255; const bn = b / 255;
  const max = Math.max(rn, gn, bn); const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const hue2rgb = (p, q, t) => {
    let tn = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
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

function solveAccessibleForeground(fgHex, bgHex, minRatio = 4.5, existingClass = '') {
  const fg = parseHexColor(fgHex);
  const bg = parseHexColor(bgHex);
  if (!fg || !bg) return { hex: '#f8fafc', tailwindClass: 'text-slate-50', ratio: 15.0 };
  const bgLum = relativeLuminance(bg);
  const targetTowardWhite = bgLum < 0.5;
  const [h, s, origL] = rgbToHsl(fg);
  let lo = targetTowardWhite ? origL : 0;
  let hi = targetTowardWhite ? 1 : origL;
  let solvedHex = targetTowardWhite ? '#ffffff' : '#000000';
  for (let iter = 0; iter < 24; iter++) {
    const mid = (lo + hi) / 2;
    const hex = rgbToHex(hslToRgb([h, s, mid]));
    if ((computeContrastRatio(hex, bgHex) || 0) >= minRatio) {
      solvedHex = hex;
      if (targetTowardWhite) hi = mid; else lo = mid;
    } else if (targetTowardWhite) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const solvedRgb = parseHexColor(solvedHex);
  const familyMatch = /^text-([a-z]+)-\d+$/.exec(String(existingClass || '').trim());
  const preferredFamily = familyMatch ? familyMatch[1] : (s < 0.2 ? 'slate' : null);
  if (preferredFamily === 'slate') {
    const slateOrder = targetTowardWhite
      ? ['slate-300', 'slate-200', 'slate-100', 'slate-50', 'white']
      : ['slate-700', 'slate-800', 'slate-900', 'slate-950', 'black'];
    for (const tok of slateOrder) {
      if ((computeContrastRatio(TAILWIND_HEX_PALETTE[tok], bgHex) || 0) >= minRatio) {
        return { hex: solvedHex, tailwindClass: `text-${tok}`, ratio: computeContrastRatio(solvedHex, bgHex) };
      }
    }
  }
  let bestToken = null;
  let bestScore = Infinity;
  for (const [tok, tokHex] of Object.entries(TAILWIND_HEX_PALETTE)) {
    if ((computeContrastRatio(tokHex, bgHex) || 0) < minRatio) continue;
    const rgb = parseHexColor(tokHex);
    const dist = Math.hypot(rgb[0] - solvedRgb[0], rgb[1] - solvedRgb[1], rgb[2] - solvedRgb[2]);
    const bonus = preferredFamily && tok.startsWith(`${preferredFamily}-`) ? -85 : 0;
    if (dist + bonus < bestScore) { bestScore = dist + bonus; bestToken = tok; }
  }
  return {
    hex: solvedHex,
    tailwindClass: bestToken ? `text-${bestToken}` : `text-[${solvedHex}]`,
    ratio: computeContrastRatio(solvedHex, bgHex),
  };
}

const VOID_HTML_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function buildLineLookup(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset) => {
    let lo = 0; let hi = starts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= offset) lo = mid + 1; else hi = mid - 1;
    }
    return hi + 1;
  };
}

const UNITLESS_JSX_PROPS = new Set([
  'opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flex', 'flexGrow', 'flexShrink', 'order', 'zoom', 'scale', 'aspectRatio', 'gridRow', 'gridColumn',
]);

function parseCssRulesAst(source, baseOffset = 0, lineAt = buildLineLookup(source), recursionDepth = 0) {
  const rules = [];
  const len = source.length;
  let i = 0;
  while (i < len) {
    while (i < len && /\s/.test(source[i])) i++;
    if (i + 1 < len && source[i] === '/' && source[i + 1] === '*') {
      const endC = source.indexOf('*/', i + 2);
      i = endC === -1 ? len : endC + 2;
      continue;
    }
    if (i >= len) break;
    const openBrace = source.indexOf('{', i);
    if (source[i] === '@') {
      const semi = source.indexOf(';', i);
      if (semi !== -1 && (openBrace === -1 || semi < openBrace)) {
        i = semi + 1;
        continue;
      }
    }
    if (openBrace === -1) break;
    const selector = source.slice(i, openBrace).trim();
    let depth = 1; let j = openBrace + 1;
    while (j < len && depth > 0) {
      if (source[j] === '{') depth++; else if (source[j] === '}') depth--;
      j++;
    }
    const closeBrace = j - 1;
    if (depth !== 0) break;
    if (selector.startsWith('@')) {
      if (recursionDepth < 8 && /^@(?:media|supports|layer|container|scope)\b/i.test(selector)) {
        rules.push(...parseCssRulesAst(source.slice(openBrace + 1, closeBrace), baseOffset + openBrace + 1, lineAt, recursionDepth + 1));
      }
      i = j;
      continue;
    }
    const declarations = {};
    for (const part of splitCssDeclarations(source.slice(openBrace + 1, closeBrace))) {
      const colon = part.indexOf(':');
      if (colon > 0) declarations[part.slice(0, colon).trim().toLowerCase()] = part.slice(colon + 1).trim();
    }
    const startOffset = baseOffset + i;
    const endOffset = baseOffset + closeBrace + 1;
    rules.push({
      type: 'CssRule', selector, declarations, bodyText: source.slice(openBrace + 1, closeBrace),
      startOffset, endOffset, startLine: lineAt(startOffset), endLine: lineAt(endOffset), rawRule: source.slice(i, closeBrace + 1),
    });
    i = closeBrace + 1;
  }
  return rules;
}

function splitCssDeclarations(str) {
  const out = [];
  let start = 0; let paren = 0; let quote = null;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') paren++; else if (ch === ')' && paren > 0) paren--;
    else if (ch === ';' && paren === 0) { out.push(str.slice(start, i)); start = i + 1; }
  }
  out.push(str.slice(start));
  return out;
}

function extractSafeColorHex(val) {
  const cleaned = String(val || '').replace(/(?:url|image-set)\s*\([^()]*\)/gi, ' ');
  return /(#[0-9a-fA-F]{3,6})\b/.exec(cleaned);
}

function escapeCssIdent(ident) {
  return String(ident || '').replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

function unescapeCssIdent(ident) {
  return String(ident || '').replace(/\\(.)/g, '$1');
}

function splitTopLevelCommas(str) {
  const out = [];
  let start = 0; let paren = 0; let brace = 0; let quote = null;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; }
    else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(') paren++; else if (ch === ')' && paren > 0) paren--;
    else if (ch === '{') brace++; else if (ch === '}' && brace > 0) brace--;
    else if (ch === ',' && paren === 0 && brace === 0) { out.push(str.slice(start, i)); start = i + 1; }
  }
  out.push(str.slice(start));
  return out;
}

function formatJsxStyleValue(v) {
  if (typeof v === 'number') return String(v);
  const s = String(v);
  if (s.includes("'")) return JSON.stringify(s);
  return `'${s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
}

function parseStyleEntries(attrsRaw) {
  const sMatch = /(?:^|[\s"'`}])(style\s*=)/.exec(attrsRaw || '');
  if (sMatch) {
    const sIdx = sMatch.index + (sMatch[0].length - sMatch[1].length);
    let cur = sIdx + sMatch[1].length;
    while (cur < attrsRaw.length && /\s/.test(attrsRaw[cur])) cur++;
    if (attrsRaw.startsWith('{{', cur)) {
      let d = 2; let k = cur + 2; let quote = null;
      while (k < attrsRaw.length && d > 0) {
        const ch = attrsRaw[k];
        if (quote) { if (ch === '\\') k++; else if (ch === quote) quote = null; }
        else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
        else if (ch === '{') d++; else if (ch === '}') d--;
        k++;
      }
      const inner = attrsRaw.slice(cur + 2, Math.max(cur + 2, k - 2));
      const map = {};
      const preserved = [];
      for (const part of splitTopLevelCommas(inner)) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const m = /^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|(-?\d+(?:\.\d+)?))$/.exec(trimmed);
        if (m) {
          const key = m[1];
          if (m[4] !== undefined) {
            map[key] = UNITLESS_JSX_PROPS.has(key) ? Number(m[4]) : `${m[4]}px`;
          } else {
            const rawStr = m[2] !== undefined ? m[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\') : m[3].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            map[key] = rawStr;
          }
          preserved.push({ type: 'prop', key, static: true });
        } else {
          const dynKey = /^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/.exec(trimmed);
          if (dynKey) preserved.push({ type: 'prop', key: dynKey[1], static: false, raw: trimmed });
          else preserved.push({ type: 'raw', raw: trimmed });
        }
      }
      return { kind: 'jsx', rawMatch: attrsRaw.slice(sIdx, k), map, preserved };
    }
    if (attrsRaw[cur] === '"' || attrsRaw[cur] === "'") {
      const q = attrsRaw[cur];
      const endQ = attrsRaw.indexOf(q, cur + 1);
      if (endQ > cur) {
        const map = {};
        for (const decl of splitCssDeclarations(attrsRaw.slice(cur + 1, endQ))) {
          const idx = decl.indexOf(':');
          if (idx > 0) map[decl.slice(0, idx).trim().toLowerCase()] = decl.slice(idx + 1).trim();
        }
        return { kind: 'css', rawMatch: attrsRaw.slice(sIdx, endQ + 1), map, preserved: [] };
      }
    }
  }
  return { kind: null, rawMatch: null, map: {}, preserved: [] };
}

function serializeStyleAttr(kind, map, preserved = []) {
  const toCamel = (k) => k.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
  const toKebab = (k) => k.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
  if (kind === 'jsx') {
    const normalizedMap = new Map();
    for (const [k, v] of Object.entries(map)) {
      if (v !== undefined && v !== '') normalizedMap.set(toCamel(k), v);
    }
    const emitted = new Set();
    const out = [];
    for (const item of preserved) {
      if (typeof item === 'string') { out.push(item); continue; }
      if (item.type === 'raw') { out.push(item.raw); continue; }
      const ck = toCamel(item.key);
      if (emitted.has(ck)) continue;
      if (normalizedMap.has(ck)) {
        out.push(`${ck}: ${formatJsxStyleValue(normalizedMap.get(ck))}`);
        emitted.add(ck);
      } else if (!item.static) {
        out.push(item.raw);
        emitted.add(ck);
      }
    }
    for (const [ck, v] of normalizedMap.entries()) {
      if (!emitted.has(ck)) out.push(`${ck}: ${formatJsxStyleValue(v)}`);
    }
    return `style={{ ${out.join(', ')} }}`;
  }
  const entries = Object.entries(map).filter(([, v]) => v !== undefined && v !== '');
  return `style="${entries.map(([k, v]) => `${toKebab(k)}: ${v}`).join('; ')}"`;
}

function resolveColorFromNode(classes, styleMap, kind) {
  const styleVal = kind === 'fg' ? styleMap.color : (styleMap.backgroundColor || styleMap['background-color'] || styleMap.background);
  const styleHex = styleVal && extractSafeColorHex(styleVal);
  if (styleHex) return { hex: styleHex[1], token: null, fromStyle: true };
  const prefix = kind === 'fg' ? 'text-' : 'bg-';
  for (const cls of classes) {
    if (!cls.startsWith(prefix)) continue;
    const suffix = cls.slice(prefix.length);
    const arb = /^\[(#[0-9a-fA-F]{3,6})\]$/.exec(suffix);
    if (arb) return { hex: arb[1], token: cls, fromStyle: false };
    if (Object.hasOwn(TAILWIND_HEX_PALETTE, suffix)) return { hex: TAILWIND_HEX_PALETTE[suffix], token: cls, fromStyle: false };
  }
  return null;
}

function parseDesignAst(source, defaultBgHex = '#0f172a') {
  const text = String(source || '');
  const lineAt = buildLineLookup(text);
  const isPureCss = !text.includes('<') && text.includes('{') && text.includes(':');
  if (isPureCss) {
    return { root: { type: 'Root', astPath: 'root', inheritedBgHex: defaultBgHex, children: [] }, nodes: [], cssRules: parseCssRulesAst(text, 0, lineAt), language: 'css' };
  }
  const root = { type: 'Root', astPath: 'root', inheritedBgHex: defaultBgHex, children: [] };
  const stack = [root];
  const nodes = [];
  const cssRules = [];
  const len = text.length;
  let i = 0;

  while (i < len) {
    const lt = text.indexOf('<', i);
    if (lt === -1) break;
    if (text.startsWith('<!--', lt)) {
      const endC = text.indexOf('-->', lt + 4);
      i = endC === -1 ? len : endC + 3;
      continue;
    }
    const lineStart = text.lastIndexOf('\n', lt - 1) + 1;
    if (/^\s*\/\//.test(text.slice(lineStart, lt))) {
      const nl = text.indexOf('\n', lt);
      i = nl === -1 ? len : nl + 1;
      continue;
    }
    let cur = lt + 1;
    let closing = false;
    if (text[cur] === '/') { closing = true; cur++; }
    if (!/[a-zA-Z]/.test(text[cur] || '')) { i = lt + 1; continue; }
    const nameStart = cur;
    while (cur < len && /[a-zA-Z0-9._:-]/.test(text[cur])) cur++;
    const tagName = text.slice(nameStart, cur);

    let braceDepth = 0;
    let quote = null;
    while (cur < len) {
      const ch = text[cur];
      if (quote) {
        if (ch === '\\') cur++;
        else if (ch === quote) quote = null;
      } else if (ch === '/' && text[cur + 1] === '*' && braceDepth > 0) {
        const cEnd = text.indexOf('*/', cur + 2);
        cur = cEnd === -1 ? len : cEnd + 1;
      } else if (ch === '/' && text[cur + 1] === '/' && braceDepth > 0) {
        const nl = text.indexOf('\n', cur + 2);
        cur = nl === -1 ? len : nl;
      } else if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
      } else if (ch === '{') {
        braceDepth++;
      } else if (ch === '}' && braceDepth > 0) {
        braceDepth--;
      } else if (ch === '>' && braceDepth === 0) {
        break;
      }
      cur++;
    }
    if (cur >= len) break;
    const tagEnd = cur + 1;
    if (closing) {
      for (let s = stack.length - 1; s >= 1; s--) {
        if (stack[s].tagName === tagName) { stack.length = s; break; }
      }
      i = tagEnd;
      continue;
    }

    const selfClose = text[cur - 1] === '/' ? '/' : '';
    const attrsRaw = text.slice(nameStart + tagName.length, selfClose ? cur - 1 : cur);
    const tagLower = tagName.toLowerCase();
    if ((tagLower === 'style' || tagLower === 'script') && !selfClose) {
      const closeRe = tagLower === 'style' ? /<\/style\b[^<>]*>/ig : /<\/script\b[^<>]*>/ig;
      closeRe.lastIndex = tagEnd;
      const closeMatch = closeRe.exec(text);
      if (!closeMatch) break;
      if (tagLower === 'style') {
        const styleBody = text.slice(tagEnd, closeMatch.index);
        if (!styleBody.trimStart().startsWith('{')) cssRules.push(...parseCssRulesAst(styleBody, tagEnd, lineAt));
      }
      i = closeMatch.index + closeMatch[0].length;
      continue;
    }

    const parent = stack[stack.length - 1];
    const idMatch = /(?:^|[\s"'`}])id=(?:"([^"]+)"|'([^']+)')/.exec(attrsRaw);
    const classMatch = /(?:^|[\s"'`}])((class|className)=(?:"([^"]*)"|'([^']*)'))/.exec(attrsRaw);
    const classes = classMatch ? (classMatch[3] ?? classMatch[4] ?? '').trim().split(/\s+/).filter(Boolean) : [];
    const styleInfo = parseStyleEntries(attrsRaw);
    const id = idMatch ? (idMatch[1] ?? idMatch[2]) : null;
    const selector = id ? `#${escapeCssIdent(id)}` : (classes[0] && !classes[0].includes('[') && !classes[0].includes(':') ? `${tagName}.${escapeCssIdent(classes[0])}` : tagName);
    const matchedCssBg = cssRules.find((r) => r.selector === selector || (id && r.selector === `#${escapeCssIdent(id)}`) || classes.some((c) => r.selector === `.${escapeCssIdent(c)}`));
    const cssBgHex = matchedCssBg && extractSafeColorHex(matchedCssBg.declarations['background-color'] || matchedCssBg.declarations.background || '');
    const ownBg = resolveColorFromNode(classes, styleInfo.map, 'bg') || (cssBgHex ? { hex: cssBgHex[1], token: null, fromStyle: true } : null);
    const effectiveBgHex = ownBg ? ownBg.hex : parent.inheritedBgHex;
    const siblingIdx = parent.children.filter((c) => c.tagName === tagName).length;
    const seg = `${tagName}${id ? `#${id}` : (classes[0] ? `.${classes[0]}` : '')}[${siblingIdx}]`;
    const openTag = text.slice(lt, tagEnd);
    const node = {
      type: 'Element',
      tagName,
      id,
      selector,
      astPath: parent === root ? seg : `${parent.astPath} > ${seg}`,
      openTag,
      attrsRaw,
      selfClose,
      startOffset: lt,
      endOffset: tagEnd,
      startLine: lineAt(lt),
      endLine: lineAt(tagEnd),
      classAttrName: classMatch ? classMatch[2] : (/\bclassName=/.test(text) ? 'className' : 'class'),
      classRawMatch: classMatch ? classMatch[1] : null,
      classes,
      styleInfo,
      ownBgHex: ownBg ? ownBg.hex : null,
      inheritedBgHex: effectiveBgHex,
      children: [],
    };
    parent.children.push(node);
    nodes.push(node);
    if (!selfClose && !VOID_HTML_TAGS.has(tagName.toLowerCase())) stack.push(node);
    i = tagEnd;
  }
  return { root, nodes, cssRules, language: /\bclassName=|\bstyle=\{\{/.test(text) ? 'jsx' : 'html' };
}

const SAFE_VISUAL_SELECTOR_RE = /^(?:#[a-zA-Z0-9_\\-]+|\.[a-zA-Z0-9_\\-]+|[a-zA-Z][a-zA-Z0-9_-]*(?:(?:#|\.)[a-zA-Z0-9_\\-]+)?)$/;

function normalizeVisualFindings(findings = []) {
  const rawList = Array.isArray(findings) ? findings : (findings ? [findings] : []);
  return rawList
    .slice(0, 64)
    .filter((item) => typeof item === 'string' || (item !== null && typeof item === 'object' && !Array.isArray(item)))
    .map((item) => {
      if (typeof item === 'string') {
        const selMatch = /(#[a-z0-9_-]+|\.[a-z0-9_-]+|\b(?:button|a|p|span|h[1-6]|div|section|img|input)(?:\.[a-z0-9_-]+)?)/i.exec(item);
        const issue = /colorblind|red\/green/i.test(item) ? 'colorblind_unsafe_status'
          : /contrast/i.test(item) ? 'low_contrast'
            : /tap|touch|target|44px|small\s+button/i.test(item) ? 'undersized_tap_target'
              : /overflow|clip|viewport|horizontal/i.test(item) ? 'fixed_width_mobile_overflow'
                : /focus|outline|ring/i.test(item) ? 'missing_focus_ring'
                  : /cls|shift|aspect|dimension/i.test(item) ? 'cls_unsized_media' : 'low_contrast';
        return { selector: selMatch ? selMatch[1] : null, issue, raw: item };
      }
      const rawSel = typeof item.selector === 'string' ? item.selector.trim() : '';
      return {
        ...item,
        selector: rawSel && SAFE_VISUAL_SELECTOR_RE.test(rawSel) ? rawSel : null,
        fgHex: typeof (item.fgHex || item.foregroundHex) === 'string' ? (item.fgHex || item.foregroundHex) : null,
        bgHex: typeof (item.bgHex || item.backgroundHex) === 'string' ? (item.bgHex || item.backgroundHex) : null,
        issue: String(item.issue || item.type || item.code || 'low_contrast'),
      };
    });
}

function nodeMatchesSelector(node, sel) {
  if (!sel) return true;
  const s = String(sel).trim();
  if (s === node.astPath || s === node.selector || s === node.tagName) return true;
  if (s.startsWith('#')) return node.id === unescapeCssIdent(s.slice(1));
  if (s.startsWith('.')) return node.classes.includes(unescapeCssIdent(s.slice(1)));
  const dotIdx = s.search(/(?<!\\)\./);
  if (dotIdx === -1) return node.tagName.toLowerCase() === s.toLowerCase();
  const tag = s.slice(0, dotIdx);
  const cls = unescapeCssIdent(s.slice(dotIdx + 1));
  return (!tag || node.tagName.toLowerCase() === tag.toLowerCase()) && (!cls || node.classes.includes(cls));
}

function inspectCssAstRules(source, ast, visualQueue, options = {}) {
  const minContrast = Number(options.minContrast || 4.5);
  const defaultBg = options.defaultBgHex || '#0f172a';
  const patches = [];
  const inlineEdits = [];
  const cssOverrides = [];
  for (const rule of ast.cssRules || []) {
    const decls = { ...rule.declarations };
    const ruleProps = {};
    const fgM = extractSafeColorHex(decls.color || '');
    const bgM = extractSafeColorHex(decls['background-color'] || decls.background || '') || [null, defaultBg];
    const vfC = visualQueue.find((v) => (!v.selector || v.selector === rule.selector) && /contrast/i.test(v.issue));
    if (fgM || vfC) {
      const fgHex = vfC?.fgHex || fgM?.[1] || '#64748b';
      const bgHex = vfC?.bgHex || bgM[1] || defaultBg;
      const ratio = computeContrastRatio(fgHex, bgHex);
      if (vfC || (ratio !== null && ratio < minContrast)) {
        const solved = solveAccessibleForeground(fgHex, bgHex, minContrast);
        decls.color = solved.hex;
        ruleProps.color = solved.hex;
        patches.push({ type: 'low_contrast', element: 'CssRule', selector: rule.selector, astPath: `css:${rule.selector}`, measuredRatio: ratio, targetRatio: minContrast, fixedRatio: solved.ratio, cssOverride: `color: ${solved.hex};`, tailwindPatch: { remove: [], add: [solved.tailwindClass] } });
      }
    }
    const rawH = decls.height || decls['min-height'];
    const hPx = rawH && /^\d+(?:\.\d+)?px$/.test(rawH) ? parseFloat(rawH) : null;
    if ((/button|btn|cta|nav-link|input/i.test(rule.selector) && hPx !== null && hPx < 44) || visualQueue.some((v) => v.selector === rule.selector && /tap|touch|target/i.test(v.issue))) {
      delete decls.height;
      decls['min-height'] = '44px';
      decls['min-width'] = '44px';
      ruleProps['min-height'] = '44px';
      ruleProps['min-width'] = '44px';
      patches.push({ type: 'undersized_tap_target', element: 'CssRule', selector: rule.selector, astPath: `css:${rule.selector}`, cssOverride: 'min-height: 44px; min-width: 44px;', tailwindPatch: { remove: [], add: ['min-h-11', 'min-w-11'] } });
    }
    if (Object.keys(ruleProps).length > 0) {
      const body = Object.entries(decls).map(([k, v]) => `${k}: ${v};`).join(' ');
      const afterRule = `${rule.selector} { ${body} }`;
      inlineEdits.push({ filePath: options.filePath || null, nodeType: 'CssRule', astPath: `css:${rule.selector}`, selector: rule.selector, startOffset: rule.startOffset, endOffset: rule.endOffset, startLine: rule.startLine, endLine: rule.endLine, expectedChunkHash: computeChunkHash(rule.rawRule), before: rule.rawRule, after: afterRule });
      cssOverrides.push({ selector: rule.selector, properties: ruleProps, cssRule: `${rule.selector} { ${Object.entries(ruleProps).map(([k, v]) => `${k}: ${v};`).join(' ')} }` });
    }
  }
  return { patches, inlineEdits, cssOverrides };
}

function inspectAndPatchDesignSource(source, options = {}) {
  const rawSource = String(source || '');
  const minContrast = Number(options.minContrast || 4.5);
  const defaultBg = options.defaultBgHex || '#0f172a';
  const allowTailwind = options.allowTailwind !== false;
  const ast = parseDesignAst(rawSource, defaultBg);
  const visualQueue = normalizeVisualFindings(options.visualFindings);
  const cssPass = inspectCssAstRules(rawSource, ast, visualQueue, { ...options, minContrast, defaultBgHex: defaultBg });
  const patches = [...cssPass.patches];
  const inlineEdits = [...cssPass.inlineEdits];
  const cssOverrides = [...cssPass.cssOverrides];
  const tailwindAdjustments = [];

  for (const node of ast.nodes) {
    let classes = [...node.classes];
    const styleMap = { ...node.styleInfo.map };
    let mutatedClasses = false;
    let mutatedStyle = false;
    const nodeCssProps = {};
    const matchedVisuals = visualQueue.filter((vf) => nodeMatchesSelector(node, vf.selector));

    // 1. Contrast AST check + visual-model `low_contrast` remediation (uses ancestor-inherited or <style> bg)
    const fgInfo = resolveColorFromNode(classes, styleMap, 'fg');
    const vfContrast = matchedVisuals.find((v) => /contrast/i.test(v.issue));
    const effFgHex = vfContrast?.fgHex || fgInfo?.hex;
    const effBgHex = vfContrast?.bgHex || node.inheritedBgHex || defaultBg;
    if (effFgHex || vfContrast) {
      const startFg = effFgHex || '#64748b';
      const targetMin = Number(vfContrast?.minContrast || minContrast);
      const currentRatio = computeContrastRatio(startFg, effBgHex);
      if (vfContrast || (currentRatio !== null && currentRatio < targetMin)) {
        const solved = solveAccessibleForeground(startFg, effBgHex, targetMin, fgInfo?.token || '');
        nodeCssProps.color = solved.hex;
        if (!allowTailwind || fgInfo?.fromStyle || node.styleInfo.kind) {
          styleMap.color = solved.hex;
          mutatedStyle = true;
        } else {
          classes = fgInfo?.token ? classes.map((c) => (c === fgInfo.token ? solved.tailwindClass : c)) : [...classes, solved.tailwindClass];
          mutatedClasses = true;
        }
        const twPatch = { remove: fgInfo?.token ? [fgInfo.token] : [], add: [solved.tailwindClass] };
        tailwindAdjustments.push({ selector: node.selector, astPath: node.astPath, ...twPatch });
        patches.push({
          type: 'low_contrast', element: node.tagName, selector: node.selector, astPath: node.astPath,
          measuredRatio: currentRatio, targetRatio: targetMin, fixedRatio: solved.ratio,
          cssOverride: `color: ${solved.hex};`, tailwindPatch: twPatch,
        });
      }
    }

    // 2. Interactive tap-target (<44px) & focus-ring AST check + visual-model remediation
    const isInteractive = /^(button|a|input|select)$/i.test(node.tagName) || /\brole=["']button["']/i.test(node.attrsRaw);
    const vfTap = matchedVisuals.find((v) => /tap|touch|target/i.test(v.issue));
    if (isInteractive || vfTap) {
      const smallTw = classes.filter((c) => /^(h-[3456789]|h-3\.5|p-[01]|p-0\.5|py-(?:0|0\.5|1)|px-(?:0|0\.5|1|1\.5)|text-\[(?:9|10)px\])$/.test(c));
      const rawCssH = styleMap.height || styleMap.minHeight || styleMap['min-height'];
      const cssHeightPx = rawCssH ? parseFloat(rawCssH) : null;
      if (vfTap || smallTw.length > 0 || (cssHeightPx !== null && cssHeightPx < 44)) {
        nodeCssProps['min-height'] = '44px';
        nodeCssProps['min-width'] = '44px';
        const addTw = ['min-h-11', 'min-w-11', 'px-4', 'py-2.5'];
        if (!allowTailwind || (node.styleInfo.kind && cssHeightPx !== null && cssHeightPx < 44)) {
          delete styleMap.height;
          delete styleMap['min-height'];
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
          type: 'undersized_tap_target', element: node.tagName, selector: node.selector, astPath: node.astPath,
          cssOverride: 'min-height: 44px; min-width: 44px; padding: 0.625rem 1rem;', tailwindPatch: twPatch,
        });
      }
      const vfFocus = matchedVisuals.find((v) => /focus|ring/i.test(v.issue));
      if (vfFocus || (classes.includes('outline-none') && !classes.some((c) => c.startsWith('focus-visible:ring') || c.startsWith('focus:ring')))) {
        const ringClasses = ['focus-visible:ring-2', 'focus-visible:ring-cyan-400', 'focus-visible:ring-offset-2'];
        if (allowTailwind) {
          for (const rc of ringClasses) if (!classes.includes(rc)) classes.push(rc);
          mutatedClasses = true;
        } else {
          styleMap.outline = '2px solid #22d3ee';
          mutatedStyle = true;
        }
        nodeCssProps.outline = '2px solid #22d3ee';
        tailwindAdjustments.push({ selector: node.selector, astPath: node.astPath, remove: [], add: ringClasses });
        patches.push({
          type: 'missing_focus_ring', element: node.tagName, selector: node.selector, astPath: node.astPath,
          cssOverride: 'outline: 2px solid #22d3ee; outline-offset: 2px;', tailwindPatch: { remove: [], add: ringClasses },
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
      if (!allowTailwind || (node.styleInfo.kind && cssWidthPx !== null)) {
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
        type: 'fixed_width_mobile_overflow', element: node.tagName, selector: node.selector, astPath: node.astPath,
        cssOverride: `width: 100%; max-width: ${px}px; box-sizing: border-box;`, tailwindPatch: twPatch,
      });
    }

    // 4. Unbounded media CLS check + colorblind non-hue affordance remediation
    const vfMedia = matchedVisuals.find((v) => /cls|shift|aspect|media/i.test(v.issue));
    const isUnsizedImg = /^img$/i.test(node.tagName) && !/\bwidth=/.test(node.attrsRaw) && !/\bheight=/.test(node.attrsRaw) && !classes.some((c) => c.startsWith('aspect-') || c.startsWith('h-') || c.startsWith('w-'));
    if (vfMedia || isUnsizedImg) {
      const addMediaTw = ['aspect-video', 'w-full', 'h-auto'];
      nodeCssProps['aspect-ratio'] = '16 / 9';
      nodeCssProps.width = '100%';
      if (allowTailwind) {
        for (const mc of addMediaTw) if (!classes.includes(mc)) classes.push(mc);
        mutatedClasses = true;
      } else {
        styleMap.aspectRatio = '16 / 9';
        styleMap.width = '100%';
        mutatedStyle = true;
      }
      tailwindAdjustments.push({ selector: node.selector, astPath: node.astPath, remove: [], add: addMediaTw });
      patches.push({
        type: 'cls_unsized_media', element: node.tagName, selector: node.selector, astPath: node.astPath,
        cssOverride: 'aspect-ratio: 16 / 9; width: 100%; height: auto;', tailwindPatch: { remove: [], add: addMediaTw },
      });
    }

    const vfColorblind = matchedVisuals.find((v) => /colorblind/i.test(v.issue));
    if (vfColorblind) {
      const cbTw = ['underline', 'decoration-2', 'underline-offset-2', 'font-semibold'];
      nodeCssProps['text-decoration'] = 'underline 2px solid currentColor';
      nodeCssProps['font-weight'] = '600';
      if (allowTailwind) {
        for (const cc of cbTw) if (!classes.includes(cc)) classes.push(cc);
        mutatedClasses = true;
      } else {
        styleMap.textDecoration = 'underline';
        styleMap.fontWeight = '600';
        mutatedStyle = true;
      }
      tailwindAdjustments.push({ selector: node.selector, astPath: node.astPath, remove: [], add: cbTw });
      patches.push({
        type: 'colorblind_unsafe_status', element: node.tagName, selector: node.selector, astPath: node.astPath,
        cssOverride: 'text-decoration: underline 2px solid currentColor; font-weight: 600;', tailwindPatch: { remove: [], add: cbTw },
      });
    }

    if (mutatedClasses || mutatedStyle) {
      let updatedAttrs = node.attrsRaw;
      if (mutatedClasses) {
        const serializedClass = `${node.classAttrName}="${classes.join(' ')}"`;
        updatedAttrs = node.classRawMatch ? updatedAttrs.replace(node.classRawMatch, () => serializedClass) : `${updatedAttrs} ${serializedClass}`;
      }
      if (mutatedStyle) {
        const serializedStyle = serializeStyleAttr(node.styleInfo.kind || (ast.language === 'jsx' ? 'jsx' : 'css'), styleMap, node.styleInfo.preserved);
        updatedAttrs = node.styleInfo.rawMatch ? updatedAttrs.replace(node.styleInfo.rawMatch, () => serializedStyle) : `${updatedAttrs} ${serializedStyle}`;
      }
      const afterTag = `<${node.tagName}${updatedAttrs}${node.selfClose}>`;
      inlineEdits.push({
        filePath: options.filePath || null,
        nodeType: 'Element',
        astPath: node.astPath,
        selector: node.selector,
        startOffset: node.startOffset,
        endOffset: node.endOffset,
        startLine: node.startLine,
        endLine: node.endLine,
        expectedChunkHash: computeChunkHash(node.openTag),
        before: node.openTag,
        after: afterTag,
      });
      if (Object.keys(nodeCssProps).length > 0) {
        const decls = Object.entries(nodeCssProps).map(([k, v]) => `${k}: ${v};`).join(' ');
        cssOverrides.push({ selector: node.selector, properties: nodeCssProps, cssRule: `${node.selector} { ${decls} }` });
      }
    }
  }

  // Synthesize standalone CSS/Tailwind overrides when visualFindings are provided without matching source elements
  if (ast.nodes.length === 0 && (ast.cssRules || []).length === 0 && visualQueue.length > 0) {
    for (const vf of visualQueue) {
      const sel = vf.selector || '.tg-surface';
      if (/colorblind/i.test(vf.issue)) {
        const cssRule = `${sel} { text-decoration: underline 2px solid currentColor; font-weight: 600; }`;
        cssOverrides.push({ selector: sel, properties: { 'text-decoration': 'underline 2px solid currentColor', 'font-weight': '600' }, cssRule });
        tailwindAdjustments.push({ selector: sel, astPath: null, remove: [], add: ['underline', 'decoration-2', 'underline-offset-2', 'font-semibold'] });
        inlineEdits.push({ filePath: options.filePath || null, nodeType: 'CssStyleSheetOverride', astPath: null, selector: sel, startOffset: null, endOffset: null, startLine: null, endLine: null, expectedChunkHash: null, before: '', after: cssRule });
        patches.push({ type: 'colorblind_unsafe_status', element: null, selector: sel, astPath: null, cssOverride: 'text-decoration: underline 2px solid currentColor; font-weight: 600;', tailwindPatch: { remove: [], add: ['underline', 'decoration-2', 'underline-offset-2', 'font-semibold'] } });
      } else if (/tap|touch|target/i.test(vf.issue)) {
        const cssRule = `${sel} { min-height: 44px; min-width: 44px; padding: 0.625rem 1rem; }`;
        cssOverrides.push({ selector: sel, properties: { 'min-height': '44px', 'min-width': '44px', padding: '0.625rem 1rem' }, cssRule });
        tailwindAdjustments.push({ selector: sel, astPath: null, remove: [], add: ['min-h-11', 'min-w-11', 'px-4', 'py-2.5'] });
        inlineEdits.push({ filePath: options.filePath || null, nodeType: 'CssStyleSheetOverride', astPath: null, selector: sel, startOffset: null, endOffset: null, startLine: null, endLine: null, expectedChunkHash: null, before: '', after: cssRule });
        patches.push({ type: 'undersized_tap_target', element: null, selector: sel, astPath: null, cssOverride: 'min-height: 44px; min-width: 44px; padding: 0.625rem 1rem;', tailwindPatch: { remove: [], add: ['min-h-11', 'min-w-11', 'px-4', 'py-2.5'] } });
      } else {
        const startFg = vf.fgHex || '#64748b';
        const bg = vf.bgHex || defaultBg;
        const tMin = Number(vf.minContrast || minContrast);
        const solved = solveAccessibleForeground(startFg, bg, tMin);
        const cssRule = `${sel} { color: ${solved.hex}; }`;
        cssOverrides.push({ selector: sel, properties: { color: solved.hex }, cssRule });
        tailwindAdjustments.push({ selector: sel, astPath: null, remove: [], add: [solved.tailwindClass] });
        inlineEdits.push({ filePath: options.filePath || null, nodeType: 'CssStyleSheetOverride', astPath: null, selector: sel, startOffset: null, endOffset: null, startLine: null, endLine: null, expectedChunkHash: null, before: '', after: cssRule });
        patches.push({ type: 'low_contrast', element: null, selector: sel, astPath: null, measuredRatio: computeContrastRatio(startFg, bg), targetRatio: tMin, fixedRatio: solved.ratio, cssOverride: `color: ${solved.hex};`, tailwindPatch: { remove: [], add: [solved.tailwindClass] } });
      }
    }
  }

  let patchedSource = rawSource;
  const anchoredEdits = inlineEdits.filter((e) => typeof e.startOffset === 'number' && typeof e.endOffset === 'number');
  for (const edit of [...anchoredEdits].sort((a, b) => b.startOffset - a.startOffset)) {
    if (patchedSource.slice(edit.startOffset, edit.endOffset) === edit.before) {
      patchedSource = patchedSource.slice(0, edit.startOffset) + edit.after + patchedSource.slice(edit.endOffset);
    }
  }

  return {
    changed: anchoredEdits.length > 0 && patchedSource !== rawSource,
    language: ast.language,
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

function makeFailedDesignReport(error) {
  return {
    ok: false,
    error,
    mode: 'active_self_correcting_design_engine',
    changed: false,
    language: 'html',
    issueCount: 0,
    patches: [],
    inlineEdits: [],
    cssOverrides: [],
    stylesheetOverride: '',
    tailwindAdjustments: [],
    patchedSource: '',
    appliedInPlace: false,
    guardReceipt: null,
    verification: { changed: false, remainingIssueCount: 0, remainingIssues: [] },
  };
}

function runDesignSelfCorrectionPipeline(input = {}) {
  const maxBytes = Math.max(4096, Number(process.env.THUMBGATE_DESIGN_MAX_SOURCE_BYTES) || 262144);
  const filePath = input.filePath ? path.resolve(String(input.filePath)) : null;
  let sourceCode = typeof input.sourceCode === 'string' ? input.sourceCode : '';
  if (!sourceCode && input.allowDiskRead === true && filePath) {
    let lst;
    try {
      lst = fs.lstatSync(filePath);
    } catch {
      return makeFailedDesignReport('file_not_found');
    }
    if (lst.isSymbolicLink() || !lst.isFile()) {
      return makeFailedDesignReport('symlink_or_non_regular_file_rejected');
    }
    if (input.workspaceRoot) {
      let realRoot;
      let realFile;
      try {
        realRoot = fs.realpathSync(path.resolve(String(input.workspaceRoot)));
        realFile = fs.realpathSync(filePath);
      } catch {
        return makeFailedDesignReport('outside_workspace_root');
      }
      if (realFile !== realRoot && !realFile.startsWith(realRoot + path.sep)) {
        return makeFailedDesignReport('outside_workspace_root');
      }
    }
    if (lst.size > maxBytes) {
      return makeFailedDesignReport('source_too_large');
    }
    sourceCode = fs.readFileSync(filePath, 'utf8');
  }
  if (Buffer.byteLength(sourceCode, 'utf8') > maxBytes) {
    return makeFailedDesignReport('source_too_large');
  }
  const report = inspectAndPatchDesignSource(sourceCode, {
    filePath,
    visualFindings: input.visualFindings,
    minContrast: input.minContrast,
    defaultBgHex: input.defaultBgHex,
    allowTailwind: input.allowTailwind !== false,
  });
  const postReport = report.patchedSource ? inspectAndPatchDesignSource(report.patchedSource, { defaultBgHex: input.defaultBgHex, minContrast: input.minContrast }) : { issueCount: 0, patches: [] };
  let appliedInPlace = false;
  let guardReceipt = null;
  if (input.applyInPlace === true && input.allowDiskRead === true && filePath && sourceCode && report.changed) {
    let currentStat = null;
    try { currentStat = fs.lstatSync(filePath); } catch { currentStat = null; }
    if (currentStat && !currentStat.isSymbolicLink() && currentStat.isFile()) {
      guardReceipt = evaluateHashAnchoredEdit({ filePath, targetContent: sourceCode, expectedHash: computeChunkHash(sourceCode) });
      if (guardReceipt.allowed) {
        fs.writeFileSync(filePath, report.patchedSource, 'utf8');
        appliedInPlace = true;
      }
    }
  }
  return {
    ok: postReport.issueCount === 0,
    mode: 'active_self_correcting_design_engine',
    ...report,
    appliedInPlace,
    guardReceipt,
    verification: {
      changed: report.changed,
      remainingIssueCount: postReport.issueCount,
      remainingIssues: postReport.patches.map((p) => ({ type: p.type, selector: p.selector })),
    },
  };
}

function parseFiniteNonNeg(v, fallback = 0) {
  if (v === undefined || v === null || v === '') return { ok: true, value: fallback, provided: false };
  if (typeof v === 'boolean' || typeof v === 'object') return { ok: false, value: 0, provided: true };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return { ok: false, value: 0, provided: true };
  return { ok: true, value: n, provided: true };
}

function scrubBoostTelemetryMetadata(event = {}) {
  const ev = event && typeof event === 'object' && !Array.isArray(event) ? event : {};
  const safeModel = String(ev.model || 'unknown').replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 64) || 'unknown';
  const safeGate = ev.gateRuleId ? String(ev.gateRuleId).replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 64) : null;
  const inTok = parseFiniteNonNeg(ev.inputTokens, 0);
  const outTok = parseFiniteNonNeg(ev.outputTokens, 0);
  const cost = parseFiniteNonNeg(ev.costUsd, 0);
  const rawTs = typeof ev.timestamp === 'string' ? ev.timestamp.trim() : '';
  const safeTs = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(rawTs) ? rawTs : new Date().toISOString();
  return {
    storesPrompts: false,
    storesResponses: false,
    storesRepoPromptContext: false,
    metadata: {
      timestamp: safeTs,
      lane: ev.lane === 'boost_lane' ? 'boost_lane' : 'primary_subscription',
      model: safeModel,
      inputTokens: Math.trunc(inTok.value),
      outputTokens: Math.trunc(outTok.value),
      costUsd: Math.round(cost.value * 1e6) / 1e6,
      gateRuleId: safeGate,
    },
  };
}

function evaluateComputeBoostLane(rawInput = {}) {
  const input = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? rawInput : null;
  if (!input) {
    return { ok: false, allowed: false, stopReason: 'invalid_boost_input', selectedLane: 'boost_lane', economics: { cashWithdrawalAllowed: false, canOverspend: false, outboundCashSpendUsd: 0 }, balances: { totalAvailableBoostUsd: 0, deductedBoostUsd: 0, remainingBoostUsd: 0, savedBoostUsd: 0 }, metering: { meteredUnits: 0 }, telemetry: scrubBoostTelemetryMetadata({}) };
  }
  const grossP = parseFiniteNonNeg(input.grossBoostUsd, 0);
  const sharedP = parseFiniteNonNeg(input.sharedPoolReleaseUsd, 0);
  const balP = parseFiniteNonNeg(input.boostBalanceUsd, 0);
  const estP = parseFiniteNonNeg(input.estimatedRequestUsd, 0);
  const inFlightP = parseFiniteNonNeg(input.activeInFlightRequests, 0);
  const opKind = String(input.operationKind || 'cloud_chat_reply').trim().toLowerCase();
  const isUnmeteredLocal = opKind === 'pre_tool_use_gate' || opKind === 'kb_setup_upload' || opKind === 'greeting_no_model' || input.blockedBeforeModel === true;
  const chatP = parseFiniteNonNeg(input.chatReplies, isUnmeteredLocal ? 0 : 1);
  const docsP = parseFiniteNonNeg(input.documentsUploaded, 0);
  const pagesP = parseFiniteNonNeg(input.pagesGenerated, 0);
  const tasksP = parseFiniteNonNeg(input.tasksExecuted, 0);
  if (![grossP, sharedP, balP, estP, inFlightP, chatP, docsP, pagesP, tasksP].every((x) => x.ok)) {
    return { ok: false, allowed: false, stopReason: 'invalid_boost_input', selectedLane: 'boost_lane', economics: { cashWithdrawalAllowed: false, canOverspend: false, outboundCashSpendUsd: 0 }, balances: { totalAvailableBoostUsd: 0, deductedBoostUsd: 0, remainingBoostUsd: 0, savedBoostUsd: 0 }, metering: { meteredUnits: 0 }, telemetry: scrubBoostTelemetryMetadata(input.telemetry) };
  }
  const grossBoostUsd = grossP.value;
  const platformFeeUsd = Math.round(grossBoostUsd * 0.05 * 100) / 100;
  const creditedCapacityUsd = Math.round((grossBoostUsd - platformFeeUsd) * 100) / 100;
  const totalAvailableBoostUsd = Math.round((balP.value + creditedCapacityUsd + sharedP.value) * 1e6) / 1e6;
  const chatReplies = Math.trunc(chatP.value);
  const documentsUploaded = Math.trunc(docsP.value);
  const pagesGenerated = Math.trunc(pagesP.value);
  const tasksExecuted = Math.trunc(tasksP.value);
  const meteredUnits = isUnmeteredLocal ? 0 : (chatReplies + documentsUploaded + pagesGenerated + tasksExecuted);
  const effectiveCostUsd = isUnmeteredLocal ? 0 : estP.value;
  const savedBoostUsd = input.blockedBeforeModel === true ? estP.value : 0;
  const primaryStatus = String(input.primarySubscriptionStatus || 'active').trim().toLowerCase();
  const primaryPaused = primaryStatus === 'window_paused' || primaryStatus === 'rate_limited' || primaryStatus === 'none';
  const inFlight = Math.trunc(inFlightP.value);
  const selectedLane = isUnmeteredLocal ? 'local_zero_burn' : (primaryPaused ? 'boost_lane' : 'primary_subscription');
  let allowed = true;
  let stopReason = null;
  if (selectedLane === 'boost_lane') {
    if (inFlight >= 1) { allowed = false; stopReason = 'boost_single_flight_busy'; }
    else if (effectiveCostUsd <= 0) { allowed = false; stopReason = totalAvailableBoostUsd <= 0 ? 'boost_balance_exhausted' : 'invalid_boost_input'; }
    else if (effectiveCostUsd > totalAvailableBoostUsd) { allowed = false; stopReason = 'boost_balance_exhausted'; }
  }
  const deductedBoostUsd = allowed && selectedLane === 'boost_lane' ? effectiveCostUsd : 0;
  const remainingBoostUsd = Math.max(0, Math.round((totalAvailableBoostUsd - deductedBoostUsd) * 1e6) / 1e6);
  return {
    ok: true,
    allowed,
    stopReason,
    selectedLane,
    economics: { grossBoostUsd, creditedCapacityUsd, platformFeeUsd, developerCapacitySharePct: 95, platformFeePct: 5, cashWithdrawalAllowed: false, supporterAccountRequired: false, canOverspend: false, outboundCashSpendUsd: 0 },
    balances: { totalAvailableBoostUsd, deductedBoostUsd, remainingBoostUsd, savedBoostUsd },
    metering: {
      operationKind: opKind,
      isUnmeteredLocal,
      meteredUnits,
      regenerationsCountFresh: true,
      breakdown: isUnmeteredLocal ? { chatReplies: 0, documentsUploaded: 0, pagesGenerated: 0, tasksExecuted: 0 } : { chatReplies, documentsUploaded, pagesGenerated, tasksExecuted },
    },
    telemetry: scrubBoostTelemetryMetadata({ ...(input.telemetry && typeof input.telemetry === 'object' ? input.telemetry : {}), lane: selectedLane === 'boost_lane' ? 'boost_lane' : 'primary_subscription', costUsd: deductedBoostUsd }),
  };
}

const SUBQ_SNAP_MODELS = new Set(['subq-snap-1.2', 'subq-snap-latest', 'subq-snap']);
const SUBQ_ALLOWED_IMAGE_MEDIA = new Set(['image/png', 'image/jpeg', 'image/webp']);
const SUBQ_SAFE_KEY_RE = /^(?!__proto__$|constructor$|prototype$)[a-zA-Z0-9_.-]{1,100}$/;
const SUBQ_MAX_WINDOW_TOKENS = 393216;
const SUBQ_PRICE_PER_MILLION_INPUT_USD = 0.04;

function buildSubQSnap12Payload(rawInput = {}) {
  const input = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? rawInput : null;
  if (!input || input.state === undefined || input.state === null) return { ok: false, error: 'missing_state' };
  const requestedModel = String(input.model || 'subq-snap-1.2').trim();
  const model = SUBQ_SNAP_MODELS.has(requestedModel) ? requestedModel : 'subq-snap-1.2';
  const rawQuestions = input.questions && typeof input.questions === 'object' && !Array.isArray(input.questions) ? input.questions : null;
  const qEntries = rawQuestions ? Object.entries(rawQuestions) : [];
  if (qEntries.length < 1 || qEntries.length > 128) return { ok: false, error: 'invalid_questions_count' };
  const questionPairs = [];
  for (const [qName, qDef] of qEntries) {
    if (!SUBQ_SAFE_KEY_RE.test(qName) || !qDef || typeof qDef !== 'object' || Array.isArray(qDef)) return { ok: false, error: 'invalid_question_key' };
    const qType = String(qDef.type || '').trim();
    const instructions = String(qDef.instructions || '').trim();
    if (!instructions || !['noul', 'choice', 'score'].includes(qType)) return { ok: false, error: `invalid_question_schema:${qName}` };
    if (qType === 'choice') {
      const cObj = qDef.criteria && typeof qDef.criteria === 'object' && !Array.isArray(qDef.criteria) ? qDef.criteria : null;
      const keys = cObj ? Object.keys(cObj) : [];
      if (keys.length < 2 || keys.length > 255 || !keys.every((k) => SUBQ_SAFE_KEY_RE.test(k))) return { ok: false, error: `invalid_choice_criteria:${qName}` };
      const criteria = Object.fromEntries([...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((k) => [k, cObj[k] === null ? null : String(cObj[k])]));
      questionPairs.push([qName, { type: 'choice', instructions, criteria }]);
    } else if (qType === 'score') {
      if (!Array.isArray(qDef.criteria) || qDef.criteria.length < 2 || qDef.criteria.length > 10) return { ok: false, error: `invalid_score_criteria:${qName}` };
      questionPairs.push([qName, { type: 'score', instructions, criteria: qDef.criteria.map((x) => String(x)) }]);
    } else {
      const entry = { type: 'noul', instructions };
      if (qDef.criteria && typeof qDef.criteria === 'object' && !Array.isArray(qDef.criteria)) {
        const noulPairs = [];
        if (Object.hasOwn(qDef.criteria, 'true')) noulPairs.push(['true', String(qDef.criteria.true)]);
        if (Object.hasOwn(qDef.criteria, 'false')) noulPairs.push(['false', String(qDef.criteria.false)]);
        if (noulPairs.length > 0) entry.criteria = Object.fromEntries(noulPairs);
      }
      questionPairs.push([qName, entry]);
    }
  }
  const questions = Object.fromEntries(questionPairs);
  let images;
  let imageTokens = 0;
  if (input.images !== undefined) {
    if (!Array.isArray(input.images) || input.images.length > 4) return { ok: false, error: 'invalid_images_count' };
    let totalDecodedBytes = 0;
    images = [];
    for (const img of input.images) {
      if (!img || typeof img !== 'object') return { ok: false, error: 'invalid_image_entry' };
      const mediaType = String(img.mediaType || '').trim().toLowerCase();
      if (!SUBQ_ALLOWED_IMAGE_MEDIA.has(mediaType)) return { ok: false, error: 'unsupported_image_media_type' };
      const cleanedB64 = String(img.base64 || '').replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
      if (!cleanedB64 || /^https?:\/\//i.test(cleanedB64)) return { ok: false, error: 'invalid_image_base64' };
      const decodedLen = Buffer.from(cleanedB64, 'base64').length;
      if (decodedLen <= 0 || decodedLen > 4 * 1024 * 1024) return { ok: false, error: 'image_over_4_mib' };
      totalDecodedBytes += decodedLen;
      if (totalDecodedBytes > 8 * 1024 * 1024) return { ok: false, error: 'images_over_8_mib_total' };
      imageTokens += 800;
      images.push({ mediaType, base64: cleanedB64 });
    }
  }
  const stateSerialized = typeof input.state === 'string' ? input.state : String(JSON.stringify(input.state) ?? '');
  const questionsSerialized = JSON.stringify(questions);
  const estTokens = Math.ceil((Buffer.byteLength(stateSerialized, 'utf8') + Buffer.byteLength(questionsSerialized, 'utf8')) / 4) + imageTokens;
  if (estTokens > SUBQ_MAX_WINDOW_TOKENS) return { ok: false, error: 'exceeds_384k_context_window', estimatedInputTokens: estTokens };
  return {
    ok: true,
    payload: { model, state: input.state, questions, ...(images && images.length > 0 ? { images } : {}) },
    estimatedInputTokens: estTokens,
    estimatedInputCostUsd: Math.round((estTokens / 1e6) * SUBQ_PRICE_PER_MILLION_INPUT_USD * 1e8) / 1e8,
    outputCostUsd: 0,
  };
}

async function callSubQSnapSystemOneApi(rawInput = {}, options = {}) {
  const built = buildSubQSnap12Payload(rawInput);
  if (!built.ok) return { ok: false, mode: 'validation_rejected', error: built.error, abstained: true, action: 'UNCERTAIN_ESCALATE_TO_FRONTIER' };
  const rawTau = typeof options.confidenceThreshold === 'number' && Number.isFinite(options.confidenceThreshold) ? options.confidenceThreshold : 0.65;
  const tau = Math.min(1, Math.max(0.01, rawTau));
  const apiKey = String(options.apiKey !== undefined ? options.apiKey : (process.env.SUBQ_API_KEY || '')).trim();
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : fetch;
  if (!apiKey) {
    return {
      ok: true,
      mode: 'local_offline_no_api_key',
      model: built.payload.model,
      estimatedInputTokens: built.estimatedInputTokens,
      estimatedInputCostUsd: built.estimatedInputCostUsd,
      outputCostUsd: 0,
      abstained: true,
      action: 'UNCERTAIN_ESCALATE_TO_FRONTIER',
      reason: 'subq_api_key_missing',
    };
  }
  let res;
  try {
    res = await fetchImpl('https://api.subq.ai/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(built.payload),
      signal: AbortSignal.timeout(Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 8000),
    });
  } catch {
    return { ok: false, mode: 'upstream_error', status: 502, error: 'subq_network_error', abstained: true, action: 'UNCERTAIN_ESCALATE_TO_FRONTIER' };
  }
  if (res.status === 402) {
    return { ok: false, mode: 'credit_exhausted_zero_overspend', status: 402, error: 'subq_credits_exhausted', outboundCashSpendUsd: 0, abstained: true, action: 'UNCERTAIN_ESCALATE_TO_FRONTIER' };
  }
  if (!res.ok) {
    return { ok: false, mode: 'upstream_error', status: res.status, error: `subq_http_${res.status}`, abstained: true, action: 'UNCERTAIN_ESCALATE_TO_FRONTIER' };
  }
  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, mode: 'upstream_error', status: 502, error: 'subq_invalid_json', abstained: true, action: 'UNCERTAIN_ESCALATE_TO_FRONTIER' };
  }
  const answers = data && typeof data.answers === 'object' && !Array.isArray(data.answers) ? data.answers : {};
  const expectedKeys = Object.keys(built.payload.questions);
  let invalidAnswer = expectedKeys.length === 0;
  let minConfidence = expectedKeys.length > 0 ? 1 : 0;
  for (const qk of expectedKeys) {
    const expectedType = built.payload.questions[qk].type;
    const ans = Object.hasOwn(answers, qk) ? answers[qk] : null;
    if (!ans || typeof ans !== 'object' || ans.type !== expectedType) { invalidAnswer = true; minConfidence = 0; break; }
    let conf = NaN;
    if (expectedType === 'noul') {
      const nv = typeof ans.noul === 'number' ? ans.noul : NaN;
      conf = Number.isFinite(nv) && nv >= 0 && nv <= 1 ? Math.max(nv, 1 - nv) : NaN;
    } else {
      const cv = typeof ans.confidence === 'number' ? ans.confidence : NaN;
      conf = Number.isFinite(cv) && cv >= 0 && cv <= 1 ? cv : NaN;
    }
    if (!Number.isFinite(conf)) { invalidAnswer = true; minConfidence = 0; break; }
    if (conf < minConfidence) minConfidence = conf;
  }
  const usageTok = parseFiniteNonNeg(data?.usage?.input_tokens, built.estimatedInputTokens);
  const inputTokens = Math.trunc(usageTok.ok ? usageTok.value : built.estimatedInputTokens);
  const abstained = invalidAnswer || minConfidence < tau;
  return {
    ok: true,
    mode: 'live_subq_systemone',
    model: data?.model || built.payload.model,
    answers,
    usage: { input_tokens: inputTokens, output_tokens: 0 },
    costUsd: Math.round((inputTokens / 1e6) * SUBQ_PRICE_PER_MILLION_INPUT_USD * 1e8) / 1e8,
    outboundCashSpendUsd: 0,
    minConfidence: Math.round(minConfidence * 1e4) / 1e4,
    abstained,
    action: abstained ? 'UNCERTAIN_ESCALATE_TO_FRONTIER' : 'PROCEED_WITH_SUBQ_DECISION',
  };
}

module.exports = {
  PROVER_COVERAGE_DOMAINS,
  TAILWIND_HEX_PALETTE,
  provePolicyBoundary,
  evaluateProposalRisk,
  verifyProviderCredentialEgress,
  verifyNonDestructiveProjectEdit,
  evaluateBrandAdherence,
  computeContrastRatio,
  solveAccessibleForeground,
  parseCssRulesAst,
  parseDesignAst,
  inspectAndPatchDesignSource,
  remediateVisualFindings,
  runDesignSelfCorrectionPipeline,
  scrubBoostTelemetryMetadata,
  evaluateComputeBoostLane,
  buildSubQSnap12Payload,
  callSubQSnapSystemOneApi,
};
