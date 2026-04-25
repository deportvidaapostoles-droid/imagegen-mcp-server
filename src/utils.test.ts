import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  urlToBase64,
  openAIImageToBase64,
  formatErrorMessage,
  createSuccessResponse,
  createErrorResponse,
} from './utils.js';

describe('urlToBase64', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should convert URL to base64 successfully', async () => {
    const mockImageData = new Uint8Array([137, 80, 78, 71]); // PNG magic bytes
    const mockResponse = {
      ok: true,
      arrayBuffer: () => Promise.resolve(mockImageData.buffer),
      headers: new Map([['content-type', 'image/png']]),
    };
    mockResponse.headers.get = (key: string) => 
      key === 'content-type' ? 'image/png' : null;

    vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

    const result = await urlToBase64('https://example.com/image.png');

    expect(result.mimeType).toBe('image/png');
    expect(result.data).toBe(Buffer.from(mockImageData).toString('base64'));
  });

  it('should use default mime type when content-type header is missing', async () => {
    const mockImageData = new Uint8Array([255, 216, 255]); // JPEG magic bytes
    const mockResponse = {
      ok: true,
      arrayBuffer: () => Promise.resolve(mockImageData.buffer),
      headers: new Map(),
    };
    mockResponse.headers.get = () => null;

    vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

    const result = await urlToBase64('https://example.com/image.jpg');

    expect(result.mimeType).toBe('image/png'); // default
  });

  it('should throw error when fetch fails', async () => {
    const mockResponse = {
      ok: false,
      statusText: 'Not Found',
    };

    vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

    await expect(urlToBase64('https://example.com/notfound.png'))
      .rejects.toThrow('Failed to fetch image: Not Found');
  });

  it('should throw error when network error occurs', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    await expect(urlToBase64('https://example.com/image.png'))
      .rejects.toThrow('Failed to convert URL to base64: Network error');
  });
});

describe('formatErrorMessage', () => {
  it('should format Error instance correctly', () => {
    const error = new Error('Test error message');
    expect(formatErrorMessage(error)).toBe('Test error message');
  });

  it('should convert string to string', () => {
    expect(formatErrorMessage('String error')).toBe('String error');
  });

  it('should convert number to string', () => {
    expect(formatErrorMessage(404)).toBe('404');
  });

  it('should convert object to string', () => {
    expect(formatErrorMessage({ code: 'ERR' })).toBe('[object Object]');
  });

  it('should handle null', () => {
    expect(formatErrorMessage(null)).toBe('null');
  });

  it('should handle undefined', () => {
    expect(formatErrorMessage(undefined)).toBe('undefined');
  });
});

describe('openAIImageToBase64', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return base64 data directly when b64_json is present', async () => {
    const result = await openAIImageToBase64({ b64_json: 'ZmFrZS1pbWFnZQ==' });

    expect(result).toEqual({
      data: 'ZmFrZS1pbWFnZQ==',
      mimeType: 'image/png',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should fetch image data when only url is present', async () => {
    const mockImageData = new Uint8Array([137, 80, 78, 71]);
    const mockResponse = {
      ok: true,
      arrayBuffer: () => Promise.resolve(mockImageData.buffer),
      headers: new Map([['content-type', 'image/png']]),
    };
    mockResponse.headers.get = (key: string) =>
      key === 'content-type' ? 'image/png' : null;

    vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response);

    const result = await openAIImageToBase64({ url: 'https://example.com/image.png' });

    expect(result).toEqual({
      data: Buffer.from(mockImageData).toString('base64'),
      mimeType: 'image/png',
    });
  });

  it('should return null when image payload has no data', async () => {
    await expect(openAIImageToBase64({})).resolves.toBeNull();
  });
});

describe('createSuccessResponse', () => {
  it('should create properly formatted success response', () => {
    const data = { success: true, message: 'OK' };
    const response = createSuccessResponse(data);

    expect(response.content).toHaveLength(1);
    expect(response.content[0].type).toBe('text');
    expect(JSON.parse(response.content[0].text)).toEqual(data);
  });

  it('should format JSON with indentation', () => {
    const data = { key: 'value' };
    const response = createSuccessResponse(data);

    expect(response.content[0].text).toBe(JSON.stringify(data, null, 2));
  });
});

describe('createErrorResponse', () => {
  it('should create properly formatted error response', () => {
    const response = createErrorResponse('Something went wrong');

    expect(response.isError).toBe(true);
    expect(response.content).toHaveLength(1);
    expect(response.content[0].type).toBe('text');
    
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('Something went wrong');
  });
});
