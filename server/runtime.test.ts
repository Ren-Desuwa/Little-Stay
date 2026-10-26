import { expect, it } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

it('loads the emitted API in native Node ESM without a TypeScript loader', () => {
  const output = mkdtempSync(join(tmpdir(), 'little-stay-runtime-'));
  try {
    writeFileSync(join(output, 'package.json'), '{"type":"module"}');
    symlinkSync(resolve('node_modules'), join(output, 'node_modules'), 'dir');
    const compilation = spawnSync(
      process.execPath,
      [
        resolve('node_modules/typescript/bin/tsc'),
        '-p',
        'tsconfig.server.json',
        '--noEmit',
        'false',
        '--allowImportingTsExtensions',
        'false',
        '--outDir',
        output,
        '--tsBuildInfoFile',
        join(output, 'build.tsbuildinfo'),
      ],
      { encoding: 'utf8' },
    );
    expect(compilation.stdout + compilation.stderr).toBe('');
    expect(compilation.status).toBe(0);
    const entry = pathToFileURL(join(output, 'api/index.js')).href;
    // Vitest/tsx resolve extensionless imports that the deployed Node ESM loader rejects.
    const execution = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import handler from ${JSON.stringify(entry)};
      console.error = () => {};
      let status;
      const response = {
        status(value) { status = value; return this; },
        setHeader() { return this; },
        json(body) {
          if (status !== 503 || !body.error) throw new Error('Expected configuration response');
          console.log('API loaded and returned configuration response');
        }
      };
      await handler({}, response);
    `,
      ],
      { encoding: 'utf8', env: { ...process.env, TURSO_DATABASE_URL: '' } },
    );
    expect(execution.stderr).toBe('');
    expect(execution.status).toBe(0);
    expect(execution.stdout).toContain('API loaded and returned configuration response');
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}, 20000);
