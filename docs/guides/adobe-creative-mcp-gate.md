# Gate Agent Edits to Creative Files (Adobe Local MCP Preview)

Adobe's November 2026 Creative Cloud announcement ([Adobe Powers a New Era of Creativity](https://news.adobe.com/news/2026/11/adobe-powers-new-era-of-creativity)) previews **local MCP integrations** that let third-party AI agents make changes inside native project files across **Photoshop, Illustrator, Premiere, and After Effects**, alongside **Adobe Brand Intelligence** for brand-standard enforcement.

Adobe's local MCP integration is currently **in preview**, and Adobe has not yet published canonical MCP tool method names for the desktop preview endpoints. Until Adobe finalizes tool schemas, ThumbGate gates creative workflows at the `PreToolUse` boundary by matching creative project file extensions (`.psd`, `.psb`, `.ai`, `.indd`, `.prproj`, `.aep`) and export/publish actions generically.

## 1. Deny Overwriting Original Project Files Without a Saved Copy

`scripts/brand-standards-gate.js` (`creative-no-overwrite-original`) blocks any direct write or local MCP mutation targeting an original creative project file unless the target filename is an explicit working copy (`*_copy.psd`, `*_working.ai`, `*_draft.prproj`) or `savedCopyVerified: true` is present after creating a backup copy:

```json
{
  "id": "creative-no-overwrite-original",
  "layer": "Execution",
  "pattern": "\\.(psd|psb|ai|indd|prproj|aep)$",
  "action": "block",
  "message": "Save a working copy (for example hero_copy.psd) before letting an agent edit native Creative Cloud project files."
}
```

### Safe Agent Workflow
1. Copy `campaign-master.psd` to `campaign-master_copy.psd`.
2. Point the agent or local MCP tool at `campaign-master_copy.psd`.
3. Keep `campaign-master.psd` untouched on disk so every layer/timeline edit is reversible.

## 2. Require Human Approval Before Exporting or Publishing

`creative-export-publish-approval` returns `decision: "approve"` (failing closed during unattended `THUMBGATE_AUTONOMOUS=1` runs) whenever a Photoshop, Illustrator, InDesign, Premiere, or After Effects MCP tool call attempts an `export`, `render`, `share`, or `publish` action:

```json
{
  "id": "creative-export-publish-approval",
  "layer": "Execution",
  "pattern": "(photoshop|illustrator|indesign|premiere|after[_-]?effects).*(export|render|publish|share)",
  "action": "approve",
  "message": "Exporting or publishing final creative assets requires human review."
}
```

## 3. Outbound Brand & Voice Enforcement (`config/brand-standards.json`)

Before any social post, GitHub comment, newsletter, or outbound email is sent, ThumbGate checks the text against `config/brand-standards.json`:
- Blocks off-brand topics, cross-product conflation, and unverified refund/guarantee claims.
- Enforces plain-words voice rules: at most **one price** per post, no stacked sales jargon, and no bot-style line labels (`Problem:`, `Fix:`), returning a plain-words rewrite suggestion.
- Holds candidate rules learned from thumbs-down feedback in `pending-brand-rules.json` (`status: "pending_approval"`) until a human approves them.
