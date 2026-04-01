---
{
  "id": "creator-partnership-review",
  "title": "Creator Partnership Review",
  "description": "Review creator-attributed acquisition performance and rank next actions by revenue and qualified demand.",
  "tags": ["acquisition", "creator", "analytics"],
  "inputs": {
    "creatorHandle": {
      "default": "reach_vb",
      "description": "Creator handle or campaign owner being reviewed."
    },
    "analyticsCommand": {
      "default": "node scripts/analytics-report.js --window=30d",
      "description": "Analytics command that should be executed for the review."
    }
  }
}
---
# Creator Partnership Review

## Purpose
Review creator performance for `{{creatorHandle}}` across acquisition, checkout, and booked revenue so the next creator budget decision is evidence-backed.

## Steps
1. Review the current attribution path for `{{creatorHandle}}` across landing, checkout, and workflow sprint intake.
2. Run: `{{analyticsCommand}}`
3. Rank `{{creatorHandle}}` on booked revenue, qualified workflow sprint leads, and checkout starts before recommending the next action.
4. Summarize which campaign variants should be repeated, cut, or expanded for `{{creatorHandle}}`.

## Success Evidence
- `{{analyticsCommand}}` exits with status `0`
- creator metrics include revenue or qualified-demand evidence
- the final recommendation names repeat/cut/expand actions for `{{creatorHandle}}`
