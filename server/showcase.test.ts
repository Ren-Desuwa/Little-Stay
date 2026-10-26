import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRemoteDatabase } from './remote-db.js';
import { region } from '../src/lib/region.js';
import { today } from '../src/lib/model.js';

afterEach(() => vi.unstubAllEnvs());
it('adds the demo alongside an existing admin exactly once, with 3/12/40 listings and guest histories', async () => {
  vi.stubEnv('LITTLE_STAY_SEED', '');
  vi.stubEnv('ADMIN_EMAIL', 'owner@example.com');
  vi.stubEnv('ADMIN_PASSWORD', 'TestAdministrator123!');
  const directory = mkdtempSync(join(tmpdir(), 'stay-showcase-'));
  const url = `file:${join(directory, 'db.sqlite')}`;
  let db = await openRemoteDatabase(url);
  try {
    const admin = (await db.prepare("SELECT * FROM users WHERE role='admin'").get())!;
    db.close();
    vi.stubEnv('LITTLE_STAY_SEED', 'demo');
    vi.stubEnv('LITTLE_STAY_DEMO_PROFILE', 'voronoi');
    db = await openRemoteDatabase(url);
    expect(await db.prepare("SELECT * FROM users WHERE role='admin'").get()).toEqual(admin);
    expect(
      await db
        .prepare('SELECT host_id,COUNT(*) AS n FROM properties GROUP BY host_id ORDER BY host_id')
        .all(),
    ).toEqual([
      { host_id: 'host-1', n: 3 },
      { host_id: 'host-2', n: 12 },
      { host_id: 'host-3', n: 40 },
    ]);
    for (const guest of ['guest-1', 'guest-2']) {
      const bookings = await db.prepare('SELECT * FROM reservations WHERE guest_id=?').all(guest);
      expect(bookings.some((b) => b.status === 'completed' && String(b.check_out) < today())).toBe(
        true,
      );
      expect(bookings.some((b) => b.status === 'confirmed' && String(b.check_in) > today())).toBe(
        true,
      );
    }
    const properties = await db.prepare('SELECT * FROM properties').all();
    expect(new Set(properties.map((p) => `${p.lat},${p.lng}`)).size).toBe(55);
    for (const p of properties) {
      expect(Number(p.lat)).toBeGreaterThan(region.bounds.south);
      expect(Number(p.lat)).toBeLessThan(region.bounds.north);
      expect(Number(p.lng)).toBeGreaterThan(region.bounds.west);
      expect(Number(p.lng)).toBeLessThan(region.bounds.east);
      expect(JSON.parse(String(p.details)).hostId).toBe(p.host_id);
    }
    await db.prepare("UPDATE users SET name='Edited demo guest' WHERE id='guest-1'").run();
    db.close();
    db = await openRemoteDatabase(url);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM properties').get())!.n).toBe(55);
    expect((await db.prepare("SELECT name FROM users WHERE id='guest-1'").get())!.name).toBe(
      'Edited demo guest',
    );
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
