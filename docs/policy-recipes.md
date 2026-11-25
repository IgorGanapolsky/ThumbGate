# Policy recipes

These policy recipes are opt-in and off by default.

## Installing or launching desktop apps

**Warns on:** Hook-visible agent tool calls that install or launch a desktop app or tool, prompting the user to review the access the app requests.

**Why:** Anthropic's beta, documented in its release notes, lets Claude Desktop install an AI-built artifact as a desktop app on macOS and Windows. A full-access tier can run programs and read, change, or delete local files. Permissions are re-approved after an app update, but code loaded from another site can change without a new permission prompt. Anthropic does not review apps before install.

**Scope limits:** Cannot intercept Claude Desktop's install button or an app's own permission dialog.

## Fetching and executing remote code

**Warns on:** Hook-visible agent tool calls that download and then execute remote code (curl piped to a shell, download-then-run, remote script execution).

**Why:** Code fetched at runtime can change after any approval was given.

**Scope limits:** Covers only actions visible to ThumbGate's hook.
