#!/usr/bin/env python3
"""Neutralize every CLI self-launch guard in a bundled ThumbGate build.

Inside a single-file pkg bundle, argv[1] equals the bundle path, so "am I the
main?" checks evaluate true and hijack stdin before the MCP server answers.
This rewrites the guard forms to false. Usage: patch_bundle.py [bundle.cjs]
"""
import re, sys
p = sys.argv[1] if len(sys.argv) > 1 else 'dist/bundle-esb.cjs'
s = open(p).read()
s, n1 = re.subn(r'require\.main === module[A-Za-z0-9_$]*', 'false', s)
s, n2 = re.subn(r'[\w()"\'\.:\[\]]+\.resolve\(process\.argv\[1\]\) === [\w()"\'\.:\[\]]+\.resolve\(__filename\)', 'false', s)
s, n3 = re.subn(r'!module\.parent\b', 'false', s)
s, n4 = re.subn(r'module\.parent === null', 'false', s)
open(p, 'w').write(s)
print('patched main=%d argv=%d parent=%d null=%d' % (n1, n2, n3, n4))
