# LinkedIn — Roo To Cline Migration

## Evidence
- Official Roo docs: https://docs.roocode.com/
- ThumbGate migration guide: https://thumbgate-production.up.railway.app/guides/roo-code-alternative-cline?utm_source=roo&utm_medium=linkedin&utm_campaign=roo_cline_migration&utm_content=guide
- Cline install doc: https://github.com/IgorGanapolsky/ThumbGate/blob/main/adapters/cline/INSTALL.md
- Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md
- Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## Guardrails
- Do not claim installs, revenue, or marketplace approval without direct command evidence.
- Do not lead with proof links before the buyer confirms pain.
- Keep pricing and traction claims aligned with `COMMERCIAL_TRUTH.md`.
- Keep quality and proof claims aligned with `VERIFICATION_EVIDENCE.md`.

## Draft
Roo Code's docs now say all Roo products shut down on May 15, 2026, and they point users to Cline as the open-source alternative.

The extension swap is the easy part. The real migration risk is losing every correction that only lived in the old agent context.

Every "do not force-push from this repo," "this codebase uses pnpm," or "never run that migration in prod" should outlive the vendor. If you are going to migrate agents, it should be the last time you migrate their lesson memory.

ThumbGate keeps that memory in a local SQLite file and turns repeated failures into pre-action checks before the next risky tool call runs. Swap Roo for Cline, keep the corrections, keep the gates.

```
npx thumbgate init --agent cline
```

Guide: https://thumbgate-production.up.railway.app/guides/roo-code-alternative-cline?utm_source=roo&utm_medium=linkedin&utm_campaign=roo_cline_migration&utm_content=guide

#Cline #RooCode #AICoding
