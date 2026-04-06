# Amp: ThumbGate Feedback Skill Install

Install the ThumbGate skill for Amp in under 60 seconds. No manual file editing required.

## One-Command Install

```bash
cp plugins/amp-skill/SKILL.md .amp/skills/thumbgate-feedback.md
```

Or from the npm package:

```bash
npx thumbgate init
cp node_modules/thumbgate/plugins/amp-skill/SKILL.md .amp/skills/thumbgate-feedback.md
```

## What This Does

Copies the skill definition to `.amp/skills/` so Amp loads it automatically on next launch.

## Verify

After copying, restart Amp. The skill will appear in the active skills list.

Then test:

```bash
node .thumbgate/capture-feedback.js --feedback=up --context="amp skill install verified" --tags="install"
```

## Available Commands (via skill)

```bash
# Positive feedback
node .thumbgate/capture-feedback.js --feedback=up --context="..." --tags="..."

# Negative feedback
node .thumbgate/capture-feedback.js --feedback=down --context="..." --what-went-wrong="..." --what-to-change="..." --tags="..."
```

## Requirements

- Amp (any version with skills support)
- Node.js 18+ in PATH
- `.thumbgate/` directory (created by `npx thumbgate init`)

## Uninstall

```bash
rm .amp/skills/thumbgate-feedback.md
```
