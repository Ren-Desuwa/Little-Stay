import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, copyFileSync, chmodSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export function backup(dataDirectory, backupDirectory) {
  const source = resolve(dataDirectory);
  const destination = resolve(backupDirectory);
  const pathFromSource = relative(source, destination);
  if (!(
    pathFromSource === '..' ||
    pathFromSource.startsWith('..' + sep) ||
    isAbsolute(pathFromSource)
  ))
    throw new Error('Store backups outside the live data directory.');
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const folder = join(
    destination,
    new Date().toISOString().replaceAll(':', '-') + '-' + crypto.randomUUID().slice(0, 8),
  );
  mkdirSync(folder, { mode: 0o700 });
  let db;
  try {
    db = new DatabaseSync(join(source, 'little-stay.sqlite'), { readOnly: true });
    // SQLite produces a consistent database snapshot, including committed WAL data.
    db.exec(`VACUUM INTO '${join(folder, 'little-stay.sqlite').replaceAll("'", "''")}'`);
    chmodSync(join(folder, 'little-stay.sqlite'), 0o600);
    const uploads = join(folder, 'uploads');
    mkdirSync(uploads, { mode: 0o700 });
    for (const entry of readdirSync(join(source, 'uploads'), { withFileTypes: true })) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.(jpg|png|webp)$/.test(entry.name)) continue;
      copyFileSync(join(source, 'uploads', entry.name), join(uploads, entry.name));
      chmodSync(join(uploads, entry.name), 0o600);
    }
    writeFileSync(
      join(folder, 'manifest.json'),
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          schemaVersion: db.prepare('PRAGMA user_version').get().user_version,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    return folder;
  } catch (error) {
    rmSync(folder, { recursive: true, force: true });
    throw error;
  } finally {
    db?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.env.TURSO_DATABASE_URL) {
    const { backupCloud } = await import('./cloud-data.mjs');
    console.log(await backupCloud(process.argv[2] || '.local/backups'));
  } else
    console.log(
      backup(
        process.env.LITTLE_STAY_DATA_DIR || '.local/data',
        process.argv[2] || '.local/backups',
      ),
    );
}
