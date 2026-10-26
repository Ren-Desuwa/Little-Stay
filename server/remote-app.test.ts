import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRemoteDatabase, RemoteDatabase } from './remote-db';
import { createApplication } from './app';
import type { PhotoStore } from './photos';
import { today, addDays } from '../src/lib/model';

let directory: string,
  first: ReturnType<typeof createApplication>,
  second: ReturnType<typeof createApplication>;
let databases: RemoteDatabase[];
const headers = { 'X-Little-Stay': '1', Origin: 'https://stay.example' };
const password = 'LittleStay123!';
const photos = new Map<string, Buffer>();
const photoStore: PhotoStore = {
  async install(name, bytes) {
    photos.set(name, bytes);
  },
  async exists(name) {
    return photos.has(name);
  },
  async url(name) {
    return photos.has(name) ? `https://store.public.blob.vercel-storage.com/uploads/${name}` : null;
  },
};
beforeEach(async () => {
  vi.stubEnv('PUBLIC_ORIGIN', 'https://stay.example');
  vi.stubEnv('LITTLE_STAY_SEED', 'demo');
  directory = mkdtempSync(join(tmpdir(), 'stay-remote-'));
  photos.clear();
  databases = [];
  const db = await openRemoteDatabase(`file:${join(directory, 'remote.sqlite')}`);
  const db2 = await openRemoteDatabase(`file:${join(directory, 'remote.sqlite')}`);
  databases.push(db, db2);
  const options = {
    databasePath: 'test-cloud-database',
    uploadsPath: '',
    photoStore,
    serverless: true,
  };
  first = createApplication({ ...options, database: db });
  second = createApplication({ ...options, database: db2 });
});
afterEach(() => {
  first?.close();
  second?.close();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});
async function cookie(app = first.app, email = 'alex') {
  const response = await supertest(app)
    .post('/api/auth/login')
    .set(headers)
    .set('X-Real-IP', '192.0.2.10')
    .send({ email: `${email}@littlestay.local`, password })
    .expect(200);
  return response.headers['set-cookie'][0].split(';')[0];
}
describe('Vercel storage path', () => {
  it('persists sessions and bookings across independent API instances and prevents double booking', async () => {
    const session = await cookie();
    const state = await supertest(second.app).get('/api/state').set('Cookie', session).expect(200);
    expect(state.body.currentUser.id).toBe('guest-1');
    expect(state.body.demo).toBe(true);
    const booking = {
      propertyId: 'stay-010',
      checkIn: addDays(today(), 60),
      checkOut: addDays(today(), 63),
      guests: 2,
    };
    const responses = await Promise.all(
      [first, second].map((runtime) =>
        supertest(runtime.app)
          .post('/api/bookings')
          .set(headers)
          .set('Cookie', session)
          .send(booking),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (await databases[0]
        .prepare("SELECT COUNT(*) AS n FROM reservations WHERE property_id='stay-010'")
        .get())!.n,
    ).toBe(1);
    await supertest(second.app)
      .post('/api/auth/logout')
      .set(headers)
      .set('Cookie', session)
      .expect(200);
    expect(
      (await supertest(first.app).get('/api/state').set('Cookie', session)).body.currentUser,
    ).toBeNull();
  });
  it('stores re-encoded photos outside the filesystem and resolves them after a cold start', async () => {
    const session = await cookie(first.app, 'isabel');
    const upload = await supertest(first.app)
      .post('/api/uploads')
      .set(headers)
      .set('Cookie', session)
      .attach('photos', readFileSync('public/images/apartment-1.jpg'), 'room.jpg')
      .expect(201);
    const name = upload.body.images[0].slice('/uploads/'.length);
    expect(photos.has(name)).toBe(true);
    await supertest(second.app)
      .get(`/api/uploads-file/${name}`)
      .expect(307)
      .expect('Location', `https://store.public.blob.vercel-storage.com/uploads/${name}`);
    await supertest(second.app).get('/api/uploads-file/missing.jpg').expect(404);
    await supertest(first.app)
      .post('/api/uploads')
      .set(headers)
      .set('Cookie', session)
      .attach('photos', readFileSync('public/images/apartment-1.jpg'), 'one.jpg')
      .attach('photos', readFileSync('public/images/apartment-1.jpg'), 'two.jpg')
      .expect(400);
  });
  it('shares login limits between instances and keeps separate visitors independent', async () => {
    for (let i = 0; i < 6; i++)
      await supertest((i % 2 ? first : second).app)
        .post('/api/auth/login')
        .set(headers)
        .set('X-Real-IP', '192.0.2.10')
        .send({ email: 'alex@littlestay.local', password: 'wrong' })
        .expect(401);
    await supertest(second.app)
      .post('/api/auth/login')
      .set(headers)
      .set('X-Real-IP', '192.0.2.10')
      .send({ email: 'alex@littlestay.local', password })
      .expect(429);
    await supertest(first.app)
      .post('/api/auth/login')
      .set(headers)
      .set('X-Real-IP', '192.0.2.11')
      .send({ email: 'alex@littlestay.local', password })
      .expect(200);
  });
  it('rolls back failed asynchronous writes without leaking them into another request context', async () => {
    await expect(
      databases[0].withTransaction(async () => {
        await databases[0].prepare("UPDATE users SET name='Uncommitted' WHERE id='guest-1'").run();
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(
      (await databases[1].prepare("SELECT name FROM users WHERE id='guest-1'").get())!.name,
    ).toBe('Alex Santos');
  });
});
