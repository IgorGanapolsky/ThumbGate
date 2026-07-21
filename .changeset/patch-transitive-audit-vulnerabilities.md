---
"thumbgate": patch
---

Patch protobufjs, js-yaml, adm-zip, and brace-expansion transitive dependency versions to clear npm audit for this repo's own root install (dev/CI), with no major-version bumps to any directly-used package. protobufjs is fixed for consumers too via a direct-dependency bump; js-yaml/brace-expansion only ever affected dev tooling. adm-zip (pulled in transitively via onnxruntime-node, install-time only, DoS-class) remains unfixed for consumers of the published package since npm overrides do not propagate past the root project — tracked as a follow-up pending an upstream onnxruntime-node/@huggingface/transformers bump.
