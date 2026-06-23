import sys
import time
import json
from pathlib import Path

WORKSPACE = Path("/Users/igorganapolsky/workspace/git/igor/Resume")
sys.path.insert(0, str(WORKSPACE / "scripts"))
from _cdp_comet import connect_existing_comet

def main():
    print("[diagnostic] Connecting to Chrome on port 9222...")
    b, ctx, _ = connect_existing_comet(port=9222)
    print(f"[diagnostic] Connected. Pages: {len(ctx.pages)}")
    for i, p in enumerate(ctx.pages):
        print(f"  Page {i}: url={p.url} title={p.title()}")
        
if __name__ == "__main__":
    main()
