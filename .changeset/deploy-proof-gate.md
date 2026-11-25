---
"thumbgate": minor
---

Deploy-proof gate: the Stop hook that `thumbgate init` installs (`claim-stop-check`), and now the Claude plugin's hooks file too, blocks a reply that says "deployed", "shipped", "now live" or "in production" unless the same reply or message shows proof from production: curl output, a /health JSON snapshot, a buildSha, an HTTP 200 from the host, or a CI line you name. It blocks once, so a reply can never loop. Name your production hosts in `.thumbgate/deploy-proof.json` (`{"hosts": ["app.example.com"], "sentinels": ["Deploy verified"]}`) or `THUMBGATE_PROD_HOSTS`; with none, proof from any https host counts. It is on by default; `THUMBGATE_DEPLOY_PROOF_GATE=0` turns it off. Other completion claims ("done", "fixed") still get the soft reminder unless `THUMBGATE_STRICT_ENFORCEMENT=1`.
