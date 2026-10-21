# Verification record

Verified on October 21, 2026. The project runs locally through Vite; no hosted deployment was created.

## Automated checks

- `npm test`: **28 tests passed** across two test files.
- `npm run build`: **passed**, including the TypeScript project check and Vite production bundle.
- Hash tests cover colliding keys, updates without duplicate entries, deletion within a chain, missing keys, empty keys, and comparison counts.
- Search tests cover known edit distances, matrix construction, all tolerance tiers, normalization, multiple query words, Makati matching, amenity/capacity/price filters, sorting, and reservation availability.
- Geometry tests compare custom Voronoi point location against brute-force nearest seeds on a deterministic grid. Empty/single sets, seed containment, outside points, coincident coordinates, shared-boundary ties, and final construction-step consistency pass.
- Booking tests cover overlap patterns, adjacent stays, invalid/past dates, capacity, non-guest booking, suspension/unpublishing, preserved nightly rates, cancellation ownership, admin cancellation, leap-year dates, and non-mutating domain operations.
- Persistence tests cover serialization and index rebuilding, corrupt saved data, denied/full storage, and restoring original seed data.

## Browser walkthrough

Completed through the Codex in-app browser:

- `blacony` returns eight balcony listings before any suspension and displays the corrected word.
- Guest Alex booked The Sunday Studio for February 10–13, 2030, with two guests. Total: PHP 7,200 at PHP 2,400 per night. A unique booking reference appeared in My bookings.
- Refresh preserved the reservation.
- Guest Jamie saw only Jamie's booking. Looking up Alex's exact reference returned no accessible reservation.
- Host Isabel saw only Isabel's eight properties and associated bookings. Changing The Sunday Studio's price to PHP 2,600 succeeded; existing bookings continued to show PHP 2,400 per night.
- Admin Sam suspended The Sunday Studio. A search for its title returned no result; existing reservations remained visible.
- Real OpenStreetMap tiles loaded with attribution. Selecting a property marker displayed its preview. Clicking the map selected a nearest property and displayed approximate distance. The Voronoi overlay control was exercised.
- Hash lab: changing capacity to seven exposed eight collisions among fifteen property records.
- Fuzzy lab: `blacony` versus `balcony` displayed edit distance two, accepted status, the matrix, and matched listing words.
- Voronoi lab: construction slider reached the last clipping step and displayed the final clipping caption.
- Guest cancellation required confirmation and changed the new booking to cancelled.
- Reset required confirmation, restored fifteen searchable listings and the original data, and returned to the guest exploration view.
- At 390 × 844, the homepage, account controls, search inputs, and responsive layout were inspected. A heading wrap issue was corrected and verified after reloading. The page had no horizontal document overflow.

## Verification limits

- Basemap tiles loaded successfully during browser testing; an actual offline/failed-tile session was not simulated. The loading/error notice and local fallback remain implemented.
- Denied/full storage was tested at the persistence layer, not by changing the browser's storage permissions.
- This is a local prototype, not a security-tested production system. Account switching is simulated. Concurrent tabs and real authentication are intentionally unsupported.

The browser demo was reset after testing. Temporary test reservations and price/suspension edits were removed.
