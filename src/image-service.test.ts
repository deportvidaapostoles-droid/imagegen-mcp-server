import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImageService } from './image-service.js';
import { getServerRuntimeConfig } from './config.js';

const config = (env: Record<string, string>) =>
  getServerRuntimeConfig([], { IMAGEGEN_PROVIDER: 'gemini', GEMINI_API_KEY: 'gm-key', ...env } as NodeJS.ProcessEnv);

/** Replace the provider call with a stub, leaving the retry policy under test. */
function serviceWithGemini(generateContent: () => Promise<unknown>) {
  const service = new ImageService(config({}));
  (service as any).gemini = { models: { generateContent } };
  return service;
}

const oneImage = async () => ({
  candidates: [{ content: { parts: [{ inlineData: { data: 'aW1n', mimeType: 'image/png' } }] } }],
});

describe('retrying a busy provider', () => {
  beforeEach(() => vi.useRealTimers());

  it('retries a 503 and succeeds', async () => {
    let calls = 0;
    const service = serviceWithGemini(async () => {
      calls += 1;
      if (calls === 1) throw new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}');
      return oneImage();
    });

    const content = await service.generate({ prompt: 'a cat', timeout: 30_000 });
    expect(calls).toBe(2);
    expect(content.some((block) => block.type === 'image')).toBe(true);
  });

  it('gives up after the attempt limit and surfaces the provider message', async () => {
    let calls = 0;
    const service = serviceWithGemini(async () => {
      calls += 1;
      throw new Error('503 UNAVAILABLE: high demand');
    });

    await expect(service.generate({ prompt: 'a cat', timeout: 30_000 })).rejects.toThrow(/high demand/);
    expect(calls).toBe(3);
  });

  it('does not retry a request the provider rejected on its merits', async () => {
    let calls = 0;
    const service = serviceWithGemini(async () => {
      calls += 1;
      throw new Error('400 INVALID_ARGUMENT: Base64 decoding failed');
    });

    await expect(service.generate({ prompt: 'a cat', timeout: 30_000 })).rejects.toThrow(/INVALID_ARGUMENT/);
    expect(calls).toBe(1);
  });

  it('does not retry when the timeout leaves no room for the wait', async () => {
    let calls = 0;
    const service = serviceWithGemini(async () => {
      calls += 1;
      throw new Error('503 high demand');
    });

    await expect(service.generate({ prompt: 'a cat', timeout: 1000 })).rejects.toThrow(/high demand/);
    expect(calls).toBe(1);
  });
});
