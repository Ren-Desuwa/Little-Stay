import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { seedData, photos, propertyPhotos } from '../src/lib/seed';
import { today, addDays } from '../src/lib/model';
import { AUTH_SCHEMA } from './auth-schema';

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, hash: string) {
  if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash)) return false;
  const [salt, key] = hash.split(':');
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(key, 'hex'));
}
export const INITIAL_SCHEMA = `
    CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('guest','host','admin')),host_status TEXT NOT NULL CHECK(host_status IN ('pending','approved','rejected')),suspended INTEGER NOT NULL DEFAULT 0,bio TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS properties(id TEXT PRIMARY KEY,host_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,neighborhood TEXT NOT NULL,price REAL NOT NULL CHECK(price>0),capacity INTEGER NOT NULL CHECK(capacity>0),lat REAL NOT NULL,lng REAL NOT NULL,published INTEGER NOT NULL,suspended INTEGER NOT NULL,approval TEXT NOT NULL CHECK(approval IN ('pending','approved','rejected')),details TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reservations(id TEXT PRIMARY KEY,reference TEXT NOT NULL UNIQUE,property_id TEXT NOT NULL REFERENCES properties(id),guest_id TEXT NOT NULL REFERENCES users(id),check_in TEXT NOT NULL,check_out TEXT NOT NULL CHECK(check_out>check_in),guests INTEGER NOT NULL,nightly_rate REAL NOT NULL,total REAL NOT NULL,status TEXT NOT NULL CHECK(status IN ('confirmed','cancelled','checked-in','completed')),created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS reservation_dates ON reservations(property_id,status,check_in,check_out);
    CREATE TABLE IF NOT EXISTS blocked_dates(id TEXT PRIMARY KEY,property_id TEXT NOT NULL REFERENCES properties(id),start TEXT NOT NULL,end TEXT NOT NULL CHECK(end>start),reason TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS favorites(user_id TEXT NOT NULL REFERENCES users(id),property_id TEXT NOT NULL REFERENCES properties(id),PRIMARY KEY(user_id,property_id));
    CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,read INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY,property_id TEXT NOT NULL REFERENCES properties(id),guest_id TEXT NOT NULL REFERENCES users(id),host_id TEXT NOT NULL REFERENCES users(id),updated_at TEXT NOT NULL,UNIQUE(property_id,guest_id));
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES threads(id),sender_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,booking_id TEXT NOT NULL UNIQUE REFERENCES reservations(id),property_id TEXT NOT NULL REFERENCES properties(id),guest_id TEXT NOT NULL REFERENCES users(id),rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),body TEXT NOT NULL,hidden INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,target_id TEXT NOT NULL,created_at TEXT NOT NULL);
    INSERT OR IGNORE INTO migrations VALUES(1,datetime('now'));
    PRAGMA user_version=1;`;

