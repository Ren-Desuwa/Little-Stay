# Implementation status

Deployment target: the complete application on Vercel, with Turso/libSQL for durable records and Vercel Blob for photos. Local development retains SQLite and local uploads.

Tasks 1–16 have been implemented and verified locally. All 153 tests and the production build pass; npm audit reports zero vulnerabilities. libSQL tests use independent connections to a local libSQL database; Blob operations in integration/backup tests are mocked. Live Turso/Blob/Vercel verification requires provisioned services and credentials. Task 8 is adapted to the requested all-Vercel deployment. Migration and local/cloud backup tooling are included. Tasks 17–19 remain optional follow-up work (email delivery, live updates, and pagination). Scheduling, backup retention, service provisioning, and live deployment remain operator setup. No services have been provisioned or deployed.

---

# Little Stay: deployment and improvement tasks

Recommendations from the supplied review, retained as a checklist. The user's request and repository instructions govern implementation.
Written on 2026-10-25 from a review of `main` at commit `54768b6`, including a full browser walkthrough.

## How to work through this file

- Do **one task at a time**, in the order listed. After each task, run `npm test` and `npm run build`. Both must pass before moving on.
- Do not delete, skip or weaken any existing test. Add a test for every behavior you change (API tests live in `server/app.test.ts`, which uses `supertest`).
- Keep the existing code style (TypeScript, Prettier settings in `.prettierrc.json`, zod validation, `fail(status, message)` for errors).
- Every change must keep **local development working exactly as before**: with no environment variables set, `npm run dev` and `npm test` should behave as they do today.
- Requires Node.js 24 or newer (`node:sqlite` is used).
- When a task is done, tick its box in this file.

## Project facts

- Frontend: React 19 + Vite (`src/`). Backend: Express 5 (`server/app.ts`, started by `server/index.ts`). Database: SQLite via `node:sqlite` (`server/db.ts`).
- Roles: `guest`, `host` (needs admin approval), `admin`.
- The three course algorithms live in `src/lib/algorithms.ts`: separate-chaining hash table, Levenshtein distance (typo-tolerant search), Voronoi diagram (nearest stay on the map). **Do not remove or replace these.**
- Data folder is set by `LITTLE_STAY_DATA_DIR` (default `.local/data`).
- Seeded demo accounts all use password `LittleStay123!`; `server/app.test.ts` relies on that.

---

## Part 1: Must fix before going online

### - [x] 1. Let the server accept outside connections

`server/index.ts` line 10 hardcodes `'127.0.0.1'`.

- Read `process.env.HOST`, defaulting to `'127.0.0.1'`.
- Also accept `process.env.PORT` (set by most hosts), falling back to `API_PORT` and then `3001`.
- Update the startup log line to print the real host.

### - [x] 2. Allow the real website address for write requests

`server/app.ts` lines 130–144 reject every POST/PATCH/DELETE whose `Origin` hostname isn't `127.0.0.1`, `localhost` or `[::1]`.

- Add an optional `PUBLIC_ORIGIN` environment variable (for example `https://littlestay.example.com`). It may be a comma-separated list.
- Allow a request when its full origin (scheme + host + port) exactly matches one of those values, **in addition to** the existing localhost names.
- Keep the `X-Little-Stay: 1` header check unchanged.
- Tests: an allowed origin passes, a different origin still gets 403.

### - [x] 3. Secure session cookie in production

`server/app.ts` `setSession()` (around line 189).

- Add `secure: true` when `process.env.NODE_ENV === 'production'`. Keep `httpOnly` and `sameSite: 'strict'`.
- Make `res.clearCookie` in logout use the same options.

### - [x] 4. Trust the hosting proxy so login limits work per visitor

The login rate limiter (around line 431) keys on `req.ip`. Behind a host's reverse proxy every visitor has the same IP.

- Add `app.set('trust proxy', ...)` driven by a `TRUST_PROXY` environment variable (for example `1`). When it isn't set, behave as today.

### - [x] 5. Remove the demo password helper and demo passwords from production

