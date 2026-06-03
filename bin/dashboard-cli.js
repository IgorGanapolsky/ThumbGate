#!/usr/bin/env node
'use strict';

// Insert 'dashboard' and '--open' as the subcommands/arguments
process.argv.splice(2, 0, 'dashboard', '--open');

require('./cli.js');
