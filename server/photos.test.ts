import { afterEach, expect, it, vi } from 'vitest';
import { head, put, BlobNotFoundError } from '@vercel/blob';
import { blobPhotos } from './photos';

vi.mock('@vercel/blob', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@vercel/blob')>()),
  head: vi.fn(),
  put: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());
it('stores immutable content-hashed photos with explicit public access and correct MIME types', async () => {
  const store = blobPhotos('server-only-token');
  for (const [extension, contentType] of [
    ['jpg', 'image/jpeg'],
    ['png', 'image/png'],
    ['webp', 'image/webp'],
  ]) {
    const name = 'a'.repeat(64) + '.' + extension;
    const bytes = Buffer.from('encoded photo');
    await store.install(name, bytes);
    expect(put).toHaveBeenLastCalledWith(`uploads/${name}`, bytes, {
      token: 'server-only-token',
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
    });
  }
});
it('resolves durable photo URLs while distinguishing missing objects from storage outages', async () => {
  const store = blobPhotos('server-only-token');
  vi.mocked(head).mockResolvedValueOnce({
    url: 'https://store.public.blob.vercel-storage.com/uploads/photo.jpg',
  } as Awaited<ReturnType<typeof head>>);
  expect(await store.url('photo.jpg')).toBe(
    'https://store.public.blob.vercel-storage.com/uploads/photo.jpg',
  );
  expect(head).toHaveBeenLastCalledWith('uploads/photo.jpg', { token: 'server-only-token' });
  vi.mocked(head).mockRejectedValueOnce(new BlobNotFoundError());
  expect(await store.exists('missing.jpg')).toBe(false);
  vi.mocked(head).mockRejectedValueOnce(new Error('Storage offline'));
  await expect(store.url('photo.jpg')).rejects.toThrow('Storage offline');
});
