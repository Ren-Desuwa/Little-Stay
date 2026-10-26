import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import { createHash, randomBytes } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { asyncTransaction, type SqlDatabase } from './remote-db.js';

const random = () => randomBytes(32).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const cookie = (req: Request, name: string) =>
  req.headers.cookie
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(name + '='))
    ?.slice(name.length + 1);
const MESSAGES = {
  cancelled: 'Google sign-in was cancelled. You can try again or use your password.',
  expired: 'Google sign-in expired or could not be verified. Please try again.',
  failed: 'Google sign-in could not be completed. Please try again.',
  email: 'Google must provide a verified email address to sign in.',
  existing:
    'An account already uses this email. Sign in with your password, then connect Google in Profile.',
  suspended: 'This account is suspended. Contact the administrator.',
  link: 'Google could not be connected. Sign in again and use a Google account with the same email.',
} as const;
class GoogleLoginError extends Error {
  constructor(readonly reason: keyof typeof MESSAGES) {
    super(MESSAGES[reason]);
  }
}
export function googleConfiguration(origins: Set<string>) {
  const {
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: clientSecret,
    GOOGLE_REDIRECT_URI: redirectUri,
  } = process.env;
  if (!clientId || !clientSecret || !redirectUri) return null;
  const url = new URL(redirectUri);
  const local =
    process.env.NODE_ENV !== 'production' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (
    url.pathname !== '/api/auth/google/callback' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    (!origins.has(url.origin) && !local) ||
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
  )
    throw new Error(
      'GOOGLE_REDIRECT_URI must be the exact /api/auth/google/callback URL on a permitted HTTPS PUBLIC_ORIGIN (or local development origin).',
    );
  return { clientId, clientSecret, redirectUri: url.href, origin: url.origin };
}

