import { resolve } from 'node:path';
import { createApplication } from './app.js';
import { serverAddress } from './config.js';
const directory = resolve(process.env.LITTLE_STAY_DATA_DIR ?? '.local/data');
const runtime = createApplication({
  databasePath: resolve(directory, 'little-stay.sqlite'),
  uploadsPath: resolve(directory, 'uploads'),
  publicPath: process.env.NODE_ENV === 'production' ? resolve('dist') : undefined,
});
const { host, port } = serverAddress();
const server = runtime.app.listen(port, host, () =>
  console.log(`Little Stay API: http://${host}:${port} · SQLite in ${directory}`),
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
