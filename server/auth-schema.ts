export const AUTH_SCHEMA = `
  CREATE TABLE IF NOT EXISTS google_identities(
    subject TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS oauth_requests(
    state_hash TEXT PRIMARY KEY,
    browser_hash TEXT NOT NULL,
    nonce TEXT NOT NULL,
    verifier TEXT NOT NULL,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    session_hash TEXT,
    role TEXT NOT NULL CHECK(role IN ('guest','host')),
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS oauth_request_expiry ON oauth_requests(expires_at);
`;
