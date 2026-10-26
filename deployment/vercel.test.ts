import { describe, expect, it } from 'vitest';
import { vercelConfig } from './vercel';

describe('Vercel application deployment', () => {
  it('runs the same-origin API in Vercel and routes photo requests without caching private data', () => {
    const config = vercelConfig();
    expect(config.framework).toBe('vite');
    expect(config.rewrites).toEqual([
      { source: '/api/:path*', destination: '/api' },
      { source: '/uploads/:path*', destination: '/api' },
    ]);
    expect(config.headers).toContainEqual({
      source: '/api/:path*',
      headers: [{ key: 'Cache-Control', value: 'no-store' }],
    });
    const csp = config.headers![0].headers.find(
      (header) => header.key === 'Content-Security-Policy',
    )!.value;
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("img-src 'self' data: blob: https:");
  });
});
