#!/usr/bin/env node
/**
 * List available Gemini models from Google AI API
 */
import { GoogleGenAI } from '@google/genai';
import { loadDotEnv, getServerRuntimeConfig } from './config.js';
loadDotEnv();
const config = getServerRuntimeConfig();
config.warnings.forEach((warning) => console.warn(`Config warning: ${warning}`));
if (config.provider !== 'gemini') {
    console.error('Error: This command requires IMAGEGEN_PROVIDER=gemini');
    process.exit(1);
}
const apiKey = config.geminiApiKey;
if (!apiKey) {
    console.error('Error: GEMINI_API_KEY not set');
    process.exit(1);
}
const ai = new GoogleGenAI({
    apiKey,
    httpOptions: config.geminiBaseUrl ? { baseUrl: config.geminiBaseUrl } : undefined,
});
async function listModels() {
    try {
        const pager = await ai.models.list({ config: { pageSize: 100 } });
        console.log('Available Gemini Models:\n');
        console.log('='.repeat(80));
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
        console.log('  - gemini-3.1-flash-image-preview (Nano Banana 2: versatile, up to 4K)');
        console.log('  - gemini-3.1-flash-lite-image (Nano Banana 2 Lite: fastest, cheapest)');
        console.log('  - gemini-3-pro-image (Nano Banana Pro: highest fidelity)');
    }
    catch (error) {
        console.error('Failed to fetch models:', error);
        process.exit(1);
    }
}
listModels();
//# sourceMappingURL=list-models.js.map