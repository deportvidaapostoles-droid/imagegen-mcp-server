import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getUploadSources,
  isUploadConfigured,
  normalizeImageContentType,
  resolveUploadSource,
  storeImage,
  MAX_UPLOAD_BYTES,
} from './uploads.js';

describe('uploads', () => {
  it('is disabled until a blob store is connected', () => {
    expect(isUploadConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isUploadConfigured({ BLOB_READ_WRITE_TOKEN: 'tok' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('accepts the supported image types and normalizes parameters', () => {
    expect(normalizeImageContentType('image/png')).toBe('image/png');
    expect(normalizeImageContentType('IMAGE/JPEG; charset=binary')).toBe('image/jpeg');
  });

  it('rejects anything that is not a supported image', () => {
    expect(() => normalizeImageContentType('application/pdf')).toThrow(/Only images/);
    expect(() => normalizeImageContentType('image/tiff')).toThrow(/Unsupported image type/);
    expect(() => normalizeImageContentType(undefined)).toThrow(/Only images/);
  });

  it('explains how to enable uploads instead of failing obscurely', async () => {
    await expect(storeImage(Buffer.from('x'), 'image/png', {} as NodeJS.ProcessEnv)).rejects.toThrow(
      /BLOB_READ_WRITE_TOKEN/
    );
  });

  it('refuses an empty or oversized file', async () => {
    const env = { BLOB_READ_WRITE_TOKEN: 'tok' } as NodeJS.ProcessEnv;
    await expect(storeImage(Buffer.alloc(0), 'image/png', env)).rejects.toThrow(/empty/);
    await expect(storeImage(Buffer.alloc(MAX_UPLOAD_BYTES + 1), 'image/png', env)).rejects.toThrow(/too large/);
  });
});

describe('private blob stores', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('@vercel/blob');
  });

  const env = { BLOB_READ_WRITE_TOKEN: 'tok' } as NodeJS.ProcessEnv;

  it('falls back to a signed URL when the store refuses a public blob', async () => {
    const put = vi.fn(async (pathname: string, _body: unknown, options: { access: string }) => {
      if (options.access === 'public') {
        throw new Error('Vercel Blob: Cannot use public access on a private store. The store is configured with private access.');
      }
      return { url: 'https://store.blob/private', pathname };
    });
    vi.doMock('@vercel/blob', () => ({
      put,
      issueSignedToken: vi.fn(async () => ({ clientSigningToken: 'c', delegationToken: 'd' })),
      presignUrl: vi.fn(async () => ({ presignedUrl: 'https://store.blob/private?signature=abc' })),
    }));
    const { storeImage } = await import('./uploads.js');
    const result = await storeImage(Buffer.from('bytes'), 'image/png', env);

    expect(put).toHaveBeenCalledTimes(2);
    expect(result.url).toContain('signature=abc');
    expect(new Date(result.expiresAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it('does not retry when the failure is not about private access', async () => {
    const put = vi.fn(async () => {
      throw new Error('Vercel Blob: quota exceeded');
    });
    vi.doMock('@vercel/blob', () => ({ put, issueSignedToken: vi.fn(), presignUrl: vi.fn() }));
    const { storeImage } = await import('./uploads.js');
    await expect(storeImage(Buffer.from('bytes'), 'image/png', env)).rejects.toThrow(/quota exceeded/);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('goes straight to a signed URL when BLOB_ACCESS=private', async () => {
    const put = vi.fn(async (pathname: string) => ({ url: 'https://store.blob/x', pathname }));
    vi.doMock('@vercel/blob', () => ({
      put,
      issueSignedToken: vi.fn(async () => ({ clientSigningToken: 'c', delegationToken: 'd' })),
      presignUrl: vi.fn(async () => ({ presignedUrl: 'https://store.blob/x?signature=zzz' })),
    }));
    const { storeImage } = await import('./uploads.js');
    const result = await storeImage(Buffer.from('bytes'), 'image/png', {
      ...env,
      BLOB_ACCESS: 'private',
    } as NodeJS.ProcessEnv);

    expect(put).toHaveBeenCalledTimes(1);
    expect(result.url).toContain('signature=zzz');
  });
});

describe('reading images back from our own store', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('@vercel/blob');
  });

  const env = { BLOB_READ_WRITE_TOKEN: 'tok' } as NodeJS.ProcessEnv;
  const streamOf = (bytes: Buffer) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes));
        controller.close();
      },
    });

  it('leaves someone else’s host alone', async () => {
    const { readStoredImage } = await import('./uploads.js');
    await expect(readStoredImage('https://example.com/photo.png', env)).resolves.toBeNull();
  });

  it('does nothing when no store is connected', async () => {
    const { readStoredImage } = await import('./uploads.js');
    await expect(
      readStoredImage('https://x.private.blob.vercel-storage.com/a.png', {} as NodeJS.ProcessEnv)
    ).resolves.toBeNull();
  });

  it('reads a private blob with the token, ignoring the signature in the query', async () => {
    const get = vi.fn(async () => ({
      statusCode: 200,
      stream: streamOf(Buffer.from('stored-bytes')),
      headers: new Headers({ 'content-type': 'image/jpeg' }),
    }));
    vi.doMock('@vercel/blob', () => ({ get }));
    const { readStoredImage } = await import('./uploads.js');

    const result = await readStoredImage(
      'https://x.private.blob.vercel-storage.com/imagegen/a.png?vercel-blob-signature=zzz',
      env
    );

    expect(get).toHaveBeenCalledWith('https://x.private.blob.vercel-storage.com/imagegen/a.png', {
      access: 'private',
      token: 'tok',
    });
    expect(Buffer.from(result!.data, 'base64').toString()).toBe('stored-bytes');
    expect(result!.mimeType).toBe('image/jpeg');
  });

  it('reports a blob that is gone rather than returning nothing', async () => {
    vi.doMock('@vercel/blob', () => ({ get: vi.fn(async () => null) }));
    const { readStoredImage } = await import('./uploads.js');
    await expect(
      readStoredImage('https://x.private.blob.vercel-storage.com/imagegen/gone.png', env)
    ).rejects.toThrow(/no longer available/);
  });
});


