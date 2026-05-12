# Buyer Leads — Real Pain, Verified Quotes (2026-05-11)

**Source:** GitHub Issues search via `gh api search/issues`. Every entry is a real public issue from a real GitHub user. Every quote is taken from the issue title (verifiable by clicking the URL). No invented names. No invented pain.

**Goal:** First external paying customer. Founder-led outreach. CEO sends manually — no auto-posting.

**Strategy:** Don't pitch the product. Offer to test ThumbGate against their exact failure as a proof-of-concept. Convert reproducible proof → $19 Pro, $49 setup, or $99 diagnostic.

---

## Tier 1 — Individual operators reporting agent failures (Pro $19/mo candidates)

These are real people writing public issues, this week, in Claude Code's own repo or their personal projects. They are bleeding. They will read a reply.

### Lead 1.1 — `mstHex` (2026-05-09)
- **Source:** [anthropics/claude-code#57615](https://github.com/anthropics/claude-code/issues/57615)
- **Pain:** "Claude generates fabricated content instead of requesting clarification"
- **Likely tier:** Pro $19/mo
- **Draft reply:**
  > Hi @mstHex — saw your issue about Claude fabricating content. I'm building [ThumbGate](https://thumbgate.ai) (`npx thumbgate init`) — one thumbs-down becomes a local PreToolUse rule so the same fabrication pattern gets blocked next time the agent tries it, before the tool call fires. Want me to test it against your exact failure case and send you the resulting rule + proof report?

### Lead 1.2 — `stulentsev` (2026-05-07)
- **Source:** [anthropics/claude-code#57042](https://github.com/anthropics/claude-code/issues/57042)
- **Pain:** "Claude generates hallucinated content without grounding in provided context"
- **Likely tier:** Pro $19/mo
- **Draft reply:**
  > Hi @stulentsev — same pattern I see a lot. I'm building [ThumbGate](https://thumbgate.ai) which turns a 👎 into a PreToolUse rule that physically blocks the next attempt to generate matching ungrounded output. If you can share a redacted reproduction, I'll wire a rule for it today and send you the proof.

### Lead 1.3 — `calebthecm` (2026-05-07)
- **Source:** [anthropics/claude-code#57054](https://github.com/anthropics/claude-code/issues/57054)
- **Pain:** "Agent suggests destructive commands without safety warnings"
- **Likely tier:** Pro $19/mo (or Team if they're at a company)
- **Draft reply:**
  > Hi @calebthecm — this is exactly the failure mode [ThumbGate](https://thumbgate.ai) was built for. `npx thumbgate init`, give the destructive suggestion a 👎, and the matching tool call gets blocked at the PreToolUse hook on the next attempt. Happy to set you up with a starter rule for the specific destructive command you're seeing — share the repro and I'll send you the rule + a 30-second proof video today.

### Lead 1.4 — `victoriapinder` (2026-04-10)
- **Source:** [anthropics/claude-code#45981](https://github.com/anthropics/claude-code/issues/45981)
- **Pain:** "Agent made destructive YouTube changes applied wrong data and falsely reported completion"
- **Likely tier:** Pro $19/mo or $49 setup (incident-recovery framing)
- **Draft reply:**
  > Hi @victoriapinder — sorry to hear about the destructive YouTube agent run. The "falsely reported completion" half is the part [ThumbGate](https://thumbgate.ai) addresses: thumbs-down once on the false-success pattern, and ThumbGate writes a local rule blocking that exact tool call on the next attempt. Want me to spin a rule that catches the specific pattern that hit you? \$49 one-time and I'll send you the working rule + an audit trail.

### Lead 1.5 — `domattioli` (2026-05-10)
- **Source:** [domattioli/DomI#31](https://github.com/domattioli/DomI/issues/31)
- **Pain:** "git push: Claude pre-emptively renames branches on every push instead of trying [the right thing first]"
- **Likely tier:** Pro $19/mo
- **Draft reply:**
  > Hi @domattioli — that "pre-emptive rename on every push" is a perfect ThumbGate use case. `npx thumbgate init`, 👎 on the rename, and the next push attempt is blocked before the rename runs. Want me to wire the rule from your specific issue and DM you the result?

### Lead 1.6 — `kevin-nous` (2026-04-04)
- **Source:** [anthropics/claude-code#43461](https://github.com/anthropics/claude-code/issues/43461)
- **Pain:** "Remote triggers: 90% MCP tool failure rate + destructive file deletion"
- **Likely tier:** Pro $19/mo or Team (90% failure rate suggests a team)
- **Draft reply:**
  > Hi @kevin-nous — 90% failure rate is brutal. ThumbGate (`npx thumbgate init`) gates the destructive deletion before it fires: 👎 once, blocked forever on that pattern. If you DM me one of the destructive deletion repros, I'll wire the rule and send you proof.

### Lead 1.7 — `Harsh99-ship-it` (2026-04-24)
- **Source:** [sankalpasawa/sutra#1](https://github.com/sankalpasawa/sutra/issues/1)
- **Pain:** "Claude fabricated an npm package that doesn't exist (@read-ai/mcp-server)"
- **Likely tier:** Pro $19/mo
- **Draft reply:**
  > Hi @Harsh99-ship-it — fabricated-package hallucination is a classic. With [ThumbGate](https://thumbgate.ai), 👎 on the fake install rec → rule blocks `npm install @read-ai/mcp-server` (and any similar fabricated package name) at the PreToolUse hook on next attempt. Want me to send you a starter rule for known-bad fabricated package names?

### Lead 1.8 — `coreintentdev` (2026-04-17 and 2026-04-18 — two issues)
- **Source:** [coreintentdev/ZYNTHIO_MASTER_DOCS#102](https://github.com/coreintentdev/ZYNTHIO_MASTER_DOCS/issues/102) and [#122](https://github.com/coreintentdev/ZYNTHIO_MASTER_DOCS/issues/122)
- **Pain:** "Claude hallucinated hardcoded API key in VDS service file — false security alert" + "48 websites was fabricated — Claude wrote VERIFIED into memory file for projects that don't [exist]"
- **Likely tier:** Pro $19/mo (active operator with multiple incidents)
- **Draft reply:**
  > Hi @coreintentdev — seeing two hallucination incidents in your tracker (#102 + #122). [ThumbGate](https://thumbgate.ai) turns each 👎 into a local PreToolUse rule that blocks the matching pattern on the next attempt. Two incidents → two rules → the third doesn't happen. Happy to set you up — share the redacted Claude transcript for either incident and I'll wire the rules today.

---

## Tier 2 — Builders shipping competing/adjacent tools (Team $147/mo, partner, or M&A candidate)

These users are **building exactly what ThumbGate does**. Two outcomes possible: they recognize ThumbGate as superior infra and integrate, or they're already past you. Worth a direct DM either way.

### Lead 2.1 — `denisvmedia` at `aifity/omnigit-mcp` (2026-04-26)
- **Source:** [aifity/omnigit-mcp#56](https://github.com/aifity/omnigit-mcp/issues/56)
- **Pain (self-reported):** "Missing: force-push, commit --amend, and reset --hard (gated as opt-in)"
- **What they're building:** A git MCP server, currently missing destructive-op gating.
- **Likely tier:** Team $147/mo (integration) OR partnership
- **Draft reply:**
  > Hi @denisvmedia — saw you're adding opt-in gating for destructive git ops in omnigit-mcp. We've built that exact enforcement layer at [ThumbGate](https://thumbgate.ai) — pluggable PreToolUse rules with a feedback loop. Worth a 15-min chat about integrating rather than rebuilding? If yes, my Cal link is [drop yours].

### Lead 2.2 — `IceRhymers` at `IceRhymers/claude-marketplace-builder` (2026-05-05)
- **Source:** [IceRhymers/claude-marketplace-builder#30](https://github.com/IceRhymers/claude-marketplace-builder/issues/30)
- **Pain (self-reported):** "feat: add destructive-guard plugin — PreToolUse hook blocking destructive Bash commands"
- **What they're building:** Direct competing PreToolUse destructive-guard plugin.
- **Likely tier:** Team $147/mo or partnership
- **Draft reply:**
  > Hi @IceRhymers — saw the destructive-guard plugin design. We ship that today at [ThumbGate](https://thumbgate.ai), with a feedback-loop that auto-promotes 👎'd patterns into rules and a hosted dashboard. Open to a quick share of how we handle the edge cases (regex vs exact match, false-positive recovery, audit trail)? Could save you a few weekends of work.

### Lead 2.3 — `lugassawan` at `swe-workbench` (2026-05-10)
- **Source:** [lugassawan/swe-workbench#164](https://github.com/lugassawan/swe-workbench/issues/164)
- **Pain (self-reported):** "Pre-push main/master gate misses destination-form refspecs (HEAD:main)"
- **What they're building:** A pre-push gate that's leaking.
- **Likely tier:** Team $147/mo (their gate is leaking, ours doesn't)
- **Draft reply:**
  > Hi @lugassawan — `HEAD:main` refspec bypass is a classic. ThumbGate handles destination-form refspecs by matching against the resolved git push args, not the raw string. Happy to share our matcher or to demo it against your repo's test cases — want to compare notes?

### Lead 2.4 — `Rodrigo-Ichaso` at `railwayapp/railway-skills` (2026-05-06)
- **Source:** [railwayapp/railway-skills#36](https://github.com/railwayapp/railway-skills/issues/36)
- **Pain (self-reported):** "Proposal: intent verification layer before destructive agent operations"
- **What they're building:** Proposing the ThumbGate concept INSIDE Railway's own skills repo.
- **Likely tier:** Could be a Railway-employee buy (Team or higher) OR a personal Pro
- **Draft reply (extra carefully personalized — Railway is our deploy host):**
  > Hi @Rodrigo-Ichaso — your intent-verification proposal is exactly the layer we built at [ThumbGate](https://thumbgate.ai) (which, by coincidence, runs on Railway). Open to chat about whether a ThumbGate skill plug would shortcut what you're proposing? Happy to ship a working ThumbGate skill for Railway agents as a demo this week.

### Lead 2.5 — `eltmon` at `eltmon/panopticon-cli` (2026-04-10)
- **Source:** [eltmon/panopticon-cli#608](https://github.com/eltmon/panopticon-cli/issues/608)
- **Pain (self-reported):** "Integrate Destructive Command Guard (dcg) with configurable settings"
- **What they're building:** A destructive command guard layer.
- **Likely tier:** Team $147/mo or partnership

---

## Tier 3 — Team / org pain (Team $147/mo or $499 diagnostic)

### Lead 3.1 — `VoltAgent/voltagent` org maintainer (2026-04-27)
- **Source:** [VoltAgent/voltagent#1251](https://github.com/VoltAgent/voltagent/issues/1251)
- **Pain (issue title):** "Agent Safety Patterns: Preventing the 'deleted production database' scenario"
- **Likely tier:** $499 diagnostic or Team $147/mo
- **Draft reply:**
  > Hi VoltAgent team — the "deleted production database" scenario is the prototypical [ThumbGate](https://thumbgate.ai) blocked-action. We ship this pattern as a starter rule. Happy to do a 30-min walkthrough of how we'd wire it into a VoltAgent deployment — or if you want to skip the call, $499 buys a "wire a working ThumbGate rule against your most-feared scenario" diagnostic.

### Lead 3.2 — `NousResearch/hermes-agent` reporter `ShengjiaCui` (2026-04-15)
- **Source:** [NousResearch/hermes-agent#10199](https://github.com/NousResearch/hermes-agent/issues/10199)
- **Pain:** "[Bug] Agent executed destructive command without user confirmation"
- **Likely tier:** Team $147/mo (NousResearch is a real org)

### Lead 3.3 — `danhannah94` at `danhannah94/foundry` (2026-04-09)
- **Source:** [danhannah94/foundry#111](https://github.com/danhannah94/foundry/issues/111)
- **Pain:** "sync_to_github silently flattens target repo layout (destructive force-overwrite)"
- **Likely tier:** Pro $19/mo (individual operator getting burned)

### Lead 3.4 — `logar16` at `github/copilot-cli` (2026-04-28)
- **Source:** [github/copilot-cli#3013](https://github.com/github/copilot-cli/issues/3013)
- **Pain:** "Hooks don't fire for background (task) agents"
- **Likely tier:** Team $147/mo or partnership (GitHub Copilot CLI team!)
- **Note:** This is in GitHub's own Copilot repo. The reporter (`logar16`) is reporting a gap in Copilot CLI itself. ThumbGate fills exactly this gap.

### Lead 3.5 — `dergachoff` at `mpecan/tokf` (2026-05-09)
- **Source:** [mpecan/tokf#367](https://github.com/mpecan/tokf/issues/367)
- **Pain (self-reported):** "feat: add first-class Codex PreToolUse hook support"
- **Likely tier:** Team $147/mo or partnership

---

## Recommended action sequence

1. **Send Tier 1 first (Leads 1.1–1.8).** These are individual operators with recent specific failures. Conversion path: GitHub issue reply → DM if they respond → "send me the repro, I'll wire the rule and DM you back today" → $19 Pro or $49 setup.

2. **Then Tier 2 (Leads 2.1–2.5).** Builders. Different pitch: not "use my product," more "let's not duplicate work — here's how we handle X."

3. **Tier 3 last.** Team-scale prospects need a longer conversation. Worth doing but lower yield-per-hour.

**Hard rule:** Do not auto-post. Every reply ships from the CEO's GitHub account, reviewed, possibly edited. AI-generated voice was thumbs-downed on 2026-04-21 and that lock stays on.

**Tracking:** Add a `LEAD-2026-05-11-{tier}.{n}` tag in any reply UTM (e.g., `?utm_source=github_issue_outreach&utm_medium=direct_reply&utm_campaign=lead_2026_05_11&utm_content=lead_1_3_calebthecm`). When their checkout fires, we'll see exactly which lead converted.

---

## Tier 1.5 — Hacker News fresh pain (last 7-14 days)

These are public HN comments. Engagement path: reply to their HN comment (CEO logs into HN web UI, replies in voice). HN profile usually shows contact email — Plan B is direct outreach.

### HN Lead 1.5.1 — `@ihatemodels` (2026-05-08)
- **Source:** [HN comment #48057849](https://news.ycombinator.com/item?id=48057849)
- **Direct buyer-signal quote:** *"You're solving a real problem, and despite beeing a bit broke ATM, I'd be willing to pay for a tool like this given the amount of time I spend on review."*
- **Tier:** Pro $19/mo (explicit "I'd pay" signal in the comment itself)
- **Draft reply (HN-voice, short):**
  > If you want to try ThumbGate free: `npx thumbgate init`. 👎 once on a Claude review-time mistake, the same pattern blocks next session. The free tier covers daily-driver use (5 active rules); Pro at $19 if/when you want recall across sessions + DPO export. I'm Igor, building it — DM if you want me to wire a rule against a specific failure you've seen.

### HN Lead 1.5.2 — `@reubenlavin` (2026-05-07)
- **Source:** [HN comment #48056665](https://news.ycombinator.com/item?id=48056665)
- **Direct buyer-signal:** *"I'm particularly interested in the disable-model-invocation: true safety on /exec and /cleanup. It addresses the biggest hurdle for AI in infra: the fear of an [agent doing something bad]."*
- **Tier:** Team $147/mo or Sprint $499 (infra concern = team-scale)
- **Draft reply:**
  > Same fear is what got me to build ThumbGate (`npx thumbgate init`) — but as a local PreToolUse hook layer instead of a model-invocation flag. /exec and /cleanup-flavored commands can be gated with a rule that auto-promotes on the first 👎. If you have a specific destructive command you want to block, send it — I'll wire the rule today and you can verify.

### HN Lead 1.5.3 — `@selfsimilar` (2026-05-11)
- **Source:** [HN comment #48098105](https://news.ycombinator.com/item?id=48098105)
- **Quote:** *"For 7 months I'd been prompting and shipping without ever sitting down and actually reading the code Claude wrote. I'd look at the diff, verify it compiled, test the ha[ppy path]."*
- **Pain:** The "trust the agent's output without verifying" failure mode → eventually burns.
- **Tier:** Pro $19/mo (individual operator)
- **Draft reply:**
  > The "trust without reading" pattern is the most expensive habit to unlearn. ThumbGate's enforcement layer doesn't fix it for you, but it stops the next destructive action that you'd have rubber-stamped without reading. `npx thumbgate init` — one 👎 on a destructive Claude tool call and it blocks the next attempt. Free tier covers daily-driver use.

---

## Tier 1.7 — HN canonical "AI deleted production DB" thread

[hn:47911524](https://news.ycombinator.com/item?id=47911524) — 860 points, 1032 comments. **The biggest public conversation about ThumbGate's exact prevented failure mode.**

Specific commenters in that thread who described the failure firsthand:

- **`@lowbloodsugar`** ([hn:47918606](https://news.ycombinator.com/item?id=47918606)) — Quoted the original incident: "Cursor running Anthropic's flagship Claude Opus 4.6 — deleted our production database and all volume-level backups in a single API call"
- **`@noobcoder`** ([hn:47930429](https://news.ycombinator.com/item?id=47930429)) — Detailed walkthrough: "April 25, 2026, Cursor running Claude Opus 4.6 deleted PocketOS's entire production database and all volume-level backups in a single Railway API call. It took nine seconds."
- **`@mennylevinski`** ([hn:48008954](https://news.ycombinator.com/item?id=48008954)) — Same incident framing
- **`@kstenerud`** ([hn:47500015](https://news.ycombinator.com/item?id=47500015)) — Multi-incident catalog: "Claude Code + Terraform (March 2026): A developer gave Claude Code access to their AWS infrastructure. It replaced their Terraform state file with..."

**Strategy:** The thread is 2 weeks cold but the audience is still actively engaging. A thoughtful comment from @IgorGanapolsky on the parent (or as a reply to a recent comment) that says: *"Built [ThumbGate](https://thumbgate.ai) precisely to prevent this — local PreToolUse hook blocks the destructive API call after one 👎. Free tier: `npx thumbgate init`. Open source."* — would land in front of the entire thread audience.

Risk: HN's "show HN" / shilling sensitivity. The comment should be contextual, not promotional. Ideal hook: respond to a specific complaint, not to the OP.

---

## Tier 2.5 — Direct competitor / partner intel (HN Show HN)

- **`@yakkomajuri`** — [AgentPort](https://agentport.sh/), 8 HN points — "Open-source Security Gateway For Agents". Builds adjacent infra. Possible partner integration (their gateway sends events to ThumbGate's enforcement engine?) or M&A target.
- **`@AgastyaTodi`** — [AgentArmor](https://github.com/Agastya910/agentarmor), 10 HN points — "8-layer security framework for AI agents". Competing positioning.
- **`@infamous-oven`** — [BetterClaw](https://news.ycombinator.com/item?id=47973502), 2 HN points — "Compile a paragraph into a workflow that gates agent tools". Adjacent.
- **`@metadata` mentioned Safe Boundary** (spectralcore.com/safeboundary) — database security proxy for AI agents. Direct horizontal.
