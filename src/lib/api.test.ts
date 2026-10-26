import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyData, getState, getStateOrder, request, uploadPhotos } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('API responses', () => {
  it('uploads eight photos as separate authenticated requests within function payload limits', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      expect(form.getAll('photos')).toHaveLength(1);
      expect(init.headers).toEqual({ 'X-Little-Stay': '1' });
      return Response.json({ images: [`/uploads/${(form.get('photos') as File).name}`] });
    });
    vi.stubGlobal('fetch', fetcher);
    const files = Array.from(
      { length: 8 },
      (_, i) => new File(['photo'], `${i}.jpg`, { type: 'image/jpeg' }),
    );
    expect(await uploadPhotos(files)).toEqual(files.map((file) => `/uploads/${file.name}`));
    expect(fetcher).toHaveBeenCalledTimes(8);
  });
  it('rejects oversized selections before uploading any files', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(
      uploadPhotos([
        new File(['small'], 'small.jpg'),
        new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'large.jpg'),
      ]),
    ).rejects.toThrow(/4 MB/);
    await expect(
      uploadPhotos(Array.from({ length: 9 }, () => new File(['photo'], 'room.jpg'))),
    ).rejects.toThrow(/eight/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects an HTML success response instead of treating it as application state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Proxy page</html>')));
    await expect(getState()).rejects.toThrow('did not return a valid response');
  });

  it('rejects malformed state returned with a successful status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Wrong service' })));
    await expect(getState()).rejects.toThrow('invalid application data');
  });

  it('shows a safe fallback when a failed response is null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(null, { status: 503 })));
    await expect(request('/state')).rejects.toThrow('The request failed.');
  });

  it('preserves server validation errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'Dates unavailable.' }, { status: 409 })),
    );
    await expect(request('/bookings', 'POST', {})).rejects.toThrow('Dates unavailable.');
  });

  it('orders state by request initiation when older polls resolve after newer account data', async () => {
    let finishOlder!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(() => new Promise<Response>((resolve) => (finishOlder = resolve)))
        .mockResolvedValueOnce(
          Response.json({
            ...emptyData,
            currentUser: { id: 'guest-new', name: 'New account', role: 'guest' },
          }),
        ),
    );
    const older = getState();
    const newer = await getState();
    finishOlder(Response.json(emptyData));
    expect(getStateOrder(await older)).toBeLessThan(getStateOrder(newer));
  });
});
