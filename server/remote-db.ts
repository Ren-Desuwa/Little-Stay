import { AsyncLocalStorage } from 'node:async_hooks';
import {
  createClient,
  type Client,
  type Transaction,
  type InValue,
  type InStatement,
} from '@libsql/client';
import type { DatabaseSync } from 'node:sqlite';
import { INITIAL_SCHEMA, openDatabase, seedDatabase, hashPassword, verifyPassword } from './db.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import { AUTH_SCHEMA } from './auth-schema.js';
import { showcaseStatements } from './showcase.js';

export class RemoteDatabase {
  private context = new AsyncLocalStorage<Transaction>();
  constructor(readonly client: Client) {}
  prepare(sql: string) {
    const execute = (args: InValue[]) =>
      (this.context.getStore() ?? this.client).execute({ sql, args });
    return {
      get: async (...args: InValue[]) => (await execute(args)).rows[0],
      all: async (...args: InValue[]) => (await execute(args)).rows,
      run: async (...args: InValue[]) => {
        const result = await execute(args);
        return { changes: result.rowsAffected, lastInsertRowid: result.lastInsertRowid };
      },
    };
  }
  batch(statements: InStatement[]) {
    const tx = this.context.getStore();
    return tx ? tx.batch(statements) : this.client.batch(statements, 'write');
  }
  async withTransaction<T>(work: () => Promise<T>) {
    if (this.context.getStore()) return work();
    let tx: Transaction | undefined;
    for (let retry = 0; !tx; retry++) {
      try {
        tx = await this.client.transaction('write');
      } catch (error) {
        if (!String((error as any).code).includes('SQLITE_BUSY') || retry >= 5) throw error;
        await delay(25 * (retry + 1));
      }
    }
    try {
      const value = await this.context.run(tx, work);
      await tx.commit();
      return value;
    } catch (error) {
      await tx.rollback();
      throw error;
    } finally {
      tx.close();
    }
  }
  close() {
    this.client.close();
  }
}

export type SqlDatabase = DatabaseSync | RemoteDatabase;

export async function asyncTransaction<T>(db: SqlDatabase, work: () => Promise<T>): Promise<T> {
  if (db instanceof RemoteDatabase) return db.withTransaction(work);
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = await work();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export async function openRemoteDatabase(url: string, authToken?: string, bootstrap = true) {
  const db = new RemoteDatabase(createClient({ url, authToken, intMode: 'number' }));
  try {
    await db.withTransaction(async () => {
      await db
        .prepare(
          'CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
        )
        .run();
      const version = Number(
        (await db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM migrations').get())!
          .version,
      );
      if (version > 4)
        throw new Error('This database uses a newer schema. Update the application.');
      if (version > 0 && version < 3)
        throw new Error('Upgrade the SQLite source locally before importing it.');
      if (!version) {
        await db.batch([
          ...INITIAL_SCHEMA.split(';')
            .map((s) => s.trim())
            .filter((sql) => sql && !/^PRAGMA\b/i.test(sql)),
          "INSERT OR IGNORE INTO migrations VALUES(2,datetime('now'))",
          "INSERT OR IGNORE INTO migrations VALUES(3,datetime('now'))",
        ]);
      }
      if (version < 4)
        await db.batch([
          ...AUTH_SCHEMA.split(';')
            .map((sql) => sql.trim())
            .filter(Boolean),
          "INSERT OR IGNORE INTO migrations VALUES(4,datetime('now'))",
        ]);
      await db
        .prepare(
          'CREATE TABLE IF NOT EXISTS login_attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,until INTEGER NOT NULL)',
        )
        .run();
      await db
        .prepare('CREATE INDEX IF NOT EXISTS login_attempt_expiry ON login_attempts(until)')
        .run();
      if (!bootstrap) return;
      if (
        process.env.LITTLE_STAY_SEED === 'demo' &&
        process.env.LITTLE_STAY_DEMO_PROFILE === 'voronoi'
      ) {
        await db
          .prepare(
            'CREATE TABLE IF NOT EXISTS demo_seed_runs(profile TEXT PRIMARY KEY,created_at TEXT NOT NULL)',
          )
          .run();
        if (
          !(await db.prepare("SELECT profile FROM demo_seed_runs WHERE profile='voronoi'").get()) &&
          !(await db.prepare('SELECT id FROM properties LIMIT 1').get())
        ) {
          await db.batch(showcaseStatements());
          await db.prepare("INSERT INTO demo_seed_runs VALUES('voronoi',datetime('now'))").run();
        }
      }
      if (
        process.env.LITTLE_STAY_DEMO_PROFILE !== 'voronoi' &&
        !(await db.prepare('SELECT id FROM users LIMIT 1').get()) &&
        process.env.LITTLE_STAY_SEED === 'demo'
      ) {
        const seed = openDatabase(':memory:');
        try {
          seedDatabase(seed);
          const statements: InStatement[] = [];
          for (const table of DATA_TABLES) {
            for (const row of seed.prepare(`SELECT * FROM ${table}`).all()) {
              const columns = Object.keys(row);
              statements.push({
                sql: `INSERT INTO ${table} (${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
                args: Object.values(row) as InValue[],
              });
            }
          }
          await db.batch(statements);
        } finally {
          seed.close();
        }
      }
      if (process.env.LITTLE_STAY_SEED !== 'demo') {
        const demos = await db
          .prepare("SELECT password_hash FROM users WHERE email LIKE '%@littlestay.local'")
          .all();
        if (demos.some((u) => verifyPassword('LittleStay123!', String(u.password_hash))))
          throw new Error(
            'Demo passwords found. Use a fresh production database or change all demo passwords.',
          );
      }
      if (await db.prepare("SELECT id FROM users WHERE role='admin' AND suspended=0").get()) return;
      const credentials = z
        .object({ email: z.email().max(254), password: z.string().min(8).max(128) })
        .parse({
          email: process.env.ADMIN_EMAIL?.trim().toLowerCase(),
          password: process.env.ADMIN_PASSWORD,
        });
      await db
        .prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)')
        .run(
          randomUUID(),
          'Administrator',
          credentials.email,
          hashPassword(credentials.password),
          'admin',
          'approved',
          0,
          '',
        );
    });
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export const DATA_TABLES = [
  'users',
  'google_identities',
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
