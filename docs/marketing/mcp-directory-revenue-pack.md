# MCP Directory Repair Pack

Updated: 2026-05-02T22:39:18.647Z

This is a sales operator artifact. It is not proof of directory approval, ranking, installs, or revenue by itself.

## Objective
Repair MCP directory drift so ThumbGate discovery points to one canonical identity and one proof-backed install path.

## Positioning
- State: directory-repair
- Headline: Fix stale MCP directory positioning before scaling discovery.
- Short description: ThumbGate already has live MCP directory discovery, but major surfaces still leak retired gateway language, legacy namespaces, or duplicate old rows. Repair those first, then scale directory acquisition.
- Summary: Current checks show one canonical listing on MCP.so, a canonical-but-stale Glama summary, a legacy Smithery namespace, one punkpeye duplicate legacy row beside the canonical listing, and one missing awesome-list entry.

## Canonical Identity
- Display name: ThumbGate
- Repository: https://github.com/IgorGanapolsky/ThumbGate
- npm package: https://www.npmjs.com/package/thumbgate
- Homepage: https://thumbgate-production.up.railway.app
- Commercial truth: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md
- Verification evidence: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
- Support docs: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/mcp-hub-submission.md

## Demand Surfaces
### MCP.so canonical listing
- Role: Live discovery surface with the current ThumbGate slug.
- Public status: Live on the canonical `thumbgate/IgorGanapolsky` path.
- Operator use: Use as the reference listing while repairing drift everywhere else.
- Surface URL: https://mcp.so/server/thumbgate/IgorGanapolsky
- Submission path: https://mcp.so/submit
- Support: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/marketing/mcp-directories.md
- Evidence checked: 2026-05-02
- Evidence summary: Live page still shows the canonical ThumbGate title, current overview copy, Workflow Hardening Sprint CTA, and the canonical GitHub repository link.
- Next repair: Keep description and proof links aligned with `COMMERCIAL_TRUTH.md` and `VERIFICATION_EVIDENCE.md` as the canonical directory copy.
- Proof: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

### Glama canonical listing
- Role: High-volume MCP registry search surface with a canonical URL but stale legacy positioning in the summary.
- Public status: Search now resolves to the canonical `IgorGanapolsky/ThumbGate` page, and the legacy `mcp-memory-gateway` URL 301-redirects there.
- Operator use: Refresh the public summary so Glama no longer describes ThumbGate as a memory gateway before pushing more directory traffic.
- Surface URL: https://glama.ai/mcp/servers?query=thumbgate
- Submission path: https://glama.ai/mcp/servers/IgorGanapolsky/ThumbGate
- Support: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/marketing/mcp-directories.md
- Evidence checked: 2026-05-02
- Evidence summary: Search JSON-LD now points at `IgorGanapolsky/ThumbGate`, but the indexed description still says ThumbGate provides "memory management and gateway capabilities" with persistent storage across sessions.
- Next repair: Update the canonical Glama description so it leads with pre-action gates, workflow safeguards, and repeat-mistake prevention instead of memory-gateway language.
- Proof: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

### Smithery search result
- Role: Installer-facing directory surface with a legacy namespace result.
- Public status: Search returns `rlhf-loop/thumbgate` with `0 connections` instead of a canonical ThumbGate namespace.
- Operator use: Publish or repair the canonical Smithery listing before treating Smithery as an active acquisition lane.
- Surface URL: https://smithery.ai/search?q=thumbgate
- Submission path: https://smithery.ai/new
- Support: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/marketing/mcp-directories.md
- Evidence checked: 2026-05-02
- Evidence summary: Direct search output shows `thumbgate [remote]`, the legacy `rlhf-loop/thumbgate` namespace, and a details link at the legacy path.
- Next repair: Publish or migrate Smithery metadata to a canonical ThumbGate namespace and retire the legacy `rlhf-loop` ownership path.
- Proof: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

### punkpeye awesome-mcp-servers
- Role: Largest GitHub awesome-list discovery surface in the current repo research.
- Public status: README now contains both a canonical `IgorGanapolsky/ThumbGate` entry and a stale duplicate `IgorGanapolsky/mcp-memory-gateway` entry.
- Operator use: Open a repair PR that removes the duplicate legacy row while preserving the canonical ThumbGate listing.
- Surface URL: https://github.com/punkpeye/awesome-mcp-servers
- Submission path: https://github.com/punkpeye/awesome-mcp-servers/blob/main/README.md
- Support: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/marketing/mcp-directories.md
- Evidence checked: 2026-05-02
- Evidence summary: The raw README shows a canonical ThumbGate row around line 893 and a stale `mcp-memory-gateway` duplicate around line 1634, so buyers can still discover the retired identity.
- Next repair: Submit a PR deleting the legacy duplicate and keeping the canonical ThumbGate row plus its pre-action gates description.
- Proof: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

