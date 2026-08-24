#!/usr/bin/env node
'use strict';

/**
 * governance-conflict-audit.js — "which of our controls report success but
 * enforce nothing?"
 *
 * WHY THIS EXISTS
 * ---------------
 * Every detector in this file is a defect that was REAL in this repository.
 * Not a hypothetical, not a lint rule imported from a style guide: each one
 * shipped, looked green, and enforced nothing until somebody happened to read
 * the code. A gate whose match block never runs still appears in the gate list.
 * A CI job that has been red for eleven straight commits still appears in the
 * Actions tab. An exclusion that hides five hundred lines from the scanner
 * still leaves the scanner badge green.
 *
 * The framing — "a readiness assessment for identifying where your
 * organization's governance and operational security tracks are quietly in
 * conflict" — is taken from the published abstract of Noah M. Kenney's
 * (Digital 520) BrightTALK webinar "Harmonizing AI Governance and Cybersecurity
 * Operations". Only the abstract was available when this was written; no talk
 * content was seen, so no specific technique below is attributable to him. The
 * design choice to keep every check deterministic and model-free follows the
 * argument in Ralph Villanueva's (Carnival Corp) abstract "10 Common Sense
 * Solutions to App Sec Challenges — AI Not Required".
 *
 * THE DETECTORS
 * -------------
 * D1  Inert-or-overmatching gate shape.  A gate config declaring a `patterns`
 *     ARRAY while scripts/gates-engine.js reads `gate.pattern` (SINGULAR, see
 *     the `if (gate.pattern)` branch). The engine's match block is skipped
 *     entirely, so the gate stops narrowing and fires on EVERY tool listed in
 *     its `toolNames` — or on every tool call at all, when `toolNames` is also
 *     absent.
 *
 * D2  Regex that cannot compile.  A `pattern` containing an inline flag group
 *     such as `(?i)`. JavaScript has no inline flag syntax; `new RegExp(p)`
 *     throws, and gates-engine.js wraps the compile in `try { … } catch {
 *     return { matched: false } }`. The throw is swallowed as "did not match",
 *     so the gate is silently inert. Detected by attempting compilation, never
 *     by pattern-matching the pattern.
 *
 * D3  Silently-red non-required check.  A check required by NEITHER
 *     `branches/<branch>/protection.required_status_checks.contexts` NOR any
 *     repository ruleset (`rules/branches/<branch>`), which has failed on N or
 *     more consecutive recent commits. Both surfaces are read and UNIONED:
 *     reading only branch protection would report a ruleset-required check as
 *     blocking nothing, which is the same fabricated-verdict failure this file
 *     exists to catch. Real case: the `deploy` and `verify` jobs (workflows
 *     "Deploy to Railway" / "Verify Production Deploy") failed on 18
 *     consecutive main commits between 2026-08-19 and 2026-08-21 while `test`
 *     stayed green and nothing blocked a merge.
 *
 * D4  Analysis blindspots.  Entries in `sonar.exclusions` /
 *     `sonar.coverage.exclusions` that hide non-trivial code from scanning.
 *     Real case: commit 0943e9b9 added four Future AGI scripts to BOTH lists
 *     before the cause of the Sonar failure was known. An exclusion is only
 *     counted when it actually intersects `sonar.sources` — hiding
 *     `node_modules` hides nothing, and reporting it as a blindspot would be
 *     the same kind of noise this tool exists to remove.
 *
 * D5  Zero production call sites.  A module reached from the package entry
 *     that no production code path requires, or an entry-level export that no
 *     production code path ever calls.
 *     BOUNDED BY WHAT A LOCAL CORPUS CAN KNOW: when the repository publishes an
 *     npm package, its entry exports ARE the public API and their callers are
 *     downstream consumers no local search can see. Those are listed as NOT
 *     INSPECTED and the detector reports PARTIAL — calling them dead would be
 *     a fabricated verdict, and calling them clean would be the opposite lie.
 *     A finding is only emitted where "no caller" is actually provable: a
 *     private/unpublished package, or a module the entry pulls in without
 *     re-exporting anything from it.
 *
 * D6  Main-check broken under symlink.  The bare
 *     `path.resolve(process.argv[1]) === path.resolve(__filename)` form, which
 *     silently no-ops when the file is invoked through an npm bin shim (argv[1]
 *     is the symlink in node_modules/.bin, __filename is the real path).
 *     Severity is keyed on whether the file is an actual `package.json#bin`
 *     target — a script nobody ships as a bin is a latent problem, not a live
 *     one, and reporting it as high would be crying wolf.
 *
 * THE HONESTY RULES THIS FILE ENFORCES
 * ------------------------------------
 * 1. CLEAN and UNAVAILABLE are different facts and must LOOK different.
 *    `status: 'ran'` with zero findings means "inspected, nothing found".
 *    `status: 'unavailable'` means "could not inspect" and never counts as a
 *    pass. `status: 'partial'` means some of the surface was inspected and
 *    some was not, and names which. A detector that cannot run is reported,
 *    never skipped.
 * 2. Counts are measured, never estimated. Every finding carries the evidence
 *    that produced it — the thrown compiler message, the list of failing SHAs,
 *    the line count, the file that was searched.
 * 3. Severity comes from a documented rule (see SEVERITY_RULES), not from a
 *    feeling about how bad something looks.
 *
 * All functions here are read-only. Nothing in this module writes to disk, and
 * the only process it spawns is `gh api` for D3.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Bounded reads only. An unbounded fs.readFileSync on a JSONL or a generated
// artifact is itself a defect this repository has already had to fix.
const { readTextTail } = require('./fs-utils');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DETECTOR_STATUS = Object.freeze({
  RAN: 'ran',
  PARTIAL: 'partial',
  UNAVAILABLE: 'unavailable',
});

const SEVERITY = Object.freeze({
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
});

const SEVERITY_ORDER = Object.freeze([
  SEVERITY.CRITICAL,
  SEVERITY.HIGH,
  SEVERITY.MEDIUM,
  SEVERITY.LOW,
]);

/**
 * Every severity assignment in this file must trace back to one of these rules.
 * They are exported so a reader can audit the mapping instead of trusting it.
 */
const SEVERITY_RULES = Object.freeze({
  'D1.no-tool-names': 'critical — the gate has no toolNames either, so with the match block skipped it fires on every tool call',
  'D1.overmatching': 'high — the match block is skipped, so the gate fires on every tool in its toolNames',
  'D1.shadowed': 'medium — a `pattern` is also present and wins; the `patterns` array is dead config the engine never reads',
  'D2.uncompilable': 'high — new RegExp() throws and gates-engine.js swallows the throw as "no match", leaving the gate inert',
  'D3.still-failing': 'high — the failure streak reaches the newest scanned commit, so the check is red right now and blocks nothing',
  'D3.recovered': 'medium — the streak has since recovered, but it ran unnoticed for N+ commits because nothing required this check',
  'D4.hidden-from-both': 'high — the path is excluded from issue analysis AND coverage, so it is invisible to the scanner in both dimensions',
  'D4.hidden-from-one': 'medium — the path is excluded from one analysis dimension',
  'D5.module-unused': 'medium — the module is reachable from the package entry but no production file requires it',
  'D5.export-uncalled': 'medium — the entry re-exports the symbol but no production file references it',
  'D6.bin-target': 'high — the file is a package.json#bin target, so it is reached through an npm shim where this check silently no-ops',
  'D6.not-bin-target': 'low — the file is not currently a bin target, so the bug is latent rather than live',
});

const DEFAULT_CONSECUTIVE_FAILURE_THRESHOLD = 3;
const DEFAULT_EXCLUDED_LINE_THRESHOLD = 50;
const DEFAULT_COMMIT_LIMIT = 20;
const DEFAULT_BRANCH = 'main';

// Generous per-file ceiling. No source file in this repository is near it, but
// the read is still bounded and any truncation is surfaced rather than hidden.
const MAX_FILE_BYTES = 16 * 1024 * 1024;

/**
 * Keys a gate config might plausibly use to hold its matcher. Exactly one of
 * these is read by the engine; any other one that carries a value is config
 * that looks enforced and is not.
 */
const MATCHER_KEYS = Object.freeze(['pattern', 'patterns']);

/** Normalise a matcher value to a list of non-empty strings. */
function matcherValues(value) {
  if (typeof value === 'string') return value.length > 0 ? [value] : [];
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' && v.length > 0);
  return [];
}

