#!/usr/bin/env node
/**
 * List available Gemini models from Google AI API
 */
import { config } from 'dotenv';
import { GoogleGenAI } from '@google/genai';

config();

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error('Error: GEMINI_API_KEY not set in environment or .env file');
  process.exit(1);
}

const ai = new GoogleGenAI({
  apiKey,
  httpOptions: process.env.GEMINI_BASE_URL ? { baseUrl: process.env.GEMINI_BASE_URL } : undefined,
});

async function listModels() {
  try {
    const pager = await ai.models.list({ config: { pageSize: 100 } });

    console.log('Available Gemini Models:\n');
    console.log('=' .repeat(80));

    for await (const model of pager) {
      const name = (model.name || '').replace('models/', '');
      const methods = model.supportedActions?.join(', ') || 'N/A';

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
