import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureAdmin, openDatabase, seedDatabase, verifyPassword } from './db';

let db: ReturnType<typeof openDatabase>;
beforeEach(() => {
  db = openDatabase(':memory:');
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('ADMIN_EMAIL', '');
  vi.stubEnv('ADMIN_PASSWORD', '');
  vi.stubEnv('LITTLE_STAY_SEED', '');
});
afterEach(() => {
  db.close();
  vi.unstubAllEnvs();
});

describe('production bootstrap', () => {
  it('seeds no demo data and refuses to start without an administrator', () => {
    seedDatabase(db);
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()!.n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM properties').get()!.n).toBe(0);
    expect(() => ensureAdmin(db)).toThrow(/ADMIN_EMAIL/);
  });
  it('hashes the initial admin password and does not overwrite it on restart', () => {
    vi.stubEnv('ADMIN_EMAIL', 'Owner@example.com');
    vi.stubEnv('ADMIN_PASSWORD', 'PrivatePass123!');
    ensureAdmin(db);
    const admin = db.prepare("SELECT * FROM users WHERE role='admin'").get() as any;
    expect(admin.email).toBe('owner@example.com');
    expect(verifyPassword('PrivatePass123!', admin.password_hash)).toBe(true);
    expect(admin.password_hash).not.toContain('PrivatePass123!');
    vi.stubEnv('ADMIN_PASSWORD', 'ChangedEnv123!');
    ensureAdmin(db);
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()!.n).toBe(1);
    expect(db.prepare('SELECT password_hash FROM users').get()!.password_hash).toBe(
      admin.password_hash,
    );
  });
  it('rejects weak or incomplete bootstrap credentials', () => {
    vi.stubEnv('ADMIN_EMAIL', 'owner@example.com');
    expect(() => ensureAdmin(db)).toThrow();
    vi.stubEnv('ADMIN_PASSWORD', 'short');
    expect(() => ensureAdmin(db)).toThrow();
  });
  it('requires explicit demo mode before publishing known demo passwords', () => {
    vi.stubEnv('LITTLE_STAY_SEED', 'demo');
    seedDatabase(db);
    expect(() => ensureAdmin(db)).not.toThrow();
    vi.stubEnv('LITTLE_STAY_SEED', '');
    expect(() => ensureAdmin(db)).toThrow(/Demo passwords/);
  });
});
