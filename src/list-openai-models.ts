#!/usr/bin/env node
/**
 * List available OpenAI models from API
 */
import OpenAI from 'openai';
import { loadDotEnv, resolveConfig } from './config.js';

loadDotEnv();
const runtimeConfig = resolveConfig();
runtimeConfig.warnings.forEach((warning) => console.warn(`Config warning: ${warning}`));

const apiKey = runtimeConfig.values.OPENAI_API_KEY;

if (!apiKey) {
  console.error('Error: OPENAI_API_KEY not set via CLI, environment, or .env file');
  process.exit(1);
}

async function listModels() {
  const client = new OpenAI({
    apiKey,
    baseURL: runtimeConfig.values.OPENAI_BASE_URL || undefined,
  });
  
  try {
    const models = await client.models.list();
    
    console.log('Available OpenAI Models:\n');
    console.log('='.repeat(80));
    
    // Filter for image-related models
    const imageModels = [];
    
    for await (const model of models) {
      if (
        model.id.includes('dall-e')
        || model.id.includes('image')
        || model.id.includes('doubao')
        || model.id.includes('seedream')
      ) {
        imageModels.push(model);
      }
    }
    
    console.log('\nImage Generation Models:');
    for (const model of imageModels) {
      console.log(`  - ${model.id}`);
    }
    
    console.log('\n' + '='.repeat(80));
    
  } catch (error) {
    console.error('Failed to fetch models:', error);
    process.exit(1);
  }
}

listModels();
