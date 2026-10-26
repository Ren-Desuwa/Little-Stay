import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import { OAuth2Client, LoginTicket, type TokenPayload } from 'google-auth-library';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApplication } from './app';
import { googleConfiguration } from './google-auth';
import { openRemoteDatabase, RemoteDatabase } from './remote-db';

let directory: string, runtime: ReturnType<typeof createApplication>;
let payload: TokenPayload;
let nonce = '';
const headers = { 'X-Little-Stay': '1', Origin: 'http://127.0.0.1:5173' };
const origin = 'http://127.0.0.1:5173';
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'stay-google-'));
  vi.stubEnv('GOOGLE_CLIENT_ID', 'test-client.apps.googleusercontent.com');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'server-only-google-secret');
  vi.stubEnv('GOOGLE_REDIRECT_URI', origin + '/api/auth/google/callback');
  vi.spyOn(OAuth2Client.prototype, 'getToken').mockResolvedValue({
    tokens: { id_token: 'signed-google-id-token', access_token: 'private-access-token' },
    res: null,
  } as any);
  vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockImplementation(
    async () => new LoginTicket('', { ...payload, nonce: (payload as any).nonce ?? nonce }),
  );
  payload = {
    iss: 'https://accounts.google.com',
    aud: 'test-client.apps.googleusercontent.com',
    sub: 'google-subject-123',
    email: 'newguest@gmail.com',
    email_verified: true,
    name: 'Google Guest',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  runtime = createApplication({
    databasePath: join(directory, 'test.sqlite'),
    uploadsPath: join(directory, 'uploads'),
  });
});
afterEach(() => {
  runtime?.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});
