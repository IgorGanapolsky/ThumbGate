import sys
import time
from pathlib import Path

WORKSPACE = Path("/Users/igorganapolsky/workspace/git/igor/Resume")
sys.path.insert(0, str(WORKSPACE / "scripts"))
from _cdp_comet import connect_existing_comet

POST_TEXT = """AI policy engines and agent guardrails are converging on the same missing layer: the final decision has to be enforced before the tool call executes.

The useful pattern is not "one more dashboard after the incident."

It is:

1. A policy layer emits allow / block / review.
2. A local pre-action gate normalizes that verdict.
3. The agent's shell command, file edit, browser action, MCP call, or deploy is blocked before execution when the verdict says stop or review.
4. The proof stays inspectable so teams can see which rule fired and why.

That is where ThumbGate fits. Guardian/Ethicore-style SDKs can own policy logic. ThumbGate can sit at the tool/MCP boundary and enforce the result locally, even when the agent is offline or running outside a hosted gateway.

Relevant guide: https://thumbgate.ai/guides/safe-self-evolution

Pricing: https://thumbgate.ai/pricing"""

def main():
    print("[linkedin-automation] Connecting to Comet on port 9222...")
    b, ctx, _ = connect_existing_comet(port=9222)
    
    print("[linkedin-automation] Searching for LinkedIn tab...")
    page = None
    for p in ctx.pages:
        if "linkedin.com" in (p.url or "").lower():
            page = p
            break
            
    if page is None:
        print("[linkedin-automation] No LinkedIn tab found. Creating a new tab...")
        page = ctx.new_page()
    else:
        print(f"[linkedin-automation] Found LinkedIn tab: {page.url}")
        page.bring_to_front()
        
    print("[linkedin-automation] Navigating to LinkedIn feed...")
    page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded", timeout=30000)
    time.sleep(5)
    
    EVIDENCE_DIR = Path("/Users/igorganapolsky/workspace/git/igor/ThumbGate/.thumbgate/evidence")
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(EVIDENCE_DIR / "linkedin_feed_pre_post.png"))
    
    print("[linkedin-automation] Clicking 'Start a post'...")
    try:
        # We target the main visible trigger container/button
        trigger = page.locator(".share-box-feed-entry__trigger:visible, button:has-text('Start a post'):visible, div[role='button']:has-text('Start a post'):visible").first
        trigger.click(force=True)
        print("[linkedin-automation] Clicked start post trigger.")
    except Exception as e:
        print(f"[linkedin-automation] Failed to click start-post trigger: {e}")
        # Direct fallback click on visible button
        page.click("button:has-text('Start a post'):visible", force=True)
        
    time.sleep(3)
    
    # Check if the "Post settings" sub-modal is open instead of the editor
    back_btn = page.locator("div[role='dialog'] button:has-text('Back'):visible")
    if back_btn.count() > 0:
        print("[linkedin-automation] 'Post settings' modal detected. Clicking 'Back' to return to editor...")
        back_btn.first.click(force=True)
        time.sleep(2)
        
    # Check if there is an active editor textbox
    editor_selector = ".ql-editor, div[contenteditable='true'], [role='textbox']"
    try:
        editor = page.wait_for_selector(editor_selector, timeout=10000)
        editor.focus()
        print("[linkedin-automation] Editor focused. Typing post text...")
        page.keyboard.type(POST_TEXT, delay=5)
    except Exception as e:
        print(f"[linkedin-automation] Failed to find or type in editor: {e}")
        page.screenshot(path=str(EVIDENCE_DIR / "linkedin_editor_error.png"))
        sys.exit(1)
        
    print("[linkedin-automation] Post text typed. Waiting for state synchronization...")
    time.sleep(3)
    page.screenshot(path=str(EVIDENCE_DIR / "linkedin_composed.png"))
    
    print("[linkedin-automation] Locating 'Post' submit button...")
    post_btn_selector = "button.share-actions__post-action:visible, button:has-text('Post'):visible"
    try:
        post_btn = page.wait_for_selector(post_btn_selector, timeout=5000)
        if post_btn.is_disabled():
            print("[linkedin-automation] WARNING: Post button is disabled. Retrying text focus...")
            editor.focus()
            page.keyboard.press("Space")
            time.sleep(1)
            
        print("[linkedin-automation] Clicking 'Post'...")
        post_btn.click(force=True)
    except Exception as e:
        print(f"[linkedin-automation] Failed to find or click Post button: {e}")
        page.screenshot(path=str(EVIDENCE_DIR / "linkedin_post_btn_error.png"))
        sys.exit(2)
        
    print("[linkedin-automation] Post submitted. Waiting for confirmation...")
    time.sleep(6)
    page.screenshot(path=str(EVIDENCE_DIR / "linkedin_success.png"))
    print("[linkedin-automation] SUCCESS! Post published.")

if __name__ == "__main__":
    main()
