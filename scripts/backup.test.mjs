import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup } from './backup.mjs';

it('backs up committed WAL data and photos into a private, independently readable snapshot', () => {
  const root = mkdtempSync(join(tmpdir(), 'stay-backup-'));
  const data = join(root, 'live');
  mkdirSync(join(data, 'uploads'), { recursive: true });
  const db = new DatabaseSync(join(data, 'little-stay.sqlite'));
  try {
    db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES('saved');",
    );
    const photo = 'a'.repeat(64) + '.jpg';
    writeFileSync(join(data, 'uploads', photo), 'photo bytes');
    writeFileSync(join(data, 'uploads', '.in-progress.tmp'), 'partial');
    const folder = backup(data, join(root, 'backups'));
    db.exec("INSERT INTO sample VALUES('later');");
    const snapshot = new DatabaseSync(join(folder, 'little-stay.sqlite'), { readOnly: true });
    try {
      expect(snapshot.prepare('SELECT * FROM sample').all()).toEqual([{ value: 'saved' }]);
    } finally {
      snapshot.close();
    }
    expect(readFileSync(join(folder, 'uploads', photo), 'utf8')).toBe('photo bytes');
    expect(statSync(folder).mode & 0o777).toBe(0o700);
    expect(statSync(join(folder, 'little-stay.sqlite')).mode & 0o777).toBe(0o600);
    expect(() => backup(data, join(data, 'uploads', 'backups'))).toThrow(/outside/);
    expect(() => backup(data, join(data, '..backups'))).toThrow(/outside/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
