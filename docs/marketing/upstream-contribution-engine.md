# Upstream Contribution Engine

Use this to earn developer trust by fixing repos ThumbGate actually depends on. This is not a spam lane.

Status: actionable
Repos scanned: 5
Issues ranked: 25
Autofix-ready: 11

## Guardrails

- Only target repos ThumbGate actually depends on or uses in shipped workflows.
- Do not create promotional PRs; fix real upstream issues with tests.
- Prefer small bugs, tests, docs, types, CI flakes, and security hardening over large feature work.
- Open external PRs only after reproduction evidence, a minimal patch, and upstream tests pass.
- Never paste secrets, customer data, or private ThumbGate context into upstream issues or PRs.

## Top Opportunities

- anthropics/anthropic-sdk-typescript#893 (55) Agent Skills: docx and pptx skills fail silently with streaming
  https://github.com/anthropics/anthropic-sdk-typescript/issues/893
  Branch: codex/upstream-anthropic-ai-sdk-893
- googleapis/js-genai#1321 (55) `sendMessage`/ `sendMessageStream` returns empty response when specific `systemInstruction` is used with `googleSearch` tool
  https://github.com/googleapis/js-genai/issues/1321
  Branch: codex/upstream-google-genai-1321
- googleapis/js-genai#1278 (55) error: Leaks detected:   - A fetch response body was created during the test, but not consumed during the test. Consume or close the response body `ReadableStream`, e.g `await resp.text()` or `await resp.body.cancel()`.
  https://github.com/googleapis/js-genai/issues/1278
  Branch: codex/upstream-google-genai-1278
- googleapis/js-genai#1259 (55) "Document has no pages" error with large pdf files via AWS signed urls Gemini 3 Flash/Pro Preview
  https://github.com/googleapis/js-genai/issues/1259
  Branch: codex/upstream-google-genai-1259
- huggingface/transformers.js#1590 (55) [webgpu] Whisper encoder fp16 precision issues
  https://github.com/huggingface/transformers.js/issues/1590
  Branch: codex/upstream-huggingface-transformers-1590
- anthropics/anthropic-sdk-typescript#1016 (45) [Vertex] anthropic-beta header forwarded to countTokens fallback fails on lagging model backends
  https://github.com/anthropics/anthropic-sdk-typescript/issues/1016
  Branch: codex/upstream-anthropic-ai-sdk-1016
- anthropics/anthropic-sdk-typescript#986 (45) partialParse in _vendor/partial-json-parser crashes on invalid JSON escape sequences from model output
  https://github.com/anthropics/anthropic-sdk-typescript/issues/986
  Branch: codex/upstream-anthropic-ai-sdk-986
- anthropics/anthropic-sdk-typescript#964 (45) Bug: `toolRunner` does not propagate `container.id` across iterations, and `setMessagesParams` causes duplicate tool call loops
  https://github.com/anthropics/anthropic-sdk-typescript/issues/964
  Branch: codex/upstream-anthropic-ai-sdk-964
- anthropics/anthropic-sdk-typescript#956 (45) Claude Opus 4.6 and Sonnet 4.6 fail to make parallel tool calls in Batch API
  https://github.com/anthropics/anthropic-sdk-typescript/issues/956
  Branch: codex/upstream-anthropic-ai-sdk-956
- googleapis/js-genai#1544 (45) gemini-3.1-flash-image-preview generation times are significantly slower than gemini-3-pro-image-preview
  https://github.com/googleapis/js-genai/issues/1544
  Branch: codex/upstream-google-genai-1544
- googleapis/js-genai#1492 (45) Bug: getFieldMasks() generates invalid protobuf FieldMask paths for ephemeral token lockAdditionalFields
  https://github.com/googleapis/js-genai/issues/1492
  Branch: codex/upstream-google-genai-1492
- huggingface/transformers.js#1667 (45) Error on translation
  https://github.com/huggingface/transformers.js/issues/1667
  Branch: codex/upstream-huggingface-transformers-1667
