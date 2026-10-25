import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from './app';
import { openDatabase } from './db';
import { addDays, today, findProperties } from '../src/lib/model';
import { region } from '../src/lib/region';
import { voronoi, locateCell, project, nearestSite } from '../src/lib/algorithms';
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, writeFileSync: vi.fn(actual.writeFileSync) };
});
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
  it('sets the standard referrer policy needed to identify web map tile requests', async () => {
    await supertest(runtime.app)
      .get('/api/health')
      .expect('Referrer-Policy', 'strict-origin-when-cross-origin')
      .expect(200);
  });
  it('seeds 50 dense, geographically valid listings without leaking credentials or reservations', async () => {
    const d = await state();
    expect(d.properties).toHaveLength(50);
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
    expect(hd.properties.length).toBeGreaterThan(0);
    expect(hd.properties.every((p: any) => p.hostId === hd.currentUser.id)).toBe(true);
    const secondHost = await login('marco');
    const secondState = await state(secondHost);
    expect(secondState.properties.length).toBeGreaterThan(0);
    expect(secondState.properties.every((p: any) => p.hostId === secondState.currentUser.id)).toBe(
      true,
    );
    await h.post('/api/bookings').set(appHeader).send(input()).expect(403);
    await secondHost.post('/api/bookings').set(appHeader).send(input()).expect(403);
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
  it('accepts eight-character passwords and rejects shorter passwords for registration and changes', async () => {
    const agent = supertest.agent(runtime.app);
    const account = { name: 'Password Boundary', email: 'boundary@example.test', role: 'guest' };
    await agent
      .post('/api/auth/register')
      .set(appHeader)
      .send({ ...account, password: 'Seven12' })
      .expect(400);
    await agent
      .post('/api/auth/register')
      .set(appHeader)
      .send({ ...account, password: 'Eight123' })
      .expect(201);
    await agent
      .post('/api/profile/password')
      .set(appHeader)
      .send({ currentPassword: 'Eight123', newPassword: 'Seven12' })
      .expect(400);
    await agent
      .post('/api/profile/password')
      .set(appHeader)
      .send({ currentPassword: 'Eight123', newPassword: 'NewPass8' })
      .expect(200);
    await agent.post('/api/auth/logout').set(appHeader).expect(200);
    await agent
      .post('/api/auth/login')
      .set(appHeader)
      .send({ email: account.email, password: 'NewPass8' })
      .expect(200);
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
  it('keeps private instructions hidden after a cancelled booking on an unpublished listing', async () => {
    const guest = await login();
    const bookingId = await book(guest);
    const host = await login('marco');
    await host
      .post('/api/properties/stay-010/publish')
      .set(appHeader)
      .send({ published: false })
      .expect(200);
    expect(
      (await state(guest)).properties.find((p: any) => p.id === 'stay-010').checkInInstructions,
    ).toBeTruthy();
    await guest.post(`/api/bookings/${bookingId}/cancel`).set(appHeader).expect(200);
    const property = (await state(guest)).properties.find((p: any) => p.id === 'stay-010');
    expect(property).toMatchObject({ published: false });
    expect(property).not.toHaveProperty('checkInInstructions');
  });
  it('rejects a cover image outside the listing gallery', async () => {
    const host = await login('isabel');
    await host
      .post('/api/properties')
      .set(appHeader)
      .send({ ...listing(), image: '/images/apartment-6.jpg', images: ['/images/apartment-1.jpg'] })
      .expect(400);
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
    const edited = (await state(h)).properties.find((p: any) => p.id === created.body.id);
    expect(edited).toMatchObject({
      title: 'Edited Local Apartment',
      hostId: 'host-1',
      approval: 'pending',
    });
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
  it('prevents new favorites and conversations for suspended hosts while allowing favorite removal', async () => {
    const guest = await login();
    await guest.post('/api/favorites/stay-001').set(appHeader).expect(200);
    const admin = await login('admin');
    await admin
      .post('/api/admin/users/host-1')
      .set(appHeader)
      .send({ action: 'suspend' })
      .expect(200);
    await guest.post('/api/favorites/stay-001').set(appHeader).expect(200);
    expect((await state(guest)).favorites).not.toContain('stay-001');
    await guest.post('/api/favorites/stay-001').set(appHeader).expect(404);
    await guest.post('/api/threads').set(appHeader).send({ propertyId: 'stay-001' }).expect(404);
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
  it('preserves existing uploaded image bytes when a replacement write fails partway through', async () => {
    const host = await login('isabel');
    const image = readFileSync('public/images/apartment-1.jpg');
    const uploaded = (
      await host.post('/api/uploads').set(appHeader).attach('photos', image, 'room.jpg').expect(201)
    ).body.images[0];
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      vi.mocked(writeFileSync).mockImplementationOnce((path) => {
        actual.writeFileSync(path, 'partial image');
        throw Object.assign(new Error('Simulated full disk.'), { code: 'ENOSPC' });
      });
      await host
        .post('/api/uploads')
        .set(appHeader)
        .attach('photos', image, 'room.jpg')
        .expect(500);
      expect(readFileSync(join(directory, uploaded))).toEqual(image);
      expect(readdirSync(join(directory, 'uploads'))).toEqual([uploaded.slice('/uploads/'.length)]);
    } finally {
      logged.mockRestore();
      vi.mocked(writeFileSync).mockReset().mockImplementation(actual.writeFileSync);
    }
  });
  it('allows eight images and rejects extra multipart fields and oversized request bodies', async () => {
    const host = await login('isabel');
    const image = readFileSync('public/images/apartment-1.jpg');
    let request = host.post('/api/uploads').set(appHeader);
    for (let i = 0; i < 8; i++) request = request.attach('photos', image, `room-${i}.jpg`);
    expect((await request.expect(201)).body.images).toHaveLength(8);
    await host
      .post('/api/uploads')
      .set(appHeader)
      .field('unused', 'value')
      .attach('photos', image, 'room.jpg')
      .expect(400);
    await supertest(runtime.app)
      .post('/api/auth/login')
      .set(appHeader)
      .send({ email: 'alex@littlestay.local', password: 'a'.repeat(1024 * 1024) })
      .expect(413);
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
  it('does not expose database backup or restore endpoints, even to administrators', async () => {
    const admin = await login('admin');
    const before = await state(admin);
    await admin.get('/api/admin/backup').expect(404);
    await admin.post('/api/admin/restore').set(appHeader).send({}).expect(404);
    expect(await state(admin)).toEqual(before);
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
    expect((await state()).properties).toHaveLength(50);
  });
  it('returns the actual schema version and treats malformed stored password hashes as invalid credentials', async () => {
    expect((await supertest(runtime.app).get('/api/health').expect(200)).body.schemaVersion).toBe(
      3,
    );
    runtime.db
      .prepare("UPDATE users SET password_hash=? WHERE id='guest-1'")
      .run('a'.repeat(32) + ':' + 'z'.repeat(128));
    await supertest(runtime.app)
      .post('/api/auth/login')
      .set(appHeader)
      .send({ email: 'alex@littlestay.local', password })
      .expect(401);
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
  it('retires surplus legacy seeds while preserving bookings and custom listings', () => {
    const columns =
      'host_id,title,neighborhood,price,capacity,lat,lng,published,suspended,approval,details';
    runtime.db.exec(
      `INSERT INTO properties SELECT 'stay-051',${columns} FROM properties WHERE id='stay-001'`,
    );
    runtime.db
      .prepare(
        "UPDATE properties SET details=json_set(details,'$.address','Fictional unit 51, Camarin, North Caloocan') WHERE id='stay-051'",
      )
      .run();
    runtime.db.exec(
      `INSERT INTO properties SELECT 'custom-listing',${columns} FROM properties WHERE id='stay-001'`,
    );
    runtime.db.exec(
      "UPDATE reservations SET property_id='stay-051' WHERE id='res-demo-1'; PRAGMA user_version=1;",
    );
    const migrated = openDatabase(join(directory, 'test.sqlite'));
    try {
      expect(
        migrated.prepare("SELECT published FROM properties WHERE id='stay-051'").get(),
      ).toMatchObject({ published: 0 });
      expect(
        migrated.prepare("SELECT published FROM properties WHERE id='custom-listing'").get(),
      ).toMatchObject({ published: 1 });
      expect(
        migrated.prepare("SELECT property_id FROM reservations WHERE id='res-demo-1'").get(),
      ).toMatchObject({ property_id: 'stay-051' });
      expect(migrated.prepare('SELECT COUNT(*) AS n FROM reservations').get()).toMatchObject({
        n: 6,
      });
    } finally {
      migrated.close();
    }
  });
  it('updates legacy demo galleries while preserving customized photos', () => {
    runtime.db
      .prepare(
        "UPDATE properties SET details=json_set(details,'$.image','/images/apartment-1.jpg','$.images',json(?)) WHERE id='stay-001'",
      )
      .run(JSON.stringify(['/images/apartment-1.jpg', '/images/apartment-2.jpg']));
    runtime.db
      .prepare(
        "UPDATE properties SET details=json_set(details,'$.image','/uploads/custom.jpg','$.images',json(?)) WHERE id='stay-002'",
      )
      .run(JSON.stringify(['/uploads/custom.jpg']));
    runtime.db.exec('PRAGMA user_version=2');
    const migrated = openDatabase(join(directory, 'test.sqlite'));
    try {
      const details = (id: string) =>
        JSON.parse(
          (migrated.prepare('SELECT details FROM properties WHERE id=?').get(id) as any).details,
        );
      expect(details('stay-001').images).toHaveLength(3);
      expect(details('stay-001').image).toBe('/images/hotel-1.jpg');
      expect(details('stay-002').images).toEqual(['/uploads/custom.jpg']);
      expect(details('stay-002').image).toBe('/uploads/custom.jpg');
    } finally {
      migrated.close();
    }
  });
  it('refuses to downgrade a database from a newer schema', () => {
    runtime.db.exec('PRAGMA user_version=99');
    expect(() => openDatabase(join(directory, 'test.sqlite'))).toThrow(/newer schema/);
    expect((runtime.db.prepare('PRAGMA user_version').get() as any).user_version).toBe(99);
  });
});
