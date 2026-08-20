'use strict';

/**
 * Universal Claim Evaluator
 *
 * Parses free-text factual claims (e.g. "the row count is 1,284") and rechecks
 * them against configured verifiers (SQLite, filesystem, JSON). Fail-closed:
 *   - mismatch → verified=false
 *   - parseable claim with no matching verifier → verified=false (unconfigured)
 *   - no parseable factual claims → neutral (empty checks; session-action gates still apply)
 *
 * Verifier queries/paths come only from operator config — never from claim text —
 * so agents cannot inject SQL or path traversal through the claim string.
 */

const fs = require('node:fs');
const path = require('node:path');
const { resolveFeedbackDir } = require('./feedback-paths');

const DEFAULT_VERIFIERS_FILENAME = 'claim-verifiers.json';
// Package install root (node_modules/thumbgate), not the consumer project cwd.
const PACKAGE_ROOT = path.join(__dirname, '..');
const CLAIM_VALUE_MARKER = '{{value}}';
const NUMBER_PATTERN_SOURCE = String.raw`[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
const INTEGER_PATTERN_SOURCE = String.raw`[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)`;
const FILE_PATTERN_SOURCE = String.raw`([^\s,]+\.[A-Za-z0-9]+)`;

function parseNumberToken(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replaceAll(',', '').trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function normalizeSubject(value) {
  return String(value || '')
    .toLowerCase()
    .replaceAll(/[_./\\-]+/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return String(value).replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function configuredClaimTemplates(verifier) {
  const templates = [];
  if (typeof verifier?.claimTemplate === 'string') templates.push(verifier.claimTemplate);
  if (Array.isArray(verifier?.claimTemplates)) templates.push(...verifier.claimTemplates);
  return templates;
}

/**
 * Compile an operator-authored literal template containing exactly one numeric
 * {{value}} slot. Everything outside the slot is regex-escaped, so a template
 * cannot smuggle in executable regex or redirect the configured verifier.
 */
function compileConfiguredClaimTemplate(template) {
  if (typeof template !== 'string' || template.length === 0 || template.length > 500) {
    throw new Error('claim template must be a non-empty string of at most 500 characters');
  }
  const parts = template.split(CLAIM_VALUE_MARKER);
  if (parts.length !== 2) {
    throw new Error(`claim template must contain exactly one ${CLAIM_VALUE_MARKER} marker`);
  }
  if (parts.join('').replaceAll(/\s+/g, '').length < 3) {
    throw new Error('claim template needs at least three literal characters outside the value marker');
  }
  const literalPattern = parts
    .map((part) => escapeRegExp(part).replaceAll(/\s+/g, String.raw`\s+`))
    .join(`(?<value>${NUMBER_PATTERN_SOURCE})`);
  return new RegExp(
    String.raw`(?<![\p{L}\p{N}_])${literalPattern}(?![\p{L}\p{N}_])`,
    'giu',
  );
}

function validateConfiguredClaimTemplates(verifiers = []) {
  for (const verifier of verifiers) {
    const templates = configuredClaimTemplates(verifier);
    if (templates.length === 0) continue;
    const verifierId = typeof verifier?.id === 'string' ? verifier.id.trim() : '';
    if (!verifierId) {
      throw new Error('a verifier with claimTemplate or claimTemplates requires a unique id');
    }
    const matchingIds = verifiers.filter((candidate) => candidate?.id === verifierId);
    if (matchingIds.length !== 1) {
      throw new Error(`duplicate configured claim-template verifier id: ${verifierId}`);
    }
    for (const template of templates) compileConfiguredClaimTemplate(template);
  }
}

function parseConfiguredClaimTemplates(source, verifiers, push) {
  for (const verifier of verifiers) {
    for (const template of configuredClaimTemplates(verifier)) {
      const pattern = compileConfiguredClaimTemplate(template);
      for (const match of source.matchAll(pattern)) {
        const expected = parseNumberToken(match.groups?.value);
        if (expected == null) continue;
        push({
          kind: 'configured_value',
          subject: normalizeSubject(verifier.id),
          expected,
          raw: match[0],
          verifierId: verifier.id,
        });
      }
    }
  }
}

function resolveRepoRoot(cwd) {
  return path.resolve(cwd || process.cwd());
}

function pathExistsOrIsSymlink(targetPath) {
  try {
    fs.lstatSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function pathIsWithin(rootPath, candidatePath) {
  const rootWithSep = rootPath.endsWith(path.sep) ? rootPath : `${rootPath}${path.sep}`;
  return candidatePath === rootPath || candidatePath.startsWith(rootWithSep);
}

function resolveSafePath(repoRoot, targetPath) {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error('path is required');
  }
  if (path.isAbsolute(targetPath)) {
    throw new Error('absolute paths are not allowed in claim verifiers');
  }
  if (targetPath.includes('\0')) {
    throw new Error('invalid path');
  }
  const lexicalRoot = path.resolve(repoRoot);
  const resolved = path.resolve(lexicalRoot, targetPath);
  if (!pathIsWithin(lexicalRoot, resolved)) {
    throw new Error(`path escapes repo root: ${targetPath}`);
  }

  // A lexical prefix check is insufficient when an in-root symlink points
  // outside the root. Resolve the target when it exists, or its closest
  // existing ancestor for not-yet-created paths, and enforce the real root.
  const realRoot = fs.realpathSync(lexicalRoot);
  let existing = resolved;
  while (!pathExistsOrIsSymlink(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  let realExisting;
  try {
    realExisting = fs.realpathSync(existing);
  } catch {
    throw new Error(`path cannot be resolved safely: ${targetPath}`);
  }
  if (!pathIsWithin(realRoot, realExisting)) {
    throw new Error(`path resolves outside repo root through a symlink: ${targetPath}`);
  }
  return resolved;
}

function createClaimCollector() {
  const claims = [];
  const seen = new Set();
  const push = (claim) => {
    const key = `${claim.kind}|${claim.subject}|${claim.path || ''}|${String(claim.expected)}`;
    if (seen.has(key)) return;
    seen.add(key);
    claims.push(claim);
  };
  return { claims, push };
}

function collectPatternClaims(source, pattern, buildClaim, push) {
  for (const match of source.matchAll(pattern)) {
    const claim = buildClaim(match);
    if (claim) push(claim);
  }
}

function numericClaim(match, { kind, subjectIndex, valueIndex, subject }) {
  const expected = parseNumberToken(match[valueIndex]);
  if (expected == null) return null;
  return {
    kind,
    subject: subject || normalizeSubject(match[subjectIndex]),
    expected,
    raw: match[0],
  };
}

function collectCountClaims(source, push) {
  const directCount = new RegExp(
    String.raw`\b([A-Za-z][\w.-]*(?:\s+[A-Za-z][\w.-]*){0,7}\s+counts?)\s*(?:is|are|=|:|equals?)\s*(${NUMBER_PATTERN_SOURCE})\b`,
    'giu',
  );
  const thereAreCount = new RegExp(
    String.raw`\bthere\s+(?:is|are)\s+(${INTEGER_PATTERN_SOURCE})\s+(rows?|records?|entries|items?|orders?|users?|lessons?|lines?)\b`,
    'giu',
  );
  const sqlCount = new RegExp(
    String.raw`\bCOUNT\s*\(\s*\*\s*\)\s*(?:=|is|:)\s*(${INTEGER_PATTERN_SOURCE})\b`,
    'giu',
  );
  collectPatternClaims(source, directCount, (match) => numericClaim(match, {
    kind: 'count', subjectIndex: 1, valueIndex: 2,
  }), push);
  collectPatternClaims(source, thereAreCount, (match) => numericClaim(match, {
    kind: 'count', subjectIndex: 2, valueIndex: 1,
  }), push);
  collectPatternClaims(source, sqlCount, (match) => numericClaim(match, {
    kind: 'count', valueIndex: 1, subject: 'count',
  }), push);
}

function fileNumericClaim(match, kind, subject) {
  const claim = numericClaim(match, { kind, valueIndex: 2, subject });
  return claim ? { ...claim, path: match[1] } : null;
}

function collectFileClaims(source, push) {
  const fileLines = new RegExp(
    String.raw`\b(?:file\s+)?${FILE_PATTERN_SOURCE}\s+(?:has|contains)\s+(${INTEGER_PATTERN_SOURCE})\s+lines?\b`,
    'giu',
  );
  const fileBytes = new RegExp(
    String.raw`\b(?:file\s+)?${FILE_PATTERN_SOURCE}\s+(?:is|has)\s+(${INTEGER_PATTERN_SOURCE})\s+bytes?\b`,
    'giu',
  );
  const fileExists = new RegExp(
    String.raw`\b(?:file\s+)?${FILE_PATTERN_SOURCE}\s+(?:exists|is present|is on disk)\b`,
    'giu',
  );
  const fileMissing = new RegExp(
    String.raw`\b(?:file\s+)?${FILE_PATTERN_SOURCE}\s+(?:does not exist|is missing|is absent)\b`,
    'giu',
  );
  collectPatternClaims(source, fileLines, (match) => fileNumericClaim(match, 'file_lines', 'lines'), push);
  collectPatternClaims(source, fileBytes, (match) => fileNumericClaim(match, 'file_bytes', 'bytes'), push);
  collectPatternClaims(source, fileExists, (match) => ({
    kind: 'file_exists', subject: 'exists', path: match[1], expected: true, raw: match[0],
  }), push);
  collectPatternClaims(source, fileMissing, (match) => ({
    kind: 'file_exists', subject: 'exists', path: match[1], expected: false, raw: match[0],
  }), push);
}

function collectVersionClaims(source, push) {
  const versionPattern = new RegExp(
    String.raw`\b((?:package\s+)?version)\s*(?:is|=|:|equals?)\s*([vV]?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)\b`,
    'giu',
  );
  collectPatternClaims(source, versionPattern, (match) => {
    const rawVersion = String(match[2]);
    const expected = /^[vV]/.test(rawVersion) ? rawVersion.slice(1) : rawVersion;
    return {
      kind: 'value',
      subject: normalizeSubject(match[1]),
      expected,
      raw: match[0],
    };
  }, push);
}

function addConfiguredClaim(claim, claims, push) {
  const alreadyParsed = claims.find((existing) => (
    existing.raw.toLowerCase() === claim.raw.toLowerCase()
    && valuesEqual(existing.expected, claim.expected)
  ));
  if (!alreadyParsed) {
    push(claim);
    return;
  }
  if (alreadyParsed.verifierId && alreadyParsed.verifierId !== claim.verifierId) {
    throw new Error(
      `claim matched multiple configured verifiers: ${alreadyParsed.verifierId}, ${claim.verifierId}`,
    );
  }
  alreadyParsed.verifierId = claim.verifierId;
}

/**
 * Extract structured factual claims from free text.
 * @returns {Array<{kind:string, subject:string, expected:*, path?:string, raw:string}>}
 */
function parseFactualClaims(text, options = {}) {
  const source = String(text || '');
  if (!source.trim()) return [];

  let verifiers = [];
  if (Array.isArray(options)) verifiers = options;
  else if (Array.isArray(options.verifiers)) verifiers = options.verifiers;
  validateConfiguredClaimTemplates(verifiers);

  const { claims, push } = createClaimCollector();
  collectCountClaims(source, push);
  collectFileClaims(source, push);
  collectVersionClaims(source, push);
  parseConfiguredClaimTemplates(source, verifiers, (claim) => addConfiguredClaim(claim, claims, push));

  return claims;
}

function inlineVerifierConfig(options) {
  const candidates = [
    { verifiers: options.verifiers, source: 'options' },
    { verifiers: options.claimVerifiers, source: 'options.claimVerifiers' },
    { verifiers: options.config?.verifiers, source: 'options.config' },
    { verifiers: options.claimVerifiers?.verifiers, source: 'options.claimVerifiers' },
  ];
  return candidates.find((candidate) => Array.isArray(candidate.verifiers)) || null;
}

function verifierConfigPaths(options, repoRoot) {
  const candidates = [];
  const explicitConfigPath = options.configPath || process.env.THUMBGATE_CLAIM_VERIFIERS_PATH;
  if (explicitConfigPath) {
    const resolvedExplicit = path.isAbsolute(explicitConfigPath)
      ? explicitConfigPath
      : path.resolve(repoRoot, explicitConfigPath);
    if (!fs.existsSync(resolvedExplicit)) {
      throw new Error(`claim verifier config not found: ${resolvedExplicit}`);
    }
    candidates.push(resolvedExplicit);
  }
  const feedbackDir = options.feedbackDir || resolveFeedbackDir({ cwd: repoRoot });
  candidates.push(
    path.join(feedbackDir, DEFAULT_VERIFIERS_FILENAME),
    path.join(repoRoot, '.thumbgate', DEFAULT_VERIFIERS_FILENAME),
    path.join(repoRoot, 'config', 'gates', DEFAULT_VERIFIERS_FILENAME),
    // Shipped defaults from the installed package so npm consumers get dogfood
    // without copying config into every project cwd.
    path.join(PACKAGE_ROOT, 'config', 'gates', DEFAULT_VERIFIERS_FILENAME),
  );
  return new Set(candidates);
}

function readVerifierConfig(candidate) {
  try {
    const raw = JSON.parse(fs.readFileSync(candidate, 'utf8'));
    let verifiers = null;
    if (Array.isArray(raw?.verifiers)) verifiers = raw.verifiers;
    else if (Array.isArray(raw)) verifiers = raw;
    if (!verifiers) {
      throw new Error('expected an array or an object with a verifiers array');
    }
    return { verifiers, source: candidate, path: candidate };
  } catch (error) {
    throw new Error(`invalid claim verifier config ${candidate}: ${error.message}`);
  }
}

function loadVerifierConfig(options = {}) {
  const inline = inlineVerifierConfig(options);
  if (inline) return inline;

  const repoRoot = resolveRepoRoot(options.cwd);
  for (const candidate of verifierConfigPaths(options, repoRoot)) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    return readVerifierConfig(candidate);
  }
  return { verifiers: [], source: 'none' };
}

function subjectMatches(claimSubject, matcherSubjects = []) {
  const claim = normalizeSubject(claimSubject);
  if (!claim) return false;
  for (const subject of matcherSubjects) {
    const needle = normalizeSubject(subject);
    if (!needle) continue;
    if (claim === needle || claim.includes(needle) || needle.includes(claim)) return true;
  }
  return false;
}

function normalizeVerifierPath(value) {
  const normalized = path.posix.normalize(String(value || '').replaceAll('\\', '/'));
  return normalized.startsWith('./') ? normalized.slice(2).toLowerCase() : normalized.toLowerCase();
}

function pathMatches(claimPath, matcherPaths = []) {
  if (!claimPath) return matcherPaths.length === 0;
  const normalized = normalizeVerifierPath(claimPath);
  for (const candidate of matcherPaths) {
    const c = normalizeVerifierPath(candidate);
    if (!c) continue;
    if (normalized === c) return true;
  }
  return false;
}

function verifierSupportsClaim(verifier, claim) {
  const match = verifier.match || {};
  const kinds = Array.isArray(match.kinds) && match.kinds.length > 0
    ? match.kinds
    : [verifier.kind];
  if (kinds.includes(claim.kind)) return true;
  if (claim.kind === 'count') {
    return kinds.includes('sqlite_count') || verifier.kind === 'sqlite_count';
  }
  const compatibleVerifierKinds = {
    value: ['json_path', 'value'],
    file_lines: ['file_lines'],
    file_bytes: ['file_bytes'],
    file_exists: ['file_exists'],
  };
  return compatibleVerifierKinds[claim.kind]?.includes(verifier.kind) || false;
}

function verifierMatchesClaim(verifier, claim) {
  if (!verifier || typeof verifier !== 'object' || !verifierSupportsClaim(verifier, claim)) {
    return false;
  }
  const match = verifier.match || {};
  const subjects = match.subjects || verifier.subjects || [];
  const paths = match.paths || (verifier.path ? [verifier.path] : []);
  if (claim.path) {
    if (paths.length > 0 && !pathMatches(claim.path, paths)) return false;
    const countSubjectMismatch = claim.kind === 'count'
      && subjects.length > 0
      && claim.subject
      && !subjectMatches(claim.subject, subjects);
    return !countSubjectMismatch;
  }
  return subjects.length > 0 && subjectMatches(claim.subject, subjects);
}

function findVerifierForClaim(claim, verifiers) {
  if (claim.verifierId) {
    return verifiers.find((verifier) => verifier?.id === claim.verifierId) || null;
  }
  return verifiers.find((verifier) => verifierMatchesClaim(verifier, claim)) || null;
}

function assertSelectOnly(query) {
  const normalized = String(query || '').trim();
  if (!normalized) throw new Error('sqlite_count verifier requires query');
  // Strip trailing semicolon and require a single SELECT statement.
  let body = normalized;
  while (body.endsWith(';')) body = body.slice(0, -1).trimEnd();
  if (/;/.test(body)) throw new Error('sqlite_count query must be a single statement');
  if (!/^\s*select\b/i.test(body)) throw new Error('sqlite_count query must be SELECT-only');
  if (/\b(insert|update|delete|drop|alter|attach|pragma|create|replace|vacuum|reindex)\b/i.test(body)) {
    throw new Error('sqlite_count query rejects non-SELECT keywords');
  }
  return body;
}

function readSqliteCount(repoRoot, verifier) {
  const dbPath = resolveSafePath(repoRoot, verifier.dbPath || verifier.path);
  if (!fs.existsSync(dbPath)) {
    throw new Error(`sqlite database not found: ${verifier.dbPath || verifier.path}`);
  }
  const query = assertSelectOnly(verifier.query);
  let db = null;
  let isBuiltin = false;
  try {
    const BetterDatabase = require('better-sqlite3');
    db = new BetterDatabase(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    try {
      const sqlite = require('node:sqlite');
      db = new sqlite.DatabaseSync(dbPath, { readOnly: true, open: true });
      isBuiltin = true;
    } catch {
      throw new Error('SQLite driver not available (install better-sqlite3 or use Node 22.5+ node:sqlite)');
    }
  }
  try {
    const row = db.prepare(query).get();
    if (!row || typeof row !== 'object') {
      throw new Error('sqlite_count query returned no row');
    }
    const values = Object.values(row);
    const first = values[0];
    const numeric = typeof first === 'number' ? first : parseNumberToken(first);
    if (numeric == null) {
      throw new Error('sqlite_count query did not return a numeric value');
    }
    return numeric;
  } finally {
    db.close();
  }
}

function readFileLines(repoRoot, filePath) {
  const resolved = resolveSafePath(repoRoot, filePath);
  const content = fs.readFileSync(resolved, 'utf8');
  if (content.length === 0) return 0;
  // Count newline-terminated lines; trailing content without newline still counts as a line.
  const parts = content.split(/\r?\n/);
  return parts.length > 0 && parts.at(-1) === '' ? parts.length - 1 : parts.length;
}

function readFileBytes(repoRoot, filePath) {
  const resolved = resolveSafePath(repoRoot, filePath);
  return fs.statSync(resolved).size;
}

function readFileExists(repoRoot, filePath) {
  const resolved = resolveSafePath(repoRoot, filePath);
  return fs.existsSync(resolved);
}

function readJsonPath(repoRoot, verifier) {
  const resolved = resolveSafePath(repoRoot, verifier.path);
  const data = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const pointer = String(verifier.jsonPath || verifier.pointer || '').replace(/^\./, '');
  if (!pointer) {
    throw new Error('json_path verifier requires jsonPath');
  }
  const segments = pointer.split('.').filter(Boolean);
  let cursor = data;
  for (const segment of segments) {
    if (cursor == null
      || typeof cursor !== 'object'
      || !Object.hasOwn(cursor, segment)) {
      throw new Error(`json path not found: ${pointer}`);
    }
    cursor = cursor[segment];
  }
  return cursor;
}

function runVerifier(claim, verifier, repoRoot) {
  const kind = verifier.kind;
  if (kind === 'sqlite_count') {
    return readSqliteCount(repoRoot, verifier);
  }
  if (kind === 'file_lines') {
    return readFileLines(repoRoot, verifier.path);
  }
  if (kind === 'file_bytes') {
    return readFileBytes(repoRoot, verifier.path);
  }
  if (kind === 'file_exists') {
    return readFileExists(repoRoot, verifier.path);
  }
  if (kind === 'json_path' || kind === 'value') {
    return readJsonPath(repoRoot, verifier);
  }
  throw new Error(`unsupported verifier kind: ${kind}`);
}

function valuesEqual(expected, actual) {
  if (typeof expected === 'boolean') {
    return Boolean(actual) === expected;
  }
  if (typeof expected === 'number') {
    const actualNumber = typeof actual === 'number' ? actual : parseNumberToken(actual);
    return actualNumber != null && actualNumber === expected;
  }
  return String(actual) === String(expected);
}

function claimCheckBase(claim) {
  return {
    claim: claim.raw,
    kind: claim.kind,
    subject: claim.subject,
    expected: claim.expected,
  };
}

function unconfiguredClaimCheck(claim, failUnconfigured) {
  let message = `Parsed factual claim "${claim.raw}" with no verifier (advisory).`;
  if (failUnconfigured) {
    message = `Parsed factual claim "${claim.raw}" but no matching verifier is configured. Add one under .thumbgate/claim-verifiers.json (or config/gates/claim-verifiers.json).`;
  }
  return {
    ...claimCheckBase(claim),
    path: claim.path || null,
    passed: !failUnconfigured,
    status: 'unconfigured',
    missing: failUnconfigured ? ['claim_verifier_configured'] : [],
    message,
  };
}

function verifierClaimCheck(claim, verifier, repoRoot) {
  const verifierLabel = verifier.id || verifier.kind;
  try {
    const actual = runVerifier(claim, verifier, repoRoot);
    const passed = valuesEqual(claim.expected, actual);
    const status = passed ? 'match' : 'mismatch';
    const message = `Claim ${passed ? 'verified' : 'mismatch'} via ${verifierLabel}: expected ${String(claim.expected)}, observed ${String(actual)}`;
    return {
      ...claimCheckBase(claim),
      claimedPath: claim.path || null,
      path: verifier.path || null,
      actual,
      verifierId: verifier.id || null,
      verifierKind: verifier.kind,
      passed,
      status,
      missing: passed ? [] : ['claim_value_match'],
      message,
    };
  } catch (error) {
    return {
      ...claimCheckBase(claim),
      claimedPath: claim.path || null,
      path: verifier.path || null,
      verifierId: verifier.id || null,
      verifierKind: verifier.kind,
      passed: false,
      status: 'verifier_error',
      missing: ['claim_verifier_success'],
      message: `Verifier ${verifierLabel} failed: ${error?.message || 'unknown error'}`,
    };
  }
}

function evaluateClaim(claim, verifiers, repoRoot, failUnconfigured) {
  const verifier = findVerifierForClaim(claim, verifiers);
  return verifier
    ? verifierClaimCheck(claim, verifier, repoRoot)
    : unconfiguredClaimCheck(claim, failUnconfigured);
}

/**
 * Evaluate free-text claims against configured verifiers.
 *
 * @param {string} claimText
 * @param {object} [options]
 * @param {Array<object>} [options.verifiers]
 * @param {string} [options.cwd]
 * @param {string} [options.configPath]
 * @param {boolean} [options.failUnconfigured=true]
 * @returns {{
 *   verified: boolean,
 *   claims: object[],
 *   checks: object[],
 *   configSource: string,
 *   verifierCount: number,
 * }}
 */
function evaluateUniversalClaims(claimText, options = {}) {
  const repoRoot = resolveRepoRoot(options.cwd);
  const failUnconfigured = options.failUnconfigured !== false;
  const { verifiers, source: configSource } = loadVerifierConfig(options);
  validateConfiguredClaimTemplates(verifiers);
  const parsed = parseFactualClaims(claimText, { verifiers });
  if (parsed.length === 0) {
    return {
      verified: true,
      claims: [],
      checks: [],
      configSource,
      verifierCount: verifiers.length,
      parsedCount: 0,
    };
  }
  const checks = parsed.map((claim) => evaluateClaim(
    claim,
    verifiers,
    repoRoot,
    failUnconfigured,
  ));
  const claimResults = parsed.map((claim, index) => ({ ...claim, ...checks[index] }));

  return {
    verified: checks.every((check) => check.passed),
    claims: claimResults,
    checks,
    configSource,
    verifierCount: verifiers.length,
    parsedCount: parsed.length,
  };
}

function evaluateUniversalClaimsAsGateChecks(claimText, options = {}) {
  const result = evaluateUniversalClaims(claimText, options);
  return {
    ...result,
    checks: result.checks.map((check) => ({
      claim: `universal:${check.kind}`,
      passed: check.passed,
      missing: check.missing || [],
      message: check.message,
      universal: check,
    })),
  };
}

function parseCliArgs(argv = []) {
  const options = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--claim') options.claim = argv[++index];
    else if (arg.startsWith('--claim=')) options.claim = arg.slice('--claim='.length);
    else if (arg === '--config') options.configPath = argv[++index];
    else if (arg.startsWith('--config=')) options.configPath = arg.slice('--config='.length);
    else if (arg === '--cwd') options.cwd = argv[++index];
    else if (arg.startsWith('--cwd=')) options.cwd = arg.slice('--cwd='.length);
    else if (arg === '--advisory') options.failUnconfigured = false;
    else if (!arg.startsWith('--')) positional.push(arg);
  }
  if (!options.claim && positional.length > 0) options.claim = positional.join(' ');
  return options;
}

function formatCliSummary(report) {
  const lines = [
    report.verified ? 'ThumbGate claim verification: PASS' : 'ThumbGate claim verification: BLOCK',
    `Parsed claims: ${report.parsedCount}`,
    `Verifier config: ${report.configSource}`,
  ];
  for (const check of report.checks) {
    lines.push(`- ${check.status}: ${check.message}`);
  }
  return `${lines.join('\n')}\n`;
}

function runCli(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const options = parseCliArgs(argv);
  let claim = String(options.claim || '').trim();
  if (!claim && !process.stdin.isTTY) {
    try {
      claim = fs.readFileSync(0, 'utf8').trim();
    } catch {
      claim = '';
    }
  }
  if (!claim) {
    stderr.write('Usage: thumbgate verify-claims --claim "the row count is 1,284" [--config path] [--json]\n');
    return 2;
  }

  try {
    const report = evaluateUniversalClaims(claim, options);
    stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatCliSummary(report));
    return report.verified ? 0 : 1;
  } catch (error) {
    const failure = {
      verified: false,
      status: 'evaluator_error',
      message: error.message,
    };
    if (options.json) stdout.write(`${JSON.stringify(failure, null, 2)}\n`);
    else stderr.write(`ThumbGate claim verification failed closed: ${error.message}\n`);
    return 1;
  }
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  process.exitCode = runCli();
}

module.exports = {
  parseFactualClaims,
  parseNumberToken,
  loadVerifierConfig,
  findVerifierForClaim,
  evaluateUniversalClaims,
  evaluateUniversalClaimsAsGateChecks,
  parseCliArgs,
  formatCliSummary,
  runCli,
  assertSelectOnly,
  resolveSafePath,
  pathMatches,
  compileConfiguredClaimTemplate,
  validateConfiguredClaimTemplates,
  DEFAULT_VERIFIERS_FILENAME,
};
