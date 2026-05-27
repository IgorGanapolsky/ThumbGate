# AC/DC governs the code agents write. Here's the missing layer.

*2026-05-27 — Igor Ganapolsky*

## The framework Sonar shipped

Sonar published the Agent Centric Development Cycle — AC/DC — earlier this year. It's a four-stage governance framework for teams running AI coding agents: **Guide → Generate → Verify → Solve**. The New Stack covered it as the framework engineering leaders should reach for.

It's a good framework. The naming is sticky. The loop closes. The stages map cleanly onto how agentic development actually feels day-to-day. If your team adopted AC/DC and made it past the talking stage, you've already done more agentic-governance work than 90% of shops claiming "AI-first."

I think the framework is also incomplete in one specific, structural way. And I think the gap matters for exactly the buyer Sonar is selling to.

## What AC/DC governs

Look at the four stages:

| Stage | What it inspects |
|-------|------------------|
| Guide | Prompts, context packs, conventions — what you hand the agent **before** generation |
| Generate | Nothing — pure LLM output |
| Verify | Committed source code — static analysis, security hotspots, coverage |
| Solve | The issues Verify surfaced |

Verify is where Sonar's product surface lives, and that's the stage doing the heavy governance lifting. The framework is internally consistent: AC/DC governs **what an agent writes**.

It does not govern **what an agent does**.

## The failures that aren't in the loop

Pull up the last five "the AI agent did something I didn't expect" incidents on your team. I'll bet money on what they look like:

- An agent ran `rm -rf node_modules ../` with a path that traversed out of the workspace.
- An agent ran `DROP TABLE users` against the staging connection because the staging connection happened to point at prod.
- An agent ran `git push --force` to `main` to "clean up history" and erased two days of work.
- An MCP tool got an outbound URL the agent improvised — hidden in a doc the agent ingested — and the URL was a credential-stealing endpoint.
- An agent committed `.env` with live keys, pushed, and the leak detector caught it ninety seconds later.

None of those produce committed source code. They're runtime actions: shell commands, file system writes, git operations, MCP tool calls, outbound network calls. They happen **between** Generate and the next Guide loop. By the time Verify runs on whatever code did get committed, the blast radius has already happened.

AC/DC has no stage for them. Verify isn't built to catch them — Verify reads source code, and these incidents produce none. Guide can hint ("don't push to main") but a hint in a prompt is not a gate.

## The missing stage

Call it **Pre-Execution Gate**, or **Verify-of-Action**, or **PreToolUse Enforcement** — pick one. The shape is the same: a layer that sits inside the agent runtime, intercepts the proposed tool call **before** the tool fires, and returns `allow / warn / block / route-to-human`.

That's the layer ThumbGate runs. It plugs into the same eight agent runtimes your team is probably already using: Claude Code, Cursor, OpenAI Codex CLI, Google Gemini CLI, Sourcegraph Amp, Cline, OpenCode, and Claude Desktop. One PreToolUse boundary, one rule set, every runtime.

I'm not pretending this competes with Sonar. Sonar inspects code. ThumbGate inspects actions. The two are different surfaces and they compose. If you adopted AC/DC and stopped at Verify-of-code, the deployment you actually want is:

1. **Keep Sonar (or whatever fills Verify) on the code surface.** No change.
2. **Add a Pre-Execution Gate at the PreToolUse boundary** across the agent runtimes your devs use.
3. **Wire the feedback loop back into Guide.** Every blocked action becomes a lesson. Lessons promote to prevention rules. Prevention rules go into the context the next Guide iteration hands to the agent. AC/DC's loop closes one stage earlier.

## Why I think Sonar didn't name this stage

The honest read: Sonar's product surface ends at static analysis. Naming a stage Sonar doesn't ship would be marketing against itself, and Sonar isn't in the business of doing that. AC/DC is consistent for the slice Sonar owns, and the slice it owns is genuinely useful. It just isn't all of agentic governance.