- `src/components/FullFeatures.tsx` lines 141–165: the "Seeded accounts for local testing" `<details>` block shows `LittleStay123!` to everyone. Render it only when `import.meta.env.DEV` is true.
- `server/db.ts` `seedDatabase()` line 107 uses the fixed password `LittleStay123!`:
  - Add a `LITTLE_STAY_SEED` environment variable. In production (`NODE_ENV=production`), do **not** seed demo accounts/listings unless `LITTLE_STAY_SEED=demo`.
  - Add `ADMIN_EMAIL` and `ADMIN_PASSWORD` environment variables. When both are set and no admin exists, create one admin account with those details (hash with the existing `hashPassword`). Refuse to start in production if no admin exists and these aren't set.
  - Tests must keep using `LittleStay123!` (they don't run in production mode).

### - [x] 6. Limit booking length and how far ahead guests can book

**Bug found in testing:** the API accepted a 10-year booking (2027-01-01 to 2036-12-31) and one for 9998-01-01 to 9999-01-01. One guest can block a property forever.

- In `validateDates` (`src/lib/model.ts` line 149), add a maximum stay of **30 nights** and a maximum check-in of **365 days from today**. Use the existing `nights()` helper and Asia/Manila `today()`.
- The reports endpoint also calls `validateDates` with `now = '0000-01-01'` and its own 366-day limit. Make sure the new limits **only apply to bookings and date blocks**, not to reports (for example, add a separate `validateBookingDates` function, or an options argument).
- Show the same limits in the booking form (the `max` attribute on the date inputs, plus a clear error message).
- Tests: a 31-night booking and a check-in 400 days away both return 400. A 30-night booking succeeds.

### - [x] 7. Remove "local demo" labels from the public version

- `src/App.tsx` line 377: the `LOCAL · SQL` pill in the header.
- `src/App.tsx` line 1187: "Fictional seed listings · Local database" in the footer.
- Show both only when `import.meta.env.DEV` is true, or when demo seeding is on.

### - [x] 8. Write deployment instructions

**Implemented adaptation:** the user selected the entire app on Vercel. Turso and Vercel Blob now replace the original production filesystem dependencies; the persistent-disk recommendation below describes the pre-migration architecture.

Add a "Deploy" section to `README.md`:

- Needs a host with a **persistent disk** (Render with a disk, Railway, Fly.io volume, or a VPS). Vercel/Netlify serverless will not work, because SQLite and uploaded photos are files on disk.
- Steps: `npm ci`, `npm run build`, `npm start`, with environment variables `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT`, `PUBLIC_ORIGIN`, `TRUST_PROXY=1`, `LITTLE_STAY_DATA_DIR=<disk path>`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.
- HTTPS is required (the cookie is `secure` in production).
- Also fix the README intro: it says the full app is on the `full` branch, but `main` now has it.

---

## Part 2: Major improvements for a real launch

### - [x] 9. Stop strangers from locking accounts

Six wrong passwords lock an account for 15 minutes for that IP + email (tested: this locked the admin out). Keep the limit, but also:

- Add a short increasing delay after each failure, and
- Periodically remove expired entries from the in-memory `attempts` map so it can't grow without limit.

### - [x] 10. Forgot password

There is no way to reset a forgotten password. Minimum version: an admin action "Reset password" in the Accounts tab that sets a temporary password and signs the user out everywhere (delete their rows in `sessions`). Better version: an emailed one-time reset link (needs an email service).

### - [x] 11. Backups

The backup/restore feature was removed. Add a script `scripts/backup.mjs` that copies the SQLite database safely (`VACUUM INTO '<file>'`) plus the `uploads/` folder into a dated folder. Document running it daily.

### - [x] 12. Content-Security-Policy header

Add a CSP header next to the other security headers in `server/app.ts` (lines 122–127). It must allow the OpenStreetMap tile host used in `src/components/StayMap.tsx`, the self-hosted fonts in `public/fonts/`, and `data:`/`blob:` images used by photo previews. Test in the browser that the map, photos and uploads still work.

### - [x] 13. Map tile provider

The free OpenStreetMap tile servers don't allow heavy public use. Make the tile URL and attribution configurable (for example `VITE_TILE_URL`), so a provider like MapTiler or Stadia Maps can be used.

### - [x] 14. Stronger photo upload checks

`imageExtension()` in `server/app.ts` only checks the first bytes of a file. Decode and re-encode each upload (for example with the `sharp` package), which also removes metadata such as GPS location and lets you resize large photos.

### - [x] 15. Privacy note and terms

Add a simple page linked from the footer explaining what's stored (name, email, bookings, messages) and how to request deletion.

### - [x] 16. Real listings, or a clear demo label

All 50 seeded stays, addresses, prices and photos are fictional. Either use real data, or keep a visible "demo" label (see task 7).

---

## Part 3: Nice-to-have

- [ ] 17. Email notifications for bookings and messages (today they only appear in the app).
- [ ] 18. Live message updates instead of the 10-second polling in `src/App.tsx` (around line 192).
- [ ] 19. `/api/state` sends all visible data on every poll. That's fine for 50 listings, but it should be split or paginated if the data grows a lot.

---

## Already verified as working (don't break these)

Guest booking, overlap rejection, cancellation, saved stays, guest–host messages, host check-in and check-out, date blocks, reports and CSV export, host registration and admin approval, all 5 admin tabs, the Algorithm Lab (hashing, fuzzy search, Voronoi), the phone layout at 390 px, cross-site request rejection, role checks on admin and report routes, and no emails or private check-in instructions sent to signed-out visitors. `npm test`: 109/109 passing. `npm audit`: 0 vulnerabilities.
