import { securityHeaders } from './security.js';

export function vercelConfig() {
  return {
    framework: 'vite' as const,
    installCommand: 'npm ci --include=dev',
    buildCommand: 'npm run build',
    outputDirectory: 'dist',
    regions: ['sin1'],
    functions: { 'api/**/*.ts': { maxDuration: 30 } },
    rewrites: [
      { source: '/api/:path*', destination: '/api' },
      { source: '/uploads/:path*', destination: '/api' },
    ],
    headers: [
      {
        source: '/(.*)',
        headers: Object.entries(securityHeaders()).map(([key, value]) => ({ key, value })),
      },
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ],
  };
}