- huggingface/transformers.js#1653 (45) Bonsai 4B: Uncaught Error: Can't create a session. ERROR_CODE: 6, ERROR_MESSAGE: std::bad_alloc
  https://github.com/huggingface/transformers.js/issues/1653
  Branch: codex/upstream-huggingface-transformers-1653
- huggingface/transformers.js#1642 (45) Auto device on Linux x64 fails hard when CUDA shared library is unavailable instead of falling back
  https://github.com/huggingface/transformers.js/issues/1642
  Branch: codex/upstream-huggingface-transformers-1642
- huggingface/transformers.js#1640 (45) Illegal Instruction when running `pipeline` on Raspberry Pi 3 Model B (64-bit)
  https://github.com/huggingface/transformers.js/issues/1640
  Branch: codex/upstream-huggingface-transformers-1640
- changesets/changesets#1937 (37) changeset 2.30.0 bug
  https://github.com/changesets/changesets/issues/1937
  Branch: codex/upstream-changesets-changelog-github-1937
- changesets/changesets#1794 (37) Changeset fails on ignore pattern when there's no matches
  https://github.com/changesets/changesets/issues/1794
  Branch: codex/upstream-changesets-changelog-github-1794
- changesets/changesets#1937 (37) changeset 2.30.0 bug
  https://github.com/changesets/changesets/issues/1937
  Branch: codex/upstream-changesets-cli-1937
- changesets/changesets#1794 (37) Changeset fails on ignore pattern when there's no matches
  https://github.com/changesets/changesets/issues/1794
  Branch: codex/upstream-changesets-cli-1794
- changesets/changesets#1887 (22) Adding peer dependencies bumps 0.X.Y packages to 1.0.0
  https://github.com/changesets/changesets/issues/1887
  Branch: codex/upstream-changesets-changelog-github-1887

## Repo Search Queries

### @anthropic-ai/sdk -> anthropics/anthropic-sdk-typescript
- repo:anthropics/anthropic-sdk-typescript label:bug state:open
- repo:anthropics/anthropic-sdk-typescript label:"good first issue" state:open
- repo:anthropics/anthropic-sdk-typescript label:"help wanted" state:open
- repo:anthropics/anthropic-sdk-typescript bounty state:open
- repo:anthropics/anthropic-sdk-typescript security state:open
- Next: Clone/fork the top autofix-ready issue, produce a minimal patch, run upstream tests, then open PR with proof.

### @changesets/changelog-github -> changesets/changesets
- repo:changesets/changesets label:bug state:open
- repo:changesets/changesets label:"good first issue" state:open
- repo:changesets/changesets label:"help wanted" state:open
- repo:changesets/changesets bounty state:open
- repo:changesets/changesets security state:open
- Next: Clone/fork the top autofix-ready issue, produce a minimal patch, run upstream tests, then open PR with proof.

### @changesets/cli -> changesets/changesets
- repo:changesets/changesets label:bug state:open
- repo:changesets/changesets label:"good first issue" state:open
- repo:changesets/changesets label:"help wanted" state:open
- repo:changesets/changesets bounty state:open
- repo:changesets/changesets security state:open
- Next: Clone/fork the top autofix-ready issue, produce a minimal patch, run upstream tests, then open PR with proof.

### @google/genai -> googleapis/js-genai
- repo:googleapis/js-genai label:bug state:open
- repo:googleapis/js-genai label:"good first issue" state:open
- repo:googleapis/js-genai label:"help wanted" state:open
- repo:googleapis/js-genai bounty state:open
- repo:googleapis/js-genai security state:open
- Next: Clone/fork the top autofix-ready issue, produce a minimal patch, run upstream tests, then open PR with proof.

### @huggingface/transformers -> huggingface/transformers.js
- repo:huggingface/transformers.js label:bug state:open
- repo:huggingface/transformers.js label:"good first issue" state:open
- repo:huggingface/transformers.js label:"help wanted" state:open
- repo:huggingface/transformers.js bounty state:open
- repo:huggingface/transformers.js security state:open
- Next: Clone/fork the top autofix-ready issue, produce a minimal patch, run upstream tests, then open PR with proof.
