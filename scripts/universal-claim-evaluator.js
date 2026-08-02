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

const fs = require('fs');
const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');

const DEFAULT_VERIFIERS_FILENAME = 'claim-verifiers.json';
// Package install root (node_modules/thumbgate), not the consumer project cwd.
const PACKAGE_ROOT = path.join(__dirname, '..');

function parseNumberToken(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/,/g, '').trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function normalizeSubject(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_./\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

/**
 * Extract structured factual claims from free text.
 * @returns {Array<{kind:string, subject:string, expected:*, path?:string, raw:string}>}
 */
function parseFactualClaims(text) {
  const source = String(text || '');
  if (!source.trim()) return [];

  const claims = [];
  const seen = new Set();

  const push = (claim) => {
    const key = `${claim.kind}|${claim.subject}|${claim.path || ''}|${String(claim.expected)}`;
    if (seen.has(key)) return;
    seen.add(key);
    claims.push(claim);
  };

  // "the row count is 1,284" / "row count = 1284" / "orders count: 42"
  const countPatterns = [
    /\b((?:the\s+)?(?:total\s+)?(?:[a-z][\w\s.-]{0,40}?)?\s*(?:row|rows|record|records|entry|entries|item|items|order|orders|user|users|lesson|lessons|line|lines)?\s+counts?\b)\s*(?:is|are|=|:|equals?)\s*([-+]?\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\b/gi,
    /\bthere\s+(?:is|are)\s+([-+]?\d{1,3}(?:,\d{3})*|\d+)\s+((?:rows?|records?|entries|items?|orders?|users?|lessons?|lines?))\b/gi,
    /\bCOUNT\s*\(\s*\*\s*\)\s*(?:=|is|:)\s*([-+]?\d{1,3}(?:,\d{3})*|\d+)\b/gi,
  ];

  for (const re of countPatterns) {
    re.lastIndex = 0;
    let match = re.exec(source);
    while (match) {
      if (re === countPatterns[1]) {
        // there are N rows
        const expected = parseNumberToken(match[1]);
        if (expected != null) {
          push({
            kind: 'count',
            subject: normalizeSubject(match[2]),
            expected,
            raw: match[0],
          });
        }
      } else if (re === countPatterns[2]) {
        const expected = parseNumberToken(match[1]);
        if (expected != null) {
          push({
            kind: 'count',
            subject: 'count',
            expected,
            raw: match[0],
          });
        }
      } else {
        const expected = parseNumberToken(match[2]);
        if (expected != null) {
          push({
            kind: 'count',
            subject: normalizeSubject(match[1]),
            expected,
            raw: match[0],
          });
        }
      }
      match = re.exec(source);
    }
  }

  // "file README.md has 120 lines" / "README.md is 1024 bytes"
  const fileLineRe = /\b(?:file\s+)?([^\s,]+\.[A-Za-z0-9]+)\s+(?:has|contains)\s+([-+]?\d{1,3}(?:,\d{3})*|\d+)\s+lines?\b/gi;
  let fileMatch = fileLineRe.exec(source);
  while (fileMatch) {
    const expected = parseNumberToken(fileMatch[2]);
    if (expected != null) {
      push({
        kind: 'file_lines',
        subject: 'lines',
        path: fileMatch[1],
        expected,
        raw: fileMatch[0],
      });
    }
    fileMatch = fileLineRe.exec(source);
  }

  const fileBytesRe = /\b(?:file\s+)?([^\s,]+\.[A-Za-z0-9]+)\s+(?:is|has)\s+([-+]?\d{1,3}(?:,\d{3})*|\d+)\s+bytes?\b/gi;
  fileMatch = fileBytesRe.exec(source);
  while (fileMatch) {
    const expected = parseNumberToken(fileMatch[2]);
    if (expected != null) {
      push({
        kind: 'file_bytes',
        subject: 'bytes',
        path: fileMatch[1],
        expected,
        raw: fileMatch[0],
      });
    }
    fileMatch = fileBytesRe.exec(source);
  }

  const fileExistsRe = /\b(?:file\s+)?([^\s,]+\.[A-Za-z0-9]+)\s+(?:exists|is present|is on disk)\b/gi;
  fileMatch = fileExistsRe.exec(source);
  while (fileMatch) {
    push({
      kind: 'file_exists',
      subject: 'exists',
      path: fileMatch[1],
      expected: true,
      raw: fileMatch[0],
    });
    fileMatch = fileExistsRe.exec(source);
  }

  const fileMissingRe = /\b(?:file\s+)?([^\s,]+\.[A-Za-z0-9]+)\s+(?:does not exist|is missing|is absent)\b/gi;
  fileMatch = fileMissingRe.exec(source);
  while (fileMatch) {
    push({
      kind: 'file_exists',
      subject: 'exists',
      path: fileMatch[1],
      expected: false,
      raw: fileMatch[0],
    });
    fileMatch = fileMissingRe.exec(source);
  }

  // "version is 1.31.0" / "package version equals 1.2.3"
  const versionRe = /\b((?:package\s+)?version)\s*(?:is|=|:|equals?)\s*([vV]?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)\b/gi;
  let versionMatch = versionRe.exec(source);
  while (versionMatch) {
    push({
      kind: 'value',
      subject: normalizeSubject(versionMatch[1]),
      expected: String(versionMatch[2]).replace(/^v/i, ''),
      raw: versionMatch[0],
    });
    versionMatch = versionRe.exec(source);
  }

  return claims;
}

function loadVerifierConfig(options = {}) {
  if (Array.isArray(options.verifiers)) {
    return { verifiers: options.verifiers, source: 'options' };
  }
  if (Array.isArray(options.claimVerifiers)) {
    return { verifiers: options.claimVerifiers, source: 'options.claimVerifiers' };
  }
  if (options.config && Array.isArray(options.config.verifiers)) {
    return { verifiers: options.config.verifiers, source: 'options.config' };
  }
  if (options.claimVerifiers && Array.isArray(options.claimVerifiers.verifiers)) {
    return { verifiers: options.claimVerifiers.verifiers, source: 'options.claimVerifiers' };
  }

  const repoRoot = resolveRepoRoot(options.cwd);
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
  candidates.push(path.join(feedbackDir, DEFAULT_VERIFIERS_FILENAME));

  // Project overrides first (consumer cwd), then the shipped package default.
  // Verifier path fields still resolve against repoRoot/cwd so package-owned
  // configs evaluate files inside the target project, not inside node_modules.
  candidates.push(path.join(repoRoot, '.thumbgate', DEFAULT_VERIFIERS_FILENAME));
  candidates.push(path.join(repoRoot, 'config', 'gates', DEFAULT_VERIFIERS_FILENAME));
  candidates.push(path.join(PACKAGE_ROOT, 'config', 'gates', DEFAULT_VERIFIERS_FILENAME));

  for (const candidate of [...new Set(candidates)]) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      const verifiers = Array.isArray(raw?.verifiers) ? raw.verifiers : Array.isArray(raw) ? raw : null;
      if (!verifiers) {
        throw new Error('expected an array or an object with a verifiers array');
      }
      return { verifiers, source: candidate, path: candidate };
    } catch (error) {
      throw new Error(`invalid claim verifier config ${candidate}: ${error.message}`);
    }
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
  const normalized = path.posix.normalize(String(value || '').replace(/\\/g, '/'));
  return normalized.replace(/^\.\//, '').toLowerCase();
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

function findVerifierForClaim(claim, verifiers) {
  for (const verifier of verifiers) {
    if (!verifier || typeof verifier !== 'object') continue;
    const match = verifier.match || {};
    const kinds = Array.isArray(match.kinds) && match.kinds.length > 0
      ? match.kinds
      : [verifier.kind];

    if (!kinds.includes(claim.kind) && !(claim.kind === 'count' && kinds.includes('sqlite_count'))) {
      // allow sqlite_count verifiers to serve generic count claims
      if (!(claim.kind === 'count' && verifier.kind === 'sqlite_count')) {
        if (!(claim.kind === 'value' && ['json_path', 'value'].includes(verifier.kind))) {
          if (!(claim.kind === 'file_lines' && verifier.kind === 'file_lines')) {
            if (!(claim.kind === 'file_bytes' && verifier.kind === 'file_bytes')) {
              if (!(claim.kind === 'file_exists' && verifier.kind === 'file_exists')) {
                continue;
              }
            }
          }
        }
      }
    }

    const subjects = match.subjects || verifier.subjects || [];
    const paths = match.paths || (verifier.path ? [verifier.path] : []);

    if (claim.path) {
      if (paths.length > 0 && !pathMatches(claim.path, paths)) continue;
      // path claim without subject constraint is ok when path matches
      if (subjects.length > 0 && claim.subject && !subjectMatches(claim.subject, subjects) && claim.kind === 'count') {
        continue;
      }
      return verifier;
    }

    if (subjects.length === 0) {
      // bare verifier without subject matchers only binds file-path claims above
      continue;
    }
    if (subjectMatches(claim.subject, subjects)) return verifier;
  }
  return null;
}

function assertSelectOnly(query) {
  const normalized = String(query || '').trim();
  if (!normalized) throw new Error('sqlite_count verifier requires query');
  // Strip trailing semicolon and require a single SELECT statement.
  const body = normalized.replace(/;+\s*$/, '');
  if (/;/.test(body)) throw new Error('sqlite_count query must be a single statement');
  if (!/^\s*select\b/i.test(body)) throw new Error('sqlite_count query must be SELECT-only');
  if (/\b(insert|update|delete|drop|alter|attach|pragma|create|replace|vacuum|reindex)\b/i.test(body)) {
    throw new Error('sqlite_count query rejects non-SELECT keywords');
  }
  return body;
}

function readSqliteCount(repoRoot, verifier) {
  const Database = require('better-sqlite3');
  const dbPath = resolveSafePath(repoRoot, verifier.dbPath || verifier.path);
  if (!fs.existsSync(dbPath)) {
    throw new Error(`sqlite database not found: ${verifier.dbPath || verifier.path}`);
  }
  const query = assertSelectOnly(verifier.query);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
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
  return parts.length > 0 && parts[parts.length - 1] === '' ? parts.length - 1 : parts.length;
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
      || !Object.prototype.hasOwnProperty.call(cursor, segment)) {
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
  const parsed = parseFactualClaims(claimText);
  if (parsed.length === 0) {
    return {
      verified: true,
      claims: [],
      checks: [],
      configSource: 'not_loaded',
      verifierCount: 0,
      parsedCount: 0,
    };
  }

  const { verifiers, source: configSource } = loadVerifierConfig(options);
  const checks = [];
  const claimResults = [];

  for (const claim of parsed) {
    const verifier = findVerifierForClaim(claim, verifiers);
    if (!verifier) {
      const check = {
        claim: claim.raw,
        kind: claim.kind,
        subject: claim.subject,
        path: claim.path || null,
        expected: claim.expected,
        passed: !failUnconfigured,
        status: 'unconfigured',
        missing: failUnconfigured ? ['claim_verifier_configured'] : [],
        message: failUnconfigured
          ? `Parsed factual claim "${claim.raw}" but no matching verifier is configured. Add one under .thumbgate/claim-verifiers.json (or config/gates/claim-verifiers.json).`
          : `Parsed factual claim "${claim.raw}" with no verifier (advisory).`,
      };
      checks.push(check);
      claimResults.push({ ...claim, ...check });
      continue;
    }

    try {
      const actual = runVerifier(claim, verifier, repoRoot);
      const passed = valuesEqual(claim.expected, actual);
      const check = {
        claim: claim.raw,
        kind: claim.kind,
        subject: claim.subject,
        claimedPath: claim.path || null,
        path: verifier.path || null,
        expected: claim.expected,
        actual,
        verifierId: verifier.id || null,
        verifierKind: verifier.kind,
        passed,
        status: passed ? 'match' : 'mismatch',
        missing: passed ? [] : ['claim_value_match'],
        message: passed
          ? `Claim verified via ${verifier.id || verifier.kind}: expected ${String(claim.expected)}, observed ${String(actual)}`
          : `Claim mismatch via ${verifier.id || verifier.kind}: expected ${String(claim.expected)}, observed ${String(actual)}`,
      };
      checks.push(check);
      claimResults.push({ ...claim, ...check });
    } catch (error) {
      const check = {
        claim: claim.raw,
        kind: claim.kind,
        subject: claim.subject,
        claimedPath: claim.path || null,
        path: verifier.path || null,
        expected: claim.expected,
        verifierId: verifier.id || null,
        verifierKind: verifier.kind,
        passed: false,
        status: 'verifier_error',
        missing: ['claim_verifier_success'],
        message: `Verifier ${verifier.id || verifier.kind} failed: ${error && error.message ? error.message : 'unknown error'}`,
      };
      checks.push(check);
      claimResults.push({ ...claim, ...check });
    }
  }

  return {
    verified: checks.length === 0 ? true : checks.every((check) => check.passed),
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
  DEFAULT_VERIFIERS_FILENAME,
};