That's fine. Frameworks are how a category gets named. Sonar named four stages. The fifth stage — the one between Generate and the next Guide — needs a name too. I'm proposing **Pre-Execution Gate**.

## What this means if you're running AC/DC now

If you have Sonar's Verify in your pipeline and you can't remember the last time it caught an `rm -rf` — that's not Verify being broken. It's Verify doing exactly what it was built to do, on the surface it was built for. The destructive actions are happening one stage earlier, where AC/DC isn't looking.

Add the Pre-Execution Gate before the next blast-radius incident teaches you which half of the loop was missing. The framework is still right. The framework just isn't done.

---

**Try it:**

```
npx thumbgate init
```

Installs the PreToolUse layer in your agent runtime. Local rules. Hosted evidence. No static-analyzer in the path.

The full mapping of ThumbGate to each AC/DC stage is here: [thumbgate.ai/learn/ac-dc-runtime-enforcement](https://thumbgate.ai/learn/ac-dc-runtime-enforcement).

---

*Igor Ganapolsky is the CTO of ThumbGate, a runtime governance layer for AI coding agents. ThumbGate is open source on [GitHub](https://github.com/IgorGanapolsky/ThumbGate) and runs in Claude Code, Cursor, Codex, Gemini, Amp, Cline, OpenCode, and Claude Desktop.*

---

## LinkedIn variant (250-word post)

> Sonar's AC/DC framework — Guide → Generate → Verify → Solve — is the cleanest naming I've seen for agentic SDLC governance. The New Stack ran it as the framework engineering leaders should reach for.
>
> I think it's incomplete in one specific, structural way.
>
> AC/DC's Verify stage inspects committed code. That's Sonar's home turf, and it's what AC/DC governs well. But pull up the last five "the AI agent did something I didn't expect" incidents on your team:
>
> → An agent ran `rm -rf` with a path that traversed out of the workspace.
> → `DROP TABLE users` against staging that happened to point at prod.
> → `git push --force` to main to "clean up history."
> → MCP tool with an improvised outbound URL.
> → `.env` committed and pushed.
>
> None of those produce committed source code. They're runtime actions — shell, file writes, git, MCP, outbound network. They happen *between* Generate and the next Guide loop. AC/DC's Verify can't see them because there's nothing for static analysis to read.
>
> The missing stage is a Pre-Execution Gate: a layer inside the agent runtime that intercepts the proposed tool call before it fires.
>
> Sonar didn't name this stage because Sonar's product surface ends at static code analysis — naming a stage they don't ship would be marketing against themselves. The framework is honest about its scope. The category just needs a fifth stage.
>
> Wrote it up with the worked map for each AC/DC stage here: https://thumbgate.ai/learn/ac-dc-runtime-enforcement
>
> Curious where the Sonar / agentic-SDLC folks land on this.

## Distribution plan

1. **Day 0** (PR #2344 merges, page live): publish blog post to thumbgate.ai/blog. Add /learn/ac-dc-runtime-enforcement to sitemap (already done in the PR).
2. **Day 0 + 1 hour**: post the LinkedIn variant from Igor's personal account. Tag Sonar + The New Stack in the post (their handles publish AI/agent content actively; the framing is complementary so the engagement risk is low).
3. **Day 0 + 4 hours**: pitch The New Stack as a guest article. Subject line: "Follow-up to your AC/DC framework piece — the Pre-Execution Gate stage." Use the blog post as the body. Their author Jennifer Riggins covers agentic SDLC and has run guest pieces in this format before.
4. **Day 1**: Bluesky + Threads variants of the LinkedIn post (Zernio routed). Reply-monitor in `engage` stage of Ralph Loop picks up engagement and queues drafts.
5. **Day 3**: write a second piece — "Five incidents AC/DC's Verify can't see" — that pulls anonymized incidents from the lesson DB. Same publication target.
