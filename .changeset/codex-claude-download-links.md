---
thumbgate: patch
---

Compat cards that promise a download now link directly to the release asset instead of a docs/source page. Codex plugin card was linking to `INSTALL.md` source despite saying "download the zip"; Claude Desktop Extension card was linking to a guide page despite saying "install the .mcpb bundle today". Both now go straight to the `.zip` / `.mcpb` on GitHub Releases. Setup-instruction secondary links preserved inline. New test `landing-page-claims.test.js` guards against regression: any compat card with "Download" in the arrow MUST have href pointing at `releases/.../download/`.
