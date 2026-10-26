# Little Stay

A rental booking application for North Caloocan, built with React, TypeScript, Vite, Express, and SQLite. The complete application, with real account sessions and server-enforced permissions, is on `main`.

**No payment features are included:** no payment gateway, simulated checkout, payment status, transaction ledger, refunds, or payment receipts. Nightly prices and accommodation totals remain part of booking quotes and summaries.

## Start locally

Install **Node.js 24 or newer**. No separate database service, Docker, cloud account, or API key is needed.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. This one command starts both Vite and the local API at http://127.0.0.1:3001. Stop any older Vite process before starting it. Both services bind to loopback only.

```sh
npm test          # Algorithms, domain rules, and real API integration tests
npm run build    # Frontend + server TypeScript checks and production bundle
LITTLE_STAY_SEED=demo npm start  # Preview the built demo locally on port 3001
```

For the built demo, open http://127.0.0.1:3001. `npm start` uses production safeguards: a fresh production database requires admin credentials, and demo data must be explicitly enabled with `LITTLE_STAY_SEED=demo`. Production session cookies require HTTPS (browsers may allow secure cookies on loopback). `npm run preview` previews Vite's build and still needs a separately running `npm run server`; `npm start` is the simpler complete production-mode check.

Optional environment variables:

- `API_PORT`: local API port, default `3001`. The standalone server prefers `PORT` when set.
- `HOST`: standalone API bind address, default `127.0.0.1`.
- `.env`: optional local environment file loaded by the dev, server, start, and backup commands; see [.env.example](.env.example).
- `VITE_PORT`: development website port, default `5173`.
- `LITTLE_STAY_DATA_DIR`: SQLite and upload directory, default `.local/data`.

For example, on Linux/macOS:

```sh
API_PORT=3002 VITE_PORT=5175 LITTLE_STAY_DATA_DIR=/tmp/little-stay-test npm run dev
```

The API restarts when its source changes during development. Existing sessions and data survive normal restarts. The UI refreshes account-scoped data every ten seconds while the tab is visible. Hosts open directly on their dashboard, see only their own listings (including drafts and pending listings), and can edit them with Edit listing. Only guest accounts can book.

## Deploy to Vercel

The complete app runs on **Vercel**: Vite serves the frontend and `api/index.ts` runs Express as a Node.js function. Production data lives in **Turso/libSQL**, and photos live in a **public Vercel Blob store**. There is no separate backend server or persistent disk to operate. Local development and tests continue to use `node:sqlite` and local uploads without environment variables.

SQLite files and uploads cannot persist in a Vercel function's filesystem. The cloud handler explicitly requires remote storage and never falls back to local files or `/tmp`. The educational hash table, Levenshtein search, and Voronoi implementation remain unchanged.

### Setup

1. Create a Turso **libSQL** database in **Singapore**, if offered in your location list, and an authentication token with write access. Vercel functions are configured for **Singapore** (`sin1`) to keep the backend and database together near Philippine users. If Singapore is unavailable and you choose **Tokyo**, change `regions` in `deployment/vercel.ts` to `['hnd1']` before deployment. Create a **public** Vercel Blob store and connect it to this project. The photos were already public in the local app; upload only listing photos suitable for public access.
2. Import the repository into Vercel. Select **Vite** and **Node.js 24.x**. `vercel.ts` configures `npm ci`, `npm run build`, and output directory `dist`. The API stays on the same origin as the browser, retaining the existing session cookie and request-header checks.
3. Add the environment variables below in Vercel. Use your actual frontend origin, including any custom domain. Keep Turso, Blob, and administrator credentials out of `VITE_*` variables.
4. Deploy. On the first API request, schema initialization runs transactionally. A new database creates the administrator from `ADMIN_EMAIL` and `ADMIN_PASSWORD`; existing admin passwords are never overwritten. You can remove `ADMIN_PASSWORD` after successful bootstrap. Check `/api/health`, then sign in with the administrator account.

```dotenv
NODE_ENV=production
PUBLIC_ORIGIN=https://your-project.vercel.app,https://stays.example.com
TRUST_PROXY=1
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=replace-with-a-database-token
BLOB_READ_WRITE_TOKEN=replace-with-your-public-store-token
ADMIN_EMAIL=owner@example.com
ADMIN_PASSWORD=replace-with-a-unique-long-password
```

`PUBLIC_ORIGIN` is an exact, comma-separated allowlist of scheme, hostname, and port. Do not include paths, trailing slashes, or wildcards. Add individual Vercel preview origins when needed. Use **separate databases and Blob stores for Preview and Production**, so previews cannot modify production records. All public endpoints require HTTPS because production cookies are Secure, HttpOnly, and SameSite=Strict.

Vercel supplies trusted visitor IP headers; cloud login limits are stored in Turso, so they survive cold starts and apply across instances. Local deployments retain configurable `TRUST_PROXY`; do not trust arbitrary forwarded headers outside the hosting proxy.

For a public course demonstration with the 50 fictional listings, explicitly set **LITTLE_STAY_SEED=demo** on an empty database. This enables the publicly known demo credentials; keep it separate from any real user data. Fictional listings always display a visible demo badge. The password-filling helper is excluded from production bundles. Production refuses a database with known demo passwords unless demo mode is explicitly enabled.

A health response with `storage: "turso"` confirms the cloud storage path. Missing credentials or inaccessible storage produce a 503 rather than a temporary local database. These steps provision and deploy through your own accounts; repository preparation does not create services or deploy automatically.

### Photos and maps

Uploads are decoded, resized to at most 2048 pixels per side, stripped of metadata, and stored in Blob under content-hashed names. The UI uploads one image per request to stay below Vercel's **4.5 MB function request limit**, while allowing up to eight images per listing and 4 MB per input image. `/uploads/*` resolves through the API to the durable Blob URL. Host authorization and server-side image validation remain required.

For public traffic beyond a light demonstration, configure a suitable tile provider using **VITE_TILE_URL** and **VITE_TILE_ATTRIBUTION** in Vercel's build environment. Use HTTPS and follow the provider's attribution/browser-key restrictions. Default OpenStreetMap tiles remain available for local development. The shared CSP applies to static pages and API responses and permits map tile images, local fonts, and data/blob photo previews.

