---
{
  "id": "repo-full-verification",
  "title": "Repo Full Verification",
  "description": "Run the proof-backed repository verification lane and summarize the resulting evidence.",
  "tags": ["verification", "dogfood", "quality"],
  "inputs": {
    "repoPath": {
      "default": ".",
      "description": "Repository path being verified."
    },
    "verificationCommand": {
      "default": "npm run verify:full",
      "description": "Verification command to execute."
    }
  }
}
---
# Repo Full Verification

## Purpose
Run the full ThumbGate verification contract for `{{repoPath}}` and keep the resulting proof artifacts, self-heal status, and workflow evidence attached to one durable runtime.

## Steps
1. Review the latest session primer and current git state before making any completion claim for `{{repoPath}}`.
2. Run: `{{verificationCommand}}`
3. Capture the resulting proof artifacts, self-heal status, and exact workflow evidence for `{{repoPath}}`.
4. Refuse to claim success if any proof lane or self-heal check is red.

## Success Evidence
- `{{verificationCommand}}` exits with status `0`
- `proof/` contains fresh proof reports for the active verification lanes
- `self-heal:check` reports `HEALTHY`
