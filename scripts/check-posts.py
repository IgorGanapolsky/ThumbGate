import sys
import time
from pathlib import Path

WORKSPACE = Path("/Users/igorganapolsky/workspace/git/igor/Resume")
sys.path.insert(0, str(WORKSPACE / "scripts"))
from _cdp_comet import connect_existing_comet

def main():
    print("[debug] Connecting to Comet...")
    b, ctx, _ = connect_existing_comet(port=9222)
    page = ctx.new_page()
    
    print("[debug] Navigating to LinkedIn profile activity...")
    page.goto("https://www.linkedin.com/in/iganapolsky/detail/recent-activity/shares/", wait_until="networkidle", timeout=30000)
    time.sleep(5)
    
    EVIDENCE_DIR = Path("/Users/igorganapolsky/workspace/git/igor/ThumbGate/.thumbgate/evidence")
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(EVIDENCE_DIR / "linkedin_activity.png"))
    print("[debug] Activity screenshot saved.")
    
    # Check if our post text is on the page
    content = page.content()
    if "AI policy engines and agent guardrails" in content:
        print("[debug] Found the post on the page!")
    else:
        print("[debug] Post NOT found in activity feed.")
        
    page.close()

if __name__ == "__main__":
    main()
