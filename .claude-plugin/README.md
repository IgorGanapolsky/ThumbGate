# ThumbGate for Claude Desktop

ThumbGate turns feedback into rule. History-aware lesson distillation reviews up to 8 prior recorded entries.

## Install
`claude mcp add thumbgate -- npx --yes --package thumbgate thumbgate serve`

## Downloads
- Bundle: https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-claude-desktop.mcpb
- Review zip: https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-claude-plugin-review.zip
- Privacy Policy: https://thumbgate-production.up.railway.app/privacy
- Product Hunt: https://www.producthunt.com/products/thumbgate

Marketplace:
```
/plugin marketplace add IgorGanapolsky/ThumbGate
/plugin install thumbgate@thumbgate-marketplace
```

## What It Does
`thumbs down` promotes a rule. `thumbs up` reinforces a workflow. Gates stop actions. 60-second follow-up links `relatedFeedbackId`.

## Configuration
Local OSS needs no API key. Host:
```json
{"mcpServers":{"thumbgate":{"command":"npx","args":["--yes","--package","thumbgate","thumbgate","serve"],"env":{"THUMBGATE_BASE_URL":"https://thumbgate-production.up.railway.app","THUMBGATE_API_KEY":"tg_YOUR_KEY_HERE"}}}}
```

## Examples
Block force-push. Capture `thumbs down` after an unsafe edit. Capture `thumbs up` after a PR

## Data Collection
Local installs store feedback and proof artifacts in project files. Hosted mode sends data to `THUMBGATE_BASE_URL`. Disable telemetry with `THUMBGATE_NO_TELEMETRY=1`.

## Support
Issues: https://github.com/IgorGanapolsky/ThumbGate/issues | Sec: https://github.com/IgorGanapolsky/ThumbGate/security

## Maintainers
- `npm run build:claude-mcpb`
- `npm run build:claude-review-zip`
