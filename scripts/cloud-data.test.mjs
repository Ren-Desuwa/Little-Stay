import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { openDatabase, seedDatabase } from '../server/db.ts';
import { backupCloud, migrateCloud, referencedPhotos } from './cloud-data.mjs';

const { blobs } = vi.hoisted(() => ({ blobs: new Map() }));
vi.mock('@vercel/blob', () => ({
  head: vi.fn(async (path) => {
    if (!blobs.has(path)) throw new Error('Missing blob');
    return { url: `https://test.public.blob.vercel-storage.com/${path}` };
  }),
  put: vi.fn(async (path, bytes) => {
    blobs.set(path, bytes);
    return { url: `https://test.public.blob.vercel-storage.com/${path}` };
  }),
}));
let root, source, env;
const photo = 'a'.repeat(64) + '.jpg';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'stay-cloud-data-'));
  source = join(root, 'source');
  mkdirSync(join(source, 'uploads'), { recursive: true });
  blobs.clear();
  env = {
    TURSO_DATABASE_URL: `file:${join(root, 'cloud.sqlite')}`,
    TURSO_AUTH_TOKEN: 'test-token',
    BLOB_READ_WRITE_TOKEN: 'test-blob-token',
    LITTLE_STAY_SEED: 'demo',
  };
  const db = openDatabase(join(source, 'little-stay.sqlite'));
  try {
    seedDatabase(db);
    db.prepare('INSERT INTO google_identities VALUES(?,?)').run(
      'preserved-google-subject',
      'guest-1',
    );
    const property = JSON.parse(
      db.prepare("SELECT details FROM properties WHERE id='stay-001'").get().details,
    );
    property.images = [`/uploads/${photo}`];
    property.image = property.images[0];
    db.prepare("UPDATE properties SET details=? WHERE id='stay-001'").run(JSON.stringify(property));
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(
      'source-session',
      'guest-1',
      Date.now() + 60000,
    );
  } finally {
    db.close();
  }
  writeFileSync(join(source, 'uploads', photo), 'original photo bytes');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const path = new URL(url).pathname.slice(1);
      return new Response(blobs.get(path), { status: blobs.has(path) ? 200 : 404 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

it('imports local data, backs up a consistent cloud snapshot with photos, and restores to an empty database', async () => {
  expect(await migrateCloud(source, env)).toEqual({ users: 5, properties: 50, photos: 1 });
  const client = createClient({ url: env.TURSO_DATABASE_URL });
  try {
    expect((await client.execute('SELECT COUNT(*) AS n FROM sessions')).rows[0].n).toBe(0);
    const folder = await backupCloud(join(root, 'backups'), env);
    const snapshot = JSON.parse(readFileSync(join(folder, 'snapshot.json'), 'utf8'));
    expect(snapshot.tables.users).toHaveLength(5);
    expect(snapshot.tables.reservations).toHaveLength(6);
    expect(snapshot.tables.google_identities).toEqual([
      { subject: 'preserved-google-subject', user_id: 'guest-1' },
    ]);
    expect(snapshot.tables.sessions).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toContain('test-token');
    expect(readFileSync(join(folder, 'uploads', photo), 'utf8')).toBe('original photo bytes');
    expect(statSync(folder).mode & 0o777).toBe(0o700);
    const restored = { ...env, TURSO_DATABASE_URL: `file:${join(root, 'restored.sqlite')}` };
    expect(await migrateCloud(folder, restored)).toEqual({ users: 5, properties: 50, photos: 1 });
    await expect(migrateCloud(source, env)).rejects.toThrow(/not empty/);
    expect((await client.execute('SELECT COUNT(*) AS n FROM users')).rows[0].n).toBe(5);
  } finally {
    client.close();
  }
});
it('refuses missing photos and accidental publication of demo passwords before creating a destination', async () => {
  await expect(migrateCloud(source, { ...env, LITTLE_STAY_SEED: '' })).rejects.toThrow(
    /demo passwords/,
  );
  rmSync(join(source, 'uploads', photo));
  await expect(migrateCloud(source, env)).rejects.toThrow(/Missing source photo/);
  expect(existsSync(join(root, 'cloud.sqlite'))).toBe(false);
  expect(() =>
    referencedPhotos({
      properties: [{ details: JSON.stringify({ image: '/uploads/../../secret' }) }],
    }),
  ).toThrow(/Invalid/);
});
it('does not leave a successful-looking backup when a referenced photo cannot be downloaded', async () => {
  await migrateCloud(source, env);
  blobs.clear();
  await expect(backupCloud(join(root, 'backups'), env)).rejects.toThrow(/Missing blob/);
  expect(readdirSync(join(root, 'backups'))).toEqual([]);
});
