import { z } from 'zod';

export function serverAddress(env = process.env) {
  return {
    host: env.HOST || '127.0.0.1',
    port: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .parse(env.PORT ?? env.API_PORT ?? 3001),
  };
}

export function publicOrigins(value = process.env.PUBLIC_ORIGIN) {
  return new Set(
    (value ?? '')
      .split(',')
      .filter((v) => v.trim())
      .map((v) => {
        const origin = v.trim();
        const url = new URL(origin);
        if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin)
          throw new Error(
            'PUBLIC_ORIGIN must contain full origins without paths or trailing slashes.',
          );
        return origin;
      }),
  );
}

export function trustProxy(value = process.env.TRUST_PROXY): number | string[] | false {
  if (!value || value === 'false' || value === '0') return false;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === 'true')
    throw new Error('Use a proxy hop count or trusted subnets for TRUST_PROXY.');
  return value.split(',').map((v) => v.trim());
}
