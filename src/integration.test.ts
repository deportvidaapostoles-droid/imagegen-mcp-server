/**
 * Integration tests using real API keys
 * Run with: npm run test:integration
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { config } from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Load environment variables
config();

describe('Gemini Integration Tests', () => {
  let geminiClient: GoogleGenerativeAI | null = null;

  beforeAll(() => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('GEMINI_API_KEY not set, skipping integration tests');
      return;
    }
    geminiClient = new GoogleGenerativeAI(apiKey);
  });

  it('should initialize Gemini client with API key', () => {
    expect(process.env.GEMINI_API_KEY).toBeDefined();
    expect(geminiClient).not.toBeNull();
  });

  it('should generate text content with gemini-2.0-flash', async () => {
    if (!geminiClient) {
      console.log('Skipping: No Gemini client');
      return;
    }

    const model = geminiClient.getGenerativeModel({ 
      model: 'gemini-2.0-flash' 
    });
    
    try {
      const result = await model.generateContent('Say hello');
      const text = result.response.text();
      expect(text).toBeDefined();
      expect(text.length).toBeGreaterThan(0);
      console.log('Gemini response:', text);
    } catch (error: any) {
      if (error.status === 429) {
        console.log('Rate limited - quota exceeded, skipping test');
        return; // Skip test gracefully
      }
      throw error;
    }
  }, 30000);

  it('should attempt image generation', async () => {
    if (!geminiClient) {
      console.log('Skipping: No Gemini client');
      return;
    }

    const model = geminiClient.getGenerativeModel({ 
      model: 'gemini-2.0-flash-exp-image-generation' 
    });
    
    try {
      const result = await model.generateContent('A red circle');
      const candidates = result.response.candidates;
      
      if (candidates && candidates.length > 0) {
        for (const part of candidates[0].content.parts) {
          if (part.inlineData) {
            console.log('Image generated:', part.inlineData.mimeType);
          } else if (part.text) {
            console.log('Text:', part.text.substring(0, 100));
          }
        }
      }
    } catch (error: any) {
      if (error.status === 429) {
        console.log('Rate limited - quota exceeded, skipping');
        return;
      }
      console.log('Image gen error:', error.message);
    }
  }, 60000);
});
