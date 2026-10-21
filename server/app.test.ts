import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from './app';
import { openDatabase } from './db';
import { addDays, today, findProperties } from '../src/lib/model';
import { region } from '../src/lib/region';
import { voronoi, locateCell, project, nearestSite } from '../src/lib/algorithms';
let runtime: ReturnType<typeof createApplication>, directory: string;
const appHeader = { 'X-Little-Stay': '1', Origin: 'http://127.0.0.1:5173' };
const password = 'LittleStay123!';
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'little-stay-api-'));
  runtime = createApplication({
    databasePath: join(directory, 'test.sqlite'),
    uploadsPath: join(directory, 'uploads'),
  });
});
afterEach(() => {
  runtime?.close();
  rmSync(directory, { recursive: true, force: true });
});
async function login(email = 'alex') {
  const agent = supertest.agent(runtime.app);
  await agent
    .post('/api/auth/login')
    .set(appHeader)
    .send({ email: email + '@littlestay.local', password })
    .expect(200);
  return agent;
}
async function state(agent?: any) {
  return (await (agent ?? supertest(runtime.app)).get('/api/state').expect(200)).body;
}
const input = (pid = 'stay-010', offset = 30) => ({
  propertyId: pid,
  checkIn: addDays(today(), offset),
  checkOut: addDays(today(), offset + 3),
  guests: 2,
});
async function book(agent: any, pid = 'stay-010', offset = 30) {
  return (await agent.post('/api/bookings').set(appHeader).send(input(pid, offset)).expect(201))
    .body.id;
}
function listing() {
  const row = runtime.db.prepare("SELECT details FROM properties WHERE id='stay-001'").get() as any;
  return JSON.parse(row.details);
}

