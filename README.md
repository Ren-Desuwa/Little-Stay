# Little Stay

A local short-term rental booking prototype for an algorithms project. Built with React, TypeScript, Vite, and Leaflet. No backend, API key, or payment account is required.

## Run locally

Use Node.js 22.12+ (or Node.js 20.19+).

```sh
npm install
npm run dev
```

Open the Local URL printed by Vite, normally http://127.0.0.1:5173.

```sh
npm test          # Algorithm, booking, ownership, search, and persistence tests
npm run build    # TypeScript check and production build
npm run preview  # Serve the production build locally
```

Photos, fonts, application code, and data are local. The OpenStreetMap basemap requires internet access. A failed basemap displays a notice while property markers, the coordinate grid, Voronoi regions, and booking features remain available. No geocoding, GPS, route calculation, or remote property service is used.

## Demo accounts

Select an account in the upper-right corner. The default is Alex Santos. Switching accounts does not delete saved data; refreshing returns the selected account to Alex.

| Account      | Role  | Access                                                                |
| ------------ | ----- | --------------------------------------------------------------------- |
| Alex Santos  | Guest | Own reservations, new bookings, upcoming cancellations                |
| Jamie Cruz   | Guest | Separate guest's reservations                                         |
| Isabel Reyes | Host  | Own eight seeded listings and associated reservations                 |
| Marco Lim    | Host  | Own seven seeded listings and associated reservations                 |
| Sam Rivera   | Admin | All listings, reservations, and accounts; suspension and cancellation |

All accounts, properties, reservations, and locations are fictional. Coordinates are placed around Makati. Interface ownership checks demonstrate role behavior; localStorage and simulated accounts are not real authentication or authorization. Use one active tab. Data is stored under `little-stay-data-v1` in this browser and origin. It is not shared with other browsers or machines. The heart buttons are session-only conveniences.

## Suggested presentation walkthrough

1. Search for `blacony`. Show that the results match the Balcony amenity. Combine `salcedo blacony` to show every query word must match. `Makati` searches all listings.
2. Filter by capacity, amenities, price, and dates. Sort by nightly price. The maximum-price slider's rightmost position means no limit.
3. Open a property, select future check-in and checkout dates, and reserve. Show the booking reference and total in My bookings. Refresh to demonstrate persistence. Switch to Jamie to show that Alex's booking is inaccessible, including by reference lookup.
4. Switch to Isabel. Edit The Sunday Studio's price or create a listing, choosing a bundled photo and map location. Publish/unpublish it. Existing reservations retain their booked nightly rate.
5. Switch to Sam. Suspend a listing, verify it is absent from search, then restore it. Existing bookings remain visible. Admin cancellation releases booked dates.
6. In Map view, enable Voronoi regions and click inside the bounded Makati area. Show the nearest matching property and approximate straight-line distance. Filters change the seed set.
7. Open Algorithm lab. Select seven hash buckets to expose collisions, then look up a key in a chain. Compare `blacony` with `balcony` in the fuzzy tab. Use the Voronoi step slider to show successive half-plane clips.
8. Use Reset demo in the footer. Confirm to restore the original five users, fifteen listings, and two sample bookings. Sample bookings are seeded relative to the reset date.

## Algorithms and implementation

- `src/lib/algorithms.ts`: DJB2-style string hash, separate chaining, update/delete/lookup comparisons; Levenshtein dynamic programming and normalization; local projection, convex half-plane clipping, bounded Voronoi cells, point location, and deterministic ties.
- `src/lib/model.ts`: domain types, hash indexes, role checks, listing mutation, date-only reservation rules, filtering, search ranking, and price snapshots.
- `src/lib/seed.ts` and `storage.ts`: fictional seed data, versioned browser persistence, validation and recovery of malformed saved data.
- `src/components/AlgorithmLab.tsx`: interactive explanations using the application's algorithm implementations. Hash-table capacity is adjustable in the lab only; application indexes use 17 buckets.
- `src/components/StayMap.tsx`: Leaflet is used only for map rendering and interaction. Voronoi cells and nearest-cell selection are custom code.

Hash lookup is expected O(1) with a bounded load factor, worst-case O(n). This small demo uses a fixed capacity and exposes its load factor; it does not claim constant lookup time for an unbounded dataset. Levenshtein uses O(mn) time and space per word pair. For n sites, repeated convex clipping is O(n³) in the worst case across all cells; point location scans cell edges. The diagram illustrates computational geometry and is not claimed to outperform brute force at this scale. Distances use a local equirectangular approximation in kilometers. Equal-distance boundaries and coincident seeds choose the lexicographically lowest property ID.

Reservations use date-only ISO values and half-open intervals `[check-in, checkout)`. Back-to-back stays are valid. Overlapping confirmed reservations, past check-ins, invalid dates, excessive guests, and unavailable properties are rejected when confirming. Cancellation releases dates. Prices are nightly rate × nights, with no taxes, service fees, payments, or refunds.

## Verification

The automated suite covers collisions, in-place hash updates and deletion, fuzzy tolerance tiers and multiword matching, Voronoi versus brute-force nearest points on a deterministic grid, coincident seeds and shared boundaries, construction-step consistency, booking overlaps and adjacency, guest/host/admin restrictions, cancellation, preserved rates, date arithmetic, live listing filters, storage recovery, persistence, and reset.

A manual browser walkthrough covers guest booking and refresh, guest reference privacy, host price editing, admin suspension, map selection and pin lookup, and the three algorithm panels. See `VERIFICATION.md` for the final recorded results.

## Local assets and acknowledgements

Six demo apartment photos are bundled in `public/images/`, downloaded from Unsplash image delivery URLs. They illustrate fictional properties and do not represent the actual locations. Source photo IDs:

- `1600210492486-724fe5c67fb0`
- `1600607687920-4e2a09cf159d`
- `1600047509807-ba8f99d2cdde`
- `1600607687939-ce8a6c25118c`
- `1616486338812-3dadae4b4ace`
- `1600566753086-00f18fb6b3ea`

DM Sans and Manrope are bundled under the SIL Open Font License; license files are in `public/fonts/`. Icons are from Lucide. Leaflet provides map rendering. Map data © OpenStreetMap contributors; on-screen attribution is preserved. Standard tiles use normal on-demand requests, without bulk download or offline tile prefetching.

## Deliberate limits

No server, SQL database, real passwords, payments, reviews, messages, email, GPS, or travel-time routing. User registration and account management are excluded; demo account selection is intentional. Data reset is destructive within this disposable prototype and requires confirmation. There is no cross-tab synchronization. Do not use real guest or host data.
