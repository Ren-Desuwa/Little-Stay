import { afterEach, expect, it, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import handler, { cloudApplication } from './vercel-handler';

afterEach(() => vi.unstubAllEnvs());
it('fails closed without cloud credentials and never falls back to a filesystem database', async () => {
  vi.stubEnv('TURSO_DATABASE_URL', '');
  const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await supertest(express().use(handler))
      .get('/api/health')
      .expect(503)
      .expect('Cache-Control', 'no-store')
      .expect({ error: 'Storage is unavailable. Check the deployment configuration.' });
    vi.stubEnv('TURSO_DATABASE_URL', 'file:/tmp/forbidden-fallback.sqlite');
    vi.stubEnv('TURSO_AUTH_TOKEN', 'test');
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'test');
    vi.stubEnv('PUBLIC_ORIGIN', 'https://stay.example');
    await expect(cloudApplication()).rejects.toThrow(/remote Turso/);
  } finally {
    logger.mockRestore();
  }
});