Vercel references: [Node.js functions](https://vercel.com/docs/functions/runtimes/node-js), [Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk), [function limits](https://vercel.com/docs/functions/limitations), [configuration](https://vercel.com/docs/project-configuration/vercel-ts). Turso: [TypeScript SDK](https://tursodatabase.github.io/libsql-client-ts/).

### Google sign-in

Google sign-in is optional and stays hidden until all three server settings below are configured. Email/password login continues working without them. The backend uses Google's authorization-code flow and verifies the ID token before creating an application session.

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select a project. Configure **Google Auth Platform → Branding** and **Audience**. For a testing app, add your Google account as a test user.
2. Open **Google Auth Platform → Clients**, create an **OAuth client ID**, and select **Web application**.
3. Add this **Authorized redirect URI**, using your actual production hostname: `https://your-project.vercel.app/api/auth/google/callback`. It must match exactly, including scheme and path. For local development, register `http://127.0.0.1:5173/api/auth/google/callback` separately and use separate local settings.
4. Add these environment variables to Vercel's **Production** environment and redeploy:

```dotenv
GOOGLE_CLIENT_ID=your-web-client.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=https://your-project.vercel.app/api/auth/google/callback
```

The callback's origin must be included in `PUBLIC_ORIGIN`. Keep these server settings out of `VITE_*` variables. You do not need Firebase, an additional JavaScript origin, or extra Google API scopes for this server flow. Leave the existing Turso, Blob, admin, and public-origin settings in place.

**Continue with Google** signs in returning Google users or creates a guest account. Choosing Host on the registration form creates a pending host that still needs administrator approval. A matching email does not automatically link Google to an existing account: sign in with that account's password, open **Account / Profile**, and choose **Connect Google account** using the same Google email. This includes the initial administrator account. Google-only accounts use Google to sign in; administrators can set a password if needed.

The backend validates state, browser binding, nonce, PKCE, ID-token signature/audience/expiry, and verified email. Google identities use Google's stable subject ID, so changing a Google email does not switch accounts. Suspensions remain enforced. Only a short-lived OAuth cookie uses SameSite=Lax for Google's callback; application session cookies retain SameSite=Strict. Abandoned flows expire after ten minutes and are single-use. Access/refresh tokens are not retained.

Schema version 4 adds Google identities and temporary OAuth flows on top of version 3 without modifying existing users, passwords, listings, or bookings. Backups retain Google identity links and omit temporary flows and sessions; the import tool accepts both older version-3 snapshots and new version-4 snapshots.

Reference: [Google OpenID Connect server flow](https://developers.google.com/identity/openid-connect/openid-connect).

### Import existing data

Fresh production deployments need no import. To preserve existing local records, back up the local directory first and run the migration **before deploying against the new database**. Configure Turso/Blob credentials in your shell or private `.env`, then run:

```sh
npm ci --include=dev
npm run migrate:cloud -- .local/data
```

The script upgrades the local schema if needed, verifies all referenced photos exist, uploads those photos to Blob, and imports records transactionally. It requires an **empty destination** and refuses to overwrite existing accounts or data. Sessions are intentionally omitted, so all users sign in again. Change the known demo passwords before importing real data, or explicitly set `LITTLE_STAY_SEED=demo` for an intentional demonstration. A failed database import may leave unreferenced Blob objects, but does not partially import database records.

### Backups and restore

Run a daily backup from a trusted machine or CI runner with Turso and Blob credentials. A backup command is provided; scheduling, offsite storage, and retention must be configured through your chosen operator/CI system:

```sh
npm run backup -- /private/backups/little-stay
```

With `TURSO_DATABASE_URL` set, the script reads a consistent database snapshot in a read transaction, downloads every photo referenced by that snapshot, and writes a private dated folder containing `snapshot.json` and `uploads/`. Credentials and sessions are excluded. Restrict access and copy backups to durable, access-controlled offsite storage. Do not run this as a Vercel function expecting files to persist.

Restore a cloud backup to a **new empty Turso database and corresponding Blob store**:

```sh
npm run migrate:cloud -- /private/backups/little-stay/<dated-folder>
```

Point the Vercel environment at the restored services and redeploy after checking records and photos. The import tool accepts both local SQLite data directories and cloud snapshot directories. A restore signs users out everywhere.

Without Turso environment variables, `npm run backup` retains the local SQLite path: it safely runs `VACUUM INTO`, includes committed WAL data, and copies immutable uploaded photos into a dated folder. Local restores must use a fresh directory without stale WAL/SHM files.

### Launch verification and remaining options

Verify login/logout through the Vercel URL, rejection of unrelated origins, a booking and overlap rejection, host uploads, admin password reset, map tiles, and the privacy link. Refresh after a new deployment to confirm bookings, sessions, and photos persist. Confirm `/api/state` is not cached. Live cloud verification requires your provisioned service credentials and deployment URL.

Bookings and host blocks are limited to 30 nights and must start within 365 days of the Manila date; reports retain their independent 366-day range. Admin password resets invalidate every target session. The footer privacy page describes stored data and lets signed-in users notify administrators of deletion requests. The operator must process requests and define retention/contact arrangements.

Optional tasks 17–19 remain future work: **email delivery**, **live messages**, and **state pagination**. Messages and notifications still refresh every ten seconds; `/api/state` targets the current small dataset. Email needs a selected service, verified sender, and credentials. These are not included in the deployment preparation.

## Local accounts and seed data

A fresh **development or test** database automatically seeds **50 fictional properties**, five accounts, six sample reservations covering upcoming/current/completed stays, and one sample review. Listings are densely distributed around Camarin, Deparo, Bagumbong, Tala, and Bagong Silang. The map extent is a rectangular search area, not an official city boundary. Addresses, coordinates, photos, and prices are illustrative, not verified rental offers.

All seeded accounts initially use **`LittleStay123!`**. Use **Sign in**, or expand the seeded-account helper to fill the login form. These are real password-checked sessions, not a role-switching dropdown. Change seeded passwords in Profile if you use the local application beyond testing.

| Email                   | Role  | Seed access                                                            |
| ----------------------- | ----- | ---------------------------------------------------------------------- |
| alex@littlestay.local   | Guest | Alex's bookings, favorites, reviews, conversations                     |
| jamie@littlestay.local  | Guest | Jamie's separate records                                               |
| isabel@littlestay.local | Host  | 27 properties and their associated reservations                        |
| marco@littlestay.local  | Host  | 23 other properties and associated reservations                        |
| admin@littlestay.local  | Admin | Account/listing approvals, suspensions, moderation, reports, audit log |

New registrations can request Guest or Host access. Host accounts start pending and require admin approval. Admin registration is intentionally unavailable. Account suspension invalidates active sessions. Password changes invalidate other sessions. Sessions expire after eight hours.

## Features

The navigation reappears when scrolling up, and a floating back-to-top button appears on longer pages. The admin dashboard has sticky tabs for Listings, Reservations, Accounts, Reviews, and Activity log, with arrow-key, Home, and End navigation.

- **Accounts:** registration, login/logout, editable name/bio, password changes, database-backed sessions, guest/host/admin permissions, host approvals, account suspension/restore.
- **Properties:** host-owned listing creation/editing, neighborhood/type, address, guest capacity, bedrooms, amenities, nightly prices, multiple images and cover selection, house rules, private check-in instructions, map placement, publish/unpublish, admin approval/rejection and suspension/restore.
- **Search:** custom typo-tolerant matching across titles/neighborhoods/amenities, dates, capacity, price, bedrooms, neighborhood, property type, price sorting, and persisted saved stays. Cards load in batches of 24.
- **Maps:** 50 seeds, price markers, clustered counts, zoom into clusters, maximum-zoom property chooser, custom Voronoi overlay, pin-based nearest matching property, and approximate straight-line distance.
- **Bookings:** visual availability calendar, instant confirmation, unique references, server-side capacity/date/availability checks inside SQLite transactions, preserved booked rates, history, upcoming cancellation, host/admin check-in and checkout, printable booking summaries.
- **Host calendars:** block/unblock nights for personal use or maintenance; reservations and other blocks cannot overlap. Removing a block releases those nights.
- **Messages:** private guest–host conversations opened from property details, persisted messages, scoped participant access, and notifications. Admins do not receive access to private conversations through the dashboard.
- **Notifications:** booking events, messages, approvals, account changes, and reviews; unread indicator and mark-all-read action.
- **Reviews:** one review per completed guest-owned reservation, ratings, property review display, and admin hide/restore moderation.
- **Reports:** host-scoped or admin-wide booking counts, booked accommodation value, calendar occupancy, date ranges up to 366 days, and CSV export. Occupancy counts reserved nights within the selected period, including upcoming reservations; booked value is not collected revenue.
- **Local data tools:** transactional schema migration, persisted SQLite data and uploaded photos, and activity log.
- **Algorithm lab (admin only):** Interactive bucket insertion with custom keys, 12 sample keys, and a preset of eight colliding keys. Overflow chains show where colliding records are placed; duplicate keys update existing entries. Play/Pause, replay, previous/next steps, speed controls, and a seekable timeline for all three demos. Watch boxed lookup keys travel into their buckets and compare clickable application records, with found/collision/missing presets. Fuzzy search highlights each compared letter, shows the three edit costs, and plays a clickable optimal alignment with per-word search tolerance. Explore Levenshtein matrix dependencies and animated Voronoi half-plane clipping with bisectors and kept/discarded areas. Inputs reset playback; switching tabs or hiding the browser stops playback. The demos follow the same frontend algorithms as search and map selection, with reduced-motion support for geometry transitions.

Editing a listing sends it back to pending review. A published flag alone does not bypass approval. Suspension/unpublishing/host suspension prevents new bookings while preserving existing reservation history. Private check-in instructions are sent only to the responsible host/admin and guests with an uncancelled reservation for that property.

## Booking rules

Dates use ISO date-only values and Asia/Manila's current date. Stays use `[check-in, checkout)` intervals, permitting same-day turnover. Overlapping confirmed, checked-in, or completed reservations and host blocks are rejected. SQLite's `BEGIN IMMEDIATE` transaction encloses availability rechecking and reservation creation so concurrent requests cannot double-book the same nights.

Bookings and host date blocks are limited to **30 nights**, with check-in/start at most **365 days** from the current Manila date. Checkout may be up to 30 nights after that final permitted check-in. Report ranges retain their independent 366-day limit.

Guests can cancel their own upcoming confirmed bookings. Admins can cancel confirmed bookings. Hosts/admins can check in confirmed stays during their reserved dates and record checkout for checked-in stays. Only completed stays can receive a review. Booking totals snapshot nightly rate × nights; later listing price changes do not alter existing reservations.

## Persistence

The default database is `.local/data/little-stay.sqlite`; user-uploaded images are in `.local/data/uploads/`. Both are ignored by Git. Sessions, accounts, bookings, conversations, favorites, reviews, and notifications live in SQL, not localStorage. Vercel uses Turso for these records and Blob for uploaded photos; local paths apply only to standalone development/server mode. The old prototype's browser data remains untouched and is not automatically imported.

Schema versions 1–4 are applied transactionally and recorded in the migrations table. Version 2 unpublishes surplus generated listings from the previous 150-property dataset while preserving their bookings and related records. User-created listings remain unchanged. Version 3 upgrades untouched demo galleries to three photos while preserving customized and uploaded photos. Opening a database with a newer schema is refused rather than silently downgraded.

Image uploads accept JPEG, PNG, or WebP, up to 4 MB per image and eight per property. The upload control replaces the current photo set; cover selection and individual removal are available. At least one photo is required. SQL references use content-hashed local filenames.

## Algorithms and architecture

- `server/app.ts`: validated API routes, sessions/permissions, bookings, upload handling, messages/reviews/notifications, reports, and safe error boundaries.
- `server/db.ts`: local relational schema, migration, password hashing, and dense seed generation.
- `server/remote-db.ts`: asynchronous Turso adapter and isolated write transactions.
- `server/vercel-handler.ts`: credential validation and cloud runtime initialization.
- `server/photos.ts`: durable public photo storage through Vercel Blob.
- `src/lib/algorithms.ts`: custom separate-chaining hash table, Levenshtein dynamic programming, projection, half-plane clipping, bounded Voronoi cells, and deterministic point location.
- `src/lib/model.ts`: shared types, date and search helpers; the server independently authorizes and validates every persisted mutation.
- `src/lib/api.ts`: same-origin API requests. Application data is loaded from the API; the old storage utility remains only as a prototype regression fixture.
- `src/lib/region.ts`: North Caloocan extent and default coordinates.

Hash lookup is expected O(1) with a bounded load factor and O(n) in the worst case. The lab exposes load factor and collisions. Levenshtein uses O(mn) time/space per word pair. Repeated convex clipping is O(n³) worst case across all Voronoi cells; point location scans cell edges. This is a computational geometry implementation, not a claim that Voronoi scanning outperforms brute force at this scale. Equal-distance boundaries and coincident seeds choose the lowest property ID. Distance is approximate straight-line proximity, not travel time.

Passwords use Node's `scrypt` with random salts. Session tokens use cryptographically random bytes and are stored hashed in SQLite; cookies are HttpOnly and SameSite=Strict. Authentication is enforced by the API. Custom educational hashing is used for lookup indexes, never for passwords. Writes require a same-origin application header; cross-origin requests are rejected. Login attempts are rate-limited. Queries use bound parameters, uploads are decoded and re-encoded with sharp, resized to a maximum of 2048 pixels per side, stripped of metadata, and stored in content-hashed paths, and CSV cells neutralize spreadsheet formula prefixes.

## Suggested walkthrough

1. Browse 50 stays, search `camarin blacony`, try property/bedroom filters, and use the clustered map and nearest-pin selection.
2. Register a guest or sign in as Alex. Save a stay, reserve future dates, refresh, inspect its booking summary, and message the host.
3. Sign in as Isabel to read/reply, manage her listings, block dates, and check in the seeded stay beginning today (`LS-DEMO0004`). Record checkout to unlock Alex's review.
4. Register a Host account; observe its pending status and disabled listing creation. Sign in as admin to approve it.
5. Create or edit a listing as a host, publish it for review, and approve it as admin. Existing booking rates remain unchanged.
6. Use the completed seeded booking under Jamie to publish a review. Test moderation and notifications.
7. Open Reports, choose a date range, and export CSV. Inspect the admin activity log.
8. Sign in as admin to present all three custom algorithms in the lab. The hash and booking-reference views respect the current account's access.

## Verification and limits

Run `npm test` for the algorithm/domain regression and HTTP integration suites. They include concurrent double-booking, permissions, private conversations, real uploads, atomic image writes, sessions/password changes, host/listing approvals, report scoping, CSV escaping, and migration version checks. See `VERIFICATION.md` for the recorded browser walkthrough and production-mode smoke check.

All core application behavior runs locally after dependencies are installed. OpenStreetMap street tiles require internet; markers and geometry still work when tiles fail. Deployment configuration runs the complete app on Vercel with Turso and Vercel Blob. Payments, email/SMS delivery, GPS, and travel-time routing are not included. Messages and notifications update by polling, not push delivery. Development seeds are fictional; the public demo label remains visible whenever fictional seeded listings exist. Production starts without demo accounts or listings unless explicitly opted in.

## Asset acknowledgements

Fourteen bundled images (six Unsplash apartment photos and eight Pexels accommodation images) illustrate fictional listings. Seeded listings each have three photos. See [image credits](public/images/CREDITS.md) for the added sources and license. Original Unsplash source photo IDs: `1600210492486-724fe5c67fb0`, `1600607687920-4e2a09cf159d`, `1600047509807-ba8f99d2cdde`, `1600607687939-ce8a6c25118c`, `1616486338812-3dadae4b4ace`, and `1600566753086-00f18fb6b3ea`.

DM Sans and Manrope use the SIL Open Font License; bundled license files are in `public/fonts/`. Icons are from Lucide; Leaflet renders the map. Map data © OpenStreetMap contributors. Standard tiles are requested on demand without offline prefetching.
