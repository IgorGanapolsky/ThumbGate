# ThumbGate Instagram Post Workflow

## Overview

This workflow creates a 1080x1080 Instagram card image and posts it to Instagram via Zernio's unified social publishing API.

## Components Created

### 1. Image Generation
**File:** `scripts/social-analytics/generate-instagram-card.js`

Generates a dark-themed 1080x1080 PNG card with:
- Background: #0d1117 (dark)
- Text: "Your AI agent has amnesia" / "Give it memory that survives restarts"
- Brand: "ThumbGate" in cyan (#00d9ff)

Usage:
```bash
node scripts/social-analytics/generate-instagram-card.js [--output=path/to/output.png]
```

Output: `.thumbgate/instagram-card.png` (default)

### 2. Instagram Post (via Zernio)
**File:** `scripts/social-analytics/instagram-thumbgate-post.js`

Posts caption text to Instagram using Zernio's unified API.

Caption includes:
- Problem statement: "Your AI coding agent forgets everything"
- Solution: "ThumbGate gives it memory that survives restarts"
- Call-to-action: "npx mcp-memory-gateway init"
- Hashtags: #AIAgents #DeveloperTools #CodingAgents #MCP #OpenSource #ClaudeCode #ThumbGate

Usage:
```bash
node scripts/social-analytics/instagram-thumbgate-post.js
```

Requirements:
- `ZERNIO_API_KEY` environment variable
- `ZERNIO_INSTAGRAM_ACCOUNT_ID` environment variable

### 3. Complete Workflow Orchestrator
**File:** `scripts/social-analytics/publish-instagram-thumbgate.js`

Combines image generation and posting in a single workflow.

Usage:
```bash
# Full workflow: generate image + post to Instagram
node scripts/social-analytics/publish-instagram-thumbgate.js

# Generate image only
node scripts/social-analytics/publish-instagram-thumbgate.js --image-only

# Post caption only (no image generation)
node scripts/social-analytics/publish-instagram-thumbgate.js --post-only
```

## Test Suite

Three comprehensive test files verify each component:

1. **tests/generate-instagram-card.test.js** — Tests image generation
   - Validates PNG file creation
   - Checks file size and PNG magic bytes
   - Verifies default output path

2. **tests/instagram-thumbgate-post.test.js** — Tests Instagram posting
   - Validates caption content and hashtags
   - Tests Zernio API integration (when ZERNIO_API_KEY set)
   - Captures and displays post ID

3. **tests/publish-instagram-thumbgate.test.js** — Tests complete workflow
   - Full integration test
   - Supports image-only and post-only modes
   - Verifies both image creation and Instagram posting

## Running Tests

```bash
# Run all Instagram-related tests
npm test -- tests/instagram-thumbgate-post.test.js
npm test -- tests/generate-instagram-card.test.js
npm test -- tests/publish-instagram-thumbgate.test.js

# Run specific test
npm test -- tests/publish-instagram-thumbgate.test.js --grep "should post to Instagram"
```

## Integration with npm Scripts

To integrate with the project's social pipeline, add to `package.json`:

```json
{
  "scripts": {
    "social:instagram:generate": "node scripts/social-analytics/generate-instagram-card.js",
    "social:instagram:post": "node scripts/social-analytics/instagram-thumbgate-post.js",
    "social:instagram:publish": "node scripts/social-analytics/publish-instagram-thumbgate.js"
  }
}
```

## Zernio API Details

**Endpoint:** `POST https://zernio.com/api/v1/posts`

**Request Body:**
```json
{
  "content": "Your caption here",
  "publishNow": true,
  "platforms": [
    {
      "platform": "instagram",
      "accountId": "YOUR_ZERNIO_INSTAGRAM_ACCOUNT_ID"
    }
  ]
}
```

**Response:**
```json
{
  "id": "post_123...",
  "data": {
    "id": "post_123..."
  }
}
```

## Architecture Notes

- **Zernio Advantage:** Single API for 8+ platforms (Instagram, TikTok, LinkedIn, YouTube, X/Twitter, Reddit, Threads, etc.)
- **Image Support:** Current Zernio implementation is text-only; image support would require:
  1. Base64 encoding the PNG
  2. Passing as `media` array with `type: 'image'`
  3. Or uploading to CDN and passing `mediaUrl` parameter
- **Caption-Only Posting:** Works independently on Instagram via Zernio text-based API
- **Future Enhancement:** Could integrate with existing `scripts/social-analytics/publishers/instagram.js` (native Graph API) for carousel support

## Environment Variables

From `.env`:
```
ZERNIO_API_KEY=sk_...
ZERNIO_INSTAGRAM_ACCOUNT_ID=69bed6ad6cb7b8cf4c8b0865
```

## Error Handling

All scripts include comprehensive error handling:
- Missing environment variables logged clearly
- API failures include response status and error text
- File system operations wrapped in try-catch
- Tests skip gracefully if dependencies not met

## Next Steps

1. Run image generation test: `npm test -- tests/generate-instagram-card.test.js`
2. Run Instagram posting test: `npm test -- tests/instagram-thumbgate-post.test.js`
3. Run full workflow test: `npm test -- tests/publish-instagram-thumbgate.test.js`
4. If all pass, trigger production workflow: `node scripts/social-analytics/publish-instagram-thumbgate.js`
