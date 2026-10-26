import { expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRemoteDatabase, RemoteDatabase } from './remote-db.js';
import { openDatabase } from './db.js';

it('migrates and reopens remote databases without PRAGMA statements', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'stay-migrations-'));
  const prepare = RemoteDatabase.prototype.prepare;
  const batch = RemoteDatabase.prototype.batch;
  const prepareSpy = vi.spyOn(RemoteDatabase.prototype, 'prepare').mockImplementation(function (
    this: RemoteDatabase,
    sql,
  ) {
    expect(sql).not.toMatch(/\bPRAGMA\b/i);
    return prepare.call(this, sql);
  });
  const batchSpy = vi.spyOn(RemoteDatabase.prototype, 'batch').mockImplementation(function (
    this: RemoteDatabase,
    statements,
  ) {
    for (const statement of statements)
      expect(typeof statement === 'string' ? statement : statement.sql).not.toMatch(/\bPRAGMA\b/i);
    return batch.call(this, statements);
  });
  try {
    const fresh = `file:${join(directory, 'fresh.sqlite')}`;
    for (let i = 0; i < 2; i++) {
      const db = await openRemoteDatabase(fresh, undefined, false);
      try {
        expect(
          (await db.prepare('SELECT MAX(version) AS version FROM migrations').get())!.version,
        ).toBe(4);
        expect(await db.prepare('SELECT * FROM google_identities').all()).toEqual([]);
      } finally {
        db.close();
      }
    }
    const legacyPath = join(directory, 'legacy.sqlite');
    const legacy = openDatabase(legacyPath);
    legacy.exec(
      'DROP TABLE oauth_requests; DROP TABLE google_identities; DELETE FROM migrations WHERE version=4; PRAGMA user_version=3;',
    );
    legacy.close();
    const migrated = await openRemoteDatabase(`file:${legacyPath}`, undefined, false);
    try {
      expect(
        (await migrated.prepare('SELECT MAX(version) AS version FROM migrations').get())!.version,
      ).toBe(4);
      expect(await migrated.prepare('SELECT * FROM google_identities').all()).toEqual([]);
      await migrated.prepare("INSERT INTO migrations VALUES(99,datetime('now'))").run();
    } finally {
      migrated.close();
    }
    await expect(openRemoteDatabase(`file:${legacyPath}`, undefined, false)).rejects.toThrow(
      'newer schema',
    );
  } finally {
    prepareSpy.mockRestore();
    batchSpy.mockRestore();
    rmSync(directory, { recursive: true, force: true });
  }
});
