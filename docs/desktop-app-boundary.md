# Desktop app boundary

ThumbGate evaluates proposed agent tool calls in a pre-action hook. It does not intercept an installed desktop app's own file access, process activity, or permission dialogs, and it cannot see actions from tools that skip the check.

Why this matters now: Anthropic's beta, documented in its release notes, lets Claude Desktop install an AI-built artifact as a desktop app on macOS and Windows. A full-access tier can run programs and read, change, or delete local files. Permissions are re-approved after an app update, but code loaded from another site can change without a new permission prompt. Anthropic does not review apps before install.

## What this means for the gate

- The gate's visibility stops at the tool call it is asked to evaluate.
- An app's own runtime activity is outside that path.
- Do not describe ThumbGate as a sandbox, firewall, or containment boundary, because it is a policy and observability layer, not one.
