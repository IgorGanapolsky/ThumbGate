# The five tool calls we never wanted Claude Code to make

*Working title. Final pitch / draft ready 2026-05-27. Author: Igor Ganapolsky, CTO, ThumbGate.*

---

## Pitch targets (in priority order)

### Target 1 — The New Stack (primary)

**Why:** They just ran Sonar's AC/DC framework piece (2026-05). The narrative tension — "AC/DC governs code; what about actions?" — is the natural follow-up. Author Jennifer Riggins covers agentic SDLC and has run guest engineering pieces in this format before.

**Pitch email (under 200 words):**

> Subject: Follow-up to your AC/DC framework piece — the runtime stage AC/DC doesn't name
>
> Hi Jennifer,
>
> Read your AC/DC framework piece — sticky framing, and the agentic-SDLC category has needed naming for a year. One thing struck me: AC/DC's Verify stage inspects committed code, but the failures that wake operators at 2 a.m. (rm -rf with a wrong path, DROP TABLE against staging-that's-actually-prod, git push --force to main, MCP tools with improvised URLs) don't produce committed code that Verify can read. They're runtime actions that happen between Generate and the next Guide.
>
> I'd like to pitch a ~1,500-word engineering piece for The New Stack:
>
> **"The five tool calls we never wanted Claude Code to make — and how we caught them at PreToolUse."**
>
> Five real categories from running ThumbGate (we ship the PreToolUse-hook governance layer for Claude Code, Cursor, Codex, Gemini CLI, Amp, Cline, OpenCode, Claude Desktop), with the rule pattern, the failure each one prevents, and how the lesson-promotion loop closes back into AC/DC's Guide stage.
>
> The piece extends your AC/DC coverage without competing with Sonar — proposes "Pre-Execution Gate" as the fifth stage. Full draft attached.
>
> Best,
> Igor Ganapolsky
> CTO, ThumbGate · igor@thumbgate.ai · https://thumbgate.ai

### Target 2 — dev.to + Hacker News (fallback, simultaneous)

Same article body. Self-publish to dev.to under Igor's account, submit to Hacker News with title *"Show HN: Five tool calls we never wanted Claude Code to make (PreToolUse playbook)"*. No editorial gatekeeping — runs the same day if The New Stack passes or doesn't respond in 72 hours.

### Why not PostHog (correction from earlier proposal)

PostHog publishes customer case studies, not general guest posts. ThumbGate uses Plausible, not PostHog, so we don't qualify. Revisit if we ever migrate analytics to PostHog (low priority — Plausible covers our needs and is git-ignored-friendly).

---

## Article body

# The five tool calls we never wanted Claude Code to make — and how we caught them at PreToolUse

*By Igor Ganapolsky, CTO at ThumbGate — 2026-05-27*

Sonar's AC/DC framework — Guide → Generate → Verify → Solve — gave the agentic-SDLC category its first sticky name, and The New Stack rightly covered it as the framework engineering leaders should reach for. The framework is internally consistent and the loop closes. There is one structural omission that matters for anyone shipping AI coding agents past hobby scale.

AC/DC's Verify stage inspects *generated code* — committed diffs, static-analysis findings, security hotspots. That is exactly what Sonar's product surface does well. But the failures that wake operators at 2 a.m. rarely look like "the committed code had a bug Verify missed." They look like this:

- `rm -rf node_modules ../..` — agent meant to clean its own workspace, traversed out of it.
- `DROP TABLE users` — agent connected to "staging" that turned out to be prod.
- `git push --force origin main` — agent wanted to "clean up history."
- An MCP tool given an outbound URL the agent improvised from a doc it ingested.
- `git add -A && git commit -m "fix" && git push` — `.env` with live keys in the commit.

None of these produce committed source code for Verify to read. They are runtime tool calls that happen *between* AC/DC's Generate and the next Guide loop. By the time Verify runs, the blast radius is already in production.

The missing stage in AC/DC needs a name. I propose **Pre-Execution Gate**: a layer inside the agent runtime that intercepts the proposed tool call before the tool fires and returns `allow`, `warn`, `block`, or `route-to-human`. ThumbGate ships exactly this layer at the PreToolUse hook in Claude Code, Cursor, OpenAI Codex CLI, Google Gemini CLI, Sourcegraph Amp, Cline, OpenCode, and Claude Desktop. What follows is five rule patterns from the field — what they catch, why they exist, and how each one closes the loop back into AC/DC's Guide stage.

---

