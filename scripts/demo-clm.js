#!/usr/bin/env node
const { SystemOneContrastiveGate } = require('./clm-contrastive-gate');

// Dummy embedder since we don't want to make real API calls in a fast script
const dummyEmbedder = {
  embed: async (text) => {
    // Return a deterministically pseudo-random 512-d vector based on text length
    const vec = new Array(512).fill(0).map((_, i) => Math.sin(text.length * i));
    return vec;
  }
};

async function run() {
  console.log("🔥 Initializing CLM System One Gate Engine...");
  const gate = new SystemOneContrastiveGate(dummyEmbedder);
  
  const rules = {
    allow: "Benign file read or status check.",
    warn: "Modifying configuration files requires attention but is generally permitted.",
    block: "Deleting the root directory or dropping databases is strictly forbidden."
  };

  const state = "The user wants to execute 'rm -rf /' in Bash.";
  
  console.log("\n[State]:", state);
  console.log("[Warming up Action Cache]...");
  const start = Date.now();
  await gate.warmup(rules);
  console.log(`Cache warmed in ${Date.now() - start}ms.`);

  const evalStart = Date.now();
  const rankings = await gate.evaluate(state, rules);
  const latency = Date.now() - evalStart;
  
  console.log(`\n[CLM Ranker Results] (Latency: ${latency}ms):`);
  rankings.forEach(r => console.log(` - ${r.candidate}: ${(r.prob * 100).toFixed(2)}%`));
  
  console.log("\nNote: Embeddings here are deterministic dummies. In production, this uses ThumbGate's Matryoshka models.");
}

run().catch(console.error);
