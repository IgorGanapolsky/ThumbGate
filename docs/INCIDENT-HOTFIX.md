# Incident & hotfix runbook

What to do when ThumbGate is blocking work it shouldn't, or has stopped blocking work it should.

Companion to [RELEASE-ROLLBACK.md](./RELEASE-ROLLBACK.md), which covers undoing a bad release.
This document covers the minutes **before** you get to that.

## Why this needs its own runbook

ThumbGate sits in the PreToolUse path of every agent on every paired machine. Its two failure
modes are the mirror of each other and neither raises an error:

- **Over-blocking** — agents stall on legitimate work. Loud, annoying, immediately obvious.
- **Under-blocking** — a gate silently stops firing. Invisible. On 2026-07-26 an audit found
  62 evasion holes in shipped code and nothing anywhere had reported a problem.

Assume you will learn about either from behaviour, not from an alert.

## Triage in one minute

```sh
# 1. Is the hook shim even present? If this file is missing, enforcement is DEAD —
#    every hook invocation fails open and nothing is gated. This has happened.
ls -l ~/.thumbgate/bin/thumbgate-hook

# 2. What does the gate actually say about a known-dangerous command?
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf ~"}}' \
  | THUMBGATE_STRICT_ENFORCEMENT=1 ~/.thumbgate/bin/thumbgate-hook gate-check

# 3. Which version is this machine actually running?
node -e "console.log(require(process.env.HOME+'/.thumbgate/runtime/node_modules/thumbgate/package.json').version)"

# 4. Has the decision distribution shifted since the last baseline?
npm run canary:check
```

Step 2 should print `"permissionDecision":"deny"`. If it prints an allow, or step 1 shows no
shim, **enforcement is down on this machine** — go to "Enforcement is dead" below.

## Scenario: a gate is blocking legitimate work

`THUMBGATE_HOTFIX_BYPASS=1` is the fastest lever. Scope it as tightly as the incident allows:

```sh
# One command
THUMBGATE_HOTFIX_BYPASS=1 <your command>

# One shell session
export THUMBGATE_HOTFIX_BYPASS=1
```

**This is a scoped bypass, not a kill switch.** `runHardFloor()` still runs first
(`bin/cli.js`), so secret exfiltration, the security scanner's deny results, and the four
self-protection gates are still enforced. It skips advisory and strict-mode gates only. That
is deliberate: the escape hatch must not be a way to turn off the parts that matter most.

Prefer narrower fixes when you have the minutes:

```sh
thumbgate rules            # inspect what fired
thumbgate doctor           # config and install health
```

Do not leave the bypass exported in a shell profile or a launchd plist. It is an incident
tool; a permanent bypass is an unenforced machine that still looks enforced.

## Scenario: enforcement is dead (nothing is being blocked)

Most likely the hook shim is missing — the file `~/.thumbgate/bin/thumbgate-hook` that every
`.claude/settings.json` hook invokes. A missing binary makes the hook error, and an erroring
PreToolUse hook **fails open**.

```sh
# Reinstall the shim from the cached runtime
~/.thumbgate/runtime/node_modules/.bin/thumbgate init

# Verify it came back AND that it denies
ls -l ~/.thumbgate/bin/thumbgate-hook
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf ~"}}' \
  | THUMBGATE_STRICT_ENFORCEMENT=1 ~/.thumbgate/bin/thumbgate-hook gate-check
```

If the shim is present but still allowing, check the version (triage step 3). Machines do
**not** auto-upgrade: the MCP wrapper only fetches `@latest` when `runtime/node_modules` is
absent, so a machine with a cached runtime stays on its old version indefinitely.

```sh
npm install thumbgate@latest --prefix ~/.thumbgate/runtime
```

## Scenario: a bad version is live

See [RELEASE-ROLLBACK.md](./RELEASE-ROLLBACK.md). Short form — npm versions are immutable and
unpublish is unavailable after 72h, so the lever is the dist-tag:

```sh
npm dist-tag add thumbgate@<last-good> latest
npm deprecate thumbgate@<bad> "Regression in <area>; use <last-good>."
```

Then remove cached runtimes so machines re-resolve: `rm -rf ~/.thumbgate/runtime/node_modules`.

## Scenario: suspected supply-chain compromise

2026 saw repeated npm registry attacks (axios in March, TanStack in May with 84 malicious
versions across 42 packages, node-gyp in June, AsyncAPI in July). If a published version is
suspected malicious rather than merely buggy:

1. `npm dist-tag add thumbgate@<last-known-good> latest` — stop the spread first.
2. `npm deprecate` every suspect version with a pointer to the good one.
3. Open a registry support request for **unpublish** — deprecation alone leaves the tarball
   installable by exact version.
4. Rotate `NPM_TOKEN` and any `GH_PAT` used by release workflows.
5. Verify provenance on the good version: every release is published with
   `npm publish --provenance`, so the attestation should tie the tarball to a specific commit
   and workflow run. A version without matching provenance did not come from this pipeline.

## After any incident

Record what happened and what signal would have caught it sooner. The canary
(`npm run canary:snapshot` / `canary:check`) exists specifically because enforcement drift is
silent; if an incident was invisible to it, that is a gap in the canary, not a reason to
distrust it.
