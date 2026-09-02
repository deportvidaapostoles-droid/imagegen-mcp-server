import { describe, it, expect, afterEach } from 'vitest';
import {
  formatErrorMessage,
  createErrorResponse,
  normalizeSharedImageUrl,
  parseImageInput,
  urlToBase64,
} from './utils.js';

describe('formatErrorMessage', () => {
  it('should format Error instances', () => {
    expect(formatErrorMessage(new Error('test error'))).toBe('test error');
  });

  it('should format non-Error values', () => {
    expect(formatErrorMessage('string error')).toBe('string error');
    expect(formatErrorMessage(42)).toBe('42');
    expect(formatErrorMessage(null)).toBe('null');
  });
});

describe('createErrorResponse', () => {
  it('should create error response with correct structure', () => {
    const response = createErrorResponse('something went wrong');

    expect(response.isError).toBe(true);
    expect(response.content).toHaveLength(1);
    expect(response.content[0].type).toBe('text');

    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('something went wrong');
  });
});

describe('parseImageInput', () => {
  it('should parse data URL', async () => {
    // 1x1 red PNG
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    const dataUrl = `data:image/png;base64,${base64}`;
    const result = await parseImageInput(dataUrl);
    expect(result.data).toBe(base64);
    expect(result.mimeType).toBe('image/png');
  });

  it('should parse raw base64 string', async () => {
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    const result = await parseImageInput(base64);
    expect(result.data).toBe(base64);
    expect(result.mimeType).toBe('image/png');
  });
});

describe('parseImageInput with URLs', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const respondWith = (body: Buffer, headers: Record<string, string>, ok = true, status = 200) => {
    globalThis.fetch = (async () =>
      ({
        ok,
        status,
        statusText: ok ? 'OK' : 'Not Found',
        headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      })) as unknown as typeof fetch;
  };

  it('fetches an https URL and returns base64', async () => {
    respondWith(Buffer.from('fake-png-bytes'), { 'content-type': 'image/png' });
    const result = await parseImageInput('https://example.com/photo.png');
    expect(result.mimeType).toBe('image/png');
    expect(Buffer.from(result.data, 'base64').toString()).toBe('fake-png-bytes');
  });

  it('strips charset parameters from the content type', async () => {
    respondWith(Buffer.from('x'), { 'content-type': 'image/jpeg; charset=binary' });
    await expect(parseImageInput('https://example.com/a.jpg')).resolves.toMatchObject({ mimeType: 'image/jpeg' });
  });

  it('rejects a URL that does not serve an image', async () => {
    respondWith(Buffer.from('<html>'), { 'content-type': 'text/html' });
    await expect(parseImageInput('https://example.com/page')).rejects.toThrow(/does not point to an image/);
  });

  it('rejects an image larger than the limit', async () => {
    respondWith(Buffer.from('x'), { 'content-type': 'image/png', 'content-length': String(50 * 1024 * 1024) });
    await expect(parseImageInput('https://example.com/huge.png')).rejects.toThrow(/too large/);
  });

  it('reports a failed request', async () => {
    respondWith(Buffer.alloc(0), {}, false, 404);
    await expect(parseImageInput('https://example.com/missing.png')).rejects.toThrow(/HTTP 404/);
  });

  it('still treats a bare string as base64', async () => {
    await expect(parseImageInput('aGVsbG8=')).resolves.toEqual({ data: 'aGVsbG8=', mimeType: 'image/png' });
  });
});

describe('file paths on a remote deployment', () => {
  const originalVercel = process.env.VERCEL;
  afterEach(() => {
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  });

  it('says what to do instead of failing with a bare ENOENT', async () => {
    process.env.VERCEL = '1';
    await expect(parseImageInput('/mnt/user-data/uploads/photo.png')).rejects.toThrow(
      /cannot read files on your machine.*\/u page.*recent_uploads/s
    );
  });

  it('still reads a real file when running locally', async () => {
    delete process.env.VERCEL;
    const { writeFile, mkdtemp, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = await mkdtemp(join(tmpdir(), 'imagegen-'));
    const file = join(dir, 'photo.png');
    await writeFile(file, Buffer.from('local-bytes'));
    try {
      const result = await parseImageInput(file);
      expect(Buffer.from(result.data, 'base64').toString()).toBe('local-bytes');
      expect(result.mimeType).toBe('image/png');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('adds the same guidance to a missing local file', async () => {
    delete process.env.VERCEL;
    await expect(parseImageInput('/definitely/not/here.png')).rejects.toThrow(/No such file/);
  });
});


describe('normalizeSharedImageUrl', () => {
  it('turns a Drive viewer link into a download link', () => {
    expect(normalizeSharedImageUrl('https://drive.google.com/file/d/1AbC-dEf/view?usp=sharing')).toBe(
      'https://drive.google.com/uc?export=download&id=1AbC-dEf'
    );
  });

  it('handles the older open?id= form', () => {
    expect(normalizeSharedImageUrl('https://drive.google.com/open?id=XyZ123')).toBe(
      'https://drive.google.com/uc?export=download&id=XyZ123'
    );
  });

  it('asks Dropbox for the file rather than the preview page', () => {
    const rewritten = new URL(
      normalizeSharedImageUrl('https://www.dropbox.com/scl/fi/abc/photo.jpg?rlkey=k&dl=0')
    );
    expect(rewritten.searchParams.get('raw')).toBe('1');
    expect(rewritten.searchParams.get('dl')).toBeNull();
    expect(rewritten.searchParams.get('rlkey')).toBe('k');
  });

  it('leaves a direct image URL and anything unparseable alone', () => {
    const direct = 'https://example.com/photo.png';
    expect(normalizeSharedImageUrl(direct)).toBe(direct);
    expect(normalizeSharedImageUrl('not a url')).toBe('not a url');
  });
});

describe('urlToBase64 failures', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('explains that an unshared Drive file is a sharing setting, not a bad link', async () => {
    globalThis.fetch = (async () =>
      new Response('<html>Sign in</html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })) as typeof fetch;

    await expect(
      urlToBase64('https://drive.google.com/file/d/1AbC-dEf/view')
    ).rejects.toThrow(/Anyone with the link/);
  });

  it('says Google Photos album links cannot be used at all', async () => {
    globalThis.fetch = (async () =>
      new Response('<html></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })) as typeof fetch;

    await expect(urlToBase64('https://photos.app.goo.gl/abc123')).rejects.toThrow(
      /Google Photos album links/
    );
  });
});
