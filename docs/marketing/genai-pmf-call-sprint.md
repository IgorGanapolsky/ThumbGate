# Gen-AI Search PMF Call Sprint

Week of: 2026-06-05

Objective: Turn generative-AI search visibility into product-market-fit evidence from one-on-one customer calls.

Source: Google launched Search Console generative-AI performance reports on 2026-06-03 for a subset of properties. The report gives visibility by impressions, pages, countries, devices, and dates. The high-ROI move is to use those page/country pockets to decide who to call next, then A/B test one pitch and one workflow per call.

## Operating Rule

- Do not infer product-market fit from impressions alone.
- Do not stay in aggregate dashboards when a page is getting AI-feature visibility.
- Every call tests one pitch, one workflow, and one concrete repeated-mistake question.
- Relay exact buyer language back into the product queue as a prevention-rule candidate, page-copy edit, and proof artifact.

## Import Workflow

```bash
npm run gsc:genai:pmf -- path/to/search-console-genai-export.csv
```

The importer accepts CSV or JSON rows with any of these fields:

- `date`, `day`, `week`, `month`, or `hour`
- `page`, `pages`, `url`, or `landing_page`
- `country` or `countries`
- `device` or `devices`
- `surface`, `report`, `feature`, or `search_appearance`
- `impressions`, `generative_ai_impressions`, or `ai_impressions`

It writes a local summary to `.thumbgate/ai-visibility/gsc-genai-YYYY-MM-DD.json` and refreshes this call sprint from the top visible pages.

## Initial Call Experiments

### genai-pmf-01: repeat-mistake-cost

- Page: https://thumbgate.ai/guides/ai-mode-ads-agent-governance
- Call target: AI workflow owner running Claude Code, Cursor, Codex, Gemini CLI, or Amp near production systems
- Pitch: Stop paying for the same AI-agent mistake twice.
- Workflow test: Ask for the last repeated coding-agent mistake, then demo how a thumbs-down becomes a pre-action check.
- Core question: What is the last AI-agent mistake you would pay to never repeat?
- Success signal: Buyer names a concrete repeated mistake, agrees to a workflow-hardening follow-up, or asks for install/proof steps.
- Build relay: Convert the call transcript into one prevention-rule candidate, one landing-page phrasing update, and one follow-up proof artifact.

### genai-pmf-02: pre-action-governance

- Page: https://thumbgate.ai/llm-context.md
- Call target: Platform owner who needs an evidence-backed answer for agent governance
- Pitch: Pre-action guardrails before code, secrets, deploys, money, or customers are touched.
- Workflow test: Map one risky tool-call path, then show the exact allow/warn/block rule that would have intercepted it.
- Core question: Which AI-agent action would require human review if an intern tried it?
- Success signal: Buyer identifies a policy boundary and asks how to enforce it before the tool call.
- Build relay: Add the boundary as a sample policy, FAQ phrasing, and demo receipt.

### genai-pmf-03: local-first-proof

- Page: https://thumbgate.ai/
- Call target: Developer lead skeptical of another cloud dashboard
- Pitch: Local feedback memory and audit evidence before another cloud dashboard.
- Workflow test: Review their current agent logs or memory folder and identify one prevention rule that can be tested today.
- Core question: Where does your team currently write down AI-agent mistakes so the next session cannot repeat them?
- Success signal: Buyer admits the memory loop is manual, missing, or non-enforcing.
- Build relay: Turn the gap into onboarding copy and a local-dashboard proof question.

### genai-pmf-04: workflow-hardening-sprint

- Page: https://thumbgate.ai/pricing
- Call target: Buyer with a costly workflow and budget authority
- Pitch: One high-risk AI workflow hardened in a week, with proof receipts.
- Workflow test: Qualify a single workflow owner, success metric, blocked-action example, and deployment boundary.
- Core question: What workflow would be embarrassing or expensive if the agent repeated yesterday's mistake?
- Success signal: Buyer will schedule a sprint scoping call or asks for a written statement of work.
- Build relay: Update workflow-sprint intake copy and outbound follow-up with the exact objection.
