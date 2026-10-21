# Little Stay · full

A complete local rental booking application for North Caloocan, built with React, TypeScript, Vite, Express, and SQLite. The `full` branch has real account sessions and server-enforced permissions. `main` retains the original browser-only prototype.

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
npm start        # Serve the built website and API together on port 3001
```

For `npm start`, open http://127.0.0.1:3001. `npm run preview` previews Vite's build and still needs a separately running `npm run server`; `npm start` is the simpler complete production-mode check.

Optional environment variables:

- `API_PORT`: local API / production server port, default `3001`.
- `VITE_PORT`: development website port, default `5173`.
- `LITTLE_STAY_DATA_DIR`: SQLite and upload directory, default `.local/data`.

For example, on Linux/macOS:

```sh
API_PORT=3002 VITE_PORT=5175 LITTLE_STAY_DATA_DIR=/tmp/little-stay-test npm run dev
```

The API restarts when its source changes during development. Existing sessions and data survive normal restarts. The UI refreshes account-scoped data every ten seconds while the tab is visible.

## Local accounts and seed data

A fresh database automatically seeds **50 fictional properties**, five accounts, six sample reservations covering upcoming/current/completed stays, and one sample review. Listings are densely distributed around Camarin, Deparo, Bagumbong, Tala, and Bagong Silang. The map extent is a rectangular search area, not an official city boundary. Addresses, coordinates, photos, and prices are illustrative, not verified rental offers.

All seeded accounts initially use **`LittleStay123!`**. Use **Sign in**, or expand the seeded-account helper to fill the login form. These are real password-checked sessions, not a role-switching dropdown. Change seeded passwords in Profile if you use the local application beyond testing.

| Email                   | Role  | Seed access                                                                     |
| ----------------------- | ----- | ------------------------------------------------------------------------------- |
| alex@littlestay.local   | Guest | Alex's bookings, favorites, reviews, conversations                              |
| jamie@littlestay.local  | Guest | Jamie's separate records                                                        |
| isabel@littlestay.local | Host  | 75 properties and their associated reservations                                 |
| marco@littlestay.local  | Host  | 75 other properties and associated reservations                                 |
| admin@littlestay.local  | Admin | Account/listing approvals, suspensions, moderation, reports, backups, audit log |

New registrations can request Guest or Host access. Host accounts start pending and require admin approval. Admin registration is intentionally unavailable. Account suspension invalidates active sessions. Password changes invalidate other sessions. Sessions expire after eight hours.

## Features

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
- **Local data tools:** transactional schema migration, persisted SQLite data and uploaded photos, admin backup download/restore, session invalidation after restore, and activity log.
- **Algorithm lab:** hash buckets/chains/collisions/lookup comparisons, Levenshtein matrix and matched words, and stepwise Voronoi clipping using the same frontend algorithm implementations as search and map selection.

Editing a listing sends it back to pending review. A published flag alone does not bypass approval. Suspension/unpublishing/host suspension prevents new bookings while preserving existing reservation history. Private check-in instructions are sent only to the responsible host/admin and guests with an uncancelled reservation for that property.

## Booking rules

Dates use ISO date-only values and Asia/Manila's current date. Stays use `[check-in, checkout)` intervals, permitting same-day turnover. Overlapping confirmed, checked-in, or completed reservations and host blocks are rejected. SQLite's `BEGIN IMMEDIATE` transaction encloses availability rechecking and reservation creation so concurrent requests cannot double-book the same nights.

Guests can cancel their own upcoming confirmed bookings. Admins can cancel confirmed bookings. Hosts/admins can check in confirmed stays during their reserved dates and record checkout for checked-in stays. Only completed stays can receive a review. Booking totals snapshot nightly rate × nights; later listing price changes do not alter existing reservations.

## Persistence and backups

The default database is `.local/data/little-stay.sqlite`; user-uploaded images are in `.local/data/uploads/`. Both are ignored by Git. Sessions, accounts, bookings, conversations, favorites, reviews, and notifications live in SQL, not localStorage. The old prototype's browser data remains untouched and is not automatically imported.

Schema versions 1 and 2 are applied transactionally and recorded in the migrations table. Version 2 unpublishes surplus generated listings from the previous 150-property dataset while preserving their bookings and related records. User-created listings remain unchanged. Opening a database with a newer schema is refused rather than silently downgraded.

Admin → Backups and restore downloads a JSON backup containing all application tables and referenced uploaded images. It excludes session tokens. Restoring validates the format, property data, image hashes, and foreign keys, replaces data transactionally, and signs everyone out. Log back in with an account/password from the restored backup. A failed restore leaves database records and sessions unchanged.

Image uploads accept JPEG, PNG, or WebP, up to 4 MB per image and eight per property. The upload control replaces the current photo set; cover selection and individual removal are available. At least one photo is required. SQL references use content-hashed local filenames.

JSON backup/restore is limited to 50 MB. For larger datasets, stop the application and copy the entire data directory, including uploads, as a filesystem backup. Backups contain private account information and password hashes; keep them local. Do not commit them to Git.

## Algorithms and architecture

- `server/app.ts`: validated API routes, sessions/permissions, bookings, upload handling, messages/reviews/notifications, reports, backups, and safe error boundaries.
- `server/db.ts`: relational schema, migration, transactions, password hashing, and dense seed generation.
- `src/lib/algorithms.ts`: custom separate-chaining hash table, Levenshtein dynamic programming, projection, half-plane clipping, bounded Voronoi cells, and deterministic point location.
- `src/lib/model.ts`: shared types, date and search helpers; the server independently authorizes and validates every persisted mutation.
- `src/lib/api.ts`: same-origin API requests. Full application data is loaded from the server; the old storage utility remains only as a prototype regression fixture.
- `src/lib/region.ts`: North Caloocan extent and default coordinates.

Hash lookup is expected O(1) with a bounded load factor and O(n) in the worst case. The lab exposes load factor and collisions. Levenshtein uses O(mn) time/space per word pair. Repeated convex clipping is O(n³) worst case across all Voronoi cells; point location scans cell edges. This is a computational geometry implementation, not a claim that Voronoi scanning outperforms brute force at this scale. Equal-distance boundaries and coincident seeds choose the lowest property ID. Distance is approximate straight-line proximity, not travel time.

Passwords use Node's `scrypt` with random salts. Session tokens use cryptographically random bytes and are stored hashed in SQLite; cookies are HttpOnly and SameSite=Strict. Authentication is enforced by the API. Custom educational hashing is used for lookup indexes, never for passwords. Writes require a same-origin application header; cross-origin requests are rejected. Login attempts are rate-limited. Queries use bound parameters, uploads use verified image signatures and content-hashed paths, and CSV cells neutralize spreadsheet formula prefixes.

## Suggested walkthrough

1. Browse 50 stays, search `camarin blacony`, try property/bedroom filters, and use the clustered map and nearest-pin selection.
2. Register a guest or sign in as Alex. Save a stay, reserve future dates, refresh, inspect its booking summary, and message the host.
3. Sign in as Isabel to read/reply, manage her listings, block dates, and check in the seeded stay beginning today (`LS-DEMO0004`). Record checkout to unlock Alex's review.
4. Register a Host account; observe its pending status and disabled listing creation. Sign in as admin to approve it.
5. Create or edit a listing as a host, publish it for review, and approve it as admin. Existing booking rates remain unchanged.
6. Use the completed seeded booking under Jamie to publish a review. Test moderation and notifications.
7. Open Reports, choose a date range, and export CSV. Download an admin backup, make a change, then restore the backup and sign in again.
8. Present all three custom algorithms in the lab. The hash and booking-reference views respect the current account's access.

## Verification and limits

Run `npm test` for the algorithm/domain regression and HTTP integration suites. They include concurrent double-booking, permissions, private conversations, real uploads, image backup round trips, failed-restore rollback, sessions/password changes, host/listing approvals, report scoping, CSV escaping, and migration version checks. See `VERIFICATION.md` for the recorded browser walkthrough and production-mode smoke check.

All core application behavior runs locally after dependencies are installed. OpenStreetMap street tiles require internet; markers and geometry still work when tiles fail. No cloud deployment, payments, email/SMS service, GPS, or travel-time routing is included. Messages and notifications update by polling, not push delivery. This is intended for the requested local project, with fictional seed content.

## Asset acknowledgements

Six bundled Unsplash apartment photographs illustrate fictional listings. Source photo IDs: `1600210492486-724fe5c67fb0`, `1600607687920-4e2a09cf159d`, `1600047509807-ba8f99d2cdde`, `1600607687939-ce8a6c25118c`, `1616486338812-3dadae4b4ace`, and `1600566753086-00f18fb6b3ea`.

DM Sans and Manrope use the SIL Open Font License; bundled license files are in `public/fonts/`. Icons are from Lucide; Leaflet renders the map. Map data © OpenStreetMap contributors. Standard tiles are requested on demand without offline prefetching.
