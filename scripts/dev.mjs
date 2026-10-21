import { spawn } from 'node:child_process';
const children = [];
function start(args) {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
  children.push(child);
  child.on('exit', (code) => {
    if (!stopping) {
      stopping = true;
      children.forEach((p) => p.kill('SIGTERM'));
      process.exitCode = code ?? 1;
    }
  });
  return child;
}
let stopping = false;
start(['--watch', '--import', 'tsx', 'server/index.ts']);
start([
  'node_modules/vite/bin/vite.js',
  '--host',
  '127.0.0.1',
  '--port',
  process.env.VITE_PORT ?? '5173',
  '--strictPort',
]);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    stopping = true;
    children.forEach((child) => child.kill('SIGTERM'));
  });
