# Cursor Marketplace Investigation — 2026-05-20

## What CEO asked
"Why can't I find ThumbGate in Cursor Marketplace? We are advertising Cursor plugin, are we not?"

## What I got wrong (corrected after CEO's "are you sure?")

### Wrong assumption 1: Previous submission was complete
- UNVERIFIED → DISPROVEN. The publisher application form at `cursor.com/marketplace/publish` showed default/placeholder values when revisited, meaning my earlier submission either didn't persist or was incomplete.
- Fix: Re-submitted with all fields properly filled (ThumbGate name, @thumbgate handle, GitHub repo URL, logo URL, description, website).

### Wrong assumption 2: The `/add-plugin` dropdown was interactive
- UNVERIFIED → DISPROVEN. The `/add-plugin` UI element at the top of the publish page showing GitHub orgs (iganapolsky, Elastic, Meta Reality Labs, Redis, Neon Postgres, Firetiger) is a **static visual mockup** of the Cursor IDE command palette. It is NOT an interactive element:
  - `read_page(filter="interactive")` does not detect it
  - `find("add-plugin input or dropdown")` returns it as a "generic" element, not interactive
  - No `role="option"`, `role="combobox"`, or `cursor: pointer` on any of the org items
  - No `<input>`, `<select>`, or `[contenteditable]` in the y-range 100-400
- This is a product showcase showing what `/add-plugin` looks like inside Cursor IDE, not a web form.

### Wrong assumption 3: Claiming "submitted" = "will appear soon"
- The marketplace requires **manual review by Cursor team**. Confirmation says: "We'll follow up at marketplace-publishing@cursor.com once we review your plugin."
- No ETA. Could be days or weeks. The marketplace currently has only ~15-20 plugins.
- Similar to App Store review — submission ≠ listing.

## Actual state of Cursor distribution channels

| Channel | Status | Discoverable? |
|---------|--------|---------------|
| `cursor.com/marketplace` | Publisher application submitted, pending review | ❌ No |
| `cursor.directory` | Page created at `/plugins/thumbgate-1`, security scan pending | ❌ No (search returns zero) |
| npm `thumbgate` package | Published and installable | ✅ Yes, via `npx` |
| GitHub repo | Public, plugin structure at `plugins/cursor-marketplace/` | ✅ Yes |

## What the marketplace actually contains (2026-05-20)

**Featured Plugins**: Datadog, Slack, Figma, Linear (major company integrations)
**Recently Added**: Modern Web Guidance, Higgsfield (third-party — proves third-party acceptance is possible)
**Official Cursor plugins** (from `cursor/plugins` repo): Continual Learning, Cursor Team Kit, Create Plugin, Agent Compatibility, CLI for Agents, PR Review Canvas, Docs Canvas, Cursor SDK, Orchestrate — all authored by "Cursor"

### Wrong assumption 4 (caught on second "are you sure?"): Only one distribution path
- UNVERIFIED → DISPROVEN. I was fixated on the marketplace web form as the only path.
- Reality: THREE parallel distribution paths exist:
  1. **Marketplace web form** — publisher application at cursor.com/marketplace/publish (done, pending review)
  2. **Direct email** — `kniparko@anysphere.com` (Cursor team contact from plugin-template README) or Slack
  3. **MCP deeplink** — `cursor://anysphere.cursor-deeplink/mcp/install?name=thumbgate&config=...` — WORKS TODAY, no approval needed

### Wrong assumption 5: Can't distribute until marketplace approves
- DISPROVEN. Cursor's official docs describe MCP Install Links as a supported distribution mechanism.
- The deeplink installs ThumbGate's MCP server directly in Cursor — one click.
- Badge: `[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.png)](WEB_LINK)`
- This is how we distribute TODAY while the marketplace review is pending.

## Cursor distribution mechanisms (from official docs)

| Mechanism | Status | Requires Approval? |
|-----------|--------|-------------------|
| Cursor Marketplace listing | Pending review | Yes (manual review) |
| MCP deeplink (cursor:// protocol) | **READY NOW** | No |
| Web install link (cursor.com/install-mcp/) | **READY NOW** | No |
| cursor.directory listing | Pending security scan | Yes (automated) |
| Local install (~/.cursor/plugins/local/) | Works for testing | No |
| Team marketplace (Dashboard import) | Available on Teams/Enterprise | No (admin controls) |

## Actions taken
1. Softened landing page Cursor claims (PR #2258, merged)
2. Re-submitted publisher application with complete, accurate data
3. Generated MCP deeplink and "Add to Cursor" badge — added to plugin README
4. Email SENT to `kniparko@anysphere.com` from `ig5973700@gmail.com` — two messages in thread:
   - First (accidental, incomplete): "(no subject)" with only subject text as body
   - Second (corrective reply): full plugin details, repo URL, npm package, components list
   - Sent from ig5973700@gmail.com, not iganapolsky@gmail.com (wrong Gmail account was active)
5. Plugin template README also mentions Slack as a submission channel — unknown which Slack workspace
6. Added "Add to Cursor" one-click install badge to production landing page (`public/index.html`) Cursor compatibility card
7. PostHog event tracking added for the badge click (`cursor_add_mcp_click`)

### Mistake log
- **Accidental email send**: Tab key in Gmail compose triggered send instead of moving to body. Email went out with no subject and incomplete body. Corrected with follow-up reply in same thread.
- **Wrong Gmail account**: Sent from ig5973700@gmail.com, not iganapolsky@gmail.com. The browser was logged into the wrong account.
- **Draft vs send confusion**: Initially saved reply as draft and told CEO to send manually. CEO corrected — "do everything" means send it.

## What CEO needs to know
- ThumbGate is NOT on the Cursor Marketplace yet — marketplace listing requires manual review, no ETA
- ThumbGate CAN be installed in Cursor TODAY via MCP deeplink (one-click install)
- "Add to Cursor" badge is live on plugin README AND production landing page
- Email to Cursor team (kniparko@anysphere.com) has been SENT with full plugin details
- Plugin structure validated against official cursor/plugin-template — all components match spec
- PRs #2257 and #2256 are in Trunk merge queue
- PR #2262 (graceful shutdown coverage) CI still running