async function begin(body: Record<string, string> = {}, session?: string) {
  let request = supertest(runtime.app).post('/api/auth/google/start').set(headers).send(body);
  if (session) request = request.set('Cookie', session);
  const response = await request.expect(200);
  const url = new URL(response.body.url);
  nonce = url.searchParams.get('nonce')!;
  return {
    response,
    url,
    state: url.searchParams.get('state')!,
    cookie: response.headers['set-cookie'][0].split(';')[0],
  };
}
function callback(flow: Awaited<ReturnType<typeof begin>>, extra = 'code=one-time-code') {
  return supertest(runtime.app)
    .get('/api/auth/google/callback?state=' + flow.state + '&' + extra)
    .set('Cookie', flow.cookie);
}
async function login(email = 'alex') {
  const result = await supertest(runtime.app)
    .post('/api/auth/login')
    .set(headers)
    .send({ email: email + '@littlestay.local', password: 'LittleStay123!' })
    .expect(200);
  return (result.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
}
async function state(cookie?: string) {
  let r = supertest(runtime.app).get('/api/state');
  if (cookie) r = r.set('Cookie', cookie);
  return (await r.expect(200)).body;
}

describe('Google sign-in', () => {
  it('upgrades schema version 3 without changing existing accounts or booked records', async () => {
    const oldDb = runtime.db as any;
    const users = oldDb.prepare('SELECT * FROM users ORDER BY id').all();
    const bookings = oldDb.prepare('SELECT * FROM reservations ORDER BY id').all();
    oldDb.exec('DROP TABLE oauth_requests; DROP TABLE google_identities; PRAGMA user_version=3;');
    runtime.close();
    runtime = createApplication({
      databasePath: join(directory, 'test.sqlite'),
      uploadsPath: join(directory, 'uploads'),
    });
    const db = runtime.db as any;
    expect(db.prepare('PRAGMA user_version').get().user_version).toBe(4);
    expect(db.prepare('SELECT * FROM users ORDER BY id').all()).toEqual(users);
    expect(db.prepare('SELECT * FROM reservations ORDER BY id').all()).toEqual(bookings);
    expect((await state(await login())).currentUser.id).toBe('guest-1');
  });
  it('stays disabled until all credentials are configured and preserves password login', async () => {
    runtime.close();
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    runtime = createApplication({
      databasePath: join(directory, 'test.sqlite'),
      uploadsPath: join(directory, 'uploads'),
    });
    expect((await supertest(runtime.app).get('/api/auth/providers')).body.google).toBe(false);
    await supertest(runtime.app).post('/api/auth/google/start').set(headers).send({}).expect(503);
    expect((await state(await login())).currentUser.id).toBe('guest-1');
  });
  it('uses state, nonce, PKCE, minimal scopes, and a separate transient Lax cookie', async () => {
    const flow = await begin();
    expect(flow.url.origin).toBe('https://accounts.google.com');
    expect(flow.url.searchParams.get('scope')!.split(' ').sort()).toEqual([
      'email',
      'openid',
      'profile',
    ]);
    expect(flow.url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(flow.url.searchParams.get('redirect_uri')).toBe(origin + '/api/auth/google/callback');
    const row = (runtime.db as any).prepare('SELECT * FROM oauth_requests').get();
    expect(row.state_hash).toBe(createHash('sha256').update(flow.state).digest('hex'));
    expect(flow.url.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(row.verifier).digest('base64url'),
    );
    expect(flow.response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(flow.response.headers['set-cookie'][0]).toContain('SameSite=Lax');
    expect(JSON.stringify(flow.response.body)).not.toContain('server-only-google-secret');
  });
  it('creates a guest, verifies the intended audience, and establishes the existing Strict session', async () => {
    const flow = await begin();
    const result = await callback(flow)
      .expect(303)
      .expect('Location', origin + '/#explore');
    expect(OAuth2Client.prototype.verifyIdToken).toHaveBeenCalledWith({
      idToken: 'signed-google-id-token',
      audience: 'test-client.apps.googleusercontent.com',
    });
    const session = (result.headers['set-cookie'] as unknown as string[]).find((c: string) =>
      c.includes('SameSite=Strict'),
    )!;
    const user = (await state(session.split(';')[0])).currentUser;
    expect(user).toMatchObject({
      name: 'Google Guest',
      email: 'newguest@gmail.com',
      role: 'guest',
      passwordLogin: false,
    });
    const row = (runtime.db as any).prepare('SELECT * FROM users WHERE id=?').get(user.id);
    expect(row.password_hash).toBe('');
    expect(JSON.stringify(await state(session.split(';')[0]))).not.toContain(
      'private-access-token',
    );
    await callback(flow)
      .expect(303)
      .expect('Location', origin + '/?auth_error=expired#explore');
    expect(OAuth2Client.prototype.getToken).toHaveBeenCalledTimes(1);
  });
  it('registers hosts as pending and rejects role escalation', async () => {
    await supertest(runtime.app)
      .post('/api/auth/google/start')
      .set(headers)
      .send({ role: 'admin' })
      .expect(400);
    const result = await callback(await begin({ role: 'host' })).expect(303);
    const session = (result.headers['set-cookie'] as unknown as string[])
      .find((c: string) => c.includes('SameSite=Strict'))!
      .split(';')[0];
    expect((await state(session)).currentUser).toMatchObject({
      role: 'host',
      hostStatus: 'pending',
    });
    await supertest(runtime.app)
      .post('/api/properties')
      .set(headers)
      .set('Cookie', session)
      .send({})
      .expect(403);
  });
  it('rejects callbacks missing browser binding or state without contacting Google', async () => {
    const flow = await begin();
    await supertest(runtime.app)
      .get('/api/auth/google/callback?state=' + flow.state + '&code=x')
      .expect(303)
      .expect('Location', origin + '/?auth_error=expired#explore');
    await supertest(runtime.app)
      .get('/api/auth/google/callback?state=wrong&code=x')
      .set('Cookie', flow.cookie)
      .expect(303)
      .expect('Location', origin + '/?auth_error=expired#explore');
    expect(OAuth2Client.prototype.getToken).not.toHaveBeenCalled();
  });
  it('rejects expired state and safely handles consent cancellation', async () => {
    const expired = await begin();
    (runtime.db as any).prepare('UPDATE oauth_requests SET expires_at=0').run();
    await callback(expired)
      .expect(303)
      .expect('Location', origin + '/?auth_error=expired#explore');
    await callback(await begin(), 'error=access_denied')
      .expect(303)
      .expect('Location', origin + '/?auth_error=cancelled#explore');
    expect(OAuth2Client.prototype.getToken).not.toHaveBeenCalled();
  });
  it('rejects invalid tokens, nonce mismatch, and unverified email without creating users', async () => {
    vi.mocked(OAuth2Client.prototype.verifyIdToken).mockRejectedValueOnce(
      new Error('Invalid signature/audience'),
    );
    await callback(await begin())
      .expect(303)
      .expect('Location', origin + '/?auth_error=failed#explore');
    (payload as any).nonce = 'wrong-nonce';
    await callback(await begin())
      .expect(303)
      .expect('Location', origin + '/?auth_error=expired#explore');
    delete (payload as any).nonce;
    payload.email_verified = false;
    await callback(await begin())
      .expect(303)
      .expect('Location', origin + '/?auth_error=email#explore');
    expect((runtime.db as any).prepare('SELECT COUNT(*) AS n FROM users').get().n).toBe(5);
  });
  it('never links or elevates an existing account merely because Google returns its email', async () => {
    for (const email of ['alex@littlestay.local', 'admin@littlestay.local']) {
      payload.email = email;
      await callback(await begin())
        .expect(303)
        .expect('Location', origin + '/?auth_error=existing#explore');
    }
    expect((runtime.db as any).prepare('SELECT COUNT(*) AS n FROM google_identities').get().n).toBe(
      0,
    );
  });
  it('allows explicit linking after password sign-in and signs in later by Google subject', async () => {
    const signedIn = await login();
    payload.email = 'alex@littlestay.local';
    await callback(await begin({ intent: 'link' }, signedIn))
      .expect(303)
      .expect('Location', origin + '/#explore');
    expect(
      (await supertest(runtime.app).get('/api/auth/providers').set('Cookie', signedIn)).body
        .googleLinked,
    ).toBe(true);
    payload.email = 'changed@gmail.com';
    const result = await callback(await begin()).expect(303);
    const session = (result.headers['set-cookie'] as unknown as string[])
      .find((c: string) => c.includes('SameSite=Strict'))!
      .split(';')[0];
    expect((await state(session)).currentUser).toMatchObject({
      id: 'guest-1',
      email: 'alex@littlestay.local',
    });
    (runtime.db as any).prepare("UPDATE users SET suspended=1 WHERE id='guest-1'").run();
    await callback(await begin())
      .expect(303)
      .expect('Location', origin + '/?auth_error=suspended#explore');
  });
  it('requires an active session and matching email to connect Google', async () => {
    await supertest(runtime.app)
      .post('/api/auth/google/start')
      .set(headers)
      .send({ intent: 'link' })
      .expect(401);
    const signedIn = await login();
    await callback(await begin({ intent: 'link' }, signedIn))
      .expect(303)
      .expect('Location', origin + '/?auth_error=link#explore');
    payload.email = 'alex@littlestay.local';
    const flow = await begin({ intent: 'link' }, signedIn);
    await supertest(runtime.app)
      .post('/api/auth/logout')
      .set(headers)
      .set('Cookie', signedIn)
      .expect(200);
    await callback(flow)
      .expect(303)
      .expect('Location', origin + '/?auth_error=link#explore');
  });
  it('requires the exact approved HTTPS callback origin in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => googleConfiguration(new Set([origin]))).toThrow(/HTTPS/);
    vi.stubEnv('GOOGLE_REDIRECT_URI', 'https://evil.example/api/auth/google/callback');
    expect(() => googleConfiguration(new Set(['https://stay.example']))).toThrow();
  });
  it('stores pending OAuth flows and identities across independent libSQL instances', async () => {
    runtime.close();
    vi.stubEnv('LITTLE_STAY_SEED', 'demo');
    const database = await openRemoteDatabase(`file:${join(directory, 'remote.sqlite')}`);
    runtime = createApplication({
      databasePath: 'google-cloud',
      uploadsPath: join(directory, 'uploads'),
      database,
    });
    const flow = await begin();
    runtime.close();
    const reopened = await openRemoteDatabase(`file:${join(directory, 'remote.sqlite')}`);
    runtime = createApplication({
      databasePath: 'google-cloud',
      uploadsPath: join(directory, 'uploads'),
      database: reopened,
    });
    const result = await callback(flow)
      .expect(303)
      .expect('Location', origin + '/#explore');
    const session = (result.headers['set-cookie'] as unknown as string[])
      .find((c: string) => c.includes('SameSite=Strict'))!
      .split(';')[0];
    expect((await state(session)).currentUser.email).toBe('newguest@gmail.com');
    expect((await reopened.prepare('SELECT COUNT(*) AS n FROM google_identities').get())!.n).toBe(
      1,
    );
  });
});