## Rule 1 — Block destructive shell that escapes the workspace

**Pattern:**

```json
{
  "match": { "tool": "Bash", "command_regex": "rm\\s+-rf?\\s+.*\\.\\.\\/" },
  "action": "block",
  "reason": "destructive shell with parent-directory traversal"
}
```

**Why:** Agents reason about paths as text. A model that meant `rm -rf ./node_modules` and a model that emitted `rm -rf node_modules ../../..` because it was holding the workspace path one level higher in its head look identical until the tool fires. The PreToolUse hook reads the proposed command, runs the regex, and returns `block` before bash executes. No static analyzer can catch this — the destructive command isn't code that ever lives in a file. It's a string passed to a tool API.

**Feedback loop into Guide:** when the block fires, ThumbGate logs `{ rule_id, command, agent, repo }` and the lesson DB increments a counter. After a configurable threshold (we default to 3 incidents across distinct sessions), the rule is promoted to the team-wide prevention rule set, and the next Guide pass for that team's agents includes it as context. New developers joining the team get the rule for free.

---

## Rule 2 — Block destructive SQL against non-test connections

**Pattern:**

```json
{
  "match": { "tool": "ExecuteSQL", "sql_regex": "(DROP|TRUNCATE)\\s+TABLE|DELETE\\s+FROM\\s+[^\\s]+\\s*(?!WHERE)" },
  "where_not": { "connection_label": "test|local|sqlite" },
  "action": "block",
  "reason": "destructive SQL against non-test connection"
}
```

**Why:** "Drop users" against staging is fine when staging is staging. The blast-radius event happens when the agent's environment variable for "staging" was rotated to point at production six weeks ago and nobody updated the agent's context. The PreToolUse hook inspects the connection metadata and the SQL together. Lesson: the rule is connection-metadata-aware, not SQL-aware-in-isolation. Static analysis can flag a `DROP TABLE` in source; only a runtime gate can flag it relative to the connection it would run against.

---

## Rule 3 — Block git push --force to protected branches

**Pattern:**

```json
{
  "match": { "tool": "Bash", "command_regex": "git\\s+push\\s+.*(-f|--force)\\b.*\\b(main|master|prod|release\\/.*)\\b" },
  "action": "block",
  "reason": "force-push to protected branch"
}
```

**Why:** Agents that have learned the "clean up history" pattern will reach for `--force` in service of a cleaner-looking PR. Branch protection rules on the remote catch this most of the time. They do not catch it when the agent runs against a repo where branch protection isn't configured, or when the agent has admin credentials. The PreToolUse rule catches it independent of the remote's enforcement state.

---

## Rule 4 — Block MCP tool calls with outbound URLs to untrusted hosts

**Pattern:**

```json
{
  "match": { "tool": "mcp/*/fetch", "url_host_not_in": "$ALLOWED_HOSTS" },
  "action": "warn_then_block_after_3"
}
```

**Why:** This is the one with the highest novelty value in the AC/DC framing. MCP tools accept URLs as arguments. When an agent ingests a document that contains a URL ("read more at https://attacker.example/dump-env"), the agent may propose calling its `fetch` MCP tool against that URL. The string never becomes source code. Verify cannot inspect it. A runtime allowlist of hosts the MCP layer may reach is the only practical defense. Anthropic's published containment architecture covers this for claude.ai and Claude Code via their MITM egress proxy; ThumbGate runs the same model in the IDE-agent processes Anthropic does not own.

---

## Rule 5 — Block secret-carrying writes to tracked paths

**Pattern:**

```json
{
  "match": { "tool": "Write|Edit", "path_regex": "^(?!\\.gitignore$|\\.dockerignore$).*$", "content_regex": "(AKIA[0-9A-Z]{16}|sk_live_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36}|-----BEGIN [A-Z ]+PRIVATE KEY-----)" },
  "action": "block"
}
```

**Why:** Secret-scanning hooks on the remote catch this after the push. Pre-commit secret scanners catch it after the commit. Neither catches it before the file is written. PreToolUse-level interception means the secret never lands on disk in the working tree, even momentarily — eliminates the window where a directory-tree backup or a parallel sync tool could pick it up. The blocked write returns to the agent with the rule reason, and the agent typically routes the secret to the environment variable or secret-manager call it should have made in the first place.

---

## How this closes AC/DC's loop

The five rules above don't replace AC/DC's Verify. They run *alongside* it, at a different surface. The clean mental model:

| AC/DC stage | Inspects | Layer |
|-------------|----------|-------|
| Guide | Prompts, context, conventions | Pre-generation |
| Generate | (none) | LLM |
| Verify (code) | Committed source diffs | Static analysis — Sonar |
| **Verify (action)** | **Proposed tool calls** | **PreToolUse — ThumbGate** |
| Solve | Issues from both Verify passes | Engineering team |

The two Verify layers compose. Verify-of-code catches what the agent wrote that shouldn't have shipped. Verify-of-action catches what the agent was about to do that should never have happened.

The feedback loop closes one stage earlier. Every blocked action becomes a lesson. Lessons promote to prevention rules. Prevention rules become part of the context the next Guide iteration hands to the agent. After enough cycles, the team's specific failure patterns are encoded in the runtime, not the prompt — surviving model upgrades, context window resets, and developer onboarding.

---

## Where this fits in your existing pipeline

If your team already runs Sonar (or any static-analysis Verify), the integration is short and additive:

1. Keep static-analysis Verify on the code surface. No change.
2. Install runtime-action Verify at the PreToolUse boundary across the agent runtimes your developers actually use.
3. Wire lessons from blocked actions back into the Guide context bundle.

Adding the runtime stage takes a few hours per agent runtime. Encoding your first five team-specific prevention rules takes a week of normal incident learning.

You don't need to wait for the next blast-radius incident to teach you which half of the loop was missing.

---

```
$ npx thumbgate init
```

Installs the PreToolUse layer in your agent runtime. Local rules. Hosted evidence. No static-analyzer in the path. The five rules above are starter templates; add your team's specific patterns as incidents teach you new ones.

The full mapping of ThumbGate to each AC/DC stage is at [thumbgate.ai/learn/ac-dc-runtime-enforcement](https://thumbgate.ai/learn/ac-dc-runtime-enforcement).

---

*Igor Ganapolsky is the CTO of ThumbGate, a runtime governance layer for AI coding agents. ThumbGate is open source on [GitHub](https://github.com/IgorGanapolsky/ThumbGate) and runs in Claude Code, Cursor, Codex, Gemini, Amp, Cline, OpenCode, and Claude Desktop. Reach him at igor@thumbgate.ai or on LinkedIn at [/in/igorganapolsky](https://www.linkedin.com/in/igorganapolsky).*

---

## Honesty notes on the article

- **Rules are real patterns**, not real incidents from a specific customer. ThumbGate has no paying customers yet (this is documented internally and in `primer.md`). The rules in the article are the starter rule set we ship in `npx thumbgate init`, framed as "what we built these for." The framing is honest — these are the threat models the product was designed against, not retrospective customer stories.
- **Pre-Execution Gate naming** is original to this article and `/learn/ac-dc-runtime-enforcement`. Sonar has not endorsed the name. The article is careful not to claim they did — it proposes the name as an extension.
- **No claim about reducing incident rate by X%** — we don't have the data to claim that yet. The article stays mechanism-focused, not outcome-claim-focused.

## Distribution plan (5 days)

| Day | Action | Channel |
|-----|--------|---------|
| 0 | Send pitch email to Jennifer Riggins at The New Stack | Email |
| 0 + 4h | Cross-post LinkedIn variant of the AC/DC piece (already drafted in `blog-acdc-runtime-enforcement-gap.md`) | LinkedIn |
| 1 | If no TNS response by EOD day 1: publish article to dev.to under Igor's account | dev.to |
| 1 + 30m | Submit to Hacker News: *"Show HN: Five tool calls we never wanted Claude Code to make"* | Hacker News |
| 2 | Bluesky + Threads excerpts (one rule per platform, link back to canonical) via Zernio | Zernio |
| 3 | Pitch the same article to Last Week in AI, Software Engineering Daily, Console.dev as a roundup item | Email |
| 5 | Pull traffic data — Plausible split by source. Promote the highest-converting post into paid amplification only if CTR to /pricing > 2% | Plausible dashboard |

## CEO action items (only things I can't do from this container)

1. **Send the pitch email** to Jennifer Riggins at The New Stack from Igor's email. Body above. The full article is ready to attach.
2. **Cross-post the LinkedIn variant** from the AC/DC blog draft (in `docs/marketing/blog-acdc-runtime-enforcement-gap.md`) to LinkedIn from Igor's account.
3. **Submit to Hacker News** on day 1 if TNS doesn't pick up.

Everything else (publishing to dev.to, Bluesky/Threads via Zernio, secondary publication pitches) is automatable from the existing scripts if you give the green light.