### appcypher awesome-mcp-servers
- Role: Secondary GitHub discovery list that currently has no ThumbGate entry.
- Public status: No ThumbGate entry found in the current README search.
- Operator use: Treat this as a clean add-listing submission, not a rename repair.
- Surface URL: https://github.com/appcypher/awesome-mcp-servers
- Submission path: https://github.com/appcypher/awesome-mcp-servers
- Support: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/marketing/mcp-directories.md
- Evidence checked: 2026-05-02
- Evidence summary: README search returned no `thumbgate` or `IgorGanapolsky` matches, so this surface is still missing entirely.
- Next repair: Open a new listing PR with ThumbGate-only copy and the canonical GitHub repository.
- Proof: https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md

## Follow-On Offers
- Proof-backed setup guide: Discovery CTA
  Buyer: Directory visitors who want a current install and proof surface before anything sales-led.
  CTA: https://thumbgate-production.up.railway.app/guide?utm_source=mcp_directories&utm_medium=directory&utm_campaign=mcp_directory_guide&utm_content=guide&campaign_variant=directory_repair&offer_code=MCP-DIRECTORY_GUIDE&cta_id=mcp_directory_guide&cta_placement=follow_on_offer&surface=mcp_directory_guide
- ThumbGate Pro: $19/mo or $149/yr
  Buyer: Directory visitors who already want the self-serve path and need a tracked paid-intent lane after the guide.
  CTA: https://thumbgate-production.up.railway.app/checkout/pro?utm_source=mcp_directories&utm_medium=directory&utm_campaign=mcp_directory_pro&utm_content=pro&campaign_variant=self_serve_paid_intent&offer_code=MCP-DIRECTORY_PRO&cta_id=mcp_directory_pro&cta_placement=follow_on_offer&plan_id=pro&surface=mcp_directory_pro
- Workflow Hardening Sprint: Primary revenue motion
  Buyer: Teams that already named one repeated workflow failure and want rollout proof, not just a directory listing.
  CTA: https://thumbgate-production.up.railway.app/?utm_source=mcp_directories&utm_medium=directory&utm_campaign=mcp_directory_sprint&utm_content=workflow_sprint&campaign_variant=repair_to_team_motion&offer_code=MCP-DIRECTORY_SPRINT&cta_id=mcp_directory_sprint&cta_placement=follow_on_offer&surface=mcp_directory_sprint#workflow-sprint-intake

## Operator Queue
### Glama listing owner or claimant
- Evidence: Glama search now lands on the canonical ThumbGate page, but the indexed summary still describes ThumbGate as a memory gateway with persistent storage across sessions.
- Proof trigger: Refresh this before sending more discovery traffic into Glama because the summary still frames ThumbGate around retired gateway language.
- Proof asset: https://glama.ai/mcp/servers?query=thumbgate
- Next ask: https://glama.ai/mcp/servers/IgorGanapolsky/ThumbGate
- Recommended motion: Edit the canonical Glama listing summary so it leads with pre-action gates, repeat-mistake prevention, and workflow safeguards.

### Smithery publisher or maintainer
- Evidence: Smithery search returns the legacy `rlhf-loop/thumbgate` namespace with no canonical ThumbGate ownership path.
- Proof trigger: Fix before treating Smithery as a live install lane because the namespace itself is still legacy.
- Proof asset: https://smithery.ai/search?q=thumbgate
- Next ask: https://smithery.ai/servers/rlhf-loop/thumbgate
- Recommended motion: Publish or migrate Smithery to a canonical ThumbGate namespace and retire `rlhf-loop`.

### GitHub awesome-list maintainer or contributor
- Evidence: The highest-reach awesome list now has both the canonical `IgorGanapolsky/ThumbGate` row and a stale `IgorGanapolsky/mcp-memory-gateway` duplicate.
- Proof trigger: Repair this before doing net-new list work because discovery can still hit the retired identity even though the canonical row already exists.
- Proof asset: https://github.com/punkpeye/awesome-mcp-servers
- Next ask: https://github.com/punkpeye/awesome-mcp-servers/pulls
- Recommended motion: Open a small README PR that deletes the legacy duplicate row and preserves the canonical ThumbGate listing.

