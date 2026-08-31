import { describe, it, expect } from 'vitest';
import { isUploadConfigured, normalizeImageContentType, storeImage, MAX_UPLOAD_BYTES } from './uploads.js';

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
