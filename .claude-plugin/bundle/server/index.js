#!/usr/bin/env node
'use strict';

// Run the CLI IN-PROCESS — do not spawn.
//
// Two field failures shaped this file, both from the same install (2026-07-29):
//   1. cliPath joined __dirname with '..','..' — one level too many — so the installed
//      extension resolved "Claude Extensions/bin/cli.js", crashed MODULE_NOT_FOUND, and
//      Desktop showed only "Server disconnected".
//   2. With that fixed, the shim spawned process.execPath. Under Claude Desktop that is
//      the ELECTRON binary; unless ELECTRON_RUN_AS_NODE survives into the child env, the
//      spawn boots a second Claude app instance instead of a node process — no stderr,
//      a ~2s silent exit on the single-instance lock, and the same "Server disconnected".
//
// Requiring the CLI directly leaves no spawn semantics to get wrong under any host
// runtime: one process, stdio owned end to end.
const path = require('path');

const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');
process.argv = [process.argv[0], cliPath, 'serve'];
require(cliPath);
