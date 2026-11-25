---
"thumbgate": minor
---

Deploy-proof gate: the Stop hook that `thumbgate init` installs (`claim-stop-check`), and now the Claude plugin's hooks file too, blocks a reply that says "deployed", "shipped", "now live" or "in production" unless the same reply or message shows proof from production: curl output, a /health JSON snapshot, a buildSha, an HTTP 200 from the host, or a CI line you name. It blocks once, so a reply can never loop. Name your production hosts in `.thumbgate/deploy-proof.json` (`{"hosts": ["app.example.com"], "sentinels": ["Deploy verified"]}`) or `THUMBGATE_PROD_HOSTS`; with none, proof from any https host counts. It is on by default; `THUMBGATE_DEPLOY_PROOF_GATE=0` turns it off. Other completion claims ("done", "fixed") still get the soft reminder unless `THUMBGATE_STRICT_ENFORCEMENT=1`.

The soft anti-claim reminder now reaches the agent. Claude Code does not show a Stop hook's plain output to the model, so the reminder for an unproven "done" or "fixed" used to go nowhere. The Stop hook now also parks it for the session, and the next UserPromptSubmit hook (`hook-auto-capture`) prints it into the agent's context once.

The deploy-proof gate wants a result, not a command: a curl line on its own, or one that reports a failure (connection refused, HTTP 5xx, `"status":"error"`), is not proof, and with hosts configured a health JSON or buildSha only counts next to a configured host. "Deployed to staging" (or dev, preview, test) is not a production claim.
