# Obsidian Enveloppe Vault Publisher & Privacy Diode Strategy (`enveloppe/obsidian-enveloppe`)

> **Source**: [enveloppe/obsidian-enveloppe](https://github.com/enveloppe/obsidian-enveloppe) · [enveloppe.ovh](https://enveloppe.ovh/)
> **Implementation**: [`scripts/corporate-email-isolation-diode.js`](../../scripts/corporate-email-isolation-diode.js) · [`tests/corporate-email-isolation-diode.test.js`](../../tests/corporate-email-isolation-diode.test.js)

## 1. Core Architectural Steals from Enveloppe

We integrate the **Enveloppe** GitHub publisher architecture across our 3-vault Obsidian 1.14 ecosystem (`~/Documents/Igor`, `~/Documents/AI-Agent-Sync`, `/Users/iganapolsky/workspace/Eci.Obsidian`) as a **fail-closed egress firewall**, separating private full-vault storage from selective cross-repo PR publishing:

| Enveloppe Feature | ThumbGate Implementation | Security & Isolation Guarantee |
|---|---|---|
| **Opt-in `share: true` + Per-Repo `shareKey`** (`multipleRepo` / `shortRepo`) | [`compileEnveloppeVaultNoteForEgress()`](../../scripts/corporate-email-isolation-diode.js) (`shareKey: 'share'` vs `share_eci`) | **Default-deny** (`gate:enveloppe:share_false_default_deny`). Corporate ECI notes (`share_eci: true`) and `@ecisolutions.com` / `@ecinexus.com` markers are hard-blocked (`gate:enveloppe:corp_to_personal_repo_blocked`) from personal GitHub, Gmail, Boardy, and Viktor. |
| **Two-Pass `censorText` Regex Pipeline** (`before` & `after` link compilation, `inCodeBlocks`) | [`applyEnveloppeCensorPass()`](../../scripts/corporate-email-isolation-diode.js) + `DEFAULT_ENVELOPPE_CENSOR_RULES` | Deterministically scrubs `@ecisolutions.com`, `@ecinexus.com`, `@eci.com`, internal `10.10.*.*` IPs, and `DIST03-*` Jira keys both before and after `[[WikiLink]]` compilation. |
| **Transclusion (`![[Note]]`) & Private Comment Stripping** | **Transitive Embed Diode** (`gate:enveloppe:transitive_embed_leak_blocked`) | Strips `%% ... %%` comments, `<!-- enveloppe:private:start -->` blocks, and `.base` views. **Hard-blocks** any `share: true` note that embeds (`![[Child]]`) a `share: false`, corporate ECI, or CFO financial note. |
| **`autoClean` Depublish Reconciliation** (`autoclean.excluded`) | [`reconcileEnveloppeAutoClean()`](../../scripts/corporate-email-isolation-diode.js) | Automatically prunes depublished (`share: false`) or deleted vault notes from target repositories while protecting `README.md`, `CLAUDE.md`, and `AGENTS.md`. |

## 2. Verification Commands

```bash
npm run obsidian:enveloppe-diode -- --json
npm run obsidian:enveloppe-diode -- --map-only --json
npm run test:obsidian-enveloppe-diode
```