describe('upload sources', () => {
  const env = (value?: string) => ({ UPLOAD_SOURCES: value } as NodeJS.ProcessEnv);

  it('is off entirely when nothing is configured', () => {
    expect(getUploadSources({} as NodeJS.ProcessEnv)).toEqual([]);
    expect(resolveUploadSource(undefined, {} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(resolveUploadSource('anything', {} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it('turns configured labels into path-safe folders, accents and all', () => {
    expect(getUploadSources(env('Farmacia Paula, De Por Vida'))).toEqual([
      { id: 'farmacia-paula', label: 'Farmacia Paula' },
      { id: 'de-por-vida', label: 'De Por Vida' },
    ]);
    expect(getUploadSources(env('Almacén Ñandú'))[0].id).toBe('almacen-nandu');
  });

  it('drops blanks and duplicates rather than creating two folders for one shop', () => {
    expect(getUploadSources(env('Uno, ,uno,  Dos ')).map((source) => source.label)).toEqual(['Uno', 'Dos']);
  });

  it('resolves by label or by folder id, however the caller says it', () => {
    const configured = env('Farmacia Paula, De Por Vida');
    expect(resolveUploadSource('De Por Vida', configured)?.id).toBe('de-por-vida');
    expect(resolveUploadSource('de-por-vida', configured)?.id).toBe('de-por-vida');
    expect(resolveUploadSource('DE POR VIDA', configured)?.id).toBe('de-por-vida');
  });

  it('asks which shop rather than filing a photo under a guess', () => {
    const configured = env('Farmacia Paula, De Por Vida');
    expect(() => resolveUploadSource(undefined, configured)).toThrow(/Farmacia Paula, De Por Vida/);
    expect(() => resolveUploadSource('Kiosco', configured)).toThrow(/Unknown source 'Kiosco'/);
  });
});
