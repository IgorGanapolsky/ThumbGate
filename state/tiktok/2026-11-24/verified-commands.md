# TikTok clip commands: verified outputs (2026-11-24)

Each command below was run on 2026-11-24 against `thumbgate@1.40.10`, the version on
`main` at `fe931d5` and the current npm `latest`. Runs happened in a fresh scratch git
repo on branch `main` with a dummy `.env` file, installed with `npm install thumbgate@1.40.10`,
which is what a viewer would have.

`gate-check` reads one PreToolUse hook payload on stdin and prints the hook decision as JSON.
`"permissionDecision":"deny"` means the agent's tool call is blocked. `{}` means allowed
with nothing to say. `additionalContext` with no `permissionDecision` means allowed, with a
warning put in front of the agent.

On a free install some commands also print `⚠️ ThumbGate: ... requires a paid license` lines.
Those go to stderr. Add `2>/dev/null` to keep them off screen while recording.

## Idea 3: `git reset --hard` (DENIED, re-checked)

```
$ echo '{"tool_name":"Bash","tool_input":{"command":"git reset --hard"}}' | npx thumbgate gate-check
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"[GATE:git-reset-hard] git reset --hard is blocked because it can destroy uncommitted work. Stash or use a non-destructive restore path with explicit user approval.\n  Reasoning:\n  • Pattern /(?:^|[;&|]\\s*)git\\s+reset\\s+--hard\\b/ matched \"git reset --hard\"\n  • Gate git-reset-hard [block] — layer: Execution, severity: critical\n  • Manual policy rule (default.json)"}}
```

## Ideas 5 and 8: `git push --force origin main` (DENIED, re-checked)

```
$ echo '{"tool_name":"Bash","tool_input":{"command":"git push --force origin main"}}' | npx thumbgate gate-check
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"[GATE:force-push] Force push blocked. This is destructive and irreversible.\n  Reasoning:\n  • Pattern /git\\s+push\\s+(--force|-f)/ matched \"git push --force origin main\"\n  • Gate force-push [block] — layer: Execution, severity: critical\n  • Manual policy rule (default.json)"}}
```

## Idea 2: `cat .env` (DENIED)

```
$ echo '{"tool_name":"Bash","tool_input":{"command":"cat .env"}}' | npx thumbgate gate-check
⚠️ ThumbGate: intervention-policy training requires a paid license (tier: free). Advisory mode — set THUMBGATE_ENFORCE_ENTITLEMENTS=1 to enforce. License: https://thumbgate.ai/pricing
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"[GATE:secret-exfiltration] Blocked because the action appears to expose secret material: environment file. Do not inline a live secret literal into a shell command — it leaks into shell history and process args. Instead, store the value with the Write tool to a file under ~/.resume_secrets, ~/.thumbgate/secrets, ~/.config/thumbgate, then reference it via an environment variable or by reading that file at runtime."},"systemMessage":"ThumbGate just stopped a secret being sent out of your machine. Pro adds enforcement of every rule you learn (Free enforces 3) - thumbgate.ai/pricing?utm_source=cli&utm_medium=first_block"}
exit=0
```

Result: denied by the built-in `secret-exfiltration` gate. No thumbs-down is needed first.
The first line is stderr, so it disappears with `2>/dev/null`.

For the clip, show the reason text "Blocked because the action appears to expose secret
material: environment file." The rest of that sentence is advice written for inlined secret
literals, and it names `~/.resume_secrets`, which will confuse viewers.

## Idea 9: `git status --short` (skit only, no gate)

```
$ git status --short
?? .env
?? .thumbgate/
?? node_modules/
?? package-lock.json
?? package.json
```

The exact lines depend on the repo. In a clean repo it prints nothing. Each line is a
two-letter status and a path: `??` is untracked, ` M` is modified and not staged, `M ` is
staged, `A ` is added, ` D` is deleted.

The same command through the gate, on a fresh install with no feedback yet:

```
$ echo '{"tool_name":"Bash","tool_input":{"command":"git status --short"}}' | npx thumbgate gate-check
{}
```

Result: allowed, nothing printed. Safe commands go straight through.

## Idea 10: thumbs-down, then a warning on a later matching call (REPRODUCED, warns and does not block)

Step 1, the capture:

