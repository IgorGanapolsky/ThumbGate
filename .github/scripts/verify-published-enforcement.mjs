#!/usr/bin/env node
// Verify that a PUBLISHED thumbgate build still blocks what it claims to block.
//
// Runs the same corpus x re-spelling grid as tests/gate-evasion-matrix.test.js, but against
// an installed tarball rather than the working tree — the tests prove the source is correct,
// this proves the artifact users actually receive is correct. Those are different claims, and
// the second was the one that went unverified.
//
// IMPORTANT: this drives the PUBLIC HOOK CONTRACT (`bin/cli.js gate-check` over stdin/stdout),
// not a direct module import. Review caught that importing scripts/gates-engine.js could
// return `deny` while the shipped `bin` entry, shim wiring, input adaptation, enforcement
// posture or output formatting were broken — leaving this green while paired agents fail
// open. The whole point is to exercise what an agent actually invokes.
//
// Usage: node verify-published-enforcement.mjs <path-to-installed-thumbgate>
// Exit 0 = no evasion holes. Exit 1 = evadable. Exit 2 = INCONCLUSIVE (could not evaluate).

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const pkgRoot = process.argv[2];
if (!pkgRoot) {
  console.error("usage: verify-published-enforcement.mjs <path-to-installed-thumbgate>");
  process.exit(2);
}

const cli = path.join(pkgRoot, "bin", "cli.js");
if (!existsSync(cli)) {
  console.error(`INCONCLUSIVE: published package has no bin/cli.js at ${cli}`);
  process.exit(2);
}

// Corpus shared with tests/gate-evasion-matrix.test.js. A packaging regression in ANY
// enforcement class must be able to fail this check, so the rows must not drift apart.
const CORPUS = [
  "rm -rf ~",
  "rm -rf /",
  "rm -rf $HOME",
  "git reset --hard HEAD~5",
  "git clean -fd",
  "git push --force origin main",
  "git add .",
  "git commit -m x",
  "git tag v9.9.9",
  "git push origin main",
  "npm publish",
  "gh release create v9.9.9",
  "gh pr create --title x",
  "gh pr merge 1",
];

const TRANSFORMS = [
  ["sudo", (c) => `sudo ${c}`],
  ["env assignment prefix", (c) => `env FOO=1 ${c}`],
  ["chained with &&", (c) => `echo hi && ${c}`],
  ["chained with ;", (c) => `echo hi; ${c}`],
  ["on a new line", (c) => `echo hi\n${c}`],
  ["absolute binary path", (c) => c.replace(/^(\w+)/, "/usr/bin/$1")],
  ["quoted binary", (c) => c.replace(/^(\w+)/, '"$1"')],
  ["backslash-escaped", (c) => `\\${c}`],
  ["git global option", (c) => (c.startsWith("git ") ? c.replace(/^git /, "git -C . ") : null)],
];

const BENIGN = [
  "ls -la",
  "git status",
  "rm -rf node_modules",
  'echo "rm -rf ~ is dangerous"',
];

const repo = mkdtempSync(path.join(tmpdir(), "tg-verify-"));
const git = (args) => execFileSync("git", args, { cwd: repo, stdio: ["ignore", "ignore", "ignore"] });
git(["init"]);
git(["config", "user.email", "verify@example.com"]);
git(["config", "user.name", "verify"]);
writeFileSync(path.join(repo, "seed.txt"), "seed\n");
git(["add", "seed.txt"]);
git(["commit", "-m", "init"]);
mkdirSync(path.join(repo, "src"), { recursive: true });
writeFileSync(path.join(repo, "src", "app.js"), "code\n");
writeFileSync(path.join(repo, "staged.txt"), "staged\n");
git(["add", "staged.txt"]);

let inconclusive = 0;

// Drive the same JSON contract a PreToolUse hook uses.
function decide(command) {
  const result = spawnSync(process.execPath, [cli, "gate-check"], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command, cwd: repo } }),
    encoding: "utf8",
    cwd: repo,
    timeout: 60_000,
    env: { ...process.env, THUMBGATE_STRICT_ENFORCEMENT: "1" },
  });
  if (result.error || result.status === null) {
    inconclusive += 1;
    return null;
  }
  // stdout may carry advisory banners around the JSON. Parse LINE-WISE from the end:
  // the decision reason embeds regex source containing braces, so scanning for the last "{"
  // lands inside a string and fails to parse.
  const lines = String(result.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith("{")) continue;
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed && typeof parsed === "object" && "hookSpecificOutput" in parsed) {
        return parsed.hookSpecificOutput?.permissionDecision ?? "allow";
      }
      // A well-formed hook response with no decision is an explicit allow.
      if (parsed && typeof parsed === "object") return "allow";
    } catch {
      // keep scanning earlier lines
    }
  }
  // No parseable hook response at all: we did not learn anything.
  inconclusive += 1;
  return null;
}

const denies = (command) => decide(command) === "deny";

const holes = [];
const falsePositives = [];
let covered = 0;

for (const command of CORPUS) {
  if (!denies(command)) continue;   // only meaningful where this build catches the plain form
  covered += 1;
  for (const [label, transform] of TRANSFORMS) {
    const variant = transform(command);
    if (!variant) continue;
    if (!denies(variant)) {
      holes.push(`${label}: ${JSON.stringify(command)} -> ${JSON.stringify(variant)}`);
    }
  }
}

for (const command of BENIGN) {
  if (denies(command)) falsePositives.push(command);
}

console.log(`contract: ${cli} gate-check (public hook interface)`);
console.log(`corpus commands denied plainly: ${covered}/${CORPUS.length}`);
console.log(`evasion holes: ${holes.length}`);
for (const hole of holes) console.log(`   HOLE  ${hole}`);
console.log(`benign commands wrongly denied: ${falsePositives.length}`);
for (const fp of falsePositives) console.log(`   FALSE POSITIVE  ${fp}`);

// An unusable artifact is INCONCLUSIVE, not "evadable". Conflating the two would open a
// misleading incident telling operators to roll back a version that may be fine — the same
// absence-is-not-evidence mistake this whole check exists to catch.
if (inconclusive > 0) {
  console.error(`INCONCLUSIVE: ${inconclusive} gate-check invocation(s) failed to produce a verdict`);
  process.exit(2);
}
if (covered === 0) {
  console.error("INCONCLUSIVE: no corpus command was denied even in plain form — nothing was measured");
  process.exit(2);
}
process.exit(holes.length > 0 || falsePositives.length > 0 ? 1 : 0);
