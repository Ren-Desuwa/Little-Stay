import { resolve } from 'node:path';
import { createApplication } from './app';
const directory = resolve(process.env.LITTLE_STAY_DATA_DIR ?? '.local/data');
const runtime = createApplication({
  databasePath: resolve(directory, 'little-stay.sqlite'),
  uploadsPath: resolve(directory, 'uploads'),
  publicPath: process.env.NODE_ENV === 'production' ? resolve('dist') : undefined,
});
const port = Number(process.env.API_PORT ?? 3001);
const server = runtime.app.listen(port, '127.0.0.1', () =>
  console.log(`Little Stay API: http://127.0.0.1:${port} · SQLite in ${directory}`),
);
server.on('error', (error) => {
  console.error(error);
  runtime.close();
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () =>
    server.close(() => {
      runtime.close();
      process.exit(0);
    }),
  );
