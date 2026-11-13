/**
 * Hardware-Aware Hybrid Inference & VRAM/KV-Cache Router
 * 
 * Architectural implementations addressing the physical limits of local LLMs:
 * (Based on MakeUseOf analysis by Yadullah Abidi on VRAM ceilings, KV cache explosion,
 * and CPU-offload latency cliffs):
 * 
 * 1. Exact VRAM & KV-Cache Budgeting Engine (weights + dynamic attention cache)
 * 2. CPU-Offload Prevention Diode (prevents catastrophic tokens/sec latency drops)
 * 3. Dynamic Tier Escalation (routes context-heavy workloads to Cloud/Crusoe Inception GPUs)
 * 4. Quantization Precision Gate (prevents catastrophic accuracy loss in code/tool contracts)
 */

'use strict';

class HardwareAwareHybridRouter {
  constructor({
    localVramGb = 16.0,          // Local GPU VRAM ceiling (e.g. 16GB laptop / 32GB 5090)
    vramSafetyMargin = 0.15,      // 15% headroom for OS, display, and PyTorch/CUDA activation overhead
    cloudProvider = 'crusoe_inception' // Cloud failover target ($10k NVIDIA Inception pool)
  } = {}) {
    this.localVramGb = localVramGb;
    this.vramSafetyMargin = vramSafetyMargin;
    this.cloudProvider = cloudProvider;
  }

  /**
   * Computes the exact memory requirement for weights + KV attention cache.
   * 
   * KV Cache formula per token:
   * 2 (Key + Value) * layers * kv_heads * (hidden_size / attention_heads) * bytes_per_element
   */
  calculateMemoryFootprint({
    modelParamB,
    quantizationBits = 4, // default Q4_K_M
    contextTokens = 2048,
    numLayers = 32,
    hiddenSize = 4096,
    numAttentionHeads = 32,
    numKeyValueHeads = 8, // Grouped Query Attention (GQA)
    kvCacheQuantBits = 16 // FP16 KV cache standard
  }) {
    // 1. Model weights footprint (GB)
    const weightBytes = (modelParamB * 1e9 * (quantizationBits / 8));
    const weightGb = weightBytes / (1024 ** 3);

    // 2. KV Cache footprint (GB)
    const headDim = hiddenSize / numAttentionHeads;
    const bytesPerElement = kvCacheQuantBits / 8;
    const kvBytesPerToken = 2 * numLayers * numKeyValueHeads * headDim * bytesPerElement;
    const kvCacheBytes = kvBytesPerToken * contextTokens;
    const kvCacheGb = kvCacheBytes / (1024 ** 3);

    // 3. Activation & runtime buffer overhead
    const activationBufferGb = 0.8;

    const totalRequiredVramGb = weightGb + kvCacheGb + activationBufferGb;

    return {
      modelParamB,
      quantizationBits,
      contextTokens,
      weightGb: Number(weightGb.toFixed(2)),
      kvCacheGb: Number(kvCacheGb.toFixed(2)),
      activationBufferGb,
      totalRequiredVramGb: Number(totalRequiredVramGb.toFixed(2))
    };
  }

  /**
   * Evaluates whether a workload should execute locally or be escalated to Cloud/Crusoe
   * to avoid the catastrophic CPU offloading latency cliff.
   */
  routeInferenceWorkload({
    taskType = 'code_generation',
    modelParamB = 14,
    quantizationBits = 4,
    contextTokens = 8192,
    numLayers = 40,
    hiddenSize = 5120,
    numAttentionHeads = 40,
    numKeyValueHeads = 8
  }) {
    // 1. Quantization safety gate for code & tools
    const quantCheck = this.validateQuantizationPrecision({ taskType, quantizationBits });
    if (!quantCheck.allowed) {
      return {
        dispatchTier: 'CLOUD_ESCALATION',
        targetProvider: this.cloudProvider,
        reason: quantCheck.reason,
        offloadAvoided: true
      };
    }

    // 2. Calculate physical memory requirement
    const footprint = this.calculateMemoryFootprint({
      modelParamB,
      quantizationBits,
      contextTokens,
      numLayers,
      hiddenSize,
      numAttentionHeads,
      numKeyValueHeads
    });

    const usableVramGb = this.localVramGb * (1 - this.vramSafetyMargin);

    if (footprint.totalRequiredVramGb > usableVramGb) {
      return {
        dispatchTier: 'CLOUD_ESCALATION',
        targetProvider: this.cloudProvider,
        reason: `VRAM limit exceeded: Required ${footprint.totalRequiredVramGb}GB (Weights: ${footprint.weightGb}GB, KV Cache: ${footprint.kvCacheGb}GB) > Usable VRAM ${usableVramGb.toFixed(2)}GB (${this.localVramGb}GB ceiling - ${(this.vramSafetyMargin * 100)}% margin). CPU offload prevented to preserve latency.`,
        footprint,
        offloadAvoided: true
      };
    }

    return {
      dispatchTier: 'LOCAL_FAST_TIER',
      targetProvider: 'local_gpu',
      reason: `Workload fits within local VRAM: Required ${footprint.totalRequiredVramGb}GB <= Usable VRAM ${usableVramGb.toFixed(2)}GB. Zero CPU offload.`,
      footprint,
      offloadAvoided: false
    };
  }

  /**
   * Enforces precision floors: aggressive quantization (< 4 bits) degrades tool syntax
   * and structured JSON schema output, causing agent hallucination loops.
   */
  validateQuantizationPrecision({ taskType, quantizationBits }) {
    const sensitiveTasks = ['code_generation', 'tool_use', 'multi_agent_adjudication', 'security_audit'];
    
    if (sensitiveTasks.includes(taskType) && quantizationBits < 4) {
      return {
        allowed: false,
        reason: `Task '${taskType}' requires >= 4-bit quantization. ${quantizationBits}-bit introduces high AST syntax errors and contract violations.`
      };
    }

    return {
      allowed: true,
      reason: `Quantization ${quantizationBits}-bit acceptable for task '${taskType}'.`
    };
  }
}

module.exports = {
  HardwareAwareHybridRouter
};