const GATES_CONFIG_DIR = path.join('config', 'gates');
const SONAR_PROPERTIES = 'sonar-project.properties';

/** Roots treated as production code for D5/D6. Tests are deliberately absent. */
const DEFAULT_PRODUCTION_ROOTS = Object.freeze(['src', 'scripts', 'bin', 'adapters', 'hooks', 'commands']);

/** Directories never walked, at any depth. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', '.claude', '.thumbgate', 'dist', 'build']);

const JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

/**
 * The bare main-check form. Deliberately written to tolerate whitespace but NOT
 * to tolerate a realpathSync() on either side — a file that resolves the
 * symlink is doing the right thing and must not be reported.
 */
const BARE_MAIN_CHECK = /path\s*\.\s*resolve\(\s*process\s*\.\s*argv\[\s*1\s*\]\s*\)\s*===\s*path\s*\.\s*resolve\(\s*__filename\s*\)/;

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function toPosix(p) {
  return String(p).split(path.sep).join('/');
}

/**
 * Read a text file with a bounded tail. Returns status alongside content so a
 * caller can tell "not there" from "there and empty" from "there and too big
 * to read whole".
 */
function readBounded(absPath, maxBytes = MAX_FILE_BYTES) {
  try {
    const { text, truncated } = readTextTail(absPath, maxBytes);
    return { ok: true, text, truncated };
  } catch (err) {
    return {
      ok: false,
      text: '',
      truncated: false,
      error: String(err && err.message ? err.message : err),
      code: err && err.code,
    };
  }
}

/**
 * Blank out comments so a lexical search cannot be fooled by prose.
 *
 * Necessary, not cosmetic: this file's own header names the dead symbols it
 * detects while explaining detector D5, and without this pass the auditor
 * counted its own documentation as a production call site and reported a dead
 * module as live. A detector that a comment can silence is exactly the class of
 * defect it exists to find.
 *
 * Characters are replaced with spaces rather than deleted so offsets and line
 * counts stay aligned with the original text.
 */
function stripComments(source, options = {}) {
  const stripStrings = Boolean(options.stripStrings);
  const out = source.split('');
  const n = source.length;
  let i = 0;
  let lastSignificant = '';
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') { out[i] = ' '; i += 1; }
      continue;
    }
    if (c === '/' && next === '*') {
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] !== '\n') out[i] = ' ';
        i += 1;
      }
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const bodyStart = i + 1;
      i += 1;
      while (i < n) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === c) { break; }
        i += 1;
      }
      if (stripStrings) {
        for (let k = bodyStart; k < i && k < n; k += 1) {
          if (source[k] !== '\n') out[k] = ' ';
        }
      }
      i += 1; // step past the closing quote (or off the end of an unterminated string)
      lastSignificant = c;
      continue;
    }
    // A `/` in operand position starts a regex literal, whose body may contain
    // `//` (as in /https?:\/\//). Skipping it prevents a false comment start.
    if (c === '/' && (lastSignificant === '' || '=(,:[!&|?{};+*%<>~^'.includes(lastSignificant))) {
      i += 1;
      let inClass = false;
      while (i < n) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '[') inClass = true;
        else if (source[i] === ']') inClass = false;
        else if (source[i] === '/' && !inClass) { i += 1; break; }
        else if (source[i] === '\n') break;
        i += 1;
      }
      lastSignificant = '/';
      continue;
    }
    if (!/\s/.test(c)) lastSignificant = c;
    i += 1;
  }
  return out.join('');
}

/** Non-blank line count. Blank-line padding is not code and must not inflate a count. */
function countCodeLines(text) {
  let n = 0;
  for (const line of text.split('\n')) {
    if (line.trim()) n += 1;
  }
  return n;
}

