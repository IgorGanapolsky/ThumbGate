# PaperBanana Diagrams

## Budget-safe policy

- Monthly cap enforced by `scripts/budget-guard.js`.
- Default cap: `$10/month` (`THUMBGATE_MONTHLY_BUDGET_USD=10`).
- Diagram generation script blocks projected overspend before calls and logs spend only after successful generation.

## Setup

1. Ensure `.env` contains `GEMINI_API_KEY`.
2. Optionally copy `.env.paperbanana.example` to `.env.paperbanana` and tune model/cost knobs.
3. Install PaperBanana (`pipx install paperbanana` or `python3 -m pip install --user paperbanana`).
4. Run:

```bash
npm run diagrams:paperbanana
```

## Outputs

- `docs/diagrams/rlhf-architecture.png`
- `docs/diagrams/plugin-topology.png`

## Spending status

```bash
npm run budget:status
```

## Failure behavior

- If a generation call fails, no new spend is written to budget ledger.
- If provided API key is invalid, PaperBanana exits with API error and no diagram is produced.
