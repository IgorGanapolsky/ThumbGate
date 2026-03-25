# Release Checklist

1. Run `npm ci` in a clean worktree.
2. Run the verification suite:
   - `npm test`
   - `npm run test:coverage`
   - `npm run prove:adapters`
   - `npm run prove:automation`
   - `npm run self-heal:check`
3. Verify `openapi/openapi.yaml` and `adapters/chatgpt/openapi.yaml` are aligned.
4. Verify adapter configs load.
5. Verify budget status: `npm run budget:status`.
6. Run `node scripts/sync-version.js --check` and fix any drift before publishing.
7. Merge the version bump to `main`; `publish-npm.yml` auto-publishes unpublished package versions, tags `vX.Y.Z`, and creates the GitHub Release.
8. Verify the published package is live: `npm view mcp-memory-gateway version`.
9. Refresh Cursor plugin metadata when marketplace copy, screenshots, or README changed.
10. Update `CHANGELOG.md`.

Cursor-specific rule: the plugin runtime uses `npx -y mcp-memory-gateway@latest serve`, so npm releases can flow into the installed plugin runtime. Marketplace metadata and Cursor Directory copy do not auto-refresh from npm and require an explicit plugin/update pass. See [docs/CURSOR_PLUGIN_OPERATIONS.md](docs/CURSOR_PLUGIN_OPERATIONS.md).
