#!/usr/bin/env node
/**
 * List available OpenAI models from API
 */
import OpenAI from 'openai';
import { loadDotEnv, getServerRuntimeConfig } from './config.js';
loadDotEnv();
const config = getServerRuntimeConfig();
config.warnings.forEach((warning) => console.warn(`Config warning: ${warning}`));
if (config.provider !== 'openai') {
    console.error('Error: This command requires IMAGEGEN_PROVIDER=openai');
    process.exit(1);
}
const apiKey = config.openaiApiKey;
if (!apiKey) {
    console.error('Error: OPENAI_API_KEY not set');
    process.exit(1);
}
async function listModels() {
    const client = new OpenAI({
        apiKey,
        baseURL: config.openaiBaseUrl || undefined,
    });
    try {
        const models = await client.models.list();
        console.log('Available OpenAI Models:\n');
        console.log('='.repeat(80));
        const imageModels = [];
        for await (const model of models) {
            if (model.id.includes('dall-e')
                || model.id.includes('image')
                || model.id.includes('doubao')
                || model.id.includes('seedream')) {
                imageModels.push(model);
            }
        }
        console.log('\nImage Generation Models:');
        for (const model of imageModels) {
            console.log(`  - ${model.id}`);
        }
        console.log('\n' + '='.repeat(80));
    }
    catch (error) {
        console.error('Failed to fetch models:', error);
        process.exit(1);
    }
}
listModels();
//# sourceMappingURL=list-openai-models.js.map