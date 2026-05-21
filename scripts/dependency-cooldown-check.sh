#!/usr/bin/env bash
set -euo pipefail

# Find directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Run the javascript implementation
node "$DIR/dependency-cooldown-check.js"
