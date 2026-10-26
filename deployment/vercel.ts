import { securityHeaders } from './security';

export function vercelConfig() {
  return {
    framework: 'vite' as const,
    installCommand: 'npm ci --include=dev',
    buildCommand: 'npm run build',
    outputDirectory: 'dist',
    regions: ['sin1'],
    functions: { 'api/**/*.ts': { maxDuration: 30 } },
    rewrites: [{ source: '/uploads/:path*', destination: '/api/uploads-file/:path*' }],
    headers: [
      {
        source: '/(.*)',
        headers: Object.entries(securityHeaders()).map(([key, value]) => ({ key, value })),
      },
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ],
  };
}