describe('full local API', () => {
  it('seeds 150 dense, geographically valid listings without leaking credentials or reservations', async () => {
    const d = await state();
    expect(d.properties).toHaveLength(150);
    expect(d.reservations).toEqual([]);
    expect(d.currentUser).toBeNull();
    expect(JSON.stringify(d)).not.toContain('password_hash');
    expect(d.users.every((u: any) => !u.email)).toBe(true);
    expect(
      d.properties.every(
        (p: any) =>
          p.lat >= region.bounds.south &&
          p.lat <= region.bounds.north &&
          p.lng >= region.bounds.west &&
          p.lng <= region.bounds.east,
      ),
    ).toBe(true);
    expect(d.properties.every((p: any) => !p.checkInInstructions)).toBe(true);
    const filters = {
      query: 'camarin blacony',
      maxPrice: 10000,
      guests: 1,
      amenities: [],
      checkIn: '',
      checkOut: '',
      sort: 'recommended',
    };
    const fuzzy = findProperties(d, filters);
    expect(fuzzy.length).toBeGreaterThan(0);
    expect(
      fuzzy.every(
        (r) => r.property.neighborhood === 'Camarin' && r.property.amenities.includes('Balcony'),
      ),
    ).toBe(true);
    const cells = voronoi(d.properties);
    for (let i = 1; i < 50; i++) {
      const point = project(14.73 + i * 0.001, 121.008 + i * 0.001);
      expect(locateCell(point, cells)).toBe(nearestSite(point, d.properties)?.id);
    }
  });
  it('creates real sessions, scopes guest/host records, and invalidates logout', async () => {
    const a = await login();
    const d = await state(a);
    expect(d.currentUser.id).toBe('guest-1');
    expect(d.reservations.every((r: any) => r.guestId === 'guest-1')).toBe(true);
    const h = await login('isabel'),
      hd = await state(h);
    expect(
      hd.reservations.every(
        (r: any) => hd.properties.find((p: any) => p.id === r.propertyId)?.hostId === 'host-1',
      ),
    ).toBe(true);
    await a.post('/api/auth/logout').set(appHeader).expect(200);
    expect((await state(a)).currentUser).toBeNull();
  });
  it('rejects bad passwords, missing sessions, cross-origin writes, and missing request headers', async () => {
    await supertest(runtime.app)
      .post('/api/auth/login')
      .set(appHeader)
      .send({ email: 'alex@littlestay.local', password: 'wrong' })
      .expect(401);
    await supertest(runtime.app).post('/api/bookings').set(appHeader).send(input()).expect(401);
    await supertest(runtime.app)
      .post('/api/auth/login')
      .set('Origin', 'https://unrelated.example')
      .set('X-Little-Stay', '1')
      .send({})
      .expect(403);
    await supertest(runtime.app).post('/api/auth/login').send({}).expect(403);
  });
  it('registers guests and pending hosts but never permits self-registration as admin', async () => {
    const a = supertest.agent(runtime.app);
    await a
      .post('/api/auth/register')
      .set(appHeader)
      .send({ name: 'New Host', email: 'new@example.test', password, role: 'host' })
      .expect(201);
    expect((await state(a)).currentUser.hostStatus).toBe('pending');
    await a.post('/api/properties').set(appHeader).send(listing()).expect(403);
    const admin = await login('admin'),
      uid = (await state(a)).currentUser.id;
    await admin
      .post(`/api/admin/users/${uid}`)
      .set(appHeader)
      .send({ action: 'approve' })
      .expect(200);
    expect((await state(a)).currentUser.hostStatus).toBe('approved');
    await supertest(runtime.app)
      .post('/api/auth/register')
      .set(appHeader)
      .send({ name: 'Admin intruder', email: 'intruder@example.test', password, role: 'admin' })
      .expect(400);
  });
  it('persists a profile update, changes passwords, and expires other sessions', async () => {
    const a = await login(),
      other = await login();
    await a
      .patch('/api/profile')
      .set(appHeader)
      .send({ name: 'Alex Updated', bio: 'A local traveler.' })
      .expect(200);
    expect((await state(a)).currentUser.name).toBe('Alex Updated');
    await a
      .post('/api/profile/password')
      .set(appHeader)
      .send({ currentPassword: 'wrong', newPassword: 'NewPassword123!' })
      .expect(400);
    await a
      .post('/api/profile/password')
      .set(appHeader)
      .send({ currentPassword: password, newPassword: 'NewPassword123!' })
      .expect(200);
    expect((await state(other)).currentUser).toBeNull();
    expect((await state(a)).currentUser.id).toBe('guest-1');
  });
  it('prevents overlapping concurrent reservations and permits adjacent stays', async () => {
    const a = await login(),
      b = await login('jamie');
    const requests = await Promise.all([
      a.post('/api/bookings').set(appHeader).send(input()),
      b.post('/api/bookings').set(appHeader).send(input()),
    ]);
    expect(requests.map((r) => r.status).sort()).toEqual([201, 409]);
    await b
      .post('/api/bookings')
      .set(appHeader)
      .send({ ...input(), checkIn: input().checkOut, checkOut: addDays(today(), 36) })
      .expect(201);
  });
  it('enforces capacity, future dates, role, and server-side approval on booking', async () => {
    const a = await login(),
      h = await login('isabel');
    await h.post('/api/bookings').set(appHeader).send(input()).expect(403);
    await a
      .post('/api/bookings')
      .set(appHeader)
      .send({ ...input(), guests: 20 })
      .expect(400);
    await a
      .post('/api/bookings')
      .set(appHeader)
      .send({ ...input(), checkIn: addDays(today(), -1) })
      .expect(400);
    const admin = await login('admin');
    await admin
      .post('/api/admin/properties/stay-010')
      .set(appHeader)
      .send({ action: 'suspend' })
      .expect(200);
    await a.post('/api/bookings').set(appHeader).send(input()).expect(409);
  });
  it('preserves booked rates and private instructions; cancelled bookings release nights', async () => {
    const a = await login(),
      bid = await book(a),
      d = await state(a),
      rate = d.reservations.find((r: any) => r.id === bid).nightlyRate;
    expect(d.properties.find((p: any) => p.id === 'stay-010').checkInInstructions).toBeTruthy();
    const h = await login('marco'),
      p = d.properties.find((p: any) => p.id === 'stay-010');
    await h
      .patch('/api/properties/stay-010')
      .set(appHeader)
      .send({ ...p, price: 9000 })
      .expect(200);
    expect((await state(a)).reservations.find((r: any) => r.id === bid).nightlyRate).toBe(rate);
    const b = await login('jamie');
    await b.post(`/api/bookings/${bid}/cancel`).set(appHeader).expect(404);
    await a.post(`/api/bookings/${bid}/cancel`).set(appHeader).expect(200);
    expect((await state(a)).calendar.some((c: any) => c.id === 'busy-' + bid)).toBe(false);
  });
  it('enforces listing ownership and admin approval after new listings and edits', async () => {
    const h = await login('isabel'),
      p = listing();
    await h.patch('/api/properties/stay-002').set(appHeader).send(p).expect(404);
    const created = await h
      .post('/api/properties')
      .set(appHeader)
      .send({ ...p, title: 'New Local Apartment' })
      .expect(201);
    expect((await state()).properties.some((p: any) => p.id === created.body.id)).toBe(false);
    const admin = await login('admin');
    await admin
      .post(`/api/admin/properties/${created.body.id}`)
      .set(appHeader)
      .send({ action: 'approve' })
      .expect(200);
    expect((await state()).properties.some((p: any) => p.id === created.body.id)).toBe(true);
    await h
      .patch(`/api/properties/${created.body.id}`)
      .set(appHeader)
      .send({ ...p, title: 'Edited Local Apartment' })
      .expect(200);
    expect((await state()).properties.some((p: any) => p.id === created.body.id)).toBe(false);
  });
  it('blocks and releases host availability while preventing overlap with bookings', async () => {
    const h = await login('marco'),
      a = await login(),
      v = { start: input().checkIn, end: input().checkOut, reason: 'Maintenance' };
    await h.post('/api/properties/stay-010/block').set(appHeader).send(v).expect(201);
    await a.post('/api/bookings').set(appHeader).send(input()).expect(409);
    const d = await state(h),
      block = d.calendar.find((c: any) => c.kind === 'blocked' && c.propertyId === 'stay-010');
    await h
      .delete('/api/blocks/' + block.id)
      .set(appHeader)
      .expect(200);
    await book(a);
    await h.post('/api/properties/stay-010/block').set(appHeader).send(v).expect(409);
  });
  it('stores favorites per account', async () => {
    const a = await login(),
      b = await login('jamie');
    await a.post('/api/favorites/stay-010').set(appHeader).expect(200);
    expect((await state(a)).favorites).toContain('stay-010');
    expect((await state(b)).favorites).not.toContain('stay-010');
    await a.post('/api/favorites/stay-010').set(appHeader).expect(200);
    expect((await state(a)).favorites).not.toContain('stay-010');
  });
  it('keeps guest/host conversations private and notifies the recipient', async () => {
    const a = await login(),
      b = await login('jamie'),
      h = await login('isabel');
    const tid = (
      await a.post('/api/threads').set(appHeader).send({ propertyId: 'stay-001' }).expect(200)
    ).body.id;
    await a
      .post(`/api/threads/${tid}/messages`)
      .set(appHeader)
      .send({ body: 'Is there a quiet workspace?' })
      .expect(201);
    expect((await state(h)).messages[0].body).toContain('workspace');
    expect((await state(h)).notifications.length).toBeGreaterThan(0);
    expect((await state(b)).messages).toEqual([]);
    await b
      .post(`/api/threads/${tid}/messages`)
      .set(appHeader)
      .send({ body: 'Intruding' })
      .expect(404);
    await h.post('/api/notifications/read').set(appHeader).expect(200);
    expect((await state(h)).notifications.every((n: any) => n.read)).toBe(true);
  });
  it('allows review once per completed own booking and supports moderation', async () => {
    const a = await login(),
      b = await login('jamie');
    await b
      .post('/api/reviews')
      .set(appHeader)
      .send({ bookingId: 'res-demo-3', rating: 5, body: 'Attempting another guest review.' })
      .expect(403);
    await a
      .post('/api/reviews')
      .set(appHeader)
      .send({ bookingId: 'res-demo-1', rating: 5, body: 'This stay has not completed yet.' })
      .expect(403);
    await b
      .post('/api/reviews')
      .set(appHeader)
      .send({ bookingId: 'res-demo-6', rating: 4, body: 'A comfortable and quiet local stay.' })
      .expect(201);
    await b
      .post('/api/reviews')
      .set(appHeader)
      .send({ bookingId: 'res-demo-6', rating: 4, body: 'Trying to review the same stay twice.' })
      .expect(409);
    const admin = await login('admin');
    await admin
      .post('/api/admin/reviews/review-demo-1')
      .set(appHeader)
      .send({ hidden: true })
      .expect(200);
    expect((await state()).reviews.some((r: any) => r.id === 'review-demo-1')).toBe(false);
  });
  it('records check-in and checkout only for the responsible host or admin', async () => {
    const h = await login('isabel'),
      other = await login('marco'),
      a = await login();
    await other
      .post('/api/bookings/res-demo-4/status')
      .set(appHeader)
      .send({ status: 'checked-in' })
      .expect(404);
    await a
      .post('/api/bookings/res-demo-4/status')
      .set(appHeader)
      .send({ status: 'checked-in' })
      .expect(404);
    await h
      .post('/api/bookings/res-demo-4/status')
      .set(appHeader)
      .send({ status: 'checked-in' })
      .expect(200);
    await h
      .post('/api/bookings/res-demo-4/status')
      .set(appHeader)
      .send({ status: 'completed' })
      .expect(200);
    expect((await state(a)).reservations.find((r: any) => r.id === 'res-demo-4').status).toBe(
      'completed',
    );
  });
  it('suspends accounts, removes host properties from search, and invalidates sessions', async () => {
    const admin = await login('admin'),
      h = await login('isabel');
    await admin
      .post('/api/admin/users/host-1')
      .set(appHeader)
      .send({ action: 'suspend' })
      .expect(200);
    expect((await state(h)).currentUser).toBeNull();
    expect((await state()).properties.every((p: any) => p.hostId !== 'host-1')).toBe(true);
    await admin
      .post('/api/admin/users/admin-1')
      .set(appHeader)
      .send({ action: 'suspend' })
      .expect(403);
  });
  it('validates image contents and upload access, and persists real photo bytes', async () => {
    const h = await login('isabel');
    await supertest(runtime.app)
      .post('/api/uploads')
      .set(appHeader)
      .attach('photos', Buffer.from('text'), 'bad.jpg')
      .expect(401);
    await h
      .post('/api/uploads')
      .set(appHeader)
      .attach('photos', Buffer.from('<svg/>'), 'bad.jpg')
      .expect(400);
    const image = readFileSync('public/images/apartment-1.jpg');
    const result = await h
      .post('/api/uploads')
      .set(appHeader)
      .attach('photos', image, 'room.jpg')
      .expect(201);
    expect(result.body.images[0]).toMatch(/^\/uploads\/[a-f0-9]{64}\.jpg$/);
    await supertest(runtime.app)
      .get(result.body.images[0])
      .expect(200)
      .expect('Content-Type', /image\/jpeg/);
  });
  it('reports occupancy with clipped dates and exports scoped CSV', async () => {
    const admin = await login('admin'),
      a = await login(),
      h = await login('isabel');
    const query = `?start=${addDays(today(), 5)}&end=${addDays(today(), 8)}`;
    const report = (await admin.get('/api/reports' + query).expect(200)).body;
    expect(report.totalBookings).toBe(1);
    expect(report.bookedValue).toBe(7200);
    expect(report.rows.find((r: any) => r.property === 'The Sunday Studio').occupancy).toBe(100);
    await a.get('/api/reports' + query).expect(403);
    const csv = await h.get('/api/reports' + query + '&format=csv').expect(200);
    expect(csv.text).toContain('The Sunday Studio');
    expect(csv.text).not.toContain('A Little Above the City');
  });
  it('backs up and restores all tables and images atomically, revoking sessions', async () => {
    const admin = await login('admin'),
      a = await login();
    const bid = await book(a);
    const host = await login('isabel');
    const uploaded = (
      await host
        .post('/api/uploads')
        .set(appHeader)
        .attach('photos', readFileSync('public/images/apartment-1.jpg'), 'room.jpg')
        .expect(201)
    ).body.images[0];
    await host
      .patch('/api/properties/stay-001')
      .set(appHeader)
      .send({ ...listing(), image: uploaded, images: [uploaded] })
      .expect(200);
    const backup = (await admin.get('/api/admin/backup').expect(200)).body;
    expect(backup.images).toHaveLength(1);
    expect(backup.tables.properties).toHaveLength(150);
    await a.post(`/api/bookings/${bid}/cancel`).set(appHeader).expect(200);
    await admin
      .post('/api/admin/restore')
      .set(appHeader)
      .attach('backup', Buffer.from(JSON.stringify(backup)), 'backup.json')
      .expect(200);
    expect((await state(admin)).currentUser).toBeNull();
    await supertest(runtime.app).get(uploaded).expect(200);
    const signedIn = await login();
    expect((await state(signedIn)).reservations.find((r: any) => r.id === bid).status).toBe(
      'confirmed',
    );
  });
  it('rejects malformed backups without altering existing data or sessions', async () => {
    const admin = await login('admin');
    await admin
      .post('/api/admin/restore')
      .set(appHeader)
      .attach('backup', Buffer.from('{"version":99}'), 'backup.json')
      .expect(400);
    expect((await state(admin)).currentUser.role).toBe('admin');
    expect((await state()).properties).toHaveLength(150);
  });
  it('persists data when the application process is reopened', async () => {
    const a = await login();
    await a
      .patch('/api/profile')
      .set(appHeader)
      .send({ name: 'Persistent Alex', bio: '' })
      .expect(200);
    runtime.close();
    runtime = createApplication({
      databasePath: join(directory, 'test.sqlite'),
      uploadsPath: join(directory, 'uploads'),
    });
    const current = await login();
    expect((await state(current)).currentUser.name).toBe('Persistent Alex');
    expect((await state()).properties).toHaveLength(150);
  });
  it('rolls back an invalid backup relationship without deleting active sessions', async () => {
    const admin = await login('admin');
    const backup = (await admin.get('/api/admin/backup')).body;
    backup.tables.reservations[0].guest_id = 'missing-user';
    await admin
      .post('/api/admin/restore')
      .set(appHeader)
      .attach('backup', Buffer.from(JSON.stringify(backup)), 'invalid.json')
      .expect(400);
    expect((await state(admin)).currentUser.role).toBe('admin');
    expect((await state()).properties).toHaveLength(150);
  });
  it('rate-limits repeated unsuccessful sign-ins', async () => {
    for (let i = 0; i < 6; i++)
      await supertest(runtime.app)
        .post('/api/auth/login')
        .set(appHeader)
        .send({ email: 'alex@littlestay.local', password: 'wrong' })
        .expect(401);
    await supertest(runtime.app)
      .post('/api/auth/login')
      .set(appHeader)
      .send({ email: 'alex@littlestay.local', password: 'wrong' })
      .expect(429);
  });
  it('escapes spreadsheet formulas in exported CSV', async () => {
    runtime.db.prepare("UPDATE properties SET title='=UNTRUSTED()' WHERE id='stay-001'").run();
    const admin = await login('admin');
    const result = await admin.get('/api/reports?format=csv').expect(200);
    expect(result.text).toContain("'=UNTRUSTED()");
  });
  it('refuses to downgrade a database from a newer schema', () => {
    runtime.db.exec('PRAGMA user_version=99');
    expect(() => openDatabase(join(directory, 'test.sqlite'))).toThrow(/newer schema/);
    expect((runtime.db.prepare('PRAGMA user_version').get() as any).user_version).toBe(99);
  });
});
