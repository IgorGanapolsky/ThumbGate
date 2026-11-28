# Anna AI OS executa: ThumbGate Gate (self-contained binary)

The Anna AI OS Founding Builder submission for `@thumbgate/thumbgate-gate`
ships the bundled executa as five self-contained platform binaries
(executa `1.0.3`, app `1.0.2`), built from this directory. No Node, no npm,
no network at runtime: JSON-RPC 2.0 over stdio straight into the bundled
ThumbGate MCP server.

## Why a self-contained binary (1.0.3 fix)

Anna's reviewer hit "unable to open the App" on the earlier launcher-style
package. Two root causes, both fixed in `mcp-bridge-entry.js`:

1. **Read-only snapshot writes.** pkg embeds the app in a read-only
   `/snapshot` tree; ThumbGate's startup writes (data dirs, journals) crashed
   it silently. The entry remaps every write/mkdir under `/snapshot` to a
   writable dir under `$HOME/tgsrv-data`.
2. **Self-launch guards.** 104 ThumbGate scripts carry "am I the main?" checks
   (`require.main === module`, `path.resolve(process.argv[1])` comparisons,
   `!module.parent`, `module.parent === null`). In a single-file bundle all of
   them evaluate true, hijack stdin, and exit before the server answers. The
   entry points `process.argv[1]` at an empty string so every guard evaluates
   false, and `patch_bundle.py` rewrites the guard forms in the bundle itself.

The entry also diverts every library stdout write to stderr so the JSON-RPC
stream stays clean, and refuses the two native addons
(`@lancedb/lancedb`, `better-sqlite3`) at `Module._resolveFilename` time.

## Native stubs and size

pkg embeds the native addons it finds (~205 MB for the LanceDB prebuilt alone),
which bloats the binary to ~378 MB. Because the entry refuses both addons and
ThumbGate runs on its proven non-native fallback paths, the build stubs the two
native packages out of `node_modules` before packaging: behavior is identical,
and the binary lands at ~114 MB (x86_64) with the same 49-tool surface as
`npx thumbgate serve`.

## Build

`build.sh` bundles the MCP server with esbuild, patches the guards, stubs the
natives, and runs `@yao-pkg/pkg` for the five targets:

```
node22-linux-x64  node22-linux-arm64  node22-macos-arm64  node22-macos-x64  node22-win-x64
```

Cross-target bytecode generation fails on an x86_64 host (the arm64/mach-o/PE
base binaries cannot run there), so the cross builds pass `--fallback-to-source`
and ship every file as plain source where bytecode was not possible. The
linux-x64 build keeps V8 bytecode.

## Anna artifact layout

Each archive keeps the manifest shape Anna expects (`tool-thumbgate-thumbgate-gate-e4ywuqrq`,
version `1.0.3`):

- POSIX (tar.gz): `manifest.json`, `bin/thumbgate-gate` (the self-contained
  binary, `0o755`); entrypoint per platform is `bin/thumbgate-gate`.
- Windows (zip): `manifest.json`, `bin/thumbgate-gate.exe` plus
  `bin/thumbgate-gate.cmd`, a shim that execs the exe; entrypoint is
  `bin/thumbgate-gate.cmd`.

## Verified

linux-x86_64, from the packed archive itself, in a bare environment (no Node,
no PATH, no npm): `initialize` returns `thumbgate-gate 1.0.3`, `tools/list`
returns all 49 tools (matching the npm package exactly), `gate_check` returns a
real verdict, `recall` returns a live context pack, and the stdio stream is
clean JSON-RPC. The other four platforms carry the same bundle and entry;
their binaries are structurally verified (ELF aarch64 / Mach-O x86_64 /
Mach-O arm64 / PE x86_64).
