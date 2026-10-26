import type { Request, Response } from 'express';
import { createApplication } from './app.js';
import { openRemoteDatabase } from './remote-db.js';
import { blobPhotos } from './photos.js';

let initialization: Promise<ReturnType<typeof createApplication>> | undefined;
export function cloudApplication() {
  return (initialization ??= (async () => {
    const { TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, BLOB_READ_WRITE_TOKEN, PUBLIC_ORIGIN } =
      process.env;
    if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN || !BLOB_READ_WRITE_TOKEN || !PUBLIC_ORIGIN)
      throw new Error(
        'Set TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, BLOB_READ_WRITE_TOKEN, and PUBLIC_ORIGIN in Vercel.',
      );
    if (!/^(libsql|https):\/\//.test(TURSO_DATABASE_URL))
      throw new Error('Use a remote Turso database URL on Vercel.');
    const database = await openRemoteDatabase(TURSO_DATABASE_URL, TURSO_AUTH_TOKEN);
    return createApplication({
      databasePath: TURSO_DATABASE_URL,
      uploadsPath: '',
      database,
      photoStore: blobPhotos(BLOB_READ_WRITE_TOKEN),
      serverless: true,
    });
  })().catch((error) => {
    initialization = undefined;
    throw error;
  }));
}

export default async function handler(req: Request, res: Response) {
  try {
    const runtime = await cloudApplication();
    return runtime.app(req, res);
  } catch (error) {
    console.error('Little Stay storage initialization failed.', error);
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).json({ error: 'Storage is unavailable. Check the deployment configuration.' });
  }
}
