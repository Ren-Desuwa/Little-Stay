import { createClient } from '@libsql/client';
import { head, put } from '@vercel/blob';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { openRemoteDatabase, DATA_TABLES } from '../server/remote-db.ts';
import { openDatabase, verifyPassword } from '../server/db.ts';

const photoName = /^[a-f0-9]{64}\.(jpg|png|webp)$/;
export function referencedPhotos(tables) {
  const names = new Set();
  for (const property of tables.properties ?? []) {
    const details = JSON.parse(property.details);
    for (const image of [details.image, ...(details.images ?? [])])
      if (typeof image === 'string' && image.startsWith('/uploads/')) {
        const name = image.slice(9);
        if (!photoName.test(name)) throw new Error('Invalid uploaded-photo path in the snapshot.');
        names.add(name);
      }
  }
  return [...names];
}

export async function backupCloud(destination, env = process.env) {
  if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN || !env.BLOB_READ_WRITE_TOKEN)
    throw new Error('Set Turso and Blob credentials before backing up.');
  const folder = join(
    resolve(destination),
    new Date().toISOString().replaceAll(':', '-') + '-' + crypto.randomUUID().slice(0, 8),
  );
  mkdirSync(join(folder, 'uploads'), { recursive: true, mode: 0o700 });
  chmodSync(folder, 0o700);
  const client = createClient({
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN,
    intMode: 'number',
  });
  try {
    const tx = await client.transaction('read');
    const tables = {};
    try {
      const version = Number(
        (await tx.execute('SELECT MAX(version) AS version FROM migrations')).rows[0].version,
      );
      if (version !== 4)
        throw new Error('Upgrade the application schema before taking a cloud backup.');
      for (const table of DATA_TABLES)
        tables[table] = (await tx.execute(`SELECT * FROM ${table}`)).rows;
      await tx.commit();
    } finally {
      tx.close();
    }
    for (const name of referencedPhotos(tables)) {
      const blob = await head(`uploads/${name}`, { token: env.BLOB_READ_WRITE_TOKEN });
      const response = await fetch(blob.url);
      if (!response.ok) throw new Error(`Could not download photo ${name}.`);
      writeFileSync(join(folder, 'uploads', name), Buffer.from(await response.arrayBuffer()), {
        mode: 0o600,
      });
    }
    writeFileSync(
      join(folder, 'snapshot.json'),
      JSON.stringify({ version: 1, schemaVersion: 4, createdAt: new Date().toISOString(), tables }),
      { mode: 0o600 },
    );
    return folder;
  } catch (error) {
    rmSync(folder, { recursive: true, force: true });
    throw error;
  } finally {
    client.close();
  }
}

export async function migrateCloud(sourceDirectory, env = process.env) {
  if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN || !env.BLOB_READ_WRITE_TOKEN)
    throw new Error('Set Turso and Blob credentials before migrating.');
  const source = resolve(sourceDirectory);
  let tables;
  if (existsSync(join(source, 'snapshot.json'))) {
    const snapshot = JSON.parse(readFileSync(join(source, 'snapshot.json'), 'utf8'));
    if (snapshot.version !== 1 || ![3, 4].includes(snapshot.schemaVersion))
      throw new Error('Unsupported snapshot.');
    tables = snapshot.tables;
    if (snapshot.schemaVersion === 3) tables.google_identities = [];
  } else {
    const path = join(source, 'little-stay.sqlite');
    if (!existsSync(path)) throw new Error('Source database not found.');
    const db = openDatabase(path);
    try {
      tables = Object.fromEntries(
        DATA_TABLES.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]),
      );
    } finally {
      db.close();
    }
  }
  for (const table of DATA_TABLES)
    if (!Array.isArray(tables[table])) throw new Error(`Missing table ${table}.`);
  if (!tables.users.some((u) => u.role === 'admin' && !u.suspended))
    throw new Error('The source must contain an active administrator.');
  if (
    env.LITTLE_STAY_SEED !== 'demo' &&
    tables.users.some(
      (u) =>
        u.email.endsWith('@littlestay.local') && verifyPassword('LittleStay123!', u.password_hash),
    )
  )
    throw new Error(
      'Change demo passwords or explicitly set LITTLE_STAY_SEED=demo before importing a public demonstration.',
    );
  const photos = referencedPhotos(tables);
  // Check the complete source before making changes to remote storage.
  for (const name of photos)
    if (!existsSync(join(source, 'uploads', name)))
      throw new Error(`Missing source photo ${name}.`);
  const db = await openRemoteDatabase(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN, false);
  try {
    if (await db.prepare('SELECT id FROM users LIMIT 1').get())
      throw new Error(
        'Destination is not empty. Import into a fresh Turso database before deploying.',
      );
    for (const name of photos)
      await put(`uploads/${name}`, readFileSync(join(source, 'uploads', name)), {
        token: env.BLOB_READ_WRITE_TOKEN,
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: name.endsWith('.jpg')
          ? 'image/jpeg'
          : name.endsWith('.png')
            ? 'image/png'
            : 'image/webp',
      });
    await db.withTransaction(async () => {
      const statements = [];
      for (const table of DATA_TABLES) {
        if (await db.prepare(`SELECT * FROM ${table} LIMIT 1`).get())
          throw new Error('Destination is not empty. Nothing was imported.');
        const allowed = new Set(
          (await db.prepare(`PRAGMA table_info(${table})`).all()).map((c) => c.name),
        );
        for (const row of tables[table]) {
          const columns = Object.keys(row);
          if (columns.length !== allowed.size || columns.some((c) => !allowed.has(c)))
            throw new Error(`Invalid columns for ${table}.`);
          statements.push({
            sql: `INSERT INTO ${table} (${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
            args: Object.values(row),
          });
        }
      }
      await db.batch(statements);
      // Sessions are intentionally omitted: every account signs in again after migration/restore.
    });
    return {
      users: tables.users.length,
      properties: tables.properties.length,
      photos: photos.length,
    };
  } finally {
    db.close();
  }
}
