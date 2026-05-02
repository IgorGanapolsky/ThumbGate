# Operator Send-Now Sheet

Updated: 2026-05-02T07:24:54.998Z

This is the copy-paste send surface for the current evidence-backed revenue loop. Use it when you need the ready-now rows, first-touch drafts, and logging commands in one markdown handoff.

## Current Snapshot
- Revenue state: post-first-dollar
- Headline: Verified booked revenue exists. Keep selling one concrete Workflow Hardening Sprint first, then route self-serve buyers to Pro.
- Billing verification: Live hosted billing summary verified for this run.
- Paid orders: 2
- Checkout starts: 1
- Active follow-ups: 0
- Warm targets ready now: 4
- Self-serve closes ready now: 3
- Production-rollout targets ready now: 3
- Cold GitHub targets ready next: 0

## Operator Rules
- Import the queue into the sales ledger before sending anything.
- Follow the row motion: sprint rows get one workflow-hardening offer; self-serve rows get the guide-to-Pro lane unless pain is confirmed.
- Qualify the offer split: Use Pro after one blocked repeat or explicit self-serve install intent. Use the Workflow Hardening Sprint when one workflow owner needs approval boundaries, rollback safety, and proof before wider rollout.
- Use [VERIFICATION_EVIDENCE.md](../VERIFICATION_EVIDENCE.md) and [COMMERCIAL_TRUTH.md](../COMMERCIAL_TRUTH.md) only after the buyer confirms pain.

```bash
npm run sales:pipeline -- import --source docs/marketing/gtm-revenue-loop.json
```

