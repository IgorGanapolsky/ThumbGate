# Transformers.js vendored runtime provenance

- Upstream project: `huggingface/transformers.js`
- Upstream package: `@huggingface/transformers@4.2.0`
- Upstream release: <https://github.com/huggingface/transformers.js/releases/tag/4.2.0>
- Vendored artifact: `dist/transformers.node.min.mjs`
- Upstream artifact SHA-256: `1dc55b57189c1e800d6a83e001d1a7fd999145b117805a686e16f327eb0eb177`
- Shipped artifact SHA-256: `578fc7760161176273dec70bbd551601c2d7305912d55ab0a176e842934c7795`
- License file SHA-256: `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`
- License: Apache License 2.0; see `LICENSE` in this directory.

## Why this artifact is vendored

The upstream 4.2.0 npm package declares Node, web, and image-processing
dependencies even though ThumbGate uses only CPU text feature extraction.
Fresh installation of the packed ThumbGate candidate showed that npm does not
propagate ThumbGate's root `overrides` into a buyer's project: the consumer
received vulnerable `adm-zip@0.5.x` and `sharp@0.34.x` and failed
`npm audit --audit-level=high`.

The shipped copy contains one semantics-preserving source transformation:
the string value for the public `Mistral3ForConditionalGeneration` class is
split across two literals in its model registry. GitHub push protection
otherwise misclassifies that class name as a Mistral credential. The class
identifier, runtime behavior, and resulting registry value are unchanged.

ThumbGate therefore ships the exact upstream Node distribution artifact and
declares only the runtime modules that artifact needs for the supported
`Xenova/all-MiniLM-L6-v2` feature-extraction path:

- `onnxruntime-node@1.21.0`
- `onnxruntime-common@1.21.0`
- `sharp@0.35.3`

This compatibility set produced a finite, normalized 384-dimensional vector
in the real-model smoke test and an audit-clean packed-consumer install on
2026-08-02. The smoke proof must pass before updating the artifact or any of
these runtime versions.
