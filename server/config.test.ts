import { describe, expect, it } from 'vitest';
import { publicOrigins, serverAddress, trustProxy } from './config';

describe('deployment configuration', () => {
  it('preserves loopback defaults and prioritizes the hosting port', () => {
    expect(serverAddress({})).toEqual({ host: '127.0.0.1', port: 3001 });
    expect(serverAddress({ HOST: '0.0.0.0', PORT: '8080', API_PORT: '3002' })).toEqual({
      host: '0.0.0.0',
      port: 8080,
    });
    expect(serverAddress({ API_PORT: '3002' }).port).toBe(3002);
    expect(() => serverAddress({ PORT: 'nope' })).toThrow();
  });
  it('accepts exact origins and rejects paths, credentials, and non-web schemes', () => {
    expect([...publicOrigins(' https://stay.example,https://preview.example:8443 ')]).toEqual([
      'https://stay.example',
      'https://preview.example:8443',
    ]);
    for (const origin of [
      'https://stay.example/path',
      'https://stay.example/',
      'https://user:pass@stay.example',
      'file:///tmp',
    ])
      expect(() => publicOrigins(origin)).toThrow();
  });
  it('trusts only explicitly configured proxy hops or networks', () => {
    expect(trustProxy('')).toBe(false);
    expect(trustProxy('1')).toBe(1);
    expect(trustProxy('loopback, 10.0.0.0/8')).toEqual(['loopback', '10.0.0.0/8']);
    expect(() => trustProxy('true')).toThrow();
  });
});
