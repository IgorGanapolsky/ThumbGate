---
"thumbgate": patch
---

Implement and test vLLM v0.33.0rc3 (Nov 2, 2026) high-ROI serving improvements from Mistral Large 4 (Oct 29, 2026) and DeepSeek-V4.1-Flash (Oct 23, 2026): HiSparse host-memory sparse KV offload planner with cross-layer KV deduplication (+14.3% host token capacity, 4.45x startup / 5.71x steady-state) and single-node MNNVL crash guard (vllm#64327), DSpark probabilistic draft sampling for T>1.0 (+12-22% throughput via lossless rejection sampling) and DCP8 0.69x draft block-ID capacity bound, cached-prefix prefill optimization (+43.9% at 64K via Layer-20 SWA 128-token bounded replay + 2MB NUMA pages + DeepSelect top-k), heterogeneous target/draft EPLB (0.94/0.89 balancedness), and 826 tok/s low-latency specialized decode megakernel with 10s sticky-fault fail-stop word.
