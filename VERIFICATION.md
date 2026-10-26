# Vercel preparation verification · 2026-10-26

- Google sign-in: 13 tests cover OAuth state, PKCE, nonce, token validation, explicit account linking, host approval, suspension, schema migration, and callbacks across libSQL runtimes. Google SDK responses are mocked; live Google login awaits OAuth credentials and deployment.
- `npm test`: **152/152 passed**, covering every existing test plus production configuration, booking bounds, password reset/session revocation, re-encoded images, deletion requests, local/cloud backups, and cloud import/restore.
- `npm run build`: frontend and backend TypeScript checks plus Vite production bundle passed.
- `npm audit`: **0 vulnerabilities**. Vercel Blob is pinned to 2.4.0 because the newer SDK pulled in an advisory-bearing CLI dependency; the public-photo APIs used here are covered by adapter/integration tests.
- Real libSQL client tests use two independent connections and app instances against a local database: concurrent bookings yield one 201 and one 409, sessions/logout cross instances, rollback isolates failures, and login limits persist across instances. These tests do not contact a live Turso service.
- Blob storage is mocked for integration and cloud backup/restore tests. Local browser verification under production CSP confirmed login/logout, removal of the password helper, booking input bounds, local photo upload/preview, loaded OpenStreetMap tile images, and the privacy page, with no console errors/warnings observed in those flows.
- No services were provisioned and no live Vercel deployment was performed. Cloud upload/download, HTTPS cookies on the final domain, function routing, and real provider connectivity still need the launch checks in README after credentials are configured. Optional tasks 17–19 (email, live updates, pagination) remain open.

The earlier local-app walkthrough below is historical; the Vercel setup is documented in README.

---

# Full implementation verification

## Current implementation — October 25, 2026

Admin database backup and restore have been removed from the dashboard, API, and current feature documentation. Their regression cases were replaced by a check that both former endpoints return HTTP 404 even for an administrator, without changing records or the active session. Ordinary database persistence remains covered.

The current project passes **109 tests across 8 files**, the frontend/server TypeScript checks, and a warning-free production build. A server-rendered UI smoke check confirms the five remaining admin tabs: Listings, Reservations, Accounts, Reviews, and Activity log. No new browser walkthrough was run for this removal.

See [AUDIT.md](AUDIT.md) for the earlier audit findings, browser verification, dependency checks, and verification limits. That audit's 120-test result predates feature removal. The October 21 results below are also historical and describe earlier application versions.

## Historical implementation verification

Verified October 21, 2026 on the `full` branch. The application runs locally with a React frontend, Express API, and SQLite database. No payment workflow or hosted deployment is included.

## Automated checks

- `npm test`: **54 tests passed**, including 24 HTTP integration tests against isolated SQLite databases and 30 algorithm/domain regression tests.
- `npm run build`: **passed**, including frontend and server TypeScript checks and the Vite production bundle.
- Dependency audit after updating Vitest: **zero reported vulnerabilities**. The runtime-only audit also reported zero.
- Production smoke checks: homepage, JavaScript bundle, bundled photo, and API returned HTTP 200. The fresh database contained **150 properties with unique names**, five accounts, six reservations, and one review.

### Algorithms and booking rules

- Hash collisions, chained lookup, replacement, deletion, missing keys, and comparison counts.
- Levenshtein distances and matrices, typo tolerance tiers, normalization, multiple query words, filters, sorting, and North Caloocan search.
- Custom Voronoi point location against brute-force nearest seeds; empty/single datasets, coincident points, clipping construction, and deterministic boundary ties.
- Overlapping and adjacent date intervals, capacity, past dates, ownership, listing visibility, cancellation, and preserved booked rates.
- Concurrent booking requests: exactly one conflicting request succeeds; the other returns HTTP 409.

### API and persistence

- Registration, login/logout, session invalidation, password changes, pending host approval, role enforcement, account suspension, and sign-in rate limits.
- Public versus private state, protected check-in instructions, scoped bookings, host ownership, listing creation/edit approval, and blocked dates.
- Private favorites, participant-only messages, notifications, completed-stay reviews, duplicate review rejection, and moderation.
- Check-in/check-out restrictions and account restoration controls.
- Photo upload authorization, content validation, and static image retrieval.
- Scoped reports, clipped date ranges, CSV export, and formula escaping.
- Backup includes uploaded image bytes; restoration recovers them and revokes sessions. Malformed and foreign-key-invalid restores roll back without losing the existing database or session.
- Database reopening preserves records. Newer unsupported schema versions are rejected.
- Original prototype browser-storage fixtures remain covered by regression tests; the full application uses SQLite rather than those fixtures.

## Browser walkthrough

Tested the development application and production build in the in-app browser using isolated QA databases:

- Guest Alex signed in, saved a favorite, booked The Sunday Studio for February 10–13, 2030, and received a booking reference. Refresh preserved the session and booking. The booking summary displayed PHP 7,200 at the original PHP 2,400 nightly rate.
- Alex sent a property message; host Isabel signed in, read it, and replied in the private conversation.
- Isabel checked in a seeded reservation, updated The Sunday Studio to PHP 2,500, and blocked February 20–22, 2030. The listing edit entered pending approval; the existing booking retained its original rate.
- Admin approved the edited listing. A newly registered host initially had listing creation disabled; admin approval enabled the host account.
- Production admin reports displayed all properties and seeded booking totals without browser console errors or React key warnings.
- The map represented all 150 stays. Cluster counts plus individual markers totaled 150; selecting a cluster zoomed into individual price markers. A placed pin selected a nearby Camarin property and displayed approximate straight-line distance.
- At 390-pixel viewport width, signed-out and signed-in navigation and advanced filters were usable without horizontal document overflow.
- The custom algorithm lab remains available with the same implementations used for indexes, fuzzy search, and Voronoi mapping. Its interactive controls were exercised during the earlier prototype walkthrough; its algorithms pass the current regression suite.

## Verification limits

- Native operating-system printing was not exercised; the printable booking summary was opened and inspected.
- An offline basemap failure was not simulated. The visible tile-loading/error notice and local marker/polygon fallback remain implemented.
- Photo upload, backup/restore, review moderation, and conflicting booking edge cases were verified through HTTP integration tests; not every API scenario was repeated through the browser.
- This is a local implementation, not an externally audited public deployment. It has no email delivery, payment processing, GPS, or travel-time routing.
- Seed properties, addresses, prices, and approximate coordinates are fictional. The rectangular North Caloocan demo extent is not an official administrative boundary.

QA data was isolated under temporary directories and is not included in the repository. The original `main` branch remains the earlier localStorage prototype.

## Reduction to 50 stays

The seed generator now creates 50 fictional listings. Schema migration 2 unpublishes the surplus generated listings (51–150) in existing databases without deleting bookings, messages, reviews, or user-created listings. Historical 150-listing walkthrough results above describe the previous dataset.

- `npm test`: **55 tests passed**, including the new legacy-data migration regression.
- `npm run build`: **passed**.
- No new browser walkthrough was run for this data-only change.

## Additional accommodation images

Added eight locally bundled Pexels accommodation images (14 total) and three-photo seed galleries. Migration 3 updates only untouched original demo galleries; customized/uploaded galleries remain intact.

- `npm test`: **56 tests passed**, including gallery migration and preservation checks.
- `npm run build`: **passed**.
- All 14 JPEGs decoded successfully and have distinct SHA-256 hashes; a contact sheet of the eight additions was visually inspected. Added download size: approximately 1.1 MB.
- No new browser walkthrough was run for this asset/data change.
