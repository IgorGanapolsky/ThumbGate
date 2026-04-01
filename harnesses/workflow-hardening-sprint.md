---
{
  "id": "workflow-hardening-sprint",
  "title": "Workflow Hardening Sprint",
  "description": "Run a focused hardening pass for one workflow and summarize prevention evidence.",
  "tags": ["workflow", "hardening", "reliability"],
  "inputs": {
    "targetWorkflow": {
      "default": "workflow-sprint-intake",
      "description": "Workflow or surface to harden."
    },
    "lessonQuery": {
      "default": "workflow hardening",
      "description": "Lesson-search theme that should shape the hardening pass."
    },
    "verificationCommand": {
      "default": "npm run test:workflow",
      "description": "Verification command for the targeted workflow slice."
    }
  }
}
---
# Workflow Hardening Sprint

## Purpose
Use the latest lessons for `{{lessonQuery}}` to harden `{{targetWorkflow}}`, then prove the workflow stays green under focused verification.

## Steps
1. Review the latest lessons, prevention rules, and failure modes related to `{{lessonQuery}}` before changing `{{targetWorkflow}}`.
2. Run: `{{verificationCommand}}`
3. Compare the resulting gate behavior, retries, and checkpoints for `{{targetWorkflow}}` against the lessons you reviewed.
4. Summarize the concrete prevention rules that now protect `{{targetWorkflow}}`.

## Success Evidence
- `{{verificationCommand}}` exits with status `0`
- the targeted workflow shows evidence-backed prevention guidance
- the shipped workflow summary names the exact gates or lessons that prevent recurrence
