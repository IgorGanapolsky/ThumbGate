# Reddit — Roo To Cline Migration

## Evidence
- Official Roo docs: https://docs.roocode.com/
- ThumbGate migration guide: https://thumbgate-production.up.railway.app/guides/roo-code-alternative-cline?utm_source=roo&utm_medium=reddit&utm_campaign=roo_cline_migration&utm_content=guide
- Cline install doc: https://github.com/IgorGanapolsky/ThumbGate/blob/main/adapters/cline/INSTALL.md
- Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md
- Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## Guardrails
- Do not claim installs, revenue, or marketplace approval without direct command evidence.
- Do not lead with proof links before the buyer confirms pain.
- Keep pricing and traction claims aligned with `COMMERCIAL_TRUTH.md`.
- Keep quality and proof claims aligned with `VERIFICATION_EVIDENCE.md`.

## Draft
# Roo Code shuts down on May 15, 2026. Make sure your agent memory survives the move to Cline.

Roo's docs now say the extension, Cloud, and Router all shut down on May 15, 2026, and they recommend Cline as the open-source alternative.

The extension swap is not the hard part. The hard part is re-teaching every correction that only lived inside Roo's context.

Every "don't force-push here," "this repo uses pnpm," or "never auto-run that migration on prod" should survive the vendor change. If the old agent goes away and the lessons go with it, you are paying twice for the same mistakes.

ThumbGate keeps lessons in a local SQLite file and turns repeated failures into pre-action checks before the next risky tool call runs. Swap Roo for Cline, keep the memory, keep the gates.

```
npx thumbgate init --agent cline
```

Migration guide: https://thumbgate-production.up.railway.app/guides/roo-code-alternative-cline?utm_source=roo&utm_medium=reddit&utm_campaign=roo_cline_migration&utm_content=guide

Full Cline setup doc: https://github.com/IgorGanapolsky/ThumbGate/blob/main/adapters/cline/INSTALL.md
