'use strict';

/**
 * NVIDIA OpenShell (v0.1.8) + Adobe MAX Nov-2026 + Lovable Self-Correcting Design Engine
 *
 * 1. Formal Policy Boundary Prover (`provePolicyBoundary`) & Policy Advisor Risk Check (`evaluateProposalRisk`)
 *    modeled on NVIDIA OpenShell (`openshell-prover` & `policy.local` advisor).
 * 2. Endpoint-Bound Credential Provider Egress Guard (`verifyProviderCredentialEgress`).
 * 3. Adobe Creative Agent / GenStudio Governance (`verifyNonDestructiveProjectEdit`, `evaluateBrandAdherence`).
 * 4. Lovable Active Self-Correcting Design Engine (`inspectAndPatchDesignSource`) that transforms visual/layout
 *    issues (WCAG contrast, <44px tap targets, mobile fixed-width overflow, focus-ring stripping) directly into
 *    inline HTML/JSX source edits, CSS overrides, and Tailwind utility patches.
 */

const PROVER_COVERAGE_DOMAINS = Object.freeze([
  'filesystem',
  'network_l4',
  'network_rest',
  'process',
  'landlock',
]);

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
  if (
    h === 'metadata.google.internal'
    || h === 'metadata'
    || h === '100.100.100.200'
    || h === 'localhost'
    || /^127\./.test(h)
    || /^169\.254\./.test(h)
    || /^fe80:/i.test(h)
    || h === '::1'
  ) {
    return { linkLocal: true, privateIp: true };
  }
  if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^fc00:|^fd/i.test(h)) {
    return { linkLocal: false, privateIp: true };
  }
  return { linkLocal: false, privateIp: false };
}