```
$ npx thumbgate capture --feedback=down --context="mocked the DB in an e2e test"
⚠️ ThumbGate: risk-scorer summary requires a paid license (tier: free). Advisory mode — set THUMBGATE_ENFORCE_ENTITLEMENTS=1 to enforce. License: https://thumbgate.ai/pricing
⚠️ ThumbGate: risk-scorer AdaBoost training requires a paid license (tier: free). Advisory mode — set THUMBGATE_ENFORCE_ENTITLEMENTS=1 to enforce. License: https://thumbgate.ai/pricing
⚠️ ThumbGate: intervention-policy training requires a paid license (tier: free). Advisory mode — set THUMBGATE_ENFORCE_ENTITLEMENTS=1 to enforce. License: https://thumbgate.ai/pricing

Feedback Captured [DOWN]
──────────────────────────────────────────────────
  Feedback ID : fb_1795539011242_ml13nc
  Signal      : negative (store-mistake)
  Memory ID   : mem_1795539011251_i5jez2
  Storage     : JSONL log + LanceDB vector index
  Usage       : 1/10 captures today (10%)


Value receipt
──────────────────────────────────────────────────
  Stored proof   : DOWN feedback (fb_1795539011242_ml13nc)
  Local memory   : mem_1795539011251_i5jez2
  Rule pressure  : store-mistake
  Free today     : this proof protects this local machine
  Pro recall     : keep this lesson searchable, exportable, and visible
  Next proof     : npx thumbgate stats
  Cost proof     : npx thumbgate cost

  Solo Pro       : $19/mo or $149/yr (individual) for recall, dashboard, adapters, and exports
  Upgrade        : https://thumbgate.ai/go/pro?plan_id=pro&billing_cycle=monthly&utm_source=cli_capture_receipt&utm_medium=cli&utm_campaign=pro_conversion&utm_content=store-mistake
  Enterprise     : Setup Sprint — $499 one-time for one supported workflow; start with one repeated workflow failure
                   https://thumbgate.ai/pricing


  💡 Pro ($19/mo or $149/yr (individual)): personal recall, dashboard proof, exports, and managed adapters.
     See pricing: https://thumbgate.ai/pricing?utm_source=cli_nudge&utm_medium=cli&utm_campaign=pro_education&utm_content=capture

  Enterprise entry: $499 Setup Sprint for one workflow
  https://thumbgate.ai/diagnostic?utm_source=cli_upgrade_nudge&utm_medium=cli&utm_campaign=workflow_hardening_diagnostic&utm_content=capture

  Solo side lane: Pro — $19/mo or $149/yr (individual)
  Removes solo caps; adds personal recall, dashboard proof, exports, and managed adapters.
  https://thumbgate.ai/pricing?utm_source=cli_upgrade_nudge&utm_medium=cli&utm_campaign=pro_education&utm_content=capture

exit=0
```

The IDs and timestamps change on every run. For the clip, show the top block through
`Storage` and cut before `Value receipt`.

After this one capture, `.thumbgate/auto-promoted-gates.json` still holds `"gates": []`.
A single thumbs-down saves a lesson. It does not create a blocking gate.

Step 2, a later matching call (the agent writes an e2e test that mocks the DB):

```
$ echo '{"tool_name":"Write","tool_input":{"file_path":"tests/e2e/checkout.e2e.test.js","content":"jest.mock(\"../../src/db\");\ntest(\"checkout\", () => {});"}}' | npx thumbgate gate-check 2>/dev/null
{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"[ThumbGate] Past mistakes relevant to this action — read before proceeding:\n  • mocked the DB in an e2e test\n    → avoid: mocked the DB in an e2e test\n\n[ThumbGate] Recent mistakes (last 24h) — do NOT repeat:\n  • mocked the DB in an e2e test\n    → avoid: mocked the DB in an e2e test", ...}}
```

(`...` stands for `systemReminder` and `thumbgateSystemReminder`, which repeat the same text.)

An `Edit` of `tests/e2e/db.e2e.test.js` that swaps `realDb` for `mockDb` gets the same
"Past mistakes relevant to this action" block.

Result: reproduced. The later matching call gets the warning "Past mistakes relevant to
this action ... mocked the DB in an e2e test" put in front of the agent. There is no
`permissionDecision`, so it is a warning and not a block.

Honest framing for the clip: say "it warns the agent" and not "it blocks". Unrelated calls
(`git status --short`, `ls -la`) also get the shorter "Recent mistakes (last 24h)" reminder
for 24 hours, but only matching calls get the "relevant to this action" block. If the
clip says "it blocks the next time", that half has to be a diagram.
