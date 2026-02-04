#!/usr/bin/env node
/**
 * List available OpenAI models from API
 */
import { config } from 'dotenv';
import OpenAI from 'openai';

config();

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.error('Error: OPENAI_API_KEY not set in environment or .env file');
  process.exit(1);
}

async function listModels() {
  const client = new OpenAI({ apiKey });
  
  try {
    const models = await client.models.list();
    
    console.log('Available OpenAI Models:\n');
    console.log('='.repeat(80));
    
    // Filter for image-related models
    const imageModels = [];
    const otherModels = [];
    
    for await (const model of models) {
      if (model.id.includes('dall-e') || model.id.includes('image')) {
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
