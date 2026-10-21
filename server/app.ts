import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  openDatabase,
  seedDatabase,
  transaction,
  hashPassword,
  verifyPassword,
  propertyFromRow,
  userFromRow,
  reservationFromRow,
} from './db';
import { today, nights, validateDates as domainValidateDates, amenities } from '../src/lib/model';
import { region } from '../src/lib/region';

function validateDates(start: string, end: string, now?: string) {
  try {
    domainValidateDates(start, end, now);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
}
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
const id = () => randomUUID();
const stamp = () => new Date().toISOString();
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const text = (min = 1, max = 200) => z.string().trim().min(min).max(max);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bookingInput = z.object({
  propertyId: text(),
  checkIn: date,
  checkOut: date,
  guests: z.number().int().min(1).max(20),
});
const imagePath = z
  .string()
  .regex(/^\/(?:images\/apartment-[1-6]\.jpg|uploads\/[a-f0-9]{64}\.(?:jpg|png|webp))$/);
const propertyInput = z.object({
  title: text(2, 80),
  neighborhood: z.enum(['Camarin', 'Deparo', 'Bagumbong', 'Tala', 'Bagong Silang']),
  description: text(10, 1500),
  price: z.number().finite().min(1).max(100000),
  capacity: z.number().int().min(1).max(20),
  bedrooms: z.number().int().min(0).max(10),
  amenities: z.array(z.enum(amenities)).max(8),
  lat: z.number().min(region.bounds.south).max(region.bounds.north),
  lng: z.number().min(region.bounds.west).max(region.bounds.east),
  image: imagePath,
  images: z.array(imagePath).min(1).max(8),
  published: z.boolean(),
  address: text(5, 200),
  propertyType: z.enum(['Studio', 'Apartment', 'House', 'Private room']),
  houseRules: text(1, 1500),
  checkInInstructions: text(1, 1500),
});
const password = z.string().min(10, 'Use at least 10 characters.').max(128);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 8 },
});
const restoreUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
});
function imageExtension(buffer: Buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP')
    return 'webp';
  return fail(400, 'Upload JPEG, PNG, or WebP images only.');
}
function rawUser(db: DatabaseSync, uid: string) {
  return db.prepare('SELECT * FROM users WHERE id=?').get(uid) as any;
}
function rawProperty(db: DatabaseSync, pid: string) {
  return db.prepare('SELECT * FROM properties WHERE id=?').get(pid) as any;
}
function csvCell(v: unknown) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function createApplication(options: {
  databasePath: string;
  uploadsPath: string;
  seed?: boolean;
  publicPath?: string;
}) {
  const db = openDatabase(options.databasePath);
  if (options.seed !== false) seedDatabase(db);
  mkdirSync(options.uploadsPath, { recursive: true });
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if (origin) {
        let hostname = '';
        try {
          hostname = new URL(origin).hostname;
        } catch {
          return next(new HttpError(403, 'Invalid request origin.'));
        }
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname))
          return next(new HttpError(403, 'Only requests from the local application are allowed.'));
      }
      if (req.get('X-Little-Stay') !== '1')
        return next(new HttpError(403, 'Missing application request header.'));
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  const cookieName = 'little_stay_' + digest(resolve(options.databasePath)).slice(0, 12);
  const attempts = new Map<string, { count: number; until: number }>();
  function session(req: Request) {
    const raw = req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(cookieName + '='))
      ?.split('=')[1];
    if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
    const row = db
      .prepare(
        'SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?',
      )
      .get(digest(raw), Date.now()) as any;
    return row && !row.suspended ? row : null;
  }
  function actor(req: Request, role?: string) {
    const u = session(req);
    if (!u) fail(401, 'Please sign in to continue.');
    if (role && u.role !== role) fail(403, `This action requires a ${role} account.`);
    return u;
  }
  function host(req: Request) {
    const u = actor(req, 'host');
    if (u.host_status !== 'approved') fail(403, 'Your host application must be approved first.');
    return u;
  }
  function audit(uid: string, action: string, target: string) {
    db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(id(), uid, action, target, stamp());
  }
  function notify(uid: string, body: string) {
    db.prepare('INSERT INTO notifications VALUES(?,?,?,?,?)').run(id(), uid, body, 0, stamp());
  }
  function setSession(res: Response, uid: string) {
    const token = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(
      digest(token),
      uid,
      Date.now() + 8 * 60 * 60 * 1000,
    );
    res.cookie(cookieName, token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 8 * 60 * 60 * 1000,
    });
  }
  function ownProperty(req: Request, pid: string) {
    const u = host(req);
    const p = rawProperty(db, pid);
    if (!p || p.host_id !== u.id) fail(404, 'Your property was not found.');
    return { u, p };
  }
  function overlaps(pid: string, start: string, end: string) {
    return (
      !!db
        .prepare(
          "SELECT id FROM reservations WHERE property_id=? AND status IN ('confirmed','checked-in','completed') AND check_in<? AND check_out>? LIMIT 1",
        )
        .get(pid, end, start) ||
      !!db
        .prepare('SELECT id FROM blocked_dates WHERE property_id=? AND start<? AND end>? LIMIT 1')
        .get(pid, end, start)
    );
  }
  function state(req: Request) {
    const u = session(req);
    const all = db.prepare('SELECT * FROM properties ORDER BY id').all() as any[];
    const visible = all.filter(
      (p) =>
        u?.role === 'admin' ||
        (u?.role === 'host' && p.host_id === u.id) ||
        (p.published &&
          !p.suspended &&
          p.approval === 'approved' &&
          rawUser(db, p.host_id)?.host_status === 'approved' &&
          !rawUser(db, p.host_id)?.suspended),
    );
    const visibleIds = new Set(visible.map((p) => p.id));
    const reservations = (
      db.prepare('SELECT * FROM reservations ORDER BY created_at DESC').all() as any[]
    ).filter(
      (r) =>
        u &&
        (u.role === 'admin' ||
          r.guest_id === u.id ||
          (u.role === 'host' && rawProperty(db, r.property_id)?.host_id === u.id)),
    );
    const properties = visible.map((p) => {
      const v = propertyFromRow(p);
      if (!(
        u &&
        (u.role === 'admin' ||
          u.id === p.host_id ||
          reservations.some(
            (r) => r.property_id === p.id && r.guest_id === u.id && r.status !== 'cancelled',
          ))
      ))
        delete v.checkInInstructions;
      return v;
    });
    // Include booked properties even after suspension/unpublishing, without making them bookable.
    reservations.forEach((r) => {
      if (!visibleIds.has(r.property_id)) {
        const p = rawProperty(db, r.property_id);
        if (p) {
          properties.push({ ...propertyFromRow(p), published: false });
          visibleIds.add(p.id);
        }
      }
    });
    const users = (db.prepare('SELECT * FROM users ORDER BY name').all() as any[]).filter(
      (v) =>
        u?.role === 'admin' ||
        v.id === u?.id ||
        visible.some((p) => p.host_id === v.id) ||
        reservations.some((r) => r.guest_id === v.id),
    );
    const threads = u
      ? (db
          .prepare('SELECT * FROM threads WHERE guest_id=? OR host_id=? ORDER BY updated_at DESC')
          .all(u.id, u.id) as any[])
      : [];
    const threadIds = new Set(threads.map((t) => t.id));
    const messages = (
      db.prepare('SELECT * FROM messages ORDER BY created_at').all() as any[]
    ).filter((m) => threadIds.has(m.thread_id));
    // Counterpart identities are needed for private conversations; never expose their email/bio.
    for (const t of threads)
      for (const uid of [t.guest_id, t.host_id])
        if (!users.some((v) => v.id === uid)) users.push(rawUser(db, uid));
    const calendar = [
      ...(
        db
          .prepare(
            "SELECT * FROM reservations WHERE status IN ('confirmed','checked-in','completed')",
          )
          .all() as any[]
      )
        .filter((r) => visibleIds.has(r.property_id))
        .map((r) => ({
          id: `busy-${r.id}`,
          propertyId: r.property_id,
          start: r.check_in,
          end: r.check_out,
          kind: 'booking',
        })),
      ...(db.prepare('SELECT * FROM blocked_dates').all() as any[])
        .filter((b) => visibleIds.has(b.property_id))
        .map((b) => ({
          id: b.id,
          propertyId: b.property_id,
          start: b.start,
          end: b.end,
          kind: 'blocked',
          reason:
            u && (u.role === 'admin' || rawProperty(db, b.property_id)?.host_id === u.id)
              ? b.reason
              : undefined,
        })),
    ];
    return {
      version: 1,
      currentUser: u ? userFromRow(u) : null,
      users: users.map((v) =>
        u?.role === 'admin' || v.id === u?.id
          ? userFromRow(v)
          : { id: v.id, name: v.name, role: v.role },
      ),
      properties,
      reservations: reservations.map(reservationFromRow),
      calendar,
      favorites: u
        ? (db.prepare('SELECT property_id FROM favorites WHERE user_id=?').all(u.id) as any[]).map(
            (f) => f.property_id,
          )
        : [],
      reviews: (db.prepare('SELECT * FROM reviews ORDER BY created_at DESC').all() as any[])
        .filter(
          (r) =>
            visibleIds.has(r.property_id) &&
            (!r.hidden || u?.role === 'admin' || r.guest_id === u?.id),
        )
        .map((r) => ({
          id: r.id,
          bookingId: r.booking_id,
          propertyId: r.property_id,
          guestId: r.guest_id,
          rating: r.rating,
          body: r.body,
          hidden: !!r.hidden,
          createdAt: r.created_at,
        })),
      threads: threads.map((t) => ({
        id: t.id,
        propertyId: t.property_id,
        guestId: t.guest_id,
        hostId: t.host_id,
        updatedAt: t.updated_at,
      })),
      messages: messages.map((m) => ({
        id: m.id,
        threadId: m.thread_id,
        senderId: m.sender_id,
        body: m.body,
        createdAt: m.created_at,
      })),
      notifications: u
        ? (
            db
              .prepare(
                'SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100',
              )
              .all(u.id) as any[]
          ).map((n) => ({
            id: n.id,
            userId: n.user_id,
            body: n.body,
            read: !!n.read,
            createdAt: n.created_at,
          }))
        : [],
      audit:
        u?.role === 'admin'
          ? (
              db.prepare('SELECT * FROM audit ORDER BY created_at DESC LIMIT 200').all() as any[]
            ).map((a) => ({
              id: a.id,
              actorId: a.actor_id,
              action: a.action,
              targetId: a.target_id,
              createdAt: a.created_at,
            }))
          : [],
    };
  }
  app.get('/api/health', (_req, res) =>
    res.json({ ok: true, storage: 'sqlite', schemaVersion: 1 }),
  );
  app.get('/api/state', (req, res) => res.json(state(req)));
  app.post('/api/auth/register', (req, res) => {
    const v = z
      .object({
        name: text(2, 80),
        email: z
          .email()
          .max(254)
          .transform((v) => v.toLowerCase()),
        password,
        role: z.enum(['guest', 'host']),
      })
      .parse(req.body);
    if (db.prepare('SELECT id FROM users WHERE email=?').get(v.email))
      fail(409, 'An account already uses that email.');
    const uid = id();
    transaction(db, () => {
      db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run(
        uid,
        v.name,
        v.email,
        hashPassword(v.password),
        v.role,
        v.role === 'host' ? 'pending' : 'approved',
        0,
        '',
      );
      audit(uid, 'account.register', uid);
      if (v.role === 'host')
        for (const a of db.prepare("SELECT id FROM users WHERE role='admin'").all() as any[])
          notify(a.id, `${v.name} applied to become a host.`);
    });
    setSession(res, uid);
    res.status(201).json({ ok: true });
  });
  app.post('/api/auth/login', (req, res) => {
    const v = z
      .object({ email: z.email().transform((v) => v.toLowerCase()), password: z.string().max(128) })
      .parse(req.body);
    const key = `${req.ip}:${v.email}`,
      attempt = attempts.get(key);
    if (attempt && attempt.until > Date.now() && attempt.count >= 6)
      fail(429, 'Too many attempts. Try again in 15 minutes.');
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(v.email) as any;
    const valid = u
      ? verifyPassword(v.password, u.password_hash)
      : (scryptDummy(v.password), false);
    if (!valid) {
      attempts.set(key, {
        count: attempt && attempt.until > Date.now() ? attempt.count + 1 : 1,
        until: Date.now() + 15 * 60 * 1000,
      });
      fail(401, 'Email or password is incorrect.');
    }
    if (u.suspended) fail(403, 'This account is suspended. Contact the local administrator.');
    attempts.delete(key);
    setSession(res, u.id);
    res.json({ ok: true });
  });
  app.post('/api/auth/logout', (req, res) => {
    const raw = req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(cookieName + '='))
      ?.split('=')[1];
    if (raw) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(raw));
    res.clearCookie(cookieName, { path: '/' });
    res.json({ ok: true });
  });
  app.patch('/api/profile', (req, res) => {
    const u = actor(req),
      v = z.object({ name: text(2, 80), bio: z.string().trim().max(500) }).parse(req.body);
    db.prepare('UPDATE users SET name=?,bio=? WHERE id=?').run(v.name, v.bio, u.id);
    audit(u.id, 'profile.update', u.id);
    res.json({ ok: true });
  });
  app.post('/api/profile/password', (req, res) => {
    const u = actor(req),
      v = z.object({ currentPassword: z.string().max(128), newPassword: password }).parse(req.body);
    if (!verifyPassword(v.currentPassword, u.password_hash))
      fail(400, 'Current password is incorrect.');
    transaction(db, () => {
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(
        hashPassword(v.newPassword),
        u.id,
      );
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
      audit(u.id, 'password.change', u.id);
    });
    setSession(res, u.id);
    res.json({ ok: true });
  });
  app.post(
    '/api/uploads',
    (req, res, next) => {
      host(req);
      next();
    },
    upload.array('photos', 8),
    (req, res) => {
      const files = req.files as Express.Multer.File[];
      if (!files?.length) fail(400, 'Choose at least one image.');
      const prepared = files.map((f) => ({
        buffer: f.buffer,
        name: `${digest(f.buffer)}.${imageExtension(f.buffer)}`,
      }));
      prepared.forEach((f) =>
        writeFileSync(join(options.uploadsPath, f.name), f.buffer, { flag: 'w' }),
      );
      res.status(201).json({ images: prepared.map((f) => `/uploads/${f.name}`) });
    },
  );
  app.post('/api/properties', (req, res) => {
    const u = host(req),
      v = propertyInput.parse(req.body),
      pid = id();
    for (const image of [v.image, ...v.images])
      if (image.startsWith('/uploads/') && !existsSync(join(options.uploadsPath, image.slice(9))))
        fail(400, 'An uploaded image was not found.');
    const p = { ...v, id: pid, hostId: u.id, suspended: false, approval: 'pending' };
    transaction(db, () => {
      db.prepare('INSERT INTO properties VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(
        pid,
        u.id,
        v.title,
        v.neighborhood,
        v.price,
        v.capacity,
        v.lat,
        v.lng,
        Number(v.published),
        0,
        'pending',
        JSON.stringify(p),
      );
      audit(u.id, 'listing.create', pid);
    });
    res.status(201).json({ ok: true, id: pid });
  });
  app.patch('/api/properties/:id', (req, res) => {
    const { u, p } = ownProperty(req, String(req.params.id)),
      v = propertyInput.parse(req.body);
    for (const image of [v.image, ...v.images])
      if (image.startsWith('/uploads/') && !existsSync(join(options.uploadsPath, image.slice(9))))
        fail(400, 'An uploaded image was not found.');
    const details = { ...v, id: p.id, hostId: u.id };
    transaction(db, () => {
      db.prepare(
        'UPDATE properties SET title=?,neighborhood=?,price=?,capacity=?,lat=?,lng=?,published=?,approval=?,details=? WHERE id=?',
      ).run(
        v.title,
        v.neighborhood,
        v.price,
        v.capacity,
        v.lat,
        v.lng,
        Number(v.published),
        'pending',
        JSON.stringify(details),
        p.id,
      );
      audit(u.id, 'listing.edit', p.id);
      notify(
        u.id,
        'Your edited listing is awaiting admin review. Existing bookings are preserved.',
      );
    });
    res.json({ ok: true });
  });
  app.post('/api/properties/:id/publish', (req, res) => {
    const { u, p } = ownProperty(req, String(req.params.id));
    const v = z.object({ published: z.boolean() }).parse(req.body);
    db.prepare('UPDATE properties SET published=? WHERE id=?').run(Number(v.published), p.id);
    audit(u.id, v.published ? 'listing.publish' : 'listing.unpublish', p.id);
    res.json({ ok: true });
  });
  app.post('/api/properties/:id/block', (req, res) => {
    const { u, p } = ownProperty(req, String(req.params.id)),
      v = z.object({ start: date, end: date, reason: text(1, 200) }).parse(req.body);
    validateDates(v.start, v.end);
    transaction(db, () => {
      if (overlaps(p.id, v.start, v.end))
        fail(409, 'Those dates overlap a reservation or an existing block.');
      db.prepare('INSERT INTO blocked_dates VALUES(?,?,?,?,?)').run(
        id(),
        p.id,
        v.start,
        v.end,
        v.reason,
      );
      audit(u.id, 'calendar.block', p.id);
    });
    res.status(201).json({ ok: true });
  });
  app.delete('/api/blocks/:id', (req, res) => {
    const b = db
      .prepare('SELECT * FROM blocked_dates WHERE id=?')
      .get(String(req.params.id)) as any;
    if (!b) fail(404, 'Date block not found.');
    const { u } = ownProperty(req, b.property_id);
    db.prepare('DELETE FROM blocked_dates WHERE id=?').run(b.id);
    audit(u.id, 'calendar.unblock', b.id);
    res.json({ ok: true });
  });
  app.post('/api/bookings', (req, res) => {
    const u = actor(req, 'guest'),
      v = bookingInput.parse(req.body);
    validateDates(v.checkIn, v.checkOut);
    const booking = transaction(db, () => {
      const p = rawProperty(db, v.propertyId);
      const owner = p ? rawUser(db, p.host_id) : null;
      if (
        !p ||
        !p.published ||
        p.suspended ||
        p.approval !== 'approved' ||
        owner?.suspended ||
        owner?.host_status !== 'approved'
      )
        fail(409, 'This property is no longer bookable.');
      if (v.guests > p.capacity) fail(400, 'Guest count exceeds property capacity.');
      if (overlaps(p.id, v.checkIn, v.checkOut))
        fail(409, 'Those dates are already reserved or blocked.');
      const bid = id(),
        reference = `LS-${randomBytes(6).toString('hex').toUpperCase()}`;
      db.prepare('INSERT INTO reservations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
        bid,
        reference,
        p.id,
        u.id,
        v.checkIn,
        v.checkOut,
        v.guests,
        p.price,
        p.price * nights(v.checkIn, v.checkOut),
        'confirmed',
        stamp(),
      );
      notify(u.id, `Booking ${reference} confirmed for ${p.title}.`);
      notify(p.host_id, `${u.name} booked ${p.title}: ${v.checkIn} to ${v.checkOut}.`);
      audit(u.id, 'booking.create', bid);
      return bid;
    });
    res.status(201).json({ ok: true, id: booking });
  });
  app.post('/api/bookings/:id/cancel', (req, res) => {
    const u = actor(req),
      r = db.prepare('SELECT * FROM reservations WHERE id=?').get(String(req.params.id)) as any;
    if (!r || !(u.role === 'admin' || (u.role === 'guest' && r.guest_id === u.id)))
      fail(404, 'Reservation not found.');
    if (r.status !== 'confirmed' || (u.role !== 'admin' && r.check_in < today()))
      fail(409, 'Only upcoming confirmed reservations can be cancelled.');
    transaction(db, () => {
      db.prepare("UPDATE reservations SET status='cancelled' WHERE id=?").run(r.id);
      notify(r.guest_id, `Booking ${r.reference} was cancelled.`);
      notify(
        rawProperty(db, r.property_id).host_id,
        `Booking ${r.reference} was cancelled; dates are available again.`,
      );
      audit(u.id, 'booking.cancel', r.id);
    });
    res.json({ ok: true });
  });
  app.post('/api/bookings/:id/status', (req, res) => {
    const u = actor(req),
      r = db.prepare('SELECT * FROM reservations WHERE id=?').get(String(req.params.id)) as any;
    const v = z.object({ status: z.enum(['checked-in', 'completed']) }).parse(req.body);
    if (
      !r ||
      !(
        u.role === 'admin' ||
        (u.role === 'host' &&
          u.host_status === 'approved' &&
          rawProperty(db, r.property_id)?.host_id === u.id)
      )
    )
      fail(404, 'Reservation not found.');
    if (
      v.status === 'checked-in' &&
      (r.status !== 'confirmed' || r.check_in > today() || r.check_out <= today())
    )
      fail(409, 'Check-in is available only during the reserved stay.');
    if (v.status === 'completed' && r.status !== 'checked-in')
      fail(409, 'A guest must be checked in before checkout.');
    transaction(db, () => {
      db.prepare('UPDATE reservations SET status=? WHERE id=?').run(v.status, r.id);
      notify(
        r.guest_id,
        `Booking ${r.reference}: ${v.status === 'completed' ? 'checkout complete. You can now leave a review.' : 'checked in. Enjoy your stay!'}`,
      );
      audit(u.id, `booking.${v.status}`, r.id);
    });
    res.json({ ok: true });
  });
  app.post('/api/favorites/:id', (req, res) => {
    const u = actor(req, 'guest'),
      p = rawProperty(db, String(req.params.id));
    if (!p || p.suspended || !p.published || p.approval !== 'approved')
      fail(404, 'Property not found.');
    const existing = db
      .prepare('SELECT * FROM favorites WHERE user_id=? AND property_id=?')
      .get(u.id, p.id);
    if (existing)
      db.prepare('DELETE FROM favorites WHERE user_id=? AND property_id=?').run(u.id, p.id);
    else db.prepare('INSERT INTO favorites VALUES(?,?)').run(u.id, p.id);
    res.json({ ok: true });
  });
  app.post('/api/threads', (req, res) => {
    const u = actor(req, 'guest'),
      v = z.object({ propertyId: text() }).parse(req.body),
      p = rawProperty(db, v.propertyId);
    if (!p || p.suspended || !p.published || p.approval !== 'approved')
      fail(404, 'Property not found.');
    let thread = db
      .prepare('SELECT id FROM threads WHERE guest_id=? AND property_id=?')
      .get(u.id, p.id) as any;
    if (!thread) {
      thread = { id: id() };
      db.prepare('INSERT INTO threads VALUES(?,?,?,?,?)').run(
        thread.id,
        p.id,
        u.id,
        p.host_id,
        stamp(),
      );
    } else db.prepare('UPDATE threads SET updated_at=? WHERE id=?').run(stamp(), thread.id);
    res.json({ ok: true, id: thread.id });
  });
  app.post('/api/threads/:id/messages', (req, res) => {
    const u = actor(req),
      t = db
        .prepare('SELECT * FROM threads WHERE id=? AND (guest_id=? OR host_id=?)')
        .get(String(req.params.id), u.id, u.id) as any;
    if (!t) fail(404, 'Conversation not found.');
    const v = z.object({ body: text(1, 2000) }).parse(req.body);
    transaction(db, () => {
      db.prepare('INSERT INTO messages VALUES(?,?,?,?,?)').run(id(), t.id, u.id, v.body, stamp());
      db.prepare('UPDATE threads SET updated_at=? WHERE id=?').run(stamp(), t.id);
      notify(
        u.id === t.guest_id ? t.host_id : t.guest_id,
        `New message from ${u.name} about ${rawProperty(db, t.property_id).title}.`,
      );
    });
    res.status(201).json({ ok: true });
  });
  app.post('/api/notifications/read', (req, res) => {
    const u = actor(req);
    db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(u.id);
    res.json({ ok: true });
  });
  app.post('/api/reviews', (req, res) => {
    const u = actor(req, 'guest'),
      v = z
        .object({ bookingId: text(), rating: z.number().int().min(1).max(5), body: text(10, 1000) })
        .parse(req.body),
      r = db
        .prepare("SELECT * FROM reservations WHERE id=? AND guest_id=? AND status='completed'")
        .get(v.bookingId, u.id) as any;
    if (!r) fail(403, 'Reviews are available only for your completed stays.');
    if (db.prepare('SELECT id FROM reviews WHERE booking_id=?').get(r.id))
      fail(409, 'This stay already has a review.');
    transaction(db, () => {
      db.prepare('INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?)').run(
        id(),
        r.id,
        r.property_id,
        u.id,
        v.rating,
        v.body,
        0,
        stamp(),
      );
      notify(rawProperty(db, r.property_id).host_id, `${u.name} reviewed your property.`);
      audit(u.id, 'review.create', r.id);
    });
    res.status(201).json({ ok: true });
  });
  app.post('/api/admin/users/:id', (req, res) => {
    const u = actor(req, 'admin'),
      target = rawUser(db, String(req.params.id)),
      v = z.object({ action: z.enum(['approve', 'reject', 'suspend', 'restore']) }).parse(req.body);
    if (!target) fail(404, 'Account not found.');
    if (target.role === 'admin') fail(403, 'Administrator accounts cannot be modified here.');
    transaction(db, () => {
      if (['approve', 'reject'].includes(v.action)) {
        if (target.role !== 'host')
          fail(400, 'Only host applications can be approved or rejected.');
        db.prepare('UPDATE users SET host_status=? WHERE id=?').run(
          v.action === 'approve' ? 'approved' : 'rejected',
          target.id,
        );
      } else {
        db.prepare('UPDATE users SET suspended=? WHERE id=?').run(
          v.action === 'suspend' ? 1 : 0,
          target.id,
        );
        if (v.action === 'suspend')
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
      }
      notify(target.id, `Account action: ${v.action}.`);
      audit(u.id, `account.${v.action}`, target.id);
    });
    res.json({ ok: true });
  });
  app.post('/api/admin/properties/:id', (req, res) => {
    const u = actor(req, 'admin'),
      p = rawProperty(db, String(req.params.id)),
      v = z.object({ action: z.enum(['approve', 'reject', 'suspend', 'restore']) }).parse(req.body);
    if (!p) fail(404, 'Listing not found.');
    transaction(db, () => {
      if (['approve', 'reject'].includes(v.action))
        db.prepare('UPDATE properties SET approval=? WHERE id=?').run(
          v.action === 'approve' ? 'approved' : 'rejected',
          p.id,
        );
      else
        db.prepare('UPDATE properties SET suspended=? WHERE id=?').run(
          v.action === 'suspend' ? 1 : 0,
          p.id,
        );
      notify(p.host_id, `${p.title}: ${v.action}.`);
      audit(u.id, `listing.${v.action}`, p.id);
    });
    res.json({ ok: true });
  });
  app.post('/api/admin/reviews/:id', (req, res) => {
    const u = actor(req, 'admin'),
      v = z.object({ hidden: z.boolean() }).parse(req.body);
    if (!db.prepare('SELECT id FROM reviews WHERE id=?').get(String(req.params.id)))
      fail(404, 'Review not found.');
    db.prepare('UPDATE reviews SET hidden=? WHERE id=?').run(
      Number(v.hidden),
      String(req.params.id),
    );
    audit(u.id, v.hidden ? 'review.hide' : 'review.restore', String(req.params.id));
    res.json({ ok: true });
  });
  app.get('/api/reports', (req, res) => {
    const u = actor(req);
    if (!['host', 'admin'].includes(u.role)) fail(403, 'Reports are for hosts and admins.');
    const start = String(req.query.start ?? today().slice(0, 7) + '-01'),
      end = String(req.query.end ?? addMonthsEnd(start));
    validateDates(start, end, '0000-01-01');
    if (nights(start, end) > 366) fail(400, 'Choose a reporting period of at most 366 days.');
    const properties = (db.prepare('SELECT * FROM properties').all() as any[]).filter(
      (p) => u.role === 'admin' || p.host_id === u.id,
    );
    const rs = (
      db
        .prepare(
          "SELECT * FROM reservations WHERE status!='cancelled' AND check_in<? AND check_out>?",
        )
        .all(end, start) as any[]
    ).filter((r) => properties.some((p) => p.id === r.property_id));
    const rows = properties.map((p) => {
      const stays = rs.filter((r) => r.property_id === p.id);
      const occupiedNights = stays.reduce(
        (sum, r) =>
          sum +
          nights(r.check_in < start ? start : r.check_in, r.check_out > end ? end : r.check_out),
        0,
      );
      return {
        propertyId: p.id,
        property: p.title,
        neighborhood: p.neighborhood,
        bookings: stays.length,
        occupiedNights,
        occupancy: Math.round((occupiedNights / nights(start, end)) * 1000) / 10,
        bookedValue: stays.reduce(
          (sum, r) =>
            sum +
            r.nightly_rate *
              nights(
                r.check_in < start ? start : r.check_in,
                r.check_out > end ? end : r.check_out,
              ),
          0,
        ),
      };
    });
    if (req.query.format === 'csv') {
      res
        .type('text/csv')
        .attachment('little-stay-occupancy.csv')
        .send(
          [
            [
              'Property',
              'Neighborhood',
              'Bookings',
              'Occupied nights',
              'Occupancy %',
              'Booked value (PHP)',
            ],
            ...rows.map((r) => [
              r.property,
              r.neighborhood,
              r.bookings,
              r.occupiedNights,
              r.occupancy,
              r.bookedValue,
            ]),
          ]
            .map((row) => row.map(csvCell).join(','))
            .join('\r\n'),
        );
    } else
      res.json({
        start,
        end,
        rows,
        totalBookings: rs.length,
        bookedValue: rows.reduce((s, r) => s + r.bookedValue, 0),
        occupancy: rows.length
          ? Math.round(
              (rows.reduce((s, r) => s + r.occupiedNights, 0) /
                (properties.length * nights(start, end))) *
                1000,
            ) / 10
          : 0,
      });
  });
  const backupTables = [
    'users',
    'properties',
    'reservations',
    'blocked_dates',
    'favorites',
    'notifications',
    'threads',
    'messages',
    'reviews',
    'audit',
  ] as const;
  app.get('/api/admin/backup', (req, res) => {
    actor(req, 'admin');
    const tables = Object.fromEntries(
      backupTables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]),
    );
    const paths = new Set<string>();
    for (const row of tables.properties as any[]) {
      const p = JSON.parse(row.details);
      for (const image of [p.image, ...(p.images ?? [])])
        if (typeof image === 'string' && image.startsWith('/uploads/')) paths.add(image.slice(9));
    }
    const images = [...paths].map((name) => ({
      name,
      data: readFileSync(join(options.uploadsPath, name)).toString('base64'),
    }));
    const archive = JSON.stringify({
      format: 'little-stay-backup',
      version: 1,
      exportedAt: stamp(),
      tables,
      images,
    });
    if (Buffer.byteLength(archive) > 50 * 1024 * 1024)
      fail(
        413,
        'This backup exceeds 50 MB. Stop the application and copy its data directory for a complete filesystem backup.',
      );
    res.attachment(`little-stay-backup-${today()}.json`).type('application/json').send(archive);
  });
  app.post(
    '/api/admin/restore',
    (req, res, next) => {
      actor(req, 'admin');
      next();
    },
    restoreUpload.single('backup'),
    (req, res) => {
      const u = actor(req, 'admin');
      if (!req.file) fail(400, 'Select a backup JSON file.');
      let backup: any;
      try {
        backup = JSON.parse(req.file!.buffer.toString('utf8'));
      } catch {
        fail(400, 'The backup is not valid JSON.');
      }
      validateBackup(backup, backupTables);
      const imageFiles = backup.images.map((image: any) => {
        const buffer = Buffer.from(image.data, 'base64');
        if (buffer.length > 4 * 1024 * 1024) fail(400, 'A backup image is too large.');
        const extension = imageExtension(buffer);
        if (image.name !== `${digest(buffer)}.${extension}`)
          fail(400, 'Backup image integrity check failed.');
        return { name: image.name, buffer };
      });
      const imageNames = new Set(imageFiles.map((i: any) => i.name));
      for (const p of backup.tables.properties) {
        const details = propertyInput.parse(propertyFromRow(p));
        for (const image of [details.image, ...details.images])
          if (image.startsWith('/uploads/') && !imageNames.has(image.slice(9)))
            fail(400, 'The backup is missing a property image.');
      }
      transaction(db, () => {
        db.exec('DELETE FROM sessions');
        for (const table of [...backupTables].reverse()) db.exec(`DELETE FROM ${table}`);
        for (const table of backupTables) {
          const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map(
            (c) => c.name,
          );
          for (const row of backup.tables[table])
            db.prepare(
              `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
            ).run(...columns.map((c) => row[c]));
        }
        for (const image of imageFiles)
          writeFileSync(join(options.uploadsPath, image.name), image.buffer);
        const admin = db
          .prepare("SELECT id FROM users WHERE role='admin' AND suspended=0")
          .get() as any;
        if (!admin) fail(400, 'The backup needs an active administrator.');
        audit(admin.id, 'database.restore', u.id);
      });
      res.clearCookie(cookieName, { path: '/' });
      res.json({ ok: true });
    },
  );
  app.use(
    '/uploads',
    express.static(options.uploadsPath, { dotfiles: 'deny', immutable: true, maxAge: '1y' }),
  );
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  if (options.publicPath) {
    app.use(express.static(options.publicPath));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(options.publicPath!, 'index.html')));
  }
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) {
      res
        .status(400)
        .json({ error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
      return;
    }
    if (error instanceof multer.MulterError) {
      res.status(400).json({
        error:
          error.code === 'LIMIT_FILE_SIZE' ? 'The file exceeds the allowed size.' : error.message,
      });
      return;
    }
    const status =
      error instanceof HttpError
        ? error.status
        : error instanceof SyntaxError ||
            String(error.code ?? '').startsWith('SQLITE_CONSTRAINT') ||
            (Number(error.errcode) & 255) === 19
          ? 400
          : 500;
    if (status === 500) console.error(error);
    res.status(status).json({
      error:
        status === 500 ? 'The request could not be completed. Please try again.' : error.message,
    });
  });
  return { app, db, close: () => db.close() };
}
// Keep unsuccessful sign-ins on a comparable password-hashing path.
function scryptDummy(password: string) {
  verifyPassword(password, '0'.repeat(32) + ':' + '0'.repeat(128));
}
function addMonthsEnd(start: string) {
  const date = new Date(start + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(date.getTime()))
    fail(400, 'Choose a valid reporting start date.');
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}
function validateBackup(backup: any, tables: readonly string[]) {
  if (
    !backup ||
    backup.format !== 'little-stay-backup' ||
    backup.version !== 1 ||
    !backup.tables ||
    !Array.isArray(backup.images) ||
    backup.images.length > 500
  )
    fail(400, 'Unsupported backup format.');
  const safeString = (v: any) => typeof v === 'string' && v.length <= 15000;
  const specs: Record<string, Record<string, 'text' | 'number'>> = {
    users: {
      id: 'text',
      name: 'text',
      email: 'text',
      password_hash: 'text',
      role: 'text',
      host_status: 'text',
      suspended: 'number',
      bio: 'text',
    },
    properties: {
      id: 'text',
      host_id: 'text',
      title: 'text',
      neighborhood: 'text',
      price: 'number',
      capacity: 'number',
      lat: 'number',
      lng: 'number',
      published: 'number',
      suspended: 'number',
      approval: 'text',
      details: 'text',
    },
    reservations: {
      id: 'text',
      reference: 'text',
      property_id: 'text',
      guest_id: 'text',
      check_in: 'text',
      check_out: 'text',
      guests: 'number',
      nightly_rate: 'number',
      total: 'number',
      status: 'text',
      created_at: 'text',
    },
    blocked_dates: { id: 'text', property_id: 'text', start: 'text', end: 'text', reason: 'text' },
    favorites: { user_id: 'text', property_id: 'text' },
    notifications: {
      id: 'text',
      user_id: 'text',
      body: 'text',
      read: 'number',
      created_at: 'text',
    },
    threads: {
      id: 'text',
      property_id: 'text',
      guest_id: 'text',
      host_id: 'text',
      updated_at: 'text',
    },
    messages: {
      id: 'text',
      thread_id: 'text',
      sender_id: 'text',
      body: 'text',
      created_at: 'text',
    },
    reviews: {
      id: 'text',
      booking_id: 'text',
      property_id: 'text',
      guest_id: 'text',
      rating: 'number',
      body: 'text',
      hidden: 'number',
      created_at: 'text',
    },
    audit: { id: 'text', actor_id: 'text', action: 'text', target_id: 'text', created_at: 'text' },
  };
  for (const table of tables) {
    if (!Array.isArray(backup.tables[table]) || backup.tables[table].length > 100000)
      fail(400, 'Invalid backup table.');
    for (const row of backup.tables[table])
      for (const [column, type] of Object.entries(specs[table]))
        if (
          type === 'text'
            ? !safeString(row?.[column])
            : typeof row?.[column] !== 'number' || !Number.isFinite(row[column])
        )
          fail(400, `Invalid backup field: ${table}.${column}`);
  }
  for (const u of backup.tables.users)
    if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(u.password_hash))
      fail(400, 'Invalid password data in backup.');
  for (const image of backup.images)
    if (
      !image ||
      typeof image.name !== 'string' ||
      !image.name.match(/^[a-f0-9]{64}\.(jpg|png|webp)$/) ||
      typeof image.data !== 'string'
    )
      fail(400, 'Invalid backup image.');
}