/** Recursively list files under `absRoot`, skipping SKIP_DIRS. */
function walkFiles(absRoot, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(absRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue; // never follow; a cycle would hang the audit
    const full = path.join(absRoot, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Translate a Sonar/npm-style glob to an anchored RegExp.
 * `**` crosses directory boundaries; `*` and `?` do not.
 */
function globToRegExp(glob) {
  const g = toPosix(glob).trim();
  let out = '';
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        // `**/` may match zero segments; a bare `**` matches anything.
        if (g[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  // A trailing slash means "this directory and everything under it".
  if (g.endsWith('/')) out += '.*';
  return new RegExp(`^${out}$`);
}

function severityRank(sev) {
  const idx = SEVERITY_ORDER.indexOf(sev);
  return idx === -1 ? SEVERITY_ORDER.length : idx;
}

function makeFinding({ detector, severity, rule, location, appears, actually, evidence }) {
  return { detector, severity, rule, location, appears, actually, evidence };
}

function detectorResult(id, title, extra = {}) {
  return {
    id,
    title,
    status: DETECTOR_STATUS.RAN,
    reason: null,
    inspected: {},
    notInspected: [],
    findings: [],
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// D1 + D2 — gate config shape and regex compilability
// ---------------------------------------------------------------------------

/**
 * Both detectors read the same files, so they share one pass. They are still
 * reported as two detectors because they fail independently: a config
 * directory that parses fine can hold an uncompilable pattern, and vice versa.
 *
 * `patternKeyReadByEngine` is a parameter, not a constant, because the whole
 * point of D1 is that the config and the engine disagree about the key name.
 * Hardcoding 'pattern' here would make this detector believe its own
 * documentation instead of the engine.
 */
function auditGateConfigs({ repoRoot, gatesDir, patternKeyReadByEngine = 'pattern' }) {
  const d1 = detectorResult('D1', 'Inert-or-overmatching gate shape');
  const d2 = detectorResult('D2', 'Regex that cannot compile');

  const absDir = path.isAbsolute(gatesDir) ? gatesDir : path.join(repoRoot, gatesDir);
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch (err) {
    const reason = err && err.code === 'ENOENT'
      ? `${toPosix(gatesDir)} does not exist under ${repoRoot}`
      : `${toPosix(gatesDir)} could not be listed: ${err && err.message ? err.message : err}`;
    for (const d of [d1, d2]) {
      d.status = DETECTOR_STATUS.UNAVAILABLE;
      d.reason = reason;
    }
    return { d1, d2 };
  }

  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => e.name)
    .sort();

  const unreadable = [];
  let gatesChecked = 0;
  let patternsCompiled = 0;

  for (const name of files) {
    const abs = path.join(absDir, name);
    const rel = toPosix(path.join(gatesDir, name));
    const read = readBounded(abs);
    if (!read.ok) {
      unreadable.push(`${rel} (${read.error})`);
      continue;
    }
    if (read.truncated) {
      unreadable.push(`${rel} (larger than the ${MAX_FILE_BYTES}-byte read ceiling; only its tail was read, so it was not parsed)`);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(read.text);
    } catch (err) {
      unreadable.push(`${rel} (not valid JSON: ${err && err.message ? err.message : err})`);
      continue;
    }
    const gates = Array.isArray(parsed && parsed.gates) ? parsed.gates : [];
    gates.forEach((gate, index) => {
      if (!gate || typeof gate !== 'object') return;
      gatesChecked += 1;
      const gateId = typeof gate.id === 'string' && gate.id ? gate.id : `<no id>`;
      const location = `${rel} → gates[${index}] (${gateId})`;
      const toolNames = Array.isArray(gate.toolNames) ? gate.toolNames : [];

      // The matcher values the engine actually reads, and the ones it does not.
      // Both string and array shapes are accepted for the engine key, so the
      // detector still works if gates-engine.js ever switches to an array. Its
      // job is to compare config against engine, not to enforce one spelling.
      const engineValues = matcherValues(gate[patternKeyReadByEngine]);
      const ignoredKeys = MATCHER_KEYS
        .filter((k) => k !== patternKeyReadByEngine)
        .filter((k) => matcherValues(gate[k]).length > 0);

      // ---- D1 -----------------------------------------------------------
      if (ignoredKeys.length > 0) {
        const ignoredDetail = ignoredKeys.map((k) => `${k}=${JSON.stringify(gate[k])}`).join('; ');
        if (engineValues.length === 0) {
          const overmatches = toolNames.length > 0
            ? `every tool in toolNames (${toolNames.join(', ')})`
            : 'every tool call, because toolNames is empty too';
          d1.findings.push(makeFinding({
            detector: 'D1',
            severity: toolNames.length > 0 ? SEVERITY.HIGH : SEVERITY.CRITICAL,
            rule: toolNames.length > 0 ? 'D1.overmatching' : 'D1.no-tool-names',
            location,
            appears: `The gate declares ${ignoredDetail}, so it reads as narrowly scoped to those strings.`,
            actually: `scripts/gates-engine.js reads gate.${patternKeyReadByEngine}. With that key absent the whole match block is skipped, so the gate matches ${overmatches}.`,
            evidence: `declared but unread: ${ignoredKeys.join(', ')}; key read by engine: ${patternKeyReadByEngine}=absent; toolNames=${toolNames.length}`,
          }));
        } else {
          d1.findings.push(makeFinding({
            detector: 'D1',
            severity: SEVERITY.MEDIUM,
            rule: 'D1.shadowed',
            location,
            appears: `The gate declares BOTH ${patternKeyReadByEngine} and ${ignoredKeys.join('/')}, reading as if all of them are enforced.`,
            actually: `Only gate.${patternKeyReadByEngine} is read. The ${ignoredKeys.join('/')} entries are dead config that no code path consults.`,
            evidence: `${patternKeyReadByEngine}=${JSON.stringify(gate[patternKeyReadByEngine])}; ignored ${ignoredDetail}`,
          }));
        }
      }

      // ---- D2 -----------------------------------------------------------
      // Detected by attempting compilation, not by looking for `(?i)`. A
      // pattern-match for a known-bad token would miss every other way a regex
      // can fail to compile.
      for (const value of engineValues) {
        patternsCompiled += 1;
        try {
          // eslint-disable-next-line no-new
          new RegExp(value);
        } catch (err) {
          const message = String(err && err.message ? err.message : err);
          const inlineFlags = /\(\?[a-zA-Z]+\)/.exec(value);
          d2.findings.push(makeFinding({
            detector: 'D2',
            severity: SEVERITY.HIGH,
            rule: 'D2.uncompilable',
            location,
            appears: `The gate declares ${patternKeyReadByEngine}: ${JSON.stringify(value)}, so it reads as an active matcher.`,
            actually: 'new RegExp() throws on this pattern. gates-engine.js compiles it inside a try/catch whose catch returns { matched: false }, so the throw is swallowed and the gate never fires.',
            evidence: inlineFlags
              ? `new RegExp() threw: ${message} — inline flag group ${inlineFlags[0]} is not JavaScript regex syntax`
              : `new RegExp() threw: ${message}`,
          }));
        }
      }
    });
  }

  const inspected = {
    gatesDir: toPosix(gatesDir),
    configFiles: files.length,
    configFilesRead: files.length - unreadable.length,
    gatesChecked,
  };
  d1.inspected = { ...inspected, patternKeyReadByEngine };
  d2.inspected = { ...inspected, patternsCompiled };

  if (unreadable.length > 0) {
    for (const d of [d1, d2]) {
      d.status = DETECTOR_STATUS.PARTIAL;
      d.reason = `${unreadable.length} of ${files.length} config file(s) could not be parsed; the gates they define were NOT checked`;
      d.notInspected = unreadable.slice();
    }
  } else if (files.length === 0) {
    for (const d of [d1, d2]) {
      d.status = DETECTOR_STATUS.UNAVAILABLE;
      d.reason = `${toPosix(gatesDir)} exists but contains no .json gate configs`;
    }
  }

  return { d1, d2 };
}

// ---------------------------------------------------------------------------
// D3 — silently-red non-required check
// ---------------------------------------------------------------------------

/**
 * Fixed install locations for the `gh` CLI, in probe order.
 *
 * The binary is resolved to an ABSOLUTE path before it is executed rather than
 * being handed to the OS as the bare name `gh`. A bare name is resolved by
 * walking $PATH, and $PATH is attacker-writable in plenty of environments — a
 * directory prepended to it can substitute a different executable entirely
 * (SonarQube S4036 / CWE-426). An auditor whose own GitHub reader can be
 * swapped out from the environment would be one more control that reports
 * success while enforcing nothing.
 */
const GH_BINARY_CANDIDATES = Object.freeze([
  '/opt/homebrew/bin/gh',              // Homebrew, Apple silicon
  '/usr/local/bin/gh',                 // Homebrew, Intel macOS
  '/home/linuxbrew/.linuxbrew/bin/gh', // Homebrew, Linux
  '/usr/bin/gh',                       // apt / dnf, and the GitHub Actions runner images
  '/bin/gh',
  '/opt/local/bin/gh',                 // MacPorts
  '/snap/bin/gh',
]);

/** First candidate that exists and is executable, or null when none is. */
function resolveGhBinary(candidates = GH_BINARY_CANDIDATES) {
  for (const candidate of candidates) {
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch { /* not installed here; try the next fixed location */ }
  }
  return null;
}

/** Default GitHub reader. Injectable so tests never touch the network. */
function makeGhApiReader(ghBinary = resolveGhBinary()) {
  if (!ghBinary) {
    // A reader that cannot run must SAY it cannot run. Returning a stub that
    // quietly produced empty data would make D3 render as clean over a surface
    // it never read — the exact defect class this file exists to detect.
    const missing = new Error(`the \`gh\` CLI was not found in any fixed install location (${GH_BINARY_CANDIDATES.join(', ')})`);
    missing.code = 'ENOENT';
    return function ghApiUnavailable() { throw missing; };
  }
  return function ghApi(apiPath) {
    const raw = execFileSync(ghBinary, ['api', apiPath], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(raw);
  };
}

function ghErrorText(err) {
  if (!err) return 'unknown error';
  if (err.code === 'ENOENT') return `the \`gh\` CLI could not be executed: ${String(err.message || err).split('\n')[0]}`;
  const stderr = err.stderr ? String(err.stderr).trim().split('\n')[0] : '';
  const message = String(err.message || err).split('\n')[0];
  const text = stderr || message;
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

function auditSilentlyRedChecks({
  gitHubRepo,
  branch = DEFAULT_BRANCH,
  consecutiveFailureThreshold,
  commitLimit,
  ghApi,
}) {
  const d3 = detectorResult('D3', 'Silently-red non-required check');

  if (!gitHubRepo) {
    d3.status = DETECTOR_STATUS.UNAVAILABLE;
    d3.reason = 'no GitHub repo was supplied and none could be derived from the git remote, so required-check contexts could not be read';
    return d3;
  }
  if (typeof ghApi !== 'function') {
    d3.status = DETECTOR_STATUS.UNAVAILABLE;
    d3.reason = 'no GitHub API reader available';
    return d3;
  }

  // 1. Required contexts. Without these, "non-required" is unknowable and the
  //    detector must not guess — a check reported as non-required when it is
  //    actually required is a fabricated finding.
  //
  //    TWO INDEPENDENT SURFACES can make a check required, and reading only one
  //    of them is itself the defect class this file exists to find:
  //      a. classic branch protection   → branches/<branch>/protection
  //      b. repository RULESETS         → rules/branches/<branch>
  //    ThumbGate layers the "main governance" ruleset on top of classic
  //    protection. A check required only by the ruleset would, if only (a) were
  //    read, be reported as red-and-blocking-nothing while it was in fact
  //    blocking every merge. The two sets are UNIONED, and a ruleset read that
  //    fails downgrades the detector to PARTIAL instead of silently narrowing
  //    the definition of "required".
  let protectionContexts;
  try {
    const protection = ghApi(`repos/${gitHubRepo}/branches/${branch}/protection`);
    const contexts = protection
      && protection.required_status_checks
      && protection.required_status_checks.contexts;
    protectionContexts = Array.isArray(contexts) ? contexts : [];
  } catch (err) {
    d3.status = DETECTOR_STATUS.UNAVAILABLE;
    d3.reason = `could not read repos/${gitHubRepo}/branches/${branch}/protection: ${ghErrorText(err)}`;
    return d3;
  }

  const rulesetContexts = [];
  const rulesetIds = [];
  let rulesetReadError = null;
  try {
    const rules = ghApi(`repos/${gitHubRepo}/rules/branches/${encodeURIComponent(branch)}`);
    for (const rule of Array.isArray(rules) ? rules : []) {
      if (!rule || rule.type !== 'required_status_checks') continue;
      const id = rule.ruleset_id === undefined || rule.ruleset_id === null
        ? '<unnamed ruleset>'
        : String(rule.ruleset_id);
      if (!rulesetIds.includes(id)) rulesetIds.push(id);
      const checks = rule.parameters && rule.parameters.required_status_checks;
      for (const check of Array.isArray(checks) ? checks : []) {
        const context = check && typeof check.context === 'string' ? check.context : null;
        if (context && !rulesetContexts.includes(context)) rulesetContexts.push(context);
      }
    }
  } catch (err) {
    rulesetReadError = ghErrorText(err);
  }

  const requiredContexts = Array.from(new Set([...protectionContexts, ...rulesetContexts])).sort();

  // 2. Recent commits.
  let commits;
  try {
    const raw = ghApi(`repos/${gitHubRepo}/commits?sha=${encodeURIComponent(branch)}&per_page=${commitLimit}`);
    commits = Array.isArray(raw) ? raw : [];
  } catch (err) {
    d3.status = DETECTOR_STATUS.UNAVAILABLE;
    d3.reason = `could not list commits on ${branch}: ${ghErrorText(err)}`;
    return d3;
  }

  if (commits.length === 0) {
    d3.status = DETECTOR_STATUS.UNAVAILABLE;
    d3.reason = `no commits returned for ${gitHubRepo}@${branch}`;
    return d3;
  }

  // 3. Per-commit check-run conclusions. Check-RUN names share a namespace with
  //    required_status_checks.contexts, which is why this compares run names
  //    rather than workflow names — a workflow name would need a fuzzy mapping
  //    and fuzzy is how false findings get made.
  const commitRows = []; // newest first
  const failedCommits = [];
  for (const commit of commits) {
    const sha = commit && commit.sha;
    if (!sha) continue;
    let checkRuns;
    try {
      const raw = ghApi(`repos/${gitHubRepo}/commits/${sha}/check-runs?per_page=100`);
      checkRuns = Array.isArray(raw && raw.check_runs) ? raw.check_runs : [];
    } catch (err) {
      failedCommits.push(`${sha.slice(0, 8)} (${ghErrorText(err)})`);
      continue;
    }
    const byName = new Map();
    for (const run of checkRuns) {
      // The API returns newest first per name; keep the first seen.
      if (run && typeof run.name === 'string' && !byName.has(run.name)) {
        byName.set(run.name, run.conclusion === undefined ? null : run.conclusion);
      }
    }
    commitRows.push({
      sha,
      short: sha.slice(0, 8),
      date: (commit.commit && commit.commit.author && commit.commit.author.date) || null,
      conclusions: byName,
    });
  }

  if (commitRows.length === 0) {
    d3.status = DETECTOR_STATUS.UNAVAILABLE;
    d3.reason = `check runs could not be read for any of the ${commits.length} commit(s) scanned`;
    d3.notInspected = failedCommits;
    return d3;
  }

  const requiredSet = new Set(requiredContexts);
  const allNames = new Set();
  for (const row of commitRows) {
    for (const name of row.conclusions.keys()) allNames.add(name);
  }

  for (const name of Array.from(allNames).sort()) {
    if (requiredSet.has(name)) continue; // required checks block the merge; they are not silent

    // Longest run of consecutive 'failure', walking newest → oldest. A commit
    // where the check is absent, pending, skipped, or cancelled BREAKS the run
    // and is recorded — treating an absence as a failure would invent data.
    let best = null;
    let runStart = null;
    let runLen = 0;
    for (let i = 0; i < commitRows.length; i += 1) {
      const row = commitRows[i];
      const conclusion = row.conclusions.has(name) ? row.conclusions.get(name) : undefined;
      if (conclusion === 'failure') {
        if (runLen === 0) runStart = i;
        runLen += 1;
        if (best === null || runLen > best.length) {
          best = { start: runStart, length: runLen, end: i };
        }
      } else {
        runLen = 0;
      }
    }

    if (!best || best.length < consecutiveFailureThreshold) continue;

    const streakShas = commitRows.slice(best.start, best.end + 1).map((r) => r.short);
    const stillFailing = best.start === 0;
    const oldest = commitRows[best.end];
    const newest = commitRows[best.start];
    d3.findings.push(makeFinding({
      detector: 'D3',
      severity: stillFailing ? SEVERITY.HIGH : SEVERITY.MEDIUM,
      rule: stillFailing ? 'D3.still-failing' : 'D3.recovered',
      location: `${gitHubRepo}@${branch} → check run "${name}"`,
      appears: `"${name}" runs on every push to ${branch} and shows up in the checks list, so it reads as an enforced deploy/verification step.`,
      actually: stillFailing
        ? `It is required by NEITHER classic branch protection NOR any repository ruleset, and it has failed on the last ${best.length} scanned commit(s) up to and including the newest. Nothing was blocked by any of those failures.`
        : `It is required by NEITHER classic branch protection NOR any repository ruleset, and it failed on ${best.length} consecutive commit(s) without blocking anything. It has since recovered.`,
      evidence: `streak of ${best.length} consecutive 'failure' conclusion(s), ${newest.short}${newest.date ? ` (${newest.date})` : ''} back to ${oldest.short}${oldest.date ? ` (${oldest.date})` : ''}: ${streakShas.join(', ')}; required by branch protection = [${protectionContexts.join(', ')}]; required by ruleset(s) ${rulesetIds.length > 0 ? rulesetIds.join(', ') : '(none)'} = [${rulesetContexts.join(', ')}]`,
    }));
  }

  d3.inspected = {
    repo: gitHubRepo,
    branch,
    commitsScanned: commitRows.length,
    commitsRequested: commitLimit,
    checkNamesSeen: allNames.size,
    requiredContexts,
    requiredByBranchProtection: protectionContexts,
    requiredByRulesets: rulesetReadError ? '(NOT READ)' : rulesetContexts,
    rulesetsWithRequiredChecks: rulesetReadError ? '(NOT READ)' : rulesetIds,
    consecutiveFailureThreshold,
  };

  // Any surface that was not read has to downgrade the verdict. Both gaps are
  // reported together so neither hides behind the other.
  const coverageGaps = [];
  if (rulesetReadError) {
    coverageGaps.push(`ruleset-required contexts could NOT be read (repos/${gitHubRepo}/rules/branches/${branch}: ${rulesetReadError}), so "required" here means classic branch protection only and a check required by a ruleset alone would be misreported below as blocking nothing`);
  }
  if (failedCommits.length > 0) {
    coverageGaps.push(`${failedCommits.length} commit(s) could not be read; their check runs were NOT inspected and any streak crossing them is under-counted`);
  }
  if (coverageGaps.length > 0) {
    d3.status = DETECTOR_STATUS.PARTIAL;
    d3.reason = coverageGaps.join('; ');
    d3.notInspected = rulesetReadError
      ? [`repos/${gitHubRepo}/rules/branches/${branch} (${rulesetReadError})`, ...failedCommits]
      : failedCommits;
  }

  return d3;
}

// ---------------------------------------------------------------------------
// D4 — analysis blindspots
// ---------------------------------------------------------------------------

function parseProperties(text) {
  const props = new Map();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    props.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return props;
}

function splitList(value) {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function auditAnalysisBlindspots({ repoRoot, excludedLineThreshold, sonarFile = SONAR_PROPERTIES }) {
  const d4 = detectorResult('D4', 'Analysis blindspots (scanner exclusions)');

  const abs = path.join(repoRoot, sonarFile);
  const read = readBounded(abs);
  if (!read.ok) {
    d4.status = DETECTOR_STATUS.UNAVAILABLE;
    d4.reason = read.code === 'ENOENT'
      ? `${sonarFile} not found under ${repoRoot}`
      : `${sonarFile} could not be read: ${read.error}`;
    return d4;
  }

  const props = parseProperties(read.text);
  const sourceRoots = splitList(props.get('sonar.sources'));
  if (sourceRoots.length === 0) {
    d4.status = DETECTOR_STATUS.UNAVAILABLE;
    d4.reason = `${sonarFile} declares no sonar.sources, so there is no analyzed surface to measure an exclusion against`;
    return d4;
  }

  // Everything Sonar would actually analyze, with its line count. An exclusion
  // that touches nothing in here hides nothing, and is not a blindspot.
  const analyzed = [];
  const unreadable = [];
  for (const root of sourceRoots) {
    const absRoot = path.join(repoRoot, root);
    for (const file of walkFiles(absRoot)) {
      const rel = toPosix(path.relative(repoRoot, file));
      const fileRead = readBounded(file);
      if (!fileRead.ok) {
        unreadable.push(`${rel} (${fileRead.error})`);
        continue;
      }
      if (fileRead.truncated) {
        unreadable.push(`${rel} (exceeds the ${MAX_FILE_BYTES}-byte read ceiling; its line count would be a tail-only undercount)`);
        continue;
      }
      analyzed.push({ rel, lines: countCodeLines(fileRead.text) });
    }
  }

  const lists = [
    { key: 'sonar.exclusions', label: 'issue analysis' },
    { key: 'sonar.coverage.exclusions', label: 'coverage' },
  ];

  // First pass: what does each exclusion in each list actually hide?
  const perList = new Map();
  for (const { key } of lists) {
    const entries = splitList(props.get(key));
    const measured = entries.map((pattern) => {
      let re;
      try {
        re = globToRegExp(pattern);
      } catch {
        return { pattern, files: 0, lines: 0, uncompilable: true };
      }
      let files = 0;
      let lines = 0;
      for (const item of analyzed) {
        if (re.test(item.rel)) {
          files += 1;
          lines += item.lines;
        }
      }
      return { pattern, files, lines, uncompilable: false };
    });
    perList.set(key, measured);
  }

  const inBoth = new Set();
  const first = new Map((perList.get('sonar.exclusions') || []).map((m) => [m.pattern, m]));
  for (const m of perList.get('sonar.coverage.exclusions') || []) {
    if (first.has(m.pattern)) inBoth.add(m.pattern);
  }

  const reported = new Set();
  for (const { key, label } of lists) {
    for (const m of perList.get(key) || []) {
      if (m.lines <= excludedLineThreshold) continue;
      const both = inBoth.has(m.pattern);
      if (both && reported.has(m.pattern)) continue;
      if (both) reported.add(m.pattern);
      const where = both ? 'sonar.exclusions AND sonar.coverage.exclusions' : key;
      d4.findings.push(makeFinding({
        detector: 'D4',
        severity: both ? SEVERITY.HIGH : SEVERITY.MEDIUM,
        rule: both ? 'D4.hidden-from-both' : 'D4.hidden-from-one',
        location: `${sonarFile} → ${where} → "${m.pattern}"`,
        appears: 'A green SonarCloud badge reads as "the analyzed code is clean".',
        actually: both
          ? `This entry removes ${m.lines} line(s) across ${m.files} file(s) from BOTH issue analysis and coverage, so nothing in them can ever turn the badge red or lower the coverage number.`
          : `This entry removes ${m.lines} line(s) across ${m.files} file(s) from ${label}. The badge is green over a smaller surface than it appears to cover.`,
        evidence: `pattern "${m.pattern}" matches ${m.files} file(s) inside sonar.sources=[${sourceRoots.join(', ')}], totalling ${m.lines} non-blank line(s); threshold is ${excludedLineThreshold}`,
      }));
    }
  }

  d4.findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.location.localeCompare(b.location));

  d4.inspected = {
    sonarFile,
    sourceRoots,
    analyzedFiles: analyzed.length,
    analyzedLines: analyzed.reduce((sum, f) => sum + f.lines, 0),
    exclusionEntries: (perList.get('sonar.exclusions') || []).length,
    coverageExclusionEntries: (perList.get('sonar.coverage.exclusions') || []).length,
    excludedLineThreshold,
  };

  if (unreadable.length > 0) {
    d4.status = DETECTOR_STATUS.PARTIAL;
    d4.reason = `${unreadable.length} file(s) inside sonar.sources could not be counted; every line total below is an UNDER-count by an unknown amount`;
    d4.notInspected = unreadable;
  }

  return d4;
}

// ---------------------------------------------------------------------------
// D5 — zero production call sites
// ---------------------------------------------------------------------------

/** Collect `require('…')` specifiers and the identifiers bound from them. */
function parseEntryRequires(text) {
  const out = [];
  const re = /require\(\s*(['"])([^'"]+)\1\s*\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ specifier: m[2], index: m.index });
  }
  return out;
}

/**
 * Local identifiers bound from each `require('…')` declaration in the entry.
 *
 * Needed to answer "is this module part of the PUBLISHED surface?": a module
 * whose bindings reach `module.exports` is public API, and public API cannot be
 * proven dead from this repository alone — its callers are downstream npm
 * consumers that no local corpus contains.
 *
 * The destructuring pattern is matched with `[^}]*` (not a lazy `[\s\S]*?`) so
 * the scan stays linear on any input; a nested brace inside a require
 * destructuring is not valid CommonJS shorthand anyway.
 */
function parseEntryBindings(text) {
  const out = [];
  const re = /(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*require\(\s*(['"])([^'"]+)\2\s*\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const target = m[1];
    const names = [];
    if (target.startsWith('{')) {
      for (const chunk of target.slice(1, -1).split(',')) {
        const trimmed = chunk.trim();
        if (!trimmed) continue;
        const parts = trimmed.split(':');
        const local = (parts.length > 1 ? parts[1] : parts[0]).trim();
        if (/^[A-Za-z_$][\w$]*$/.test(local)) names.push(local);
      }
    } else if (/^[A-Za-z_$][\w$]*$/.test(target)) {
      names.push(target);
    }
    out.push({ specifier: m[3], names });
  }
  return out;
}

/**
 * The text of the entry's `module.exports = …` statement, or '' when absent.
 * Shared by parseEntryExportNames and the public-API check so both read exactly
 * the same span.
 */
function extractEntryExportStatement(text) {
  const start = text.indexOf('module.exports');
  if (start === -1) return '';

  // End of the assignment: the first `;` or newline reached at zero
  // paren/brace/bracket depth.
  let depth = 0;
  let end = text.length;
  const eq = text.indexOf('=', start);
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') depth -= 1;
    else if (depth === 0 && (c === ';' || c === '\n') && i > eq) { end = i; break; }
  }
  return text.slice(start, end);
}

/**
 * Names re-exported by the entry's `module.exports = …` statement.
 *
 * Deliberately reads EVERY object literal in the statement, not just the first.
 * `module.exports = Object.assign({}, base, { A, B })` puts an empty `{}` first;
 * a scanner that stopped at the first brace would report zero exports and then
 * silently pass D5b for a file it never actually looked at — the exact
 * failure mode this whole tool exists to catch.
 */
function parseEntryExportNames(text) {
  const statement = extractEntryExportStatement(text);
  if (!statement) return [];

  const names = [];
  const seen = new Set();
  for (let i = 0; i < statement.length; i += 1) {
    if (statement[i] !== '{') continue;
    let braceDepth = 0;
    let close = -1;
    for (let j = i; j < statement.length; j += 1) {
      if (statement[j] === '{') braceDepth += 1;
      else if (statement[j] === '}') {
        braceDepth -= 1;
        if (braceDepth === 0) { close = j; break; }
      }
    }
    if (close === -1) break;
    for (const chunk of statement.slice(i + 1, close).split(',')) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      const key = trimmed.split(':')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(key) && !seen.has(key)) {
        seen.add(key);
        names.push(key);
      }
    }
    i = close;
  }
  return names;
}

/**
 * @param {boolean} [publicApi]   true when this repository IS a published npm
 *                                package, i.e. the entry surface has consumers
 *                                that no local corpus can contain
 * @param {string|null} [packageName]
 */
function auditZeroCallSites({ repoRoot, entryFile, productionRoots, publicApi = false, packageName = null }) {
  const d5 = detectorResult('D5', 'Zero production call sites');

  const absEntry = path.join(repoRoot, entryFile);
  const entryRead = readBounded(absEntry);
  if (entryRead.ok) entryRead.text = stripComments(entryRead.text);
  if (!entryRead.ok) {
    d5.status = DETECTOR_STATUS.UNAVAILABLE;
    d5.reason = entryRead.code === 'ENOENT'
      ? `package entry ${toPosix(entryFile)} not found under ${repoRoot}`
      : `package entry ${toPosix(entryFile)} could not be read: ${entryRead.error}`;
    return d5;
  }

  const entryRel = toPosix(entryFile);
  const entryDir = path.dirname(absEntry);
  const exportStatement = extractEntryExportStatement(entryRead.text);

  // Symbols and modules that ARE the published package surface. For these the
  // corpus below can only prove "no INTERNAL caller", which is not the same
  // fact as "dead" — the callers are downstream npm consumers of the package,
  // and they are outside anything this process can read. Reporting them as
  // findings would be an invented verdict, so they are listed as NOT INSPECTED
  // instead, and the detector drops to PARTIAL to say so out loud.
  const publicApiNotAnalyzable = [];

  // Local modules the entry pulls in. Non-relative specifiers are third-party
  // and out of scope.
  const localModules = [];
  for (const { specifier } of parseEntryRequires(entryRead.text)) {
    if (!specifier.startsWith('.')) continue;
    const resolvedBase = path.resolve(entryDir, specifier);
    const candidates = [resolvedBase, `${resolvedBase}.js`, path.join(resolvedBase, 'index.js')];
    const hit = candidates.find((c) => {
      try { return fs.statSync(c).isFile(); } catch { return false; }
    });
    if (!hit) continue;
    const rel = toPosix(path.relative(repoRoot, hit));
    if (!localModules.some((m) => m.rel === rel)) {
      localModules.push({ rel, abs: hit, specifier });
    }
  }

  // Which local modules feed a symbol into `module.exports`? Those modules are
  // re-exported, so they are public API rather than internal wiring.
  const specifierToRel = new Map(localModules.map((mod) => [mod.specifier, mod.rel]));
  const publicApiModules = new Set();
  for (const binding of parseEntryBindings(entryRead.text)) {
    const rel = specifierToRel.get(binding.specifier);
    if (!rel) continue;
    const reaches = binding.names.some(
      (name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(exportStatement),
    );
    if (reaches) publicApiModules.add(rel);
  }

  // Production corpus: everything under productionRoots except the entry file.
  const corpus = [];
  const unreadable = [];
  const roots = [];
  for (const root of productionRoots) {
    const absRoot = path.join(repoRoot, root);
    let exists = false;
    try { exists = fs.statSync(absRoot).isDirectory(); } catch { exists = false; }
    if (!exists) continue;
    roots.push(root);
    for (const file of walkFiles(absRoot)) {
      if (!JS_EXTENSIONS.has(path.extname(file))) continue;
      const rel = toPosix(path.relative(repoRoot, file));
      if (rel === entryRel) continue;
      const read = readBounded(file);
      if (!read.ok) { unreadable.push(`${rel} (${read.error})`); continue; }
      if (read.truncated) { unreadable.push(`${rel} (exceeds the read ceiling; only its tail was searched)`); continue; }
      corpus.push({ rel, abs: file, text: stripComments(read.text) });
    }
  }

  if (roots.length === 0) {
    d5.status = DETECTOR_STATUS.UNAVAILABLE;
    d5.reason = `none of the production roots [${productionRoots.join(', ')}] exist under ${repoRoot}, so there is no corpus to search for call sites`;
    return d5;
  }

  // --- D5a: modules with no production requirer other than the entry --------
  for (const mod of localModules) {
    const modAbs = path.resolve(mod.abs);
    const requirers = [];
    for (const file of corpus) {
      for (const { specifier } of parseEntryRequires(file.text)) {
        if (!specifier.startsWith('.')) continue;
        const base = path.resolve(path.dirname(file.abs), specifier);
        const resolved = [base, `${base}.js`, path.join(base, 'index.js')].map((c) => path.resolve(c));
        if (resolved.includes(modAbs)) { requirers.push(file.rel); break; }
      }
    }
    if (requirers.length === 0) {
      if (publicApi && publicApiModules.has(mod.rel)) {
        publicApiNotAnalyzable.push(`${mod.rel} — re-exported by ${entryRel}, so its call sites are downstream consumers of the published package${packageName ? ` \`${packageName}\`` : ''}, which this corpus cannot contain`);
        continue;
      }
      d5.findings.push(makeFinding({
        detector: 'D5',
        severity: SEVERITY.MEDIUM,
        rule: 'D5.module-unused',
        location: mod.rel,
        appears: `${entryRel} requires it, so it reads as part of the shipped runtime.`,
        actually: `No file under [${roots.join(', ')}] requires it. Its only consumers are the package entry's re-export and whatever tests exist for it.`,
        evidence: `searched ${corpus.length} production file(s) under [${roots.join(', ')}] for a require() resolving to ${mod.rel}; 0 matched`,
      }));
    }
  }

  // --- D5b: entry exports nobody references --------------------------------
  // The file that DEFINES a symbol is not a user of it. Counting the definition
  // site as a call site is how `evaluateThreat` stayed invisible: it was
  // imported by the entry, re-exported, never called, and every naive search
  // found it in its own module and declared it live.
  const definitionSites = new Set(localModules.map((m) => m.rel));
  const callSiteCorpus = corpus.filter((f) => !definitionSites.has(f.rel));
  const exportNames = parseEntryExportNames(entryRead.text);
  for (const name of exportNames) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    const users = [];
    for (const file of callSiteCorpus) {
      if (re.test(file.text)) { users.push(file.rel); if (users.length > 2) break; }
    }
    if (users.length === 0) {
      if (publicApi) {
        publicApiNotAnalyzable.push(`${entryRel} → export "${name}" — a published entry export${packageName ? ` of \`${packageName}\`` : ''}, so its callers are downstream npm consumers this corpus cannot contain`);
        continue;
      }
      d5.findings.push(makeFinding({
        detector: 'D5',
        severity: SEVERITY.MEDIUM,
        rule: 'D5.export-uncalled',
        location: `${entryRel} → export "${name}"`,
        appears: `The package entry re-exports ${name}, so it reads as a live part of the public runtime surface.`,
        actually: `No file under [${roots.join(', ')}] mentions ${name} at all. It is imported and re-exported without ever being called.`,
        evidence: `searched ${corpus.length} production file(s) under [${roots.join(', ')}] for /\\b${name}\\b/; 0 matched`,
      }));
    }
  }

  d5.inspected = {
    entryFile: entryRel,
    productionRoots: roots,
    productionFilesSearched: corpus.length,
    entryLocalModules: localModules.length,
    entryExportNames: exportNames.length,
    publishedPackage: publicApi ? (packageName || 'yes') : 'no (private or unnamed)',
    publicApiNotAnalyzable: publicApiNotAnalyzable.length,
  };

  const gaps = [];
  if (publicApiNotAnalyzable.length > 0) {
    gaps.push(`${publicApiNotAnalyzable.length} entry-surface symbol(s)/module(s) have no INTERNAL call site, but this repository publishes${packageName ? ` \`${packageName}\`` : ' a package'} and downstream npm consumers are outside every corpus this process can read; they are reported neither dead NOR clean`);
  }
  if (unreadable.length > 0) {
    gaps.push(`${unreadable.length} production file(s) could not be searched; a call site inside them would have been missed, so a "zero call sites" finding here is weaker than it looks`);
  }
  if (gaps.length > 0) {
    d5.status = DETECTOR_STATUS.PARTIAL;
    d5.reason = gaps.join('; ');
    d5.notInspected = [...publicApiNotAnalyzable, ...unreadable];
  }

  return d5;
}

// ---------------------------------------------------------------------------
// D6 — main-check broken under symlink
// ---------------------------------------------------------------------------

function auditMainCheckUnderSymlink({ repoRoot, productionRoots, binTargets }) {
  const d6 = detectorResult('D6', 'Main-check broken under symlink');

  const binSet = new Set(binTargets.map((t) => toPosix(t)));
  const roots = [];
  const unreadable = [];
  let scanned = 0;

  for (const root of productionRoots) {
    const absRoot = path.join(repoRoot, root);
    let exists = false;
    try { exists = fs.statSync(absRoot).isDirectory(); } catch { exists = false; }
    if (!exists) continue;
    roots.push(root);
    for (const file of walkFiles(absRoot)) {
      const ext = path.extname(file);
      // Extension-less files are included because npm bin targets often have
      // none (bin/futureagi-bridge is one).
      if (ext && !JS_EXTENSIONS.has(ext)) continue;
      const rel = toPosix(path.relative(repoRoot, file));
      const read = readBounded(file);
      if (!read.ok) { unreadable.push(`${rel} (${read.error})`); continue; }
      if (read.truncated) { unreadable.push(`${rel} (exceeds the read ceiling; only its tail was searched)`); continue; }
      scanned += 1;
      // Comments AND string literals are blanked first. A commented-out main
      // check enforces nothing, and a main check quoted inside a help string is
      // documentation, not code — reporting either would be a fabricated
      // finding. This detector caught exactly that on bin/cli.js, whose only
      // occurrence of the bare form is inside this command's own --help text.
      const code = stripComments(read.text, { stripStrings: true });
      if (!BARE_MAIN_CHECK.test(code)) continue;
      // A file that also resolves the symlink is doing the right thing.
      if (/realpathSync/.test(code)) continue;
      const isBin = binSet.has(rel);
      d6.findings.push(makeFinding({
        detector: 'D6',
        severity: isBin ? SEVERITY.HIGH : SEVERITY.LOW,
        rule: isBin ? 'D6.bin-target' : 'D6.not-bin-target',
        location: rel,
        appears: 'The file guards its CLI entrypoint with a path-resolve main check, which reads as "run this only when executed directly".',
        actually: isBin
          ? 'This file IS a package.json#bin target. npm installs bins as symlinks in node_modules/.bin, so process.argv[1] is the symlink while __filename is the real path. The comparison is false and the CLI body never runs.'
          : 'The comparison is false whenever the file is reached through a symlink (an npm bin shim). This file is not currently a bin target, so the bug is latent, not live.',
        evidence: `matched /${BARE_MAIN_CHECK.source}/ with no realpathSync() in the file; package.json#bin target: ${isBin ? 'yes' : 'no'}`,
      }));
    }
  }

  if (roots.length === 0) {
    d6.status = DETECTOR_STATUS.UNAVAILABLE;
    d6.reason = `none of the production roots [${productionRoots.join(', ')}] exist under ${repoRoot}`;
    return d6;
  }

  d6.findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.location.localeCompare(b.location));

  d6.inspected = {
    productionRoots: roots,
    filesScanned: scanned,
    binTargets: Array.from(binSet).sort(),
    binTargetsAffected: d6.findings.filter((f) => f.rule === 'D6.bin-target').length,
    nonBinFilesAffected: d6.findings.filter((f) => f.rule === 'D6.not-bin-target').length,
  };

  if (unreadable.length > 0) {
    d6.status = DETECTOR_STATUS.PARTIAL;
    d6.reason = `${unreadable.length} file(s) could not be searched and were NOT checked for the bare main-check form`;
    d6.notInspected = unreadable;
  }

  return d6;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function readPackageJson(repoRoot) {
  const read = readBounded(path.join(repoRoot, 'package.json'));
  if (!read.ok || read.truncated) return null;
  try { return JSON.parse(read.text); } catch { return null; }
}

/** Derive `owner/name` from the origin remote without spawning git. */
function deriveGitHubRepo(repoRoot) {
  const candidates = [path.join(repoRoot, '.git', 'config')];
  // Worktrees store a `.git` FILE pointing at the real gitdir.
  const dotGit = path.join(repoRoot, '.git');
  try {
    const stat = fs.statSync(dotGit);
    if (stat.isFile()) {
      const pointer = readBounded(dotGit, 4096);
      const match = pointer.ok && /gitdir:\s*(.+)/.exec(pointer.text.trim());
      if (match) {
        const gitDir = path.resolve(repoRoot, match[1].trim());
        // .git/worktrees/<name>/  → the common dir is two levels up.
        candidates.push(path.join(gitDir, '..', '..', 'config'));
      }
    }
  } catch { /* no .git at all */ }

  for (const candidate of candidates) {
    const read = readBounded(candidate, 1024 * 1024);
    if (!read.ok) continue;
    // The repository name may contain dots (`acme/foo.bar`). Capture the whole
    // non-whitespace tail and strip ONLY a terminal `.git`, rather than
    // excluding dots from the name — a `[^\s.]+` capture silently truncates
    // `foo.bar.git` to `foo`, which then queries an unrelated repository and
    // reports D3 unavailable for a reason that is not the real one.
    const m = /url\s*=\s*(?:https:\/\/github\.com\/|git@github\.com:)([^\s/]+)\/(\S+)/.exec(read.text);
    if (!m) continue;
    const owner = m[1];
    const name = m[2].replace(/\/+$/, '').replace(/\.git$/i, '');
    if (owner && name && !name.includes('/')) return `${owner}/${name}`;
  }
  return null;
}

/**
 * Run every detector and return one report.
 *
 * @param {object} [opts]
 * @param {string} [opts.repoRoot]                     repository to audit
 * @param {string|null} [opts.gitHubRepo]              "owner/name"; derived from the git remote when omitted
 * @param {string} [opts.branch]                       protected branch to inspect for D3
 * @param {number} [opts.consecutiveFailureThreshold]  D3: consecutive failures that make a check a finding
 * @param {number} [opts.excludedLineThreshold]        D4: lines an exclusion must hide to be a finding
 * @param {number} [opts.commitLimit]                  D3: how many commits to scan
 * @param {string[]} [opts.productionRoots]            D5/D6: directories treated as production code
 * @param {Function|null} [opts.ghApi]                 injectable GitHub reader; null disables D3
 * @param {boolean} [opts.offline]                     skip D3 and report it UNAVAILABLE
 */
function auditGovernanceConflicts(opts = {}) {
  const repoRoot = path.resolve(opts.repoRoot || process.cwd());
  const consecutiveFailureThreshold = Number.isFinite(Number(opts.consecutiveFailureThreshold))
    && Number(opts.consecutiveFailureThreshold) >= 1
    ? Math.floor(Number(opts.consecutiveFailureThreshold))
    : DEFAULT_CONSECUTIVE_FAILURE_THRESHOLD;
  const excludedLineThreshold = Number.isFinite(Number(opts.excludedLineThreshold))
    && Number(opts.excludedLineThreshold) >= 0
    ? Math.floor(Number(opts.excludedLineThreshold))
    : DEFAULT_EXCLUDED_LINE_THRESHOLD;
  const commitLimit = Number.isFinite(Number(opts.commitLimit)) && Number(opts.commitLimit) >= 1
    ? Math.min(100, Math.floor(Number(opts.commitLimit)))
    : DEFAULT_COMMIT_LIMIT;
  // A bare `--branch` flag parses to boolean true in the CLI arg parser.
  // Interpolating that into an API path would produce a nonsense request and a
  // spurious UNAVAILABLE, so only a real string is accepted.
  const branch = typeof opts.branch === 'string' && opts.branch ? opts.branch : DEFAULT_BRANCH;
  const productionRoots = Array.isArray(opts.productionRoots) && opts.productionRoots.length > 0
    ? opts.productionRoots.slice()
    : DEFAULT_PRODUCTION_ROOTS.slice();

  const pkg = readPackageJson(repoRoot);
  const entryFile = opts.entryFile || (pkg && typeof pkg.main === 'string' ? pkg.main : 'src/index.js');
  const binTargets = pkg && pkg.bin && typeof pkg.bin === 'object'
    ? Object.values(pkg.bin).filter((v) => typeof v === 'string')
    : [];

  let gitHubRepo;
  if (opts.gitHubRepo === undefined) gitHubRepo = deriveGitHubRepo(repoRoot);
  else if (typeof opts.gitHubRepo === 'string' && opts.gitHubRepo) gitHubRepo = opts.gitHubRepo;
  else gitHubRepo = null; // explicit null, or a bare `--github-repo` flag

  const { d1, d2 } = auditGateConfigs({
    repoRoot,
    gatesDir: opts.gatesDir || GATES_CONFIG_DIR,
    patternKeyReadByEngine: opts.patternKeyReadByEngine || 'pattern',
  });

  let d3;
  if (opts.offline) {
    d3 = detectorResult('D3', 'Silently-red non-required check');
    d3.status = DETECTOR_STATUS.UNAVAILABLE;
    d3.reason = 'offline mode was requested, so branch protection and check runs were not read';
  } else {
    const ghApi = opts.ghApi === undefined ? makeGhApiReader() : opts.ghApi;
    d3 = auditSilentlyRedChecks({
      gitHubRepo, branch, consecutiveFailureThreshold, commitLimit, ghApi,
    });
  }

  const d4 = auditAnalysisBlindspots({
    repoRoot,
    excludedLineThreshold,
    sonarFile: opts.sonarFile || SONAR_PROPERTIES,
  });
  // A package with a name that is not marked private is published: its entry
  // exports have consumers outside this repository.
  const publicApi = Boolean(pkg && typeof pkg.name === 'string' && pkg.name && pkg.private !== true);
  const d5 = auditZeroCallSites({
    repoRoot,
    entryFile,
    productionRoots,
    publicApi,
    packageName: publicApi ? pkg.name : null,
  });
  const d6 = auditMainCheckUnderSymlink({ repoRoot, productionRoots, binTargets });

  const detectors = [d1, d2, d3, d4, d5, d6];
  const findings = [];
  for (const d of detectors) findings.push(...d.findings);
  findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity)
    || a.detector.localeCompare(b.detector)
    || a.location.localeCompare(b.location));

  const bySeverity = {};
  for (const sev of SEVERITY_ORDER) bySeverity[sev] = 0;
  for (const f of findings) bySeverity[f.severity] += 1;

  return {
    generatedAt: new Date().toISOString(),
    repoRoot,
    gitHubRepo,
    branch,
    thresholds: { consecutiveFailureThreshold, excludedLineThreshold, commitLimit },
    detectors: detectors.reduce((acc, d) => { acc[d.id] = d; return acc; }, {}),
    detectorOrder: detectors.map((d) => d.id),
    findings,
    counts: {
      findings: findings.length,
      bySeverity,
      detectorsRan: detectors.filter((d) => d.status === DETECTOR_STATUS.RAN).length,
      detectorsPartial: detectors.filter((d) => d.status === DETECTOR_STATUS.PARTIAL).length,
      detectorsUnavailable: detectors.filter((d) => d.status === DETECTOR_STATUS.UNAVAILABLE).length,
    },
    severityRules: SEVERITY_RULES,
  };
}

// ---------------------------------------------------------------------------
// Text rendering
// ---------------------------------------------------------------------------

const MAX_FINDINGS_RENDERED_PER_DETECTOR = 12;

function statusLabel(detector) {
  if (detector.status === DETECTOR_STATUS.UNAVAILABLE) return 'UNAVAILABLE — NOT CHECKED';
  if (detector.status === DETECTOR_STATUS.PARTIAL) return 'PARTIAL — some of the surface was NOT checked';
  return detector.findings.length === 0 ? 'RAN — CLEAN (checked, nothing found)' : `RAN — ${detector.findings.length} finding(s)`;
}

function describeInspected(detector) {
  const parts = [];
  for (const [key, value] of Object.entries(detector.inspected || {})) {
    if (Array.isArray(value)) parts.push(`${key}=[${value.join(', ')}]`);
    else parts.push(`${key}=${value}`);
  }
  return parts.join('  ');
}

function renderConflictAuditText(report) {
  const lines = [];
  lines.push('ThumbGate governance conflict audit — controls that report success but enforce nothing');
  lines.push(`  repo       : ${report.repoRoot}`);
  lines.push(`  github     : ${report.gitHubRepo || '(not determined)'} @ ${report.branch}`);
  lines.push(`  generated  : ${report.generatedAt}`);
  lines.push(`  thresholds : ${report.thresholds.consecutiveFailureThreshold} consecutive failures, ${report.thresholds.excludedLineThreshold} excluded lines, ${report.thresholds.commitLimit} commits scanned`);
  lines.push('');

  lines.push('Detectors');
  for (const id of report.detectorOrder) {
    const d = report.detectors[id];
    lines.push(`  ${d.id}  ${d.title}`);
    lines.push(`      ${statusLabel(d)}`);
    if (d.reason) lines.push(`      reason: ${d.reason}`);
    const inspected = describeInspected(d);
    if (inspected) lines.push(`      inspected: ${inspected}`);
    for (const item of (d.notInspected || []).slice(0, 5)) {
      lines.push(`      NOT inspected: ${item}`);
    }
    if ((d.notInspected || []).length > 5) {
      lines.push(`      NOT inspected: ... and ${d.notInspected.length - 5} more`);
    }
  }
  lines.push('');

  const unavailable = report.detectorOrder
    .map((id) => report.detectors[id])
    .filter((d) => d.status === DETECTOR_STATUS.UNAVAILABLE);
  const partial = report.detectorOrder
    .map((id) => report.detectors[id])
    .filter((d) => d.status === DETECTOR_STATUS.PARTIAL);

  if (unavailable.length > 0) {
    lines.push('!! COVERAGE GAP — the following detectors did NOT run.');
    lines.push('!! Their surfaces are NOT reported clean. Absence of findings below says nothing about them.');
    for (const d of unavailable) lines.push(`!!   ${d.id} ${d.title}: ${d.reason}`);
    lines.push('');
  }
  if (partial.length > 0) {
    lines.push('!  PARTIAL COVERAGE — the following detectors ran over an incomplete surface:');
    for (const d of partial) lines.push(`!    ${d.id} ${d.title}: ${d.reason}`);
    lines.push('');
  }

  lines.push('Findings');
  const sevSummary = SEVERITY_ORDER.map((s) => `${s} ${report.counts.bySeverity[s]}`).join('   ');
  lines.push(`  total ${report.counts.findings}   (${sevSummary})`);
  lines.push('');

  for (const id of report.detectorOrder) {
    const d = report.detectors[id];
    if (d.findings.length === 0) continue;
    lines.push(`  ${d.id} — ${d.title}`);
    for (const f of d.findings.slice(0, MAX_FINDINGS_RENDERED_PER_DETECTOR)) {
      lines.push(`    [${f.severity.toUpperCase()}] ${f.location}`);
      lines.push(`      appears to : ${f.appears}`);
      lines.push(`      actually   : ${f.actually}`);
      lines.push(`      evidence   : ${f.evidence}`);
      lines.push(`      severity by: ${SEVERITY_RULES[f.rule] || f.rule}`);
    }
    if (d.findings.length > MAX_FINDINGS_RENDERED_PER_DETECTOR) {
      lines.push(`    ... and ${d.findings.length - MAX_FINDINGS_RENDERED_PER_DETECTOR} more ${d.id} finding(s); use --json for all of them`);
    }
    lines.push('');
  }

  if (report.counts.findings === 0) {
    const scope = unavailable.length === 0 && partial.length === 0
      ? 'every detector ran over its full surface'
      : `${report.counts.detectorsRan} of ${report.detectorOrder.length} detector(s) ran over their full surface`;
    lines.push(`  No findings — ${scope}.`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  auditGovernanceConflicts,
  renderConflictAuditText,
  auditGateConfigs,
  auditSilentlyRedChecks,
  auditAnalysisBlindspots,
  auditZeroCallSites,
  auditMainCheckUnderSymlink,
  globToRegExp,
  parseProperties,
  parseEntryExportNames,
  parseEntryRequires,
  parseEntryBindings,
  extractEntryExportStatement,
  resolveGhBinary,
  makeGhApiReader,
  GH_BINARY_CANDIDATES,
  stripComments,
  countCodeLines,
  deriveGitHubRepo,
  DETECTOR_STATUS,
  SEVERITY,
  SEVERITY_RULES,
  BARE_MAIN_CHECK,
  DEFAULT_CONSECUTIVE_FAILURE_THRESHOLD,
  DEFAULT_EXCLUDED_LINE_THRESHOLD,
  DEFAULT_COMMIT_LIMIT,
  DEFAULT_PRODUCTION_ROOTS,
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function runCli(argv) {
  const args = argv.slice(2);
  const flag = (name) => {
    const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!hit) return undefined;
    if (hit === `--${name}`) return true;
    return hit.slice(`--${name}=`.length);
  };

  const asString = (v) => (typeof v === 'string' ? v : undefined);
  const report = auditGovernanceConflicts({
    repoRoot: asString(flag('repo-root')),
    gitHubRepo: asString(flag('github-repo')),
    branch: asString(flag('branch')),
    consecutiveFailureThreshold: asString(flag('consecutive-failures')),
    excludedLineThreshold: asString(flag('excluded-lines')),
    commitLimit: asString(flag('commits')),
    offline: flag('offline') !== undefined,
  });

  if (flag('json') !== undefined) console.log(JSON.stringify(report, null, 2));
  else process.stdout.write(`${renderConflictAuditText(report)}\n`);
}

// SonarCloud S3403 flags `require.main === module` as an always-false strict
// equality; the path-resolve form is the portable equivalent. realpathSync
// keeps it working when this file is reached through a symlink — which is
// exactly the defect D6 detects, so getting it wrong here would be its own
// punchline.
if (process.argv[1]) {
  let invoked = null;
  let self = null;
  try { invoked = fs.realpathSync(process.argv[1]); } catch { invoked = path.resolve(process.argv[1]); }
  try { self = fs.realpathSync(__filename); } catch { self = path.resolve(__filename); }
  if (invoked === self) runCli(process.argv);
}