## Send Now: Warm Discovery
### 1. @Deep_Ad1959 — r/cursor
- Motion: Workflow Hardening Sprint
- Pipeline lead id: reddit_deep_ad1959_r_cursor
- Pipeline stage: targeted
- Contact: https://www.reddit.com/user/Deep_Ad1959/
- Contact surfaces: n/a
- Evidence score: 10
- Evidence: warm inbound engagement; workflow pain named: rollback risk; already in DMs
- Why now: Warm Reddit engager already named a repeated workflow risk, so the fastest path is a founder-led diagnostic.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
First-touch draft:
> Your question about rollback rates when context changes is exactly the right one. I am looking for one AI-agent workflow to harden end-to-end this week: repeated failure, prevention rule, and proof run. If you have one workflow where context drift or rollback risk keeps showing up, I can harden that workflow for you. Worth a 15-minute diagnostic?
Log after send: `npm run sales:pipeline -- advance --lead 'reddit_deep_ad1959_r_cursor' --channel 'reddit_dm' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on rollback risk.'`
Pain-confirmed follow-up:
> If your workflow really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'reddit_deep_ad1959_r_cursor' --channel 'reddit_dm' --stage 'replied' --note 'Buyer confirmed pain around rollback risk.'`
Self-serve follow-up:
> If you want to inspect the self-serve path while you evaluate your workflow, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide If you decide the tool path is enough, the live Pro checkout is https://thumbgate-production.up.railway.app/checkout/pro. If the blocker needs hands-on workflow hardening, keep the sprint intake here: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
Checkout close draft:
> If you are already comparing close options for your workflow, the primary path is Workflow Hardening Sprint: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Self-serve Pro: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
Log after call booked: `npm run sales:pipeline -- advance --lead 'reddit_deep_ad1959_r_cursor' --channel 'reddit_dm' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for rollback risk.'`
Log after checkout started: `npm run sales:pipeline -- advance --lead 'reddit_deep_ad1959_r_cursor' --channel 'reddit_dm' --stage 'checkout_started' --note 'Buyer started the self-serve checkout after discussing rollback risk.'`
Log after sprint intake: `npm run sales:pipeline -- advance --lead 'reddit_deep_ad1959_r_cursor' --channel 'reddit_dm' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for rollback risk.'`
Log after paid: `npm run sales:pipeline -- advance --lead 'reddit_deep_ad1959_r_cursor' --channel 'reddit_dm' --stage 'paid' --note 'Closed Workflow Hardening Sprint and booked revenue after resolving rollback risk.'`
### 2. @game-of-kton — r/cursor
- Motion: Workflow Hardening Sprint
- Pipeline lead id: reddit_game_of_kton_r_cursor
- Pipeline stage: targeted
- Contact: https://www.reddit.com/user/game-of-kton/
- Contact surfaces: n/a
- Evidence score: 9
- Evidence: warm inbound engagement; built serious memory systems; workflow pain named: stale context and conflicting facts
- Why now: Warm Reddit engager already works on advanced agent memory, so discovery should center on one repeated failure pattern.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
First-touch draft:
> Your ACT-R engram work is fascinating, especially the conflict resolution for opposing facts and the decay model. I am looking for one serious AI-agent workflow to harden end-to-end this week. If your memory system has one recurring failure mode such as stale context, opposing facts, bad handoffs, or unsafe tool calls, I can turn that into a prevention rule and proof run. Open to a 15-minute diagnostic?
Log after send: `npm run sales:pipeline -- advance --lead 'reddit_game_of_kton_r_cursor' --channel 'reddit_dm' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on stale context and conflicting facts.'`
Pain-confirmed follow-up:
> If your workflow really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'reddit_game_of_kton_r_cursor' --channel 'reddit_dm' --stage 'replied' --note 'Buyer confirmed pain around stale context and conflicting facts.'`
Self-serve follow-up:
> If you want to inspect the self-serve path while you evaluate your workflow, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide If you decide the tool path is enough, the live Pro checkout is https://thumbgate-production.up.railway.app/checkout/pro. If the blocker needs hands-on workflow hardening, keep the sprint intake here: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
Checkout close draft:
> If you are already comparing close options for your workflow, the primary path is Workflow Hardening Sprint: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Self-serve Pro: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
Log after call booked: `npm run sales:pipeline -- advance --lead 'reddit_game_of_kton_r_cursor' --channel 'reddit_dm' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for stale context and conflicting facts.'`
Log after checkout started: `npm run sales:pipeline -- advance --lead 'reddit_game_of_kton_r_cursor' --channel 'reddit_dm' --stage 'checkout_started' --note 'Buyer started the self-serve checkout after discussing stale context and conflicting facts.'`
Log after sprint intake: `npm run sales:pipeline -- advance --lead 'reddit_game_of_kton_r_cursor' --channel 'reddit_dm' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for stale context and conflicting facts.'`
Log after paid: `npm run sales:pipeline -- advance --lead 'reddit_game_of_kton_r_cursor' --channel 'reddit_dm' --stage 'paid' --note 'Closed Workflow Hardening Sprint and booked revenue after resolving stale context and conflicting facts.'`
### 3. @leogodin217 — r/ClaudeCode
- Motion: Workflow Hardening Sprint
- Pipeline lead id: reddit_leogodin217_r_claudecode
- Pipeline stage: targeted
- Contact: https://www.reddit.com/user/leogodin217/
- Contact surfaces: n/a
- Evidence score: 9
- Evidence: warm inbound engagement; mature multi-step workflow described; workflow pain named: review boundaries and context risk
- Why now: Warm Reddit engager already described a mature workflow, so the next step is a targeted diagnostic on one failure mode.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
First-touch draft:
> Your arch-create to sprint workflow is one of the most mature agent processes I have seen anyone describe. I am looking for one AI-agent workflow to harden end-to-end this week. Your workflow already has phases, review boundaries, and context risk, so it is a strong fit: pick one repeating failure and I will help turn it into an enforceable Pre-Action Check plus proof run. Worth 15 minutes?
Log after send: `npm run sales:pipeline -- advance --lead 'reddit_leogodin217_r_claudecode' --channel 'reddit_dm' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on review boundaries and context risk.'`
Pain-confirmed follow-up:
> If your workflow really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'reddit_leogodin217_r_claudecode' --channel 'reddit_dm' --stage 'replied' --note 'Buyer confirmed pain around review boundaries and context risk.'`
Self-serve follow-up:
> If you want to inspect the self-serve path while you evaluate your workflow, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide If you decide the tool path is enough, the live Pro checkout is https://thumbgate-production.up.railway.app/checkout/pro. If the blocker needs hands-on workflow hardening, keep the sprint intake here: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
Checkout close draft:
> If you are already comparing close options for your workflow, the primary path is Workflow Hardening Sprint: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Self-serve Pro: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
Log after call booked: `npm run sales:pipeline -- advance --lead 'reddit_leogodin217_r_claudecode' --channel 'reddit_dm' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for review boundaries and context risk.'`
Log after checkout started: `npm run sales:pipeline -- advance --lead 'reddit_leogodin217_r_claudecode' --channel 'reddit_dm' --stage 'checkout_started' --note 'Buyer started the self-serve checkout after discussing review boundaries and context risk.'`
Log after sprint intake: `npm run sales:pipeline -- advance --lead 'reddit_leogodin217_r_claudecode' --channel 'reddit_dm' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for review boundaries and context risk.'`
Log after paid: `npm run sales:pipeline -- advance --lead 'reddit_leogodin217_r_claudecode' --channel 'reddit_dm' --stage 'paid' --note 'Closed Workflow Hardening Sprint and booked revenue after resolving review boundaries and context risk.'`
### 4. @Enthu-Cutlet-1337 — r/ClaudeCode
- Motion: Workflow Hardening Sprint
- Pipeline lead id: reddit_enthu_cutlet_1337_r_claudecode
- Pipeline stage: targeted
- Contact: https://www.reddit.com/user/Enthu-Cutlet-1337/
- Contact surfaces: n/a
- Evidence score: 8
- Evidence: warm inbound engagement; responded to adaptive-gate positioning; workflow pain named: brittle guardrails
- Why now: Warm Reddit engager already understands the adaptive-gate thesis, so offer one concrete workflow hardening diagnostic.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
First-touch draft:
> Appreciate the kind words on the Thompson Sampling approach. You nailed the core insight: most guardrails are brittle prompt hacks that break when context shifts. I am looking for one AI-agent workflow to harden end-to-end this week: repeated failure, prevention rule, and proof run. If you have a workflow where brittle guardrails keep failing, I can harden that workflow with you. Open to a 15-minute diagnostic?
Log after send: `npm run sales:pipeline -- advance --lead 'reddit_enthu_cutlet_1337_r_claudecode' --channel 'reddit_dm' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on brittle guardrails.'`
Pain-confirmed follow-up:
> If your workflow really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'reddit_enthu_cutlet_1337_r_claudecode' --channel 'reddit_dm' --stage 'replied' --note 'Buyer confirmed pain around brittle guardrails.'`
Self-serve follow-up:
> If you want to inspect the self-serve path while you evaluate your workflow, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide If you decide the tool path is enough, the live Pro checkout is https://thumbgate-production.up.railway.app/checkout/pro. If the blocker needs hands-on workflow hardening, keep the sprint intake here: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
Checkout close draft:
> If you are already comparing close options for your workflow, the primary path is Workflow Hardening Sprint: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Self-serve Pro: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
Log after call booked: `npm run sales:pipeline -- advance --lead 'reddit_enthu_cutlet_1337_r_claudecode' --channel 'reddit_dm' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for brittle guardrails.'`
Log after checkout started: `npm run sales:pipeline -- advance --lead 'reddit_enthu_cutlet_1337_r_claudecode' --channel 'reddit_dm' --stage 'checkout_started' --note 'Buyer started the self-serve checkout after discussing brittle guardrails.'`
Log after sprint intake: `npm run sales:pipeline -- advance --lead 'reddit_enthu_cutlet_1337_r_claudecode' --channel 'reddit_dm' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for brittle guardrails.'`
Log after paid: `npm run sales:pipeline -- advance --lead 'reddit_enthu_cutlet_1337_r_claudecode' --channel 'reddit_dm' --stage 'paid' --note 'Closed Workflow Hardening Sprint and booked revenue after resolving brittle guardrails.'`
## Close Now: Self-Serve Pro
### 1. @xbim08 — xbim08
- Motion: Pro at $19/mo or $149/yr
- Pipeline lead id: github_xbim08_awesome_claude_code_plugins
- Pipeline stage: targeted
- Contact: https://github.com/xbim08
- Contact surfaces: GitHub profile: https://github.com/xbim08; Repository: https://github.com/xbim08/awesome-claude-code-plugins
- Repo: awesome-claude-code-plugins (https://github.com/xbim08/awesome-claude-code-plugins)
- Evidence score: 12
- Evidence: workflow control surface; agent infrastructure; self-serve agent tooling; 9 GitHub stars; updated in the last 7 days
- Why now: Target looks like a self-serve tooling surface, so Pro is the cleaner CTA unless a concrete workflow pain is confirmed.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/guide
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
First-touch draft:
> Hey @xbim08, saw you're building around `awesome-claude-code-plugins`. If you want the clean self-serve tool path first, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide. If one repeated agent mistake is still slowing the workflow down after that, Pro is the clean next step.
Log after send: `npm run sales:pipeline -- advance --lead 'github_xbim08_awesome_claude_code_plugins' --channel 'manual' --stage 'contacted' --note 'Sent Pro at $19/mo or $149/yr self-serve first touch focused on the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
Pain-confirmed follow-up:
> If you want the self-serve path for `awesome-claude-code-plugins`, here is the live Pro checkout: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_xbim08_awesome_claude_code_plugins' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
Self-serve follow-up:
> If you want the self-serve path for `awesome-claude-code-plugins`, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide If the install path looks right and you want the dashboard plus export-ready evidence, the live Pro checkout is https://thumbgate-production.up.railway.app/checkout/pro
Checkout close draft:
> If you are already comparing close options for `awesome-claude-code-plugins`, the primary path is Pro at $19/mo or $149/yr: https://thumbgate-production.up.railway.app/checkout/pro Self-serve Pro: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
Log after call booked: `npm run sales:pipeline -- advance --lead 'github_xbim08_awesome_claude_code_plugins' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute diagnostic after the self-serve conversation exposed repeated pain around the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
Log after checkout started: `npm run sales:pipeline -- advance --lead 'github_xbim08_awesome_claude_code_plugins' --channel 'manual' --stage 'checkout_started' --note 'Buyer started the self-serve checkout after discussing the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_xbim08_awesome_claude_code_plugins' --channel 'manual' --stage 'sprint_intake' --note 'Buyer escalated from the self-serve lane into Workflow Hardening Sprint intake for the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
Log after paid: `npm run sales:pipeline -- advance --lead 'github_xbim08_awesome_claude_code_plugins' --channel 'manual' --stage 'paid' --note 'Closed Pro at $19/mo or $149/yr and booked revenue after resolving the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
### 2. @zaxbysauce — zaxbysauce
- Motion: Pro at $19/mo or $149/yr
- Pipeline lead id: github_zaxbysauce_opencode_swarm
- Pipeline stage: targeted
- Contact: https://github.com/zaxbysauce
- Contact surfaces: GitHub profile: https://github.com/zaxbysauce; Repository: https://github.com/zaxbysauce/opencode-swarm
- Repo: opencode-swarm (https://github.com/zaxbysauce/opencode-swarm)
- Evidence score: 12
- Evidence: workflow control surface; self-serve agent tooling; 289 GitHub stars; updated in the last 7 days
- Why now: Target looks like a local hook, plugin, or config surface, so start with the setup guide and Pro follow-on before pitching a sprint.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/guide
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
First-touch draft:
> Hey @zaxbysauce, saw you're building around `opencode-swarm`. If you want the clean self-serve tool path first, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide. If one repeated agent mistake is still slowing the workflow down after that, Pro is the clean next step.
Log after send: `npm run sales:pipeline -- advance --lead 'github_zaxbysauce_opencode_swarm' --channel 'manual' --stage 'contacted' --note 'Sent Pro at $19/mo or $149/yr self-serve first touch focused on the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
Pain-confirmed follow-up:
> If you want the self-serve path for `opencode-swarm`, here is the live Pro checkout: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_zaxbysauce_opencode_swarm' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
Self-serve follow-up:
> If you want the self-serve path for `opencode-swarm`, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide If the install path looks right and you want the dashboard plus export-ready evidence, the live Pro checkout is https://thumbgate-production.up.railway.app/checkout/pro
Checkout close draft:
> If you are already comparing close options for `opencode-swarm`, the primary path is Pro at $19/mo or $149/yr: https://thumbgate-production.up.railway.app/checkout/pro Self-serve Pro: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
Log after call booked: `npm run sales:pipeline -- advance --lead 'github_zaxbysauce_opencode_swarm' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute diagnostic after the self-serve conversation exposed repeated pain around the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
Log after checkout started: `npm run sales:pipeline -- advance --lead 'github_zaxbysauce_opencode_swarm' --channel 'manual' --stage 'checkout_started' --note 'Buyer started the self-serve checkout after discussing the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_zaxbysauce_opencode_swarm' --channel 'manual' --stage 'sprint_intake' --note 'Buyer escalated from the self-serve lane into Workflow Hardening Sprint intake for the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
Log after paid: `npm run sales:pipeline -- advance --lead 'github_zaxbysauce_opencode_swarm' --channel 'manual' --stage 'paid' --note 'Closed Pro at $19/mo or $149/yr and booked revenue after resolving the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
### 3. @iliaal — iliaal
- Motion: Pro at $19/mo or $149/yr
- Pipeline lead id: github_iliaal_compound_engineering_plugin
- Pipeline stage: targeted
- Contact: http://ilia.ws/
- Contact surfaces: Website: http://ilia.ws/; GitHub profile: https://github.com/iliaal; Repository: https://github.com/iliaal/compound-engineering-plugin
- Repo: compound-engineering-plugin (https://github.com/iliaal/compound-engineering-plugin)
- Evidence score: 12
- Evidence: workflow control surface; agent infrastructure; self-serve agent tooling; 11 GitHub stars; updated in the last 7 days
- Why now: Target looks like a local hook, plugin, or config surface, so start with the setup guide and Pro follow-on before pitching a sprint.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/guide
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
First-touch draft:
> Hey @iliaal, saw you're building around `compound-engineering-plugin`. If you want the clean self-serve tool path first, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide. If one repeated agent mistake is still slowing the workflow down after that, Pro is the clean next step.
Log after send: `npm run sales:pipeline -- advance --lead 'github_iliaal_compound_engineering_plugin' --channel 'manual' --stage 'contacted' --note 'Sent Pro at $19/mo or $149/yr self-serve first touch focused on the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
Pain-confirmed follow-up:
> If you want the self-serve path for `compound-engineering-plugin`, here is the live Pro checkout: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_iliaal_compound_engineering_plugin' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
Self-serve follow-up:
> If you want the self-serve path for `compound-engineering-plugin`, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide If the install path looks right and you want the dashboard plus export-ready evidence, the live Pro checkout is https://thumbgate-production.up.railway.app/checkout/pro
Checkout close draft:
> If you are already comparing close options for `compound-engineering-plugin`, the primary path is Pro at $19/mo or $149/yr: https://thumbgate-production.up.railway.app/checkout/pro Self-serve Pro: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
Log after call booked: `npm run sales:pipeline -- advance --lead 'github_iliaal_compound_engineering_plugin' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute diagnostic after the self-serve conversation exposed repeated pain around the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
Log after checkout started: `npm run sales:pipeline -- advance --lead 'github_iliaal_compound_engineering_plugin' --channel 'manual' --stage 'checkout_started' --note 'Buyer started the self-serve checkout after discussing the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_iliaal_compound_engineering_plugin' --channel 'manual' --stage 'sprint_intake' --note 'Buyer escalated from the self-serve lane into Workflow Hardening Sprint intake for the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
Log after paid: `npm run sales:pipeline -- advance --lead 'github_iliaal_compound_engineering_plugin' --channel 'manual' --stage 'paid' --note 'Closed Pro at $19/mo or $149/yr and booked revenue after resolving the proof-backed setup guide and local-first enforcement before any team-motion pitch.'`
## Send Next: Production Rollout
### 1. @Adqui9608 — Adqui9608
- Motion: Workflow Hardening Sprint
- Pipeline lead id: github_adqui9608_ai_code_review_agent
- Pipeline stage: targeted
- Contact: https://github.com/Adqui9608
- Contact surfaces: GitHub profile: https://github.com/Adqui9608; Repository: https://github.com/Adqui9608/ai-code-review-agent
- Repo: ai-code-review-agent (https://github.com/Adqui9608/ai-code-review-agent)
- Evidence score: 15
- Evidence: workflow control surface; production or platform workflow; business-system integration; agent infrastructure; updated in the last 7 days
- Why now: Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
First-touch draft:
> Hey @Adqui9608, saw you're shipping `ai-code-review-agent`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
Log after send: `npm run sales:pipeline -- advance --lead 'github_adqui9608_ai_code_review_agent' --channel 'manual' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
Pain-confirmed follow-up:
> If `ai-code-review-agent` really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_adqui9608_ai_code_review_agent' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
Self-serve follow-up:
> If you want to inspect the self-serve path while you evaluate `ai-code-review-agent`, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide If you decide the tool path is enough, the live Pro checkout is https://thumbgate-production.up.railway.app/checkout/pro. If the blocker needs hands-on workflow hardening, keep the sprint intake here: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
Checkout close draft:
> If you are already comparing close options for `ai-code-review-agent`, the primary path is Workflow Hardening Sprint: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Self-serve Pro: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
Log after call booked: `npm run sales:pipeline -- advance --lead 'github_adqui9608_ai_code_review_agent' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
Log after checkout started: `npm run sales:pipeline -- advance --lead 'github_adqui9608_ai_code_review_agent' --channel 'manual' --stage 'checkout_started' --note 'Buyer started the self-serve checkout after discussing one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_adqui9608_ai_code_review_agent' --channel 'manual' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
Log after paid: `npm run sales:pipeline -- advance --lead 'github_adqui9608_ai_code_review_agent' --channel 'manual' --stage 'paid' --note 'Closed Workflow Hardening Sprint and booked revenue after resolving one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
### 2. @kamaldhingra — kamaldhingra
- Motion: Workflow Hardening Sprint
- Pipeline lead id: github_kamaldhingra_ai_agents_qa_automation
- Pipeline stage: targeted
- Contact: https://github.com/kamaldhingra
- Contact surfaces: GitHub profile: https://github.com/kamaldhingra; Repository: https://github.com/kamaldhingra/AI-Agents-QA-Automation
- Repo: AI-Agents-QA-Automation (https://github.com/kamaldhingra/AI-Agents-QA-Automation)
- Evidence score: 15
- Evidence: workflow control surface; production or platform workflow; business-system integration; agent infrastructure; updated in the last 7 days
- Why now: Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
First-touch draft:
> Hey @kamaldhingra, saw you're shipping `AI-Agents-QA-Automation`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
Log after send: `npm run sales:pipeline -- advance --lead 'github_kamaldhingra_ai_agents_qa_automation' --channel 'manual' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
Pain-confirmed follow-up:
> If `AI-Agents-QA-Automation` really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_kamaldhingra_ai_agents_qa_automation' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
Self-serve follow-up:
> If you want to inspect the self-serve path while you evaluate `AI-Agents-QA-Automation`, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide If you decide the tool path is enough, the live Pro checkout is https://thumbgate-production.up.railway.app/checkout/pro. If the blocker needs hands-on workflow hardening, keep the sprint intake here: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
Checkout close draft:
> If you are already comparing close options for `AI-Agents-QA-Automation`, the primary path is Workflow Hardening Sprint: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Self-serve Pro: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
Log after call booked: `npm run sales:pipeline -- advance --lead 'github_kamaldhingra_ai_agents_qa_automation' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
Log after checkout started: `npm run sales:pipeline -- advance --lead 'github_kamaldhingra_ai_agents_qa_automation' --channel 'manual' --stage 'checkout_started' --note 'Buyer started the self-serve checkout after discussing one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_kamaldhingra_ai_agents_qa_automation' --channel 'manual' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
Log after paid: `npm run sales:pipeline -- advance --lead 'github_kamaldhingra_ai_agents_qa_automation' --channel 'manual' --stage 'paid' --note 'Closed Workflow Hardening Sprint and booked revenue after resolving one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
### 3. @dolutech — dolutech
- Motion: Workflow Hardening Sprint
- Pipeline lead id: github_dolutech_engine_context
- Pipeline stage: targeted
- Contact: https://dolutech.com/
- Contact surfaces: Website: https://dolutech.com/; GitHub profile: https://github.com/dolutech; Repository: https://github.com/dolutech/engine_context
- Company: @dolutech
- Repo: engine_context (https://github.com/dolutech/engine_context)
- Evidence score: 15
- Evidence: workflow control surface; production or platform workflow; business-system integration; agent infrastructure; 8 GitHub stars
- Why now: Lead with one business-system workflow that needs approval boundaries, rollback safety, and proof.
- Proof rule: Use proof pack only after the buyer confirms pain.
- CTA: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
- Next operator step: Send the first-touch draft and log the outreach in the sales pipeline.
First-touch draft:
> Hey @dolutech, saw you're shipping `engine_context`. If one approval, handoff, or rollback step keeps creating trouble, I can harden that workflow for you with a prevention gate and proof run: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
Log after send: `npm run sales:pipeline -- advance --lead 'github_dolutech_engine_context' --channel 'manual' --stage 'contacted' --note 'Sent Workflow Hardening Sprint first touch focused on one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
Pain-confirmed follow-up:
> If `engine_context` really has one repeated workflow failure blocking rollout, I can send the Workflow Hardening Sprint brief plus the commercial truth and verification evidence: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
Log after pain-confirmed reply: `npm run sales:pipeline -- advance --lead 'github_dolutech_engine_context' --channel 'manual' --stage 'replied' --note 'Buyer confirmed pain around one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
Self-serve follow-up:
> If you want to inspect the self-serve path while you evaluate `engine_context`, start with the proof-backed setup guide: https://thumbgate-production.up.railway.app/guide If you decide the tool path is enough, the live Pro checkout is https://thumbgate-production.up.railway.app/checkout/pro. If the blocker needs hands-on workflow hardening, keep the sprint intake here: https://thumbgate-production.up.railway.app/#workflow-sprint-intake
Checkout close draft:
> If you are already comparing close options for `engine_context`, the primary path is Workflow Hardening Sprint: https://thumbgate-production.up.railway.app/#workflow-sprint-intake Self-serve Pro: https://thumbgate-production.up.railway.app/checkout/pro Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
Log after call booked: `npm run sales:pipeline -- advance --lead 'github_dolutech_engine_context' --channel 'manual' --stage 'call_booked' --note 'Booked a 15-minute workflow hardening diagnostic for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
Log after checkout started: `npm run sales:pipeline -- advance --lead 'github_dolutech_engine_context' --channel 'manual' --stage 'checkout_started' --note 'Buyer started the self-serve checkout after discussing one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
Log after sprint intake: `npm run sales:pipeline -- advance --lead 'github_dolutech_engine_context' --channel 'manual' --stage 'sprint_intake' --note 'Buyer moved into Workflow Hardening Sprint intake for one business-system workflow that needs approval boundaries, rollback safety, and proof.'`
Log after paid: `npm run sales:pipeline -- advance --lead 'github_dolutech_engine_context' --channel 'manual' --stage 'paid' --note 'Closed Workflow Hardening Sprint and booked revenue after resolving one business-system workflow that needs approval boundaries, rollback safety, and proof.'`