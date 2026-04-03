# ThumbGate Pro Migration Stub

This public repository no longer distributes the ThumbGate Pro runtime or premium configuration packs.

Pro now ships from the private repository and package:

```bash
npm config set @igorganapolsky:registry https://npm.pkg.github.com
npm install -g @igorganapolsky/mcp-memory-gateway-pro
```

Why this changed:

- The public repo remains the open-source core.
- Premium runtime, dashboard, export, and configuration assets move to the private Pro package.
- This keeps the free/pro boundary enforceable instead of publishing premium assets from a public tree.

Current pricing and traction policy: [Commercial Truth](../docs/COMMERCIAL_TRUTH.md)