function proverVerdict(result, exitCode, extra = {}) {
  return {
    result,
    exitCode,
    passed: result === 'within_boundary',
    coverage: { domains: [...PROVER_COVERAGE_DOMAINS] },
    ...extra,
  };
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
  const bLandlock = boundary.landlock?.compatibility;
  if (bLandlock === 'hard_requirement' && cLandlock && cLandlock !== 'hard_requirement') {
    return proverVerdict('exceeds_boundary', 1, {
      reason_code: 'landlock_downgrade',
      counterexample: `landlock compatibility ${cLandlock}`,
    });
  }

  // 2. Process identity check
  for (const field of ['run_as_user', 'run_as_group']) {
    const cVal = candidate.process_policy?.[field];
    const bVal = boundary.process_policy?.[field];
    if (cVal !== undefined && bVal !== undefined && String(cVal) !== String(bVal)) {
      const cRoot = String(cVal) === '0' || String(cVal).toLowerCase() === 'root';
      const bRoot = String(bVal) === '0' || String(bVal).toLowerCase() === 'root';
      if (cRoot && !bRoot) {
        return proverVerdict('exceeds_boundary', 1, {
          reason_code: 'privilege_escalation_root',
          counterexample: `process ${field} ${cVal}`,
        });
      }
      return proverVerdict('unsupported', 3, {
        reason_code: 'uid_remap_unverifiable',
        reason: `Cannot verify ${field} change from '${bVal}' to '${cVal}' without sandbox /etc/passwd.`,
      });
    }
  }

  // 3. Filesystem access check (symlink-strict per OpenShell prover semantics)
  const cRo = new Set(candidate.filesystem_policy?.read_only || []);
  const cRw = new Set(candidate.filesystem_policy?.read_write || []);
  const bRo = new Set(boundary.filesystem_policy?.read_only || []);
  const bRw = new Set(boundary.filesystem_policy?.read_write || []);
  const bAllRead = new Set([...bRo, ...bRw]);

  for (const p of [...cRo, ...cRw]) {
    if (!String(p).startsWith('/')) {
      return proverVerdict('unsupported', 3, {
        reason_code: 'workdir_relative_path',
        reason: `Filesystem path '${p}' depends on sandbox working directory.`,
      });
    }
  }
  for (const p of cRw) {
    if (bRw.has('/') || bRw.has(p)) continue;
    if (bRw.size === 0 || bRo.has(p)) {
      return proverVerdict('exceeds_boundary', 1, {
        reason_code: 'filesystem_write_exceeds',
        counterexample: `filesystem write ${p}`,
      });
    }
    return proverVerdict('unsupported', 3, {
      reason_code: 'symlink_subpath_unverifiable',
      reason: `Candidate write path '${p}' differs from boundary paths and symlinks cannot be statically resolved.`,
    });
  }
  for (const p of cRo) {
    if (bAllRead.has('/') || bAllRead.has(p)) continue;
    if (bAllRead.size === 0) {
      return proverVerdict('exceeds_boundary', 1, {
        reason_code: 'filesystem_read_exceeds',
        counterexample: `filesystem read ${p}`,
      });
    }
    return proverVerdict('unsupported', 3, {
      reason_code: 'symlink_subpath_unverifiable',
      reason: `Candidate read path '${p}' differs from boundary paths and symlinks cannot be statically resolved.`,
    });
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
        return proverVerdict('unsupported', 3, {
          reason_code: 'unsupported_policy_shape',
          reason: `candidate policy rule '${rule.name || 'unnamed'}' uses protocol '${proto}'; only L4 TCP and REST are modeled`,
        });
      }
      if (!ep.host || (ep.port !== undefined && ep.ports !== undefined) || String(ep.host).includes(':') || !isAscii(ep.host)) {
        return proverVerdict('unsupported', 3, {
          reason_code: 'unsupported_endpoint_shape',
          reason: `Endpoint '${ep.host || '(missing)'}' omits host, mixes port/ports, uses IPv6, or has non-ASCII characters.`,
        });
      }
      if (proto === 'rest' && ep.enforcement && ep.enforcement !== 'enforce') {
        return proverVerdict('unsupported', 3, {
          reason_code: 'audit_mode_non_enforcing',
          reason: `REST endpoint '${ep.host}:${ep.port || 443}' uses enforcement '${ep.enforcement}'; audit mode does not block requests.`,
        });
      }

      const port = Number(ep.port || 443);
      const matchingBoundary = bEndpoints.find((b) => b.host === ep.host && Number(b.port || 443) === port);
      if (!matchingBoundary) {
        const wildcardOverlap = bEndpoints.find((b) => Number(b.port || 443) === port && (String(b.host).startsWith('*.') || String(ep.host).startsWith('*.')));
        if (wildcardOverlap && (!ep.allowed_ips || !wildcardOverlap.allowed_ips)) {
          return proverVerdict('unsupported', 3, {
            reason_code: 'wildcard_host_overlap',
            reason: `Wildcard and exact host share port ${port} without allowed_ips.`,
          });
        }
        return proverVerdict('exceeds_boundary', 1, {
          reason_code: 'network_destination_exceeds',
          counterexample: `network ${proto} ${ep.host}:${port}`,
        });
      }

      // Binary glob vs exact symlink check
      for (const cb of cBins) {
        if (matchingBoundary.binaries.length > 0 && !matchingBoundary.binaries.includes(cb)) {
          const globMatch = matchingBoundary.binaries.find((bb) => String(bb).endsWith('*') && String(cb).startsWith(String(bb).slice(0, -1)));
          if (globMatch) {
            return proverVerdict('unsupported', 3, {
              reason_code: 'binary_glob_symlink_unverifiable',
              reason: `Candidate binary '${cb}' matched only via boundary glob '${globMatch}'.`,
            });
          }
          return proverVerdict('exceeds_boundary', 1, {
            reason_code: 'binary_exceeds_boundary',
            counterexample: `binary ${cb} -> ${ep.host}:${port}`,
          });
        }
      }

      // REST method + path allow rules check
      if (proto === 'rest') {
        if (String(matchingBoundary.protocol || 'tcp').toLowerCase() !== 'rest') {
          return proverVerdict('unsupported', 3, {
            reason_code: 'mixed_rest_and_l4_endpoint',
            reason: `Host '${ep.host}:${port}' mixes REST and non-REST endpoint rules.`,
          });
        }
        const bAllows = (matchingBoundary.rules || []).filter((r) => r.allow).map((r) => r.allow);
        for (const r of ep.rules || []) {
          if (!r.allow) continue;
          const method = String(r.allow.method || 'GET').toUpperCase();
          const rPath = String(r.allow.path || '/');
          if (rPath.includes('?') || rPath.includes('[')) {
            return proverVerdict('unsupported', 3, {
              reason_code: 'unsupported_rest_path_matcher',
              reason: `REST path '${rPath}' uses query parameters or bracket expressions.`,
            });
          }
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
  const autoApproved = !neverApprovable
    && !globalPolicyActive
    && approvalMode === 'auto'
    && findingsList.length === 0
    && flagsList.length === 0;

  return {
    valid: true,
    status: neverApprovable ? 'blocked_never_approvable' : (autoApproved ? 'auto_approved' : 'pending_human_review'),
    autoApproved,
    neverApprovable,
    findings: findingsList,
    securityFlags: flagsList,
  };
}

/**
 * NVIDIA OpenShell Endpoint-Bound Provider Credential Egress Check.
 * Agents hold placeholders (`tg_cred://<provider>/<KEY>`) and never transmit credentials to unapproved hosts.
 */
function verifyProviderCredentialEgress(request, providers = []) {
  const urlStr = String(request?.url || '');
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { allowed: false, reason: 'invalid_destination_url' };
  }
  const host = parsed.hostname.toLowerCase();
  const port = Number(parsed.port || (parsed.protocol === 'http:' ? 80 : 443));
  const method = String(request?.method || 'GET').toUpperCase();
  const serializedHeaders = JSON.stringify(request?.headers || {});
  const placeholderMatch = serializedHeaders.match(/tg_cred:\/\/([a-z0-9_-]+)\/([A-Za-z0-9_]+)/i);
  const providerName = request?.provider || (placeholderMatch ? placeholderMatch[1] : null);
  if (!providerName) return { allowed: true, injected: false };

  const provider = providers.find((p) => p && p.name === providerName);
  if (!provider || !Array.isArray(provider.endpoints) || provider.endpoints.length === 0) {
    return { allowed: false, reason: 'profileless_or_unknown_provider' };
  }

  const endpointOk = provider.endpoints.some((ep) => {
    if (String(ep.host || '').toLowerCase() !== host) return false;
    if (Number(ep.port || 443) !== port) return false;
    if (Array.isArray(ep.methods) && ep.methods.length > 0 && !ep.methods.map((m) => m.toUpperCase()).includes(method)) {
      return false;
    }
    if (ep.pathPrefix && !parsed.pathname.startsWith(ep.pathPrefix)) return false;
    return true;
  });

  if (!endpointOk) {
    return {
      allowed: false,
      reason: 'credential_destination_mismatch',
      detail: `Provider '${providerName}' credential cannot be sent to ${method} ${host}:${port}${parsed.pathname}`,
    };
  }
  return { allowed: true, injected: true, provider: providerName };
}

/**
 * Adobe MAX Nov-2026 Local Creative MCP Guard: keep layers, sequences, and compositions editable.
 */
function verifyNonDestructiveProjectEdit(action = {}) {
  const targetPath = String(action.targetPath || action.file || '').trim();
  const outputPath = String(action.outputPath || '').trim();
  const operation = String(action.operation || action.command || '').trim();
  if (!LAYERED_PROJECT_EXT_RE.test(targetPath)) {
    return { allowed: true, nonDestructive: true };
  }
  const overwritesInPlace = !outputPath || outputPath === targetPath;
  if (DESTRUCTIVE_ASSET_OP_RE.test(operation) && overwritesInPlace && action.preserveLayers !== true) {
    const ext = targetPath.match(LAYERED_PROJECT_EXT_RE)[0];
    const suggestedOutput = targetPath.slice(0, -ext.length) + `.export${ext}`;
    return {
      allowed: false,
      reason: 'destructive_layer_flatten_blocked',
      suggestedPatch: {
        preserveLayers: true,
        outputPath: suggestedOutput,
      },
    };
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

function resolveColorFromClassesOrStyle(classAttr, styleAttr, kind) {
  const prefix = kind === 'fg' ? 'text-' : 'bg-';
  const cssProp = kind === 'fg' ? 'color' : 'background(?:-color)?';
  const styleMatch = new RegExp(`(?:^|;)\\s*${cssProp}\\s*:\\s*(#[0-9a-fA-F]{3,6})\\b`).exec(styleAttr || '');
  if (styleMatch) return { hex: styleMatch[1], token: null, fromStyle: true };

  const classes = String(classAttr || '').trim().split(/\s+/).filter(Boolean);
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
 * Inspect HTML/JSX markup for visual/layout optimization issues and emit BOTH
 * structured CSS/Tailwind patches AND an inline AST-rewritten `patchedSource`.
 */
function inspectAndPatchDesignSource(source, options = {}) {
  const minContrast = Number(options.minContrast || 4.5);
  const defaultBg = options.defaultBgHex || '#0f172a';
  const patches = [];
  const tagRegex = /<([a-zA-Z][a-zA-Z0-9.-]*)(\s[^<>]*?)?(\/?)>/g;

  let patchedSource = String(source || '');
  let offsetDelta = 0;
  let match;

  while ((match = tagRegex.exec(String(source || ''))) !== null) {
    const fullOpenTag = match[0];
    const tagName = match[1];
    const attrsRaw = match[2] || '';
    const selfClose = match[3] || '';
    const classAttrMatch = /\b(class|className)=("([^"]*)"|'([^']*)')/.exec(attrsRaw);
    const classAttrName = classAttrMatch ? classAttrMatch[1] : 'className';
    const classQuote = classAttrMatch ? classAttrMatch[2][0] : '"';
    let classes = classAttrMatch ? (classAttrMatch[3] ?? classAttrMatch[4] ?? '').trim().split(/\s+/).filter(Boolean) : [];

    const styleAttrMatch = /\bstyle="([^"]*)"/.exec(attrsRaw);
    let inlineStyle = styleAttrMatch ? styleAttrMatch[1].trim() : '';

    let mutatedClasses = false;
    let mutatedStyle = false;
    const cssOverrides = {};
    const tailwindEdits = [];

    // 1. Contrast check & self-correction
    const fgInfo = resolveColorFromClassesOrStyle(classes.join(' '), inlineStyle, 'fg');
    const bgInfo = resolveColorFromClassesOrStyle(classes.join(' '), inlineStyle, 'bg');
    if (fgInfo && (bgInfo || options.defaultBgHex)) {
      const bgHex = bgInfo ? bgInfo.hex : defaultBg;
      const currentRatio = computeContrastRatio(fgInfo.hex, bgHex);
      if (currentRatio !== null && currentRatio < minContrast) {
        const solved = solveAccessibleForeground(fgInfo.hex, bgHex, minContrast);
        cssOverrides.color = solved.hex;
        if (fgInfo.fromStyle) {
          inlineStyle = inlineStyle.replace(/(?:^|;)\s*color\s*:\s*#[0-9a-fA-F]{3,6}/i, (m) => m.replace(/#[0-9a-fA-F]{3,6}/, solved.hex));
          mutatedStyle = true;
        } else if (fgInfo.token) {
          classes = classes.map((c) => (c === fgInfo.token ? solved.tailwindClass : c));
          tailwindEdits.push({ remove: fgInfo.token, add: solved.tailwindClass });
          mutatedClasses = true;
        }
        patches.push({
          type: 'low_contrast',
          element: tagName,
          measuredRatio: currentRatio,
          targetRatio: minContrast,
          fixedRatio: solved.ratio,
          cssOverride: `color: ${solved.hex};`,
          tailwindPatch: tailwindEdits[tailwindEdits.length - 1] || { add: solved.tailwindClass },
        });
      }
    }

    // 2. Interactive tap-target (<44px) check & self-correction
    const isInteractive = /^(button|a|input|select)$/i.test(tagName) || /\brole=["']button["']/i.test(attrsRaw);
    if (isInteractive) {
      const smallTw = classes.filter((c) => /^(h-[45678]|p-[01]|py-(?:0|0\.5|1)|px-(?:1|1\.5)|text-\[(?:9|10)px\])$/.test(c));
      const smallCssMatch = /(?:^|;)\s*height\s*:\s*(\d+)px/i.exec(inlineStyle);
      const smallCssPx = smallCssMatch ? Number(smallCssMatch[1]) : null;
      if (smallTw.length > 0 || (smallCssPx !== null && smallCssPx < 44)) {
        cssOverrides['min-height'] = '44px';
        cssOverrides['min-width'] = '44px';
        if (smallTw.length > 0) {
          classes = classes.filter((c) => !smallTw.includes(c));
          for (const addCls of ['min-h-11', 'min-w-11', 'px-4', 'py-2.5']) {
            if (!classes.includes(addCls)) classes.push(addCls);
          }
          tailwindEdits.push({ remove: smallTw, add: ['min-h-11', 'min-w-11', 'px-4', 'py-2.5'] });
          mutatedClasses = true;
        }
        if (smallCssPx !== null && smallCssPx < 44) {
          inlineStyle = inlineStyle.replace(/(?:^|;)\s*height\s*:\s*\d+px/i, (m) => m.replace(/height\s*:\s*\d+px/i, 'min-height: 44px; min-width: 44px'));
          mutatedStyle = true;
        }
        patches.push({
          type: 'undersized_tap_target',
          element: tagName,
          cssOverride: 'min-height: 44px; min-width: 44px; padding: 0.625rem 1rem;',
          tailwindPatch: { remove: smallTw, add: ['min-h-11', 'min-w-11', 'px-4', 'py-2.5'] },
        });
      }

      // 3. Focus-ring stripping (`outline-none` without `focus-visible:ring-*`)
      if (classes.includes('outline-none') && !classes.some((c) => c.startsWith('focus-visible:ring') || c.startsWith('focus:ring'))) {
        const ringClasses = ['focus-visible:ring-2', 'focus-visible:ring-cyan-400', 'focus-visible:ring-offset-2'];
        classes.push(...ringClasses);
        mutatedClasses = true;
        cssOverrides.outline = '2px solid #22d3ee';
        patches.push({
          type: 'missing_focus_ring',
          element: tagName,
          cssOverride: 'outline: 2px solid #22d3ee; outline-offset: 2px;',
          tailwindPatch: { remove: [], add: ringClasses },
        });
      }
    }

    // 4. Fixed-width mobile overflow (`w-[600px]` or `width: 600px` >= 360px without `max-w-full`)
    const fixedTw = classes.find((c) => /^w-\[(\d+)px\]$/.test(c) && Number(/^w-\[(\d+)px\]$/.exec(c)[1]) >= 360);
    const fixedCss = /(?:^|;)\s*width\s*:\s*(\d+)px/i.exec(inlineStyle);
    if ((fixedTw && !classes.includes('max-w-full')) || (fixedCss && Number(fixedCss[1]) >= 360 && !/max-width/i.test(inlineStyle))) {
      if (fixedTw) {
        const px = /^w-\[(\d+)px\]$/.exec(fixedTw)[1];
        const maxCls = `max-w-[${px}px]`;
        classes = classes.map((c) => (c === fixedTw ? 'w-full' : c));
        if (!classes.includes(maxCls)) classes.push(maxCls);
        mutatedClasses = true;
        patches.push({
          type: 'fixed_width_mobile_overflow',
          element: tagName,
          cssOverride: `width: 100%; max-width: ${px}px; box-sizing: border-box;`,
          tailwindPatch: { remove: [fixedTw], add: ['w-full', maxCls] },
        });
      } else if (fixedCss) {
        const px = fixedCss[1];
        inlineStyle = inlineStyle.replace(/(?:^|;)\s*width\s*:\s*\d+px/i, (m) => m.replace(/width\s*:\s*\d+px/i, `width: 100%; max-width: ${px}px`));
        mutatedStyle = true;
        patches.push({
          type: 'fixed_width_mobile_overflow',
          element: tagName,
          cssOverride: `width: 100%; max-width: ${px}px; box-sizing: border-box;`,
          tailwindPatch: { remove: [], add: ['w-full', `max-w-[${px}px]`] },
        });
      }
    }

    if (mutatedClasses || mutatedStyle) {
      let updatedAttrs = attrsRaw;
      if (mutatedClasses) {
        const serialized = `${classAttrName}=${classQuote}${classes.join(' ')}${classQuote}`;
        updatedAttrs = classAttrMatch
          ? updatedAttrs.replace(classAttrMatch[0], serialized)
          : `${updatedAttrs} ${serialized}`;
      }
      if (mutatedStyle && styleAttrMatch) {
        updatedAttrs = updatedAttrs.replace(styleAttrMatch[0], `style="${inlineStyle}"`);
      }
      const replacementTag = `<${tagName}${updatedAttrs}${selfClose}>`;
      const startIdx = match.index + offsetDelta;
      patchedSource = patchedSource.slice(0, startIdx) + replacementTag + patchedSource.slice(startIdx + fullOpenTag.length);
      offsetDelta += replacementTag.length - fullOpenTag.length;
    }
  }

  return {
    changed: patches.length > 0,
    issueCount: patches.length,
    patches,
    patchedSource,
  };
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
  inspectAndPatchDesignSource,
};
