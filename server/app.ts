import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { z } from 'zod';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { asyncTransaction as transaction, RemoteDatabase, type SqlDatabase } from './remote-db.js';
import type { PhotoStore } from './photos.js';
import { setTimeout as delay } from 'node:timers/promises';
import { publicOrigins, trustProxy } from './config.js';
import { securityHeaders } from '../deployment/security.js';
import { googleConfiguration, mountGoogleAuth } from './google-auth.js';
import {
  openDatabase,
  seedDatabase,
  ensureAdmin,
  hashPassword,
  verifyPassword,
  propertyFromRow,
  userFromRow,
  reservationFromRow,
} from './db.js';
import {
  today,
  nights,
  validateDates as domainValidateDates,
  validateBookingDates,
  amenities,
} from '../src/lib/model.js';
import { region } from '../src/lib/region.js';
function validateDates(start: string, end: string, now?: string) {
  try {
    if (now === undefined) validateBookingDates(start, end);
    else domainValidateDates(start, end, now);
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
  .regex(
    /^\/(?:images\/(?:apartment-[1-6]|hotel-[1-8])\.jpg|uploads\/[a-f0-9]{64}\.(?:jpg|png|webp))$/,
  );
const propertyInput = z
  .object({
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
  })
  .refine((value) => value.images.includes(value.image), {
    path: ['image'],
    message: 'Choose a cover from the listing photos.',
  });
const password = z.string().min(8, 'Use at least 8 characters.').max(128);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 8, fields: 0, parts: 8 },
});
function imageExtension(buffer: Buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP')
    return 'webp';
  return fail(400, 'Upload JPEG, PNG, or WebP images only.');
}
async function rawUser(db: SqlDatabase, uid: string) {
  return (await db.prepare('SELECT * FROM users WHERE id=?').get(uid)) as any;
}
async function rawProperty(db: SqlDatabase, pid: string) {
  return (await db.prepare('SELECT * FROM properties WHERE id=?').get(pid)) as any;
}
function csvCell(v: unknown) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function createApplication<TDatabase extends SqlDatabase = DatabaseSync>(options: {
  databasePath: string;
  uploadsPath: string;
  seed?: boolean;
  publicPath?: string;
  database?: TDatabase;
  photoStore?: PhotoStore;
  serverless?: boolean;
}) {
  const localDatabase = options.database ? undefined : openDatabase(options.databasePath);
  const db: SqlDatabase = options.database ?? localDatabase!;
  let origins: Set<string>;
  let proxy: ReturnType<typeof trustProxy>;
  let google: ReturnType<typeof googleConfiguration>;
  try {
    origins = publicOrigins();
    proxy = trustProxy();
    google = googleConfiguration(origins);
    if (localDatabase) {
      if (options.seed !== false) seedDatabase(localDatabase);
      ensureAdmin(localDatabase);
    }
  } catch (error) {
    db.close();
    throw error;
  }
  if (!options.photoStore) mkdirSync(options.uploadsPath, { recursive: true });
  function installImage(name: string, buffer: Buffer) {
    if (options.photoStore) return options.photoStore.install(name, buffer);
    const temporary = join(options.uploadsPath, `.${id()}.tmp`);
    try {
      // A failed write must never truncate an image referenced by existing listings.
      writeFileSync(temporary, buffer, { flag: 'wx' });
      renameSync(temporary, join(options.uploadsPath, name));
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  async function photoExists(name: string) {
    return options.photoStore
      ? options.photoStore.exists(name)
      : existsSync(join(options.uploadsPath, name));
  }
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', proxy);
  app.use((req, res, next) => {
    res.set(securityHeaders(process.env.NODE_ENV === 'production'));
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
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname) && !origins.has(origin))
          return next(new HttpError(403, 'Requests from this origin are not allowed.'));
      }
      if (req.get('X-Little-Stay') !== '1')
        return next(new HttpError(403, 'Missing application request header.'));
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  const cookieName =
    'little_stay_' +
    digest(options.database ? options.databasePath : resolve(options.databasePath)).slice(0, 12);
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'strict' as const,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  };
  const attempts = new Map<
    string,
    {
      count: number;
      until: number;
    }
  >();
  const cleanup = setInterval(() => {
    for (const [key, attempt] of attempts) if (attempt.until <= Date.now()) attempts.delete(key);
  }, 60000);
  cleanup.unref();
  async function session(req: Request) {
    const raw = req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(cookieName + '='))
      ?.split('=')[1];
    if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
    const row = (await db
      .prepare(
        'SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?',
      )
      .get(digest(raw), Date.now())) as any;
    return row && !row.suspended ? row : null;
  }
  async function actor(req: Request, role?: string) {
    const u = await session(req);
    if (!u) fail(401, 'Please sign in to continue.');
    if (role && u.role !== role) fail(403, `This action requires a ${role} account.`);
    return u;
  }
  async function host(req: Request) {
    const u = await actor(req, 'host');
    if (u.host_status !== 'approved') fail(403, 'Your host application must be approved first.');
    return u;
  }
  async function audit(uid: string, action: string, target: string) {
    await db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(id(), uid, action, target, stamp());
  }
  async function notify(uid: string, body: string) {
    await db
      .prepare('INSERT INTO notifications VALUES(?,?,?,?,?)')
      .run(id(), uid, body, 0, stamp());
  }
  async function setSession(res: Response, uid: string) {
    const token = randomBytes(32).toString('hex');
    await db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    await db
      .prepare('INSERT INTO sessions VALUES(?,?,?)')
      .run(digest(token), uid, Date.now() + 8 * 60 * 60 * 1000);
    res.cookie(cookieName, token, {
      ...cookieOptions,
      maxAge: 8 * 60 * 60 * 1000,
    });
  }
  async function ownProperty(req: Request, pid: string) {
    const u = await host(req);
    const p = await rawProperty(db, pid);
    if (!p || p.host_id !== u.id) fail(404, 'Your property was not found.');
    return { u, p };
  }
  async function overlaps(pid: string, start: string, end: string) {
    return (
      !!(await db
        .prepare(
          "SELECT id FROM reservations WHERE property_id=? AND status IN ('confirmed','checked-in','completed') AND check_in<? AND check_out>? LIMIT 1",
        )
        .get(pid, end, start)) ||
      !!(await db
        .prepare('SELECT id FROM blocked_dates WHERE property_id=? AND start<? AND end>? LIMIT 1')
        .get(pid, end, start))
    );
  }
  async function publiclyAvailable(p: any) {
    if (!p || !p.published || p.suspended || p.approval !== 'approved') return false;
    const owner = await rawUser(db, p.host_id);
    return owner?.role === 'host' && owner.host_status === 'approved' && !owner.suspended;
  }
  async function state(req: Request) {
    const u = await session(req);
    const all = (await db.prepare('SELECT * FROM properties ORDER BY id').all()) as any[];
    const propertyRows = new Map(all.map((p) => [p.id, p]));
    const userRows = (await db.prepare('SELECT * FROM users ORDER BY name').all()) as any[];
    const usersById = new Map(userRows.map((u) => [u.id, u]));
    const visible = all.filter(
      (p) =>
        u?.role === 'admin' ||
        (u?.role === 'host'
          ? p.host_id === u.id
          : p.published &&
            !p.suspended &&
            p.approval === 'approved' &&
            usersById.get(p.host_id)?.role === 'host' &&
            usersById.get(p.host_id)?.host_status === 'approved' &&
            !usersById.get(p.host_id)?.suspended),
    );
    const visibleIds = new Set(visible.map((p) => p.id));
    const reservations = (
      (await db.prepare('SELECT * FROM reservations ORDER BY created_at DESC').all()) as any[]
    ).filter(
      (r) =>
        u &&
        (u.role === 'admin' ||
          r.guest_id === u.id ||
          (u.role === 'host' && propertyRows.get(r.property_id)?.host_id === u.id)),
    );
    const serializeProperty = (p: any) => {
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
    };
    const properties = visible.map(serializeProperty);
    // Include booked properties even after suspension/unpublishing, without making them bookable.
    reservations.forEach((r) => {
      if (!visibleIds.has(r.property_id)) {
        const p = propertyRows.get(r.property_id);
        if (p) {
          properties.push({ ...serializeProperty(p), published: false });
          visibleIds.add(p.id);
        }
      }
    });
    const users = userRows.filter(
      (v) =>
        u?.role === 'admin' ||
        v.id === u?.id ||
        visible.some((p) => p.host_id === v.id) ||
        reservations.some((r) => r.guest_id === v.id),
    );
    const threads = u
      ? ((await db
          .prepare('SELECT * FROM threads WHERE guest_id=? OR host_id=? ORDER BY updated_at DESC')
          .all(u.id, u.id)) as any[])
      : [];
    const threadIds = new Set(threads.map((t) => t.id));
    const messages = (
      (await db.prepare('SELECT * FROM messages ORDER BY created_at').all()) as any[]
    ).filter((m) => threadIds.has(m.thread_id));
    // Counterpart identities are needed for private conversations; never expose their email/bio.
    for (const t of threads)
      for (const uid of [t.guest_id, t.host_id])
        if (!users.some((v) => v.id === uid)) users.push(usersById.get(uid));
    const calendar = [
      ...(
        (await db
          .prepare(
            "SELECT * FROM reservations WHERE status IN ('confirmed','checked-in','completed')",
          )
          .all()) as any[]
      )
        .filter((r) => visibleIds.has(r.property_id))
        .map((r) => ({
          id: `busy-${r.id}`,
          propertyId: r.property_id,
          start: r.check_in,
          end: r.check_out,
          kind: 'booking',
        })),
      ...((await db.prepare('SELECT * FROM blocked_dates').all()) as any[])
        .filter((b) => visibleIds.has(b.property_id))
        .map((b) => ({
          id: b.id,
          propertyId: b.property_id,
          start: b.start,
          end: b.end,
          kind: 'blocked',
          reason:
            u && (u.role === 'admin' || propertyRows.get(b.property_id)?.host_id === u.id)
              ? b.reason
              : undefined,
        })),
    ];
    return {
      version: 1,
      demo: all.some((p) => JSON.parse(p.details).address?.startsWith('Fictional unit ')),
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
        ? (
            (await db
              .prepare('SELECT property_id FROM favorites WHERE user_id=?')
              .all(u.id)) as any[]
          ).map((f) => f.property_id)
        : [],
      reviews: ((await db.prepare('SELECT * FROM reviews ORDER BY created_at DESC').all()) as any[])
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
            (await db
              .prepare(
                'SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100',
              )
              .all(u.id)) as any[]
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
              (await db
                .prepare('SELECT * FROM audit ORDER BY created_at DESC LIMIT 200')
                .all()) as any[]
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
  mountGoogleAuth(app, {
    db,
    config: google,
    sessionCookie: cookieName,
    getUser: session,
    setSession,
    audit,
    notify,
  });
  app.get('/api/health', async (_req, res) =>
    res.json({
      ok: true,
      storage: options.database ? 'turso' : 'sqlite',
      schemaVersion: Number(((await db.prepare('PRAGMA user_version').get()) as any).user_version),
    }),
  );
  app.get('/api/state', async (req, res) => res.json(await state(req)));
  app.post('/api/auth/register', async (req, res) => {
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
    if (await db.prepare('SELECT id FROM users WHERE email=?').get(v.email))
      fail(409, 'An account already uses that email.');
    const uid = id();
    await transaction(db, async () => {
      await db
        .prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)')
        .run(
          uid,
          v.name,
          v.email,
          hashPassword(v.password),
          v.role,
          v.role === 'host' ? 'pending' : 'approved',
          0,
          '',
        );
      await audit(uid, 'account.register', uid);
      if (v.role === 'host')
        for (const a of (await db
          .prepare("SELECT id FROM users WHERE role='admin'")
          .all()) as any[])
          await notify(a.id, `${v.name} applied to become a host.`);
    });
    await setSession(res, uid);
    res.status(201).json({ ok: true });
  });
  app.post('/api/auth/login', async (req, res) => {
    const v = z
      .object({ email: z.email().transform((v) => v.toLowerCase()), password: z.string().max(128) })
      .parse(req.body);
    if (db instanceof RemoteDatabase) {
      // Persist attempts so cold starts and multiple function instances share limits.
      const key = digest(
        `${options.serverless ? req.get('x-real-ip') || req.ip : req.ip}:${v.email}`,
      );
      const outcome = await db.withTransaction(async () => {
        await db.prepare('DELETE FROM login_attempts WHERE until<=?').run(Date.now());
        const attempt = await db.prepare('SELECT * FROM login_attempts WHERE key=?').get(key);
        if (attempt && Number(attempt.count) >= 6)
          return { locked: true, valid: false, user: null, count: Number(attempt.count) };
        const user = (await db.prepare('SELECT * FROM users WHERE email=?').get(v.email)) as any;
        const valid = user
          ? verifyPassword(v.password, user.password_hash)
          : (scryptDummy(v.password), false);
        const count = Number(attempt?.count ?? 0) + 1;
        if (valid) await db.prepare('DELETE FROM login_attempts WHERE key=?').run(key);
        else
          await db
            .prepare(
              'INSERT INTO login_attempts VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,until=excluded.until',
            )
            .run(key, count, Date.now() + 15 * 60_000);
        return { locked: false, valid, user, count };
      });
      if (outcome.locked) fail(429, 'Too many attempts. Try again in 15 minutes.');
      if (!outcome.valid) {
        await delay(Math.min(outcome.count * 100, 600));
        fail(401, 'Email or password is incorrect.');
      }
      if (outcome.user.suspended)
        fail(403, 'This account is suspended. Contact the administrator.');
      await setSession(res, outcome.user.id);
      res.json({ ok: true });
      return;
    }
    const key = `${req.ip}:${v.email}`,
      attempt = attempts.get(key);
    if (attempt && attempt.until > Date.now() && attempt.count >= 6)
      fail(429, 'Too many attempts. Try again in 15 minutes.');
    const u = (await db.prepare('SELECT * FROM users WHERE email=?').get(v.email)) as any;
    const valid = u
      ? verifyPassword(v.password, u.password_hash)
      : (scryptDummy(v.password), false);
    if (!valid) {
      if (!attempts.has(key) && attempts.size >= 10000)
        attempts.delete(attempts.keys().next().value!);
      const count = attempt && attempt.until > Date.now() ? attempt.count + 1 : 1;
      attempts.set(key, {
        count,
        until: Date.now() + 15 * 60 * 1000,
      });
      await delay(Math.min(count * 100, 600));
      fail(401, 'Email or password is incorrect.');
    }
    if (u.suspended) fail(403, 'This account is suspended. Contact the local administrator.');
    attempts.delete(key);
    await setSession(res, u.id);
    res.json({ ok: true });
  });
  app.post('/api/auth/logout', async (req, res) => {
    const raw = req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(cookieName + '='))
      ?.split('=')[1];
    if (raw) await db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(raw));
    res.clearCookie(cookieName, cookieOptions);
    res.json({ ok: true });
  });
  app.patch('/api/profile', async (req, res) => {
    const u = await actor(req),
      v = z.object({ name: text(2, 80), bio: z.string().trim().max(500) }).parse(req.body);
    await db.prepare('UPDATE users SET name=?,bio=? WHERE id=?').run(v.name, v.bio, u.id);
    await audit(u.id, 'profile.update', u.id);
    res.json({ ok: true });
  });
  app.post('/api/profile/password', async (req, res) => {
    const u = await actor(req),
      v = z.object({ currentPassword: z.string().max(128), newPassword: password }).parse(req.body);
    if (!verifyPassword(v.currentPassword, u.password_hash))
      fail(400, 'Current password is incorrect.');
    await transaction(db, async () => {
      await db
        .prepare('UPDATE users SET password_hash=? WHERE id=?')
        .run(hashPassword(v.newPassword), u.id);
      await db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
      await audit(u.id, 'password.change', u.id);
    });
    await setSession(res, u.id);
    res.json({ ok: true });
  });
  app.post('/api/profile/deletion-request', async (req, res) => {
    const u = await actor(req);
    await transaction(db, async () => {
      await audit(u.id, 'account.deletion-request', u.id);
      for (const admin of (await db
        .prepare("SELECT id FROM users WHERE role='admin' AND suspended=0")
        .all()) as any[])
        await notify(
          admin.id,
          `${u.name} (${u.email}) requested account deletion. Verify the request and arrange retention or removal of related records.`,
        );
    });
    res.json({ ok: true });
  });
  app.post(
    '/api/uploads',
    async (req, res, next) => {
      await host(req);
      next();
    },
    upload.array('photos', 8),
    async (req, res) => {
      const files = req.files as Express.Multer.File[];
      if (!files?.length) fail(400, 'Choose at least one image.');
      if (options.serverless && files.length > 1) fail(400, 'Upload one photo per request.');
      const prepared: {
        buffer: Buffer;
        name: string;
      }[] = [];
      // Decode every image before writing any, including files later in a batch.
      for (const file of files) {
        const extension = imageExtension(file.buffer);
        let buffer: Buffer;
        try {
          buffer = await sharp(file.buffer, { limitInputPixels: 40000000, failOn: 'warning' })
            .rotate()
            .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
            .toFormat(extension === 'jpg' ? 'jpeg' : extension)
            .toBuffer();
        } catch {
          fail(
            400,
            'The photo could not be decoded. Upload a valid JPEG, PNG, or WebP under 40 megapixels.',
          );
        }
        prepared.push({ buffer: buffer!, name: `${digest(buffer!)}.${extension}` });
      }
      for (const f of prepared) await installImage(f.name, f.buffer);
      res.status(201).json({ images: prepared.map((f) => `/uploads/${f.name}`) });
    },
  );
  app.post('/api/properties', async (req, res) => {
    const u = await host(req),
      v = propertyInput.parse(req.body),
      pid = id();
    for (const image of [v.image, ...v.images])
      if (image.startsWith('/uploads/') && !(await photoExists(image.slice(9))))
        fail(400, 'An uploaded image was not found.');
    const p = { ...v, id: pid, hostId: u.id, suspended: false, approval: 'pending' };
    await transaction(db, async () => {
      await db
        .prepare('INSERT INTO properties VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(
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
      await audit(u.id, 'listing.create', pid);
    });
    res.status(201).json({ ok: true, id: pid });
  });
  app.patch('/api/properties/:id', async (req, res) => {
    const { u, p } = await ownProperty(req, String(req.params.id)),
      v = propertyInput.parse(req.body);
    for (const image of [v.image, ...v.images])
      if (image.startsWith('/uploads/') && !(await photoExists(image.slice(9))))
        fail(400, 'An uploaded image was not found.');
    const details = { ...v, id: p.id, hostId: u.id };
    await transaction(db, async () => {
      await db
        .prepare(
          'UPDATE properties SET title=?,neighborhood=?,price=?,capacity=?,lat=?,lng=?,published=?,approval=?,details=? WHERE id=?',
        )
        .run(
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
      await audit(u.id, 'listing.edit', p.id);
      await notify(
        u.id,
        'Your edited listing is awaiting admin review. Existing bookings are preserved.',
      );
    });
    res.json({ ok: true });
  });
  app.post('/api/properties/:id/publish', async (req, res) => {
    const { u, p } = await ownProperty(req, String(req.params.id));
    const v = z.object({ published: z.boolean() }).parse(req.body);
    await db.prepare('UPDATE properties SET published=? WHERE id=?').run(Number(v.published), p.id);
    await audit(u.id, v.published ? 'listing.publish' : 'listing.unpublish', p.id);
    res.json({ ok: true });
  });
  app.post('/api/properties/:id/block', async (req, res) => {
    const { u, p } = await ownProperty(req, String(req.params.id)),
      v = z.object({ start: date, end: date, reason: text(1, 200) }).parse(req.body);
    validateDates(v.start, v.end);
    await transaction(db, async () => {
      if (await overlaps(p.id, v.start, v.end))
        fail(409, 'Those dates overlap a reservation or an existing block.');
      await db
        .prepare('INSERT INTO blocked_dates VALUES(?,?,?,?,?)')
        .run(id(), p.id, v.start, v.end, v.reason);
      await audit(u.id, 'calendar.block', p.id);
    });
    res.status(201).json({ ok: true });
  });
  app.delete('/api/blocks/:id', async (req, res) => {
    const b = (await db
      .prepare('SELECT * FROM blocked_dates WHERE id=?')
      .get(String(req.params.id))) as any;
    if (!b) fail(404, 'Date block not found.');
    const { u } = await ownProperty(req, b.property_id);
    await db.prepare('DELETE FROM blocked_dates WHERE id=?').run(b.id);
    await audit(u.id, 'calendar.unblock', b.id);
    res.json({ ok: true });
  });
  app.post('/api/bookings', async (req, res) => {
    const u = await actor(req, 'guest'),
      v = bookingInput.parse(req.body);
    validateDates(v.checkIn, v.checkOut);
    const booking = await transaction(db, async () => {
      const p = await rawProperty(db, v.propertyId);
      if (!(await publiclyAvailable(p))) fail(409, 'This property is no longer bookable.');
      if (v.guests > p.capacity) fail(400, 'Guest count exceeds property capacity.');
      if (await overlaps(p.id, v.checkIn, v.checkOut))
        fail(409, 'Those dates are already reserved or blocked.');
      const bid = id(),
        reference = `LS-${randomBytes(6).toString('hex').toUpperCase()}`;
      await db
        .prepare('INSERT INTO reservations VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(
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
      await notify(u.id, `Booking ${reference} confirmed for ${p.title}.`);
      await notify(p.host_id, `${u.name} booked ${p.title}: ${v.checkIn} to ${v.checkOut}.`);
      await audit(u.id, 'booking.create', bid);
      return bid;
    });
    res.status(201).json({ ok: true, id: booking });
  });
  app.post('/api/bookings/:id/cancel', async (req, res) => {
    const u = await actor(req),
      r = (await db
        .prepare('SELECT * FROM reservations WHERE id=?')
        .get(String(req.params.id))) as any;
    if (!r || !(u.role === 'admin' || (u.role === 'guest' && r.guest_id === u.id)))
      fail(404, 'Reservation not found.');
    if (r.status !== 'confirmed' || (u.role !== 'admin' && r.check_in < today()))
      fail(409, 'Only upcoming confirmed reservations can be cancelled.');
    await transaction(db, async () => {
      await db.prepare("UPDATE reservations SET status='cancelled' WHERE id=?").run(r.id);
      await notify(r.guest_id, `Booking ${r.reference} was cancelled.`);
      await notify(
        (await rawProperty(db, r.property_id)).host_id,
        `Booking ${r.reference} was cancelled; dates are available again.`,
      );
      await audit(u.id, 'booking.cancel', r.id);
    });
    res.json({ ok: true });
  });
  app.post('/api/bookings/:id/status', async (req, res) => {
    const u = await actor(req),
      r = (await db
        .prepare('SELECT * FROM reservations WHERE id=?')
        .get(String(req.params.id))) as any;
    const v = z.object({ status: z.enum(['checked-in', 'completed']) }).parse(req.body);
    if (
      !r ||
      !(
        u.role === 'admin' ||
        (u.role === 'host' &&
          u.host_status === 'approved' &&
          (await rawProperty(db, r.property_id))?.host_id === u.id)
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
    await transaction(db, async () => {
      await db.prepare('UPDATE reservations SET status=? WHERE id=?').run(v.status, r.id);
      await notify(
        r.guest_id,
        `Booking ${r.reference}: ${v.status === 'completed' ? 'checkout complete. You can now leave a review.' : 'checked in. Enjoy your stay!'}`,
      );
      await audit(u.id, `booking.${v.status}`, r.id);
    });
    res.json({ ok: true });
  });
  app.post('/api/favorites/:id', async (req, res) => {
    const u = await actor(req, 'guest'),
      p = await rawProperty(db, String(req.params.id));
    const existing = await db
      .prepare('SELECT * FROM favorites WHERE user_id=? AND property_id=?')
      .get(u.id, String(req.params.id));
    if (!existing && !(await publiclyAvailable(p))) fail(404, 'Property not found.');
    if (existing)
      await db
        .prepare('DELETE FROM favorites WHERE user_id=? AND property_id=?')
        .run(u.id, String(req.params.id));
    else await db.prepare('INSERT INTO favorites VALUES(?,?)').run(u.id, p.id);
    res.json({ ok: true });
  });
  app.post('/api/threads', async (req, res) => {
    const u = await actor(req, 'guest'),
      v = z.object({ propertyId: text() }).parse(req.body),
      p = await rawProperty(db, v.propertyId);
    if (!(await publiclyAvailable(p))) fail(404, 'Property not found.');
    let thread = (await db
      .prepare('SELECT id FROM threads WHERE guest_id=? AND property_id=?')
      .get(u.id, p.id)) as any;
    if (!thread) {
      thread = { id: id() };
      await db
        .prepare('INSERT INTO threads VALUES(?,?,?,?,?)')
        .run(thread.id, p.id, u.id, p.host_id, stamp());
    } else await db.prepare('UPDATE threads SET updated_at=? WHERE id=?').run(stamp(), thread.id);
    res.json({ ok: true, id: thread.id });
  });
  app.post('/api/threads/:id/messages', async (req, res) => {
    const u = await actor(req),
      t = (await db
        .prepare('SELECT * FROM threads WHERE id=? AND (guest_id=? OR host_id=?)')
        .get(String(req.params.id), u.id, u.id)) as any;
    if (!t) fail(404, 'Conversation not found.');
    const v = z.object({ body: text(1, 2000) }).parse(req.body);
    await transaction(db, async () => {
      await db
        .prepare('INSERT INTO messages VALUES(?,?,?,?,?)')
        .run(id(), t.id, u.id, v.body, stamp());
      await db.prepare('UPDATE threads SET updated_at=? WHERE id=?').run(stamp(), t.id);
      await notify(
        u.id === t.guest_id ? t.host_id : t.guest_id,
        `New message from ${u.name} about ${(await rawProperty(db, t.property_id)).title}.`,
      );
    });
    res.status(201).json({ ok: true });
  });
  app.post('/api/notifications/read', async (req, res) => {
    const u = await actor(req);
    await db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(u.id);
    res.json({ ok: true });
  });
  app.post('/api/reviews', async (req, res) => {
    const u = await actor(req, 'guest'),
      v = z
        .object({ bookingId: text(), rating: z.number().int().min(1).max(5), body: text(10, 1000) })
        .parse(req.body),
      r = (await db
        .prepare("SELECT * FROM reservations WHERE id=? AND guest_id=? AND status='completed'")
        .get(v.bookingId, u.id)) as any;
    if (!r) fail(403, 'Reviews are available only for your completed stays.');
    if (await db.prepare('SELECT id FROM reviews WHERE booking_id=?').get(r.id))
      fail(409, 'This stay already has a review.');
    await transaction(db, async () => {
      await db
        .prepare('INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?)')
        .run(id(), r.id, r.property_id, u.id, v.rating, v.body, 0, stamp());
      await notify(
        (await rawProperty(db, r.property_id)).host_id,
        `${u.name} reviewed your property.`,
      );
      await audit(u.id, 'review.create', r.id);
    });
    res.status(201).json({ ok: true });
  });
  app.post('/api/admin/users/:id', async (req, res) => {
    const u = await actor(req, 'admin'),
      target = await rawUser(db, String(req.params.id)),
      v = z.object({ action: z.enum(['approve', 'reject', 'suspend', 'restore']) }).parse(req.body);
    if (!target) fail(404, 'Account not found.');
    if (target.role === 'admin') fail(403, 'Administrator accounts cannot be modified here.');
    await transaction(db, async () => {
      if (['approve', 'reject'].includes(v.action)) {
        if (target.role !== 'host')
          fail(400, 'Only host applications can be approved or rejected.');
        await db
          .prepare('UPDATE users SET host_status=? WHERE id=?')
          .run(v.action === 'approve' ? 'approved' : 'rejected', target.id);
      } else {
        await db
          .prepare('UPDATE users SET suspended=? WHERE id=?')
          .run(v.action === 'suspend' ? 1 : 0, target.id);
        if (v.action === 'suspend')
          await db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
      }
      await notify(target.id, `Account action: ${v.action}.`);
      await audit(u.id, `account.${v.action}`, target.id);
    });
    res.json({ ok: true });
  });
  app.post('/api/admin/users/:id/password', async (req, res) => {
    const u = await actor(req, 'admin');
    const target = await rawUser(db, String(req.params.id));
    const v = z.object({ temporaryPassword: password }).parse(req.body);
    if (!target) fail(404, 'Account not found.');
    if (target.role === 'admin') fail(403, 'Administrator accounts cannot be modified here.');
    await transaction(db, async () => {
      await db
        .prepare('UPDATE users SET password_hash=? WHERE id=?')
        .run(hashPassword(v.temporaryPassword), target.id);
      await db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
      await audit(u.id, 'account.password-reset', target.id);
      await notify(
        target.id,
        'Your password was reset by an administrator. Change it in Profile after signing in.',
      );
    });
    res.json({ ok: true });
  });
  app.post('/api/admin/properties/:id', async (req, res) => {
    const u = await actor(req, 'admin'),
      p = await rawProperty(db, String(req.params.id)),
      v = z.object({ action: z.enum(['approve', 'reject', 'suspend', 'restore']) }).parse(req.body);
    if (!p) fail(404, 'Listing not found.');
    await transaction(db, async () => {
      if (['approve', 'reject'].includes(v.action))
        await db
          .prepare('UPDATE properties SET approval=? WHERE id=?')
          .run(v.action === 'approve' ? 'approved' : 'rejected', p.id);
      else
        await db
          .prepare('UPDATE properties SET suspended=? WHERE id=?')
          .run(v.action === 'suspend' ? 1 : 0, p.id);
      await notify(p.host_id, `${p.title}: ${v.action}.`);
      await audit(u.id, `listing.${v.action}`, p.id);
    });
    res.json({ ok: true });
  });
  app.post('/api/admin/reviews/:id', async (req, res) => {
    const u = await actor(req, 'admin'),
      v = z.object({ hidden: z.boolean() }).parse(req.body);
    if (!(await db.prepare('SELECT id FROM reviews WHERE id=?').get(String(req.params.id))))
      fail(404, 'Review not found.');
    await db
      .prepare('UPDATE reviews SET hidden=? WHERE id=?')
      .run(Number(v.hidden), String(req.params.id));
    await audit(u.id, v.hidden ? 'review.hide' : 'review.restore', String(req.params.id));
    res.json({ ok: true });
  });
  app.get('/api/reports', async (req, res) => {
    const u = await actor(req);
    if (!['host', 'admin'].includes(u.role)) fail(403, 'Reports are for hosts and admins.');
    const start = String(req.query.start ?? today().slice(0, 7) + '-01'),
      end = String(req.query.end ?? addMonthsEnd(start));
    validateDates(start, end, '0000-01-01');
    if (nights(start, end) > 366) fail(400, 'Choose a reporting period of at most 366 days.');
    const properties = ((await db.prepare('SELECT * FROM properties').all()) as any[]).filter(
      (p) => u.role === 'admin' || p.host_id === u.id,
    );
    const rs = (
      (await db
        .prepare(
          "SELECT * FROM reservations WHERE status!='cancelled' AND check_in<? AND check_out>?",
        )
        .all(end, start)) as any[]
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
  if (options.photoStore) {
    app.get(['/api/uploads-file/:name', '/uploads/:name'], async (req, res) => {
      const name = String(req.params.name);
      if (!/^[a-f0-9]{64}\.(jpg|png|webp)$/.test(name)) fail(404, 'Photo not found.');
      const url = await options.photoStore!.url(name);
      if (!url) fail(404, 'Photo not found.');
      res.redirect(307, url!);
    });
  } else {
    app.use(
      '/uploads',
      express.static(options.uploadsPath, { dotfiles: 'deny', immutable: true, maxAge: '1y' }),
    );
  }
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
        : error.type === 'entity.too.large'
          ? 413
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
  return {
    app,
    db: db as TDatabase,
    close: () => {
      clearInterval(cleanup);
      db.close();
    },
  };
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
