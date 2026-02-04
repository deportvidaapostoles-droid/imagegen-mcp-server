#!/usr/bin/env node
/**
 * List available Gemini models from Google AI API
 */
import { config } from 'dotenv';

config();

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error('Error: GEMINI_API_KEY not set in environment or .env file');
  process.exit(1);
}

async function listModels() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    console.log('Available Gemini Models:\n');
    console.log('=' .repeat(80));
    
    for (const model of data.models) {
      const name = model.name.replace('models/', '');
      const methods = model.supportedGenerationMethods?.join(', ') || 'N/A';
      
      console.log(`\nModel: ${name}`);
      console.log(`  Display: ${model.displayName}`);
      console.log(`  Methods: ${methods}`);
      if (model.description) {
        console.log(`  Desc: ${model.description.substring(0, 80)}...`);
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('\nRecommended for image generation:');
    console.log('  - gemini-2.0-flash (default, fast)');
    console.log('  - gemini-2.5-flash (latest)');
    console.log('  - gemini-2.0-flash-exp-image-generation (experimental)');
    
  } catch (error) {
    console.error('Failed to fetch models:', error);
    process.exit(1);
  }
}

listModels();
