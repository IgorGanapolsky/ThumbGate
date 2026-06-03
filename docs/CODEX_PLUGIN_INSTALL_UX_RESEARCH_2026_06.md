# Codex Plugin Install UX Research - June 2026

Date: 2026-06-03

## Bottom line

ThumbGate should not lead with a zip download for Codex Desktop. In June 2026, the clearest install hierarchy is:

1. `npx thumbgate init --agent codex` for self-serve setup.
2. Codex Plugins or a Codex marketplace source for true plugin installs.
3. GitHub release zip only for review, offline handoff, and manual marketplace wiring.

The zip is a portable plugin folder, not a double-click installer.

## Evidence

- OpenAI Codex plugin docs describe user installs through the Codex plugin directory: open Plugins, select a plugin, choose the plus button or **Add to Codex**, then start a new thread.
- OpenAI Codex plugin-build docs describe distribution through marketplace JSON catalogs, including `codex plugin marketplace add`, repo marketplaces, personal marketplaces, and workspace sharing.
- OpenAI Codex MCP docs describe direct MCP setup through `config.toml` and `codex mcp`, which matches ThumbGate's current CLI setup approach.
- The local ThumbGate release bundle contains `.codex-plugin/plugin.json`, `.mcp.json`, `.agents/plugins/marketplace.json`, and `config.toml`, which makes it suitable as a portable plugin root after extraction.
- Common developer-tool install patterns keep the primary CTA executable and reversible: package-manager command first, marketplace install second, offline artifact only for advanced/manual use.

## UX implications

- A browser download CTA creates a dead end if Codex Desktop does not automatically import the zip.
- Users should never have to infer whether to double-click, drag, unzip, copy into `~/.codex`, or run a CLI command.
- The page needs to say exactly what happens after the first click.
- A release artifact is still valuable, but only when labeled as an artifact: review bundle, offline bundle, marketplace source, or enterprise audit package.

## Recommended public copy

Primary button:

```text
Install with CLI setup
```

Secondary button:

```text
Read install docs
```

Tertiary button:

```text
Download zip for review
```

Required warning near any zip link:

```text
The zip is not a double-click Codex Desktop installer. Extract it and install the folder through Codex Plugins or a marketplace flow if available. Otherwise use npx thumbgate init --agent codex.
```

## Enterprise packaging

Enterprise customers should get:

- one signed setup command or managed config snippet
- an offline zip for security review
- a marketplace catalog entry for workspace/team rollout
- a verification command: `npx thumbgate feedback-self-test`
- rollback instructions that remove the ThumbGate MCP entry and hook config

## Sources

- OpenAI Codex Plugins: `https://developers.openai.com/codex/plugins`
- OpenAI Codex Build plugins: `https://developers.openai.com/codex/plugins/build`
- OpenAI Codex MCP: `https://developers.openai.com/codex/mcp`
- VS Code extension marketplace install pattern: `https://code.visualstudio.com/docs/editor/extension-marketplace`
- npm package execution pattern: `https://docs.npmjs.com/cli/v10/commands/npx`
- GitHub release asset distribution: `https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository`
