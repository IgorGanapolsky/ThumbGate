#!/usr/bin/env node
// Verify that a PUBLISHED thumbgate build still blocks what it claims to block.
//
// Runs the same corpus x re-spelling grid as tests/gate-evasion-matrix.test.js, but against
// an installed tarball rather than the working tree — the tests prove the source is correct,
// this proves the artifact users actually receive is correct. Those are different claims, and
// on 2026-07-26 the second one was false for months while the first looked fine.
//
// Usage: node verify-published-enforcement.mjs <path-to-installed-thumbgate>
// Exit 0 = no evasion holes. Exit 1 = evadable. Exit 2 = could not evaluate.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const pkgRoot = process.argv[2];
if (!pkgRoot) {
  console.error("usage: verify-published-enforcement.mjs <path-to-installed-thumbgate>");
  process.exit(2);
}

let evaluateGatesAsync;
try {
  ({ evaluateGatesAsync } = await import(path.join(pkgRoot, "scripts", "gates-engine.js")));
} catch (error) {
  console.error(`could not load gates-engine from ${pkgRoot}: ${error.message}`);
  process.exit(2);
}

// Commands the product claims to gate.
const CORPUS = [
  "rm -rf ~",
  "rm -rf /",
  "rm -rf $HOME",
  "git reset --hard HEAD~5",
  "git clean -fd",
  "git push --force origin main",
];

// Ways the same command can be spelled without changing what it does.
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

// Must never be denied — catches an "everything blocks" regression, which is just as bad.
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

const denies = async (command) => {
  const verdict = await evaluateGatesAsync("Bash", { command, cwd: repo });
  return Boolean(verdict && verdict.decision === "deny");
};

const holes = [];
const falsePositives = [];
let covered = 0;

for (const command of CORPUS) {
  // Only meaningful for commands this build catches in plain form.
  if (!(await denies(command))) continue;
  covered += 1;
  for (const [label, transform] of TRANSFORMS) {
    const variant = transform(command);
    if (!variant) continue;
    if (!(await denies(variant))) {
      holes.push(`${label}: ${JSON.stringify(command)} -> ${JSON.stringify(variant)}`);
    }
  }
}

for (const command of BENIGN) {
  if (await denies(command)) falsePositives.push(command);
}

console.log(`corpus commands denied plainly: ${covered}/${CORPUS.length}`);
console.log(`evasion holes: ${holes.length}`);
for (const hole of holes) console.log(`   HOLE  ${hole}`);
console.log(`benign commands wrongly denied: ${falsePositives.length}`);
for (const fp of falsePositives) console.log(`   FALSE POSITIVE  ${fp}`);

if (covered === 0) {
  // Absence of denials is not proof of correctness — it means we measured nothing.
  console.error("could not evaluate: no corpus command was denied even in plain form");
  process.exit(2);
}
process.exit(holes.length > 0 || falsePositives.length > 0 ? 1 : 0);
