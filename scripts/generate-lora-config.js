#!/usr/bin/env node
'use strict';

function generateLoraConfig(modelName = 'llama-3-8b') {
  return {
    base_model: modelName,
    adapter: 'lora',
    r: 8,
    lora_alpha: 16,
    lora_dropout: 0.05,
    target_modules: ['q_proj', 'v_proj'],
    training_data: './dist/training-data.jsonl'
  };
}

if (require.main === module) {
  console.log(JSON.stringify(generateLoraConfig()));
}

module.exports = { generateLoraConfig };