export function mountGoogleAuth(
  app: Express,
  options: {
    db: SqlDatabase;
    config: ReturnType<typeof googleConfiguration>;
    sessionCookie: string;
    getUser: (req: Request) => Promise<any>;
    setSession: (res: Response, userId: string) => Promise<void>;
    audit: (uid: string, action: string, target: string) => Promise<void>;
    notify: (uid: string, body: string) => Promise<void>;
  },
) {
  const { db, config } = options;
  const client = config
    ? new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri)
    : null;
  const flowCookie = options.sessionCookie + '_google';
  // Only the short-lived OAuth cookie needs Lax for Google's top-level callback.
  const flowOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/api/auth/google',
  };
  app.get('/api/auth/providers', async (req, res) => {
    const user = await options.getUser(req);
    const linked = user
      ? await db.prepare('SELECT subject FROM google_identities WHERE user_id=?').get(user.id)
      : null;
    res.json({ google: !!config, googleLinked: !!linked });
  });
  app.post('/api/auth/google/start', async (req, res) => {
    if (!config || !client) {
      res.status(503).json({ error: 'Google sign-in is not configured yet.' });
      return;
    }
    const input = z
      .object({
        intent: z.enum(['login', 'link']).default('login'),
        role: z.enum(['guest', 'host']).default('guest'),
      })
      .parse(req.body);
    const user = input.intent === 'link' ? await options.getUser(req) : null;
    if (input.intent === 'link' && !user) {
      res.status(401).json({ error: 'Sign in before connecting Google.' });
      return;
    }
    const state = random(),
      browser = random(),
      nonce = random(),
      verifier = random();
    await asyncTransaction(db, async () => {
      await db.prepare('DELETE FROM oauth_requests WHERE expires_at<=?').run(Date.now());
      await db
        .prepare('INSERT INTO oauth_requests VALUES(?,?,?,?,?,?,?,?)')
        .run(
          digest(state),
          digest(browser),
          nonce,
          verifier,
          user?.id ?? null,
          user ? digest(cookie(req, options.sessionCookie) ?? '') : null,
          input.role,
          Date.now() + 10 * 60_000,
        );
    });
    res.cookie(flowCookie, browser, { ...flowOptions, maxAge: 10 * 60_000 });
    res.json({
      url: client.generateAuthUrl({
        access_type: 'online',
        scope: ['openid', 'email', 'profile'],
        state,
        nonce,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: CodeChallengeMethod.S256,
        prompt: 'select_account',
      }),
    });
  });
  app.get('/api/auth/google/callback', async (req, res) => {
    if (!config || !client) {
      res.status(503).json({ error: 'Google sign-in is not configured yet.' });
      return;
    }
    res.clearCookie(flowCookie, flowOptions);
    try {
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const browser = cookie(req, flowCookie) ?? '';
      if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(browser))
        throw new GoogleLoginError('expired');
      const flow = await asyncTransaction(db, async () => {
        const row = (await db
          .prepare(
            'SELECT * FROM oauth_requests WHERE state_hash=? AND browser_hash=? AND expires_at>?',
          )
          .get(digest(state), digest(browser), Date.now())) as any;
        if (!row) throw new GoogleLoginError('expired');
        await db.prepare('DELETE FROM oauth_requests WHERE state_hash=?').run(digest(state));
        return row;
      });
      if (req.query.error) throw new GoogleLoginError('cancelled');
      const code = z.string().min(1).max(4096).parse(req.query.code);
      const { tokens } = await client.getToken({
        code,
        codeVerifier: flow.verifier,
        redirect_uri: config.redirectUri,
      });
      if (!tokens.id_token) throw new GoogleLoginError('failed');
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: config.clientId,
      });
      const claims = ticket.getPayload();
      if (!claims || claims.nonce !== flow.nonce || !claims.sub)
        throw new GoogleLoginError('expired');
      const email = z.email().max(254).safeParse(claims.email?.toLowerCase());
      if (!email.success || claims.email_verified !== true) throw new GoogleLoginError('email');
      const uid = await asyncTransaction(db, async () => {
        const identity = await db
          .prepare('SELECT user_id FROM google_identities WHERE subject=?')
          .get(claims.sub);
        if (flow.user_id) {
          const session = await db
            .prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?')
            .get(flow.session_hash, Date.now());
          const user = (await db
            .prepare('SELECT * FROM users WHERE id=?')
            .get(flow.user_id)) as any;
          const linked = await db
            .prepare('SELECT subject FROM google_identities WHERE user_id=?')
            .get(flow.user_id);
          if (
            !session ||
            session.user_id !== flow.user_id ||
            !user ||
            user.suspended ||
            user.email !== email.data ||
            (identity && identity.user_id !== user.id) ||
            (linked && linked.subject !== claims.sub)
          )
            throw new GoogleLoginError('link');
          if (!linked)
            await db.prepare('INSERT INTO google_identities VALUES(?,?)').run(claims.sub, user.id);
          await options.audit(user.id, 'account.google-link', user.id);
          return user.id;
        }
        if (identity) {
          const user = (await db
            .prepare('SELECT * FROM users WHERE id=?')
            .get(String(identity.user_id))) as any;
          if (!user || user.suspended) throw new GoogleLoginError('suspended');
          await options.audit(user.id, 'account.google-login', user.id);
          return user.id;
        }
        // Email alone never links Google to an existing password/host/admin account.
        if (await db.prepare('SELECT id FROM users WHERE email=?').get(email.data))
          throw new GoogleLoginError('existing');
        const uid = crypto.randomUUID();
        const name = (claims.name?.trim() || email.data.split('@')[0]).slice(0, 80);
        await db
          .prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)')
          .run(
            uid,
            name,
            email.data,
            '',
            flow.role,
            flow.role === 'host' ? 'pending' : 'approved',
            0,
            '',
          );
        await db.prepare('INSERT INTO google_identities VALUES(?,?)').run(claims.sub, uid);
        await options.audit(uid, 'account.google-register', uid);
        if (flow.role === 'host')
          for (const admin of (await db
            .prepare("SELECT id FROM users WHERE role='admin' AND suspended=0")
            .all()) as any[])
            await options.notify(admin.id, `${name} applied to become a host.`);
        return uid;
      });
      await options.setSession(res, uid);
      res.redirect(303, config.origin + '/#explore');
    } catch (error) {
      const reason = error instanceof GoogleLoginError ? error.reason : 'failed';
      // Keep provider tokens, codes, and upstream errors out of URLs and application logs.
      res.redirect(303, config.origin + '/?auth_error=' + reason + '#explore');
    }
  });
}
