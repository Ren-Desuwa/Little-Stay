# Little Stay audit — October 25, 2026

This is the historical audit snapshot. Admin database backup and restore were subsequently removed at the user's request. References to those features and the test counts below describe the application before removal; see [VERIFICATION.md](VERIFICATION.md) for current verification.

The application, server, shared libraries, algorithm demos, persistence, dependencies, and startup scripts were reviewed. Confirmed defects were fixed and regression coverage was expanded. This audit covers the current project files and local application, not the operating system or a public deployment.

## Fixed findings

### Privacy, authorization, and persistence

- **Private check-in instructions:** historical properties added back to guest state bypassed instruction filtering. A guest with only a cancelled reservation could receive instructions after the listing became unpublished or suspended. Both normal and historical properties now use the same permission-aware serializer.
- **Host eligibility:** listing visibility, booking creation, new favorites, and new conversations now consistently require an approved, unsuspended host. Removing an existing favorite remains possible after its listing becomes unavailable.
- **Backup integrity:** restores now validate real calendar dates, booking rates and totals, overlapping reservations and date blocks, account roles, property ownership, conversation participants, message senders, review relationships, flags, and timestamps. Failed restores preserve database records and sessions.
- **Image writes:** uploads and restores install content-hashed images through a temporary file and atomic rename. A regression simulates a partial disk-write failure and verifies existing image bytes and temporary-file cleanup.
- **Input handling:** cover photos must belong to the gallery; multipart field and part counts are bounded; oversized JSON returns HTTP 413; malformed stored password hashes fail authentication safely.
- **Health reporting:** the health endpoint reports the actual SQLite schema version.

### Frontend behavior

- State responses are ordered so a delayed poll cannot replace newer account or mutation data. Invalid API responses and polling failures produce visible errors.
- Account changes clear account-specific dialogs and reset account components. Distinct React keys prevent reservation sections from duplicating during reconciliation.
- Guests cannot open host reports through a hash URL. Signed-out protected pages have a recovery path.
- Report labels and CSV links use the loaded report period. Failed report requests remove stale results.
- Conversation drafts are stored separately by thread, and polling does not change the selected conversation unexpectedly.
- Dialog headings have unique IDs; scroll locking accounts for multiple dialogs; backdrop clicks distinguish the dialog body from its backdrop. Restore errors remain visible in the confirmation dialog.
- Booking summaries follow current reservation state, and review selection remains valid after refresh.
- Selected map clusters retain access to their properties. Selecting a marker clears an older nearest-pin selection.
- Guest, night, and bedroom labels use the correct singular/plural form.
- The admin algorithm lab loads separately. The final main bundle is approximately 460.45 kB, with a separate 41.46 kB lab bundle; the build has no chunk-size warning.

### Algorithms and compatibility helpers

- Explicit ascending/descending price sorting takes priority over fuzzy relevance among accepted results.
- Coincident Voronoi sites use the same ID ordering as nearest-site lookup. Half-plane intersections stay on their source segment, and zero-area cells do not contain arbitrary points.
- Exported prototype mutation helpers now check canonical account state, moderation, and calendar blocks. Listing edits return to pending review.
- Prototype storage accepts additional accounts and every booking lifecycle status and rejects malformed optional collections. The live application continues to use SQLite.
- README seed ownership counts now match the 50-property dataset: Isabel has 27 properties and Marco has 23.

### Dependencies and street tiles

- Updated the lockfile to body-parser 2.4.0 and multer 2.5.0, and raised the multer manifest minimum to the patched release. These address the published [body-parser advisory](https://github.com/advisories/GHSA-27r3-jxmh-p828) and [multer advisory](https://github.com/advisories/GHSA-q7qp-rjg7-q26m). The final npm audit reported zero vulnerabilities.
- Production responses previously set `Referrer-Policy: same-origin`, suppressing the cross-origin Referer required by OpenStreetMap. The header now uses `strict-origin-when-cross-origin`, consistent with the [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/). A browser reload verified that street tiles rendered after the change.
- Tile loading tracks failures across each batch so a later successful tile cannot hide another tile's failure.

## Verification

| Check                                 | Result                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete Vitest suite                 | 120 tests passed across 8 files                                                                                                                         |
| API suite within the complete run     | 43 tests, including privacy, authorization, restore rollback, uploads, atomic image writes, and response headers                                        |
| Library suite within the complete run | 77 tests, including API response handling, domain rules, storage, algorithms, traces, and playback                                                      |
| Production build                      | Frontend and server TypeScript checks plus Vite bundle passed without warnings                                                                          |
| Formatting                            | Prettier check passed for `src`, `server`, `scripts`, `package.json`, and `README.md`                                                                   |
| Dependency audit                      | Zero reported vulnerabilities after the two compatible updates                                                                                          |
| Existing database, read-only          | `PRAGMA quick_check` returned `ok`; `foreign_key_check` returned no violations; schema version 3                                                        |
| Development startup                   | `npm run dev` started Vite and API; homepage, source module, and proxied health endpoint returned HTTP 200                                              |
| Production startup                    | `npm start` served homepage, JavaScript, CSS, favicon, bundled image, font, and health endpoint with HTTP 200; unknown API route returned JSON HTTP 404 |
| Geometry comparison                   | 15,012 deterministic point checks matched Voronoi point location against nearest-site lookup                                                            |

The browser pass exercised seeded guest/host/admin sessions, protected report navigation, host-scoped reports, report-period/export consistency, invalid-period errors, future booking creation, session and booking persistence across reload/server restart, booking summaries, admin tab keyboard navigation, algorithm playback and tabs, modal scroll restoration, map clustering, marker selection, Voronoi overlay, and a narrow mobile layout with no horizontal page overflow.

Two future reservations were created only in a temporary audit database. Existing application records were not changed. Mutation tests used isolated temporary SQLite databases and upload directories. Loopback HTTP checks required the execution environment's network approval; their authorized reruns passed.

## Limits

- Git metadata is unavailable in this workspace, so commit history, branch differences, and repository cleanliness could not be verified.
- Native printing was not exercised; the booking summary was inspected in the browser.
- An offline browser was not simulated. Tile-error handling was reviewed and corrected; online map rendering was verified.
- Upload validation checks JPEG/PNG/WebP signatures rather than decoding the full image stream.
- API integration tests cover upload, restore, review moderation, and conflicting-booking cases; every API scenario was not repeated manually in the browser.
- The application remains a local project with fictional listings and documented demo credentials. No hosted deployment or operating-system audit was performed.