export function openDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF;',
  );
  const version = Number((db.prepare('PRAGMA user_version').get() as any).user_version);
  if (version > 4) {
    db.close();
    throw new Error('This database uses a newer schema. Update the application before opening it.');
  }
  if (version < 1) transaction(db, () => db.exec(INITIAL_SCHEMA));
  if (version < 2)
    transaction(db, () => {
      // Retain historical bookings and related records; retire only surplus generated listings.
      const retire = db.prepare(`UPDATE properties SET published=0 WHERE id=?
        AND host_id IN ('host-1','host-2')
        AND json_extract(details,'$.address') LIKE ?`);
      for (let i = 51; i <= 150; i++)
        retire.run(`stay-${String(i).padStart(3, '0')}`, `Fictional unit ${i}, %`);
      db.exec("INSERT OR IGNORE INTO migrations VALUES(2,datetime('now')); PRAGMA user_version=2;");
    });
  if (version < 3)
    transaction(db, () => {
      const update = db.prepare('UPDATE properties SET details=? WHERE id=?');
      for (let i = 0; i < 150; i++) {
        const row = db
          .prepare('SELECT details,host_id FROM properties WHERE id=?')
          .get(`stay-${String(i + 1).padStart(3, '0')}`) as any;
        if (!row || !['host-1', 'host-2'].includes(row.host_id)) continue;
        const details = JSON.parse(row.details);
        const oldImages = [photos[i % 6], photos[(i + 1) % 6]];
        // Upgrade only the original demo gallery; preserve uploaded and customized photos.
        if (
          !details.address?.startsWith(`Fictional unit ${i + 1}, `) ||
          details.image !== oldImages[0] ||
          JSON.stringify(details.images) !== JSON.stringify(oldImages)
        )
          continue;
        const images = propertyPhotos(i);
        update.run(
          JSON.stringify({ ...details, image: images[0], images }),
          `stay-${String(i + 1).padStart(3, '0')}`,
        );
      }
      db.exec("INSERT OR IGNORE INTO migrations VALUES(3,datetime('now')); PRAGMA user_version=3;");
    });
  if (version < 4)
    transaction(db, () => {
      db.exec(AUTH_SCHEMA);
      db.exec("INSERT OR IGNORE INTO migrations VALUES(4,datetime('now')); PRAGMA user_version=4;");
    });
  return db;
}
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
export function seedDatabase(db: DatabaseSync) {
  if (process.env.NODE_ENV === 'production' && process.env.LITTLE_STAY_SEED !== 'demo') return;
  if ((db.prepare('SELECT COUNT(*) AS n FROM users').get() as any).n) return;
  transaction(db, () => {
    const base = seedData();
    const emails = ['alex', 'jamie', 'isabel', 'marco', 'admin'];
    base.users.forEach((u, i) =>
      db
        .prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)')
        .run(
          u.id,
          u.name,
          `${emails[i]}@littlestay.local`,
          hashPassword('LittleStay123!'),
          u.role,
          'approved',
          0,
          '',
        ),
    );
    for (let i = 0; i < 50; i++) {
      const template = base.properties[i % 15];
      const ring = Math.floor(i / 15);
      const angle = (i * 137.508 * Math.PI) / 180;
      const radius = ring === 0 ? 0 : 0.00065 + ring * 0.00028;
      const propertyType =
        ring === 0 && template.title.includes('Studio')
          ? 'Studio'
          : ['Studio', 'Apartment', 'House', 'Private room'][i % 4];
      const p = {
        ...template,
        id: `stay-${String(i + 1).padStart(3, '0')}`,
        title:
          ring === 0
            ? template.title
            : `${template.neighborhood} ${['Courtyard', 'Sunrise', 'Acacia', 'Haven', 'Terrace', 'Nest', 'Vista', 'Luna', 'Bamboo'][ring - 1]} ${propertyType} ${i + 1}`,
        lat: template.lat + Math.sin(angle) * radius,
        lng: template.lng + Math.cos(angle) * radius,
        price: ring === 0 ? template.price : 1200 + ((i * 173) % 4300),
        capacity: propertyType === 'House' ? 6 : propertyType === 'Apartment' ? 4 : 2,
        bedrooms: propertyType === 'Studio' ? 0 : propertyType === 'House' ? 3 : 1,
        propertyType,
        address: `Fictional unit ${i + 1}, ${template.neighborhood}, North Caloocan`,
        images: propertyPhotos(i),
        image: propertyPhotos(i)[0],
        houseRules: 'No smoking indoors. Quiet hours: 10 PM–7 AM. Please respect the neighborhood.',
        checkInInstructions:
          'Check in from 2 PM. Message your host for the key handover. Checkout by 11 AM.',
        approval: 'approved',
      };
      db.prepare('INSERT INTO properties VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(
        p.id,
        p.hostId,
        p.title,
        p.neighborhood,
        p.price,
        p.capacity,
        p.lat,
        p.lng,
        1,
        0,
        'approved',
        JSON.stringify(p),
      );
    }
    const bookings = [
      ['guest-1', 'stay-001', 5, 8, 'confirmed'],
      ['guest-2', 'stay-002', 10, 12, 'confirmed'],
      ['guest-1', 'stay-003', -8, -5, 'completed'],
      ['guest-1', 'stay-005', 0, 3, 'confirmed'],
      ['guest-2', 'stay-007', -2, 0, 'checked-in'],
      ['guest-2', 'stay-004', -10, -7, 'completed'],
    ];
    bookings.forEach(([guest, property, start, end, status], i) => {
      const p = db.prepare('SELECT price FROM properties WHERE id=?').get(property) as any;
      const rate = p.price;
      db.prepare('INSERT INTO reservations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
        `res-demo-${i + 1}`,
        `LS-DEMO000${i + 1}`,
        property,
        guest,
        addDays(today(), Number(start)),
        addDays(today(), Number(end)),
        2,
        rate,
        rate * (Number(end) - Number(start)),
        status,
        new Date().toISOString(),
      );
    });
    db.prepare('INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?)').run(
      'review-demo-1',
      'res-demo-3',
      'stay-003',
      'guest-1',
      5,
      'A peaceful little stay with a welcoming host and a comfortable workspace.',
      0,
      new Date().toISOString(),
    );
  });
}
export function ensureAdmin(db: DatabaseSync) {
  if (process.env.NODE_ENV === 'production' && process.env.LITTLE_STAY_SEED !== 'demo') {
    // An old local database must not silently publish known demo credentials.
    const demos = db
      .prepare("SELECT password_hash FROM users WHERE email LIKE '%@littlestay.local'")
      .all() as any[];
    if (demos.some((u) => verifyPassword('LittleStay123!', u.password_hash)))
      throw new Error(
        'Demo passwords found. Use a fresh production data directory or change all demo passwords.',
      );
  }
  if (db.prepare("SELECT id FROM users WHERE role='admin' AND suspended=0").get()) return;
  const { ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = process.env;
  if (email && password) {
    const credentials = z
      .object({ email: z.email().max(254), password: z.string().min(8).max(128) })
      .parse({ email: email.trim().toLowerCase(), password });
    db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run(
      randomUUID(),
      'Administrator',
      credentials.email,
      hashPassword(credentials.password),
      'admin',
      'approved',
      0,
      '',
    );
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Set ADMIN_EMAIL and ADMIN_PASSWORD to create the first production administrator.',
    );
  }
}
export function propertyFromRow(row: any) {
  return {
    ...JSON.parse(row.details),
    id: row.id,
    hostId: row.host_id,
    title: row.title,
    neighborhood: row.neighborhood,
    price: row.price,
    capacity: row.capacity,
    lat: row.lat,
    lng: row.lng,
    published: !!row.published,
    suspended: !!row.suspended,
    approval: row.approval,
  };
}
export function userFromRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    hostStatus: row.host_status,
    suspended: !!row.suspended,
    bio: row.bio,
    passwordLogin: !!row.password_hash,
  };
}
export function reservationFromRow(r: any) {
  return {
    id: r.id,
    reference: r.reference,
    propertyId: r.property_id,
    guestId: r.guest_id,
    checkIn: r.check_in,
    checkOut: r.check_out,
    guests: r.guests,
    nightlyRate: r.nightly_rate,
    total: r.total,
    status: r.status,
    createdAt: r.created_at,
  };
}
