import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyData, getState, getStateOrder, request } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('API responses', () => {
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