### GitHub awesome-list maintainer or contributor
- Evidence: No current ThumbGate entry exists in the appcypher list, so this is clean acquisition expansion instead of repair.
- Proof trigger: Only pursue after the legacy-name repairs are underway so new discovery traffic sees one canonical identity.
- Proof asset: https://github.com/appcypher/awesome-mcp-servers
- Next ask: https://github.com/appcypher/awesome-mcp-servers/pulls
- Recommended motion: Open a new listing PR with ThumbGate-only copy, the npm package, and the canonical GitHub repository.

### Directory maintenance owner
- Evidence: MCP.so already exposes the correct ThumbGate slug and current overview, so it can anchor every other repair.
- Proof trigger: Use as the backstop whenever a directory repair needs a live canonical listing reference.
- Proof asset: https://mcp.so/server/thumbgate/IgorGanapolsky
- Next ask: https://mcp.so/server/thumbgate/IgorGanapolsky
- Recommended motion: Preserve this listing as the canonical reference and mirror its ThumbGate-only naming everywhere else.

## Outreach Drafts
### Glama claim or support request — Glama listing maintainer
ThumbGate now resolves to the canonical Glama page, but the summary still describes it as a memory gateway with persistent storage across sessions. The active positioning is pre-action gates for AI coding agents: repeated mistakes become enforceable checks before risky actions run. Please refresh the summary so the canonical ThumbGate listing reflects the current product.

### Smithery publish note — Smithery publisher
The current Smithery search result for `thumbgate` resolves to the legacy `rlhf-loop/thumbgate` namespace. The active package and repository are `thumbgate` and `IgorGanapolsky/ThumbGate`. Publish or migrate the listing under the canonical ThumbGate namespace before treating Smithery as a live acquisition lane.

### punkpeye duplicate-removal PR body — awesome-mcp-servers maintainer
This PR removes the stale `IgorGanapolsky/mcp-memory-gateway` duplicate and keeps the canonical `IgorGanapolsky/ThumbGate` row. ThumbGate is the active repository and package; the description remains focused on pre-action gates that prevent AI coding agents from repeating known mistakes.

### appcypher README PR body — awesome-mcp-servers maintainer
This PR adds ThumbGate to the list using the canonical repository and current product language. ThumbGate is the pre-action gates layer for AI coding agents: it captures explicit feedback, turns repeated failures into prevention rules, and blocks repeat mistakes before risky actions run again.

## 90-Day Measurement Plan
- North star: directory_referral_to_paid_intent
- Policy: Treat directory presence as acquisition evidence only after a tracked guide click, install-surface click, or qualified workflow conversation exists.
- Minimum useful signal: One tracked setup-guide visit or workflow-sprint conversation sourced from a repaired directory surface.
- Strong signal: Three tracked paid-intent events sourced from repaired directory referrals across guide, Pro, or sprint lanes.
Tracked metrics:
- directory_referral_clicks
- guide_visits_from_directories
- codex_plugin_page_visits_from_directories
- workflow_sprint_intake_submissions_from_directories
- pro_checkout_starts_from_directories
Guardrails:
- Do not claim directory approval, ranking, installs, or revenue without direct command evidence.
- Do not ship new directory copy that mentions `mcp-memory-gateway`, `rlhf-loop`, or other retired product names as active surfaces.
- Keep pricing aligned with COMMERCIAL_TRUTH.md.
- Keep proof claims aligned with VERIFICATION_EVIDENCE.md.
Milestones:
- days_0_30: Repair Glama summary drift, Smithery namespace drift, and the punkpeye duplicate before broadening directory distribution. Decision rule: Do not add lower-priority directories until the visible legacy-name leaks are fixed or actively queued.
- days_31_60: Measure whether repaired directory referrals produce guide clicks or qualified workflow conversations. Decision rule: If referral clicks exist without paid intent, move proof and install CTAs higher on the linked destination pages.
- days_61_90: Prune low-signal directories and keep only the surfaces that produce tracked downstream intent. Decision rule: If a directory does not create tracked guide clicks or workflow conversations, stop treating it as an active acquisition lane.
Do not count as success:
- directory pages that still use legacy names
- directory visibility without a tracked downstream click
- unverified claims about official registry presence, approval, or paid traffic

## Proof Links
- https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/COMMERCIAL_TRUTH.md
- https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md
