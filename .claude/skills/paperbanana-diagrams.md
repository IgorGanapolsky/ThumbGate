# Skill: PaperBanana Diagram Generation

## Description
Generate publication-quality architecture and methodology diagrams using Google's PaperBanana framework with Gemini. Use when the user needs professional diagrams for README, docs, or stakeholder presentations.

## Prerequisites
- Python 3.12+
- `pip install paperbanana` (community: llmsresearch/paperbanana)
- `GOOGLE_API_KEY` in `.env` (Gemini API key)

## Quick Generate (CLI)

```bash
# Basic diagram from text description
paperbanana generate \
    --input docs/diagrams/description.txt \
    --caption "MCP Memory Gateway Architecture" \
    --vlm-provider gemini \
    --optimize --auto \
    --output docs/diagrams/architecture.png

# Continue/refine a previous run
paperbanana generate --continue \
    --feedback "Make arrows thicker, increase contrast"
```

## Quick Generate (Python API)

```python
import asyncio
from paperbanana import PaperBananaPipeline, GenerationInput, DiagramType
from paperbanana.core.config import Settings

settings = Settings(
    vlm_provider="gemini",
    vlm_model="gemini-2.5-pro",
    image_provider="gemini",
    image_model="gemini-2.5-pro",
    optimize_inputs=True,
    auto_refine=True,
)

pipeline = PaperBananaPipeline(settings=settings)

result = asyncio.run(pipeline.generate(
    GenerationInput(
        source_context=open("docs/diagrams/rlhf-architecture.txt").read(),
        communicative_intent="System architecture showing the RLHF feedback capture, validation, memory promotion, and training export pipeline.",
        diagram_type=DiagramType.METHODOLOGY,
    )
))

# result.image_path contains the output PNG
```

## Workflow
1. Write a plain-text description of the system in `docs/diagrams/<name>.txt`
2. Run `paperbanana generate` with Gemini provider
3. Review output, refine with `--continue --feedback "..."`
4. Copy final PNG to `docs/diagrams/<name>.png`
5. Reference in README as `![Alt](docs/diagrams/<name>.png)`

## Config Override (configs/paperbanana.yaml)
```yaml
vlm:
  provider: gemini
  model: gemini-2.5-pro
image:
  provider: gemini
  model: gemini-2.5-pro
pipeline:
  num_retrieval_examples: 10
  refinement_iterations: 3
  output_resolution: "2k"
output:
  dir: docs/diagrams
  save_iterations: true
  save_metadata: true
```

## Tips
- Methodology text should describe components, data flow, and relationships
- Use `--optimize` to let the Planner agent improve your input
- Use `--auto` to let the Critic agent refine until satisfied
- For RLHF repo: generate both architecture overview and plugin topology diagrams
