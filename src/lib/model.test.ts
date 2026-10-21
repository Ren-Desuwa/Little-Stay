import { region } from './region';
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  addDays,
  available,
  buildIndexes,
  cancelBooking,
  createBooking,
  findProperties,
  nights,
  saveProperty,
  toggleSuspension,
  validateDates,
  validDate,
  type Filters,
} from './model';
import { seedData } from './seed';
import { loadData, persistData, STORAGE_KEY } from './storage';

const now = '2030-01-01';
const booking = { propertyId: 'stay-01', checkIn: '2030-01-10', checkOut: '2030-01-13', guests: 2 };
const fresh = () => ({ ...seedData(), reservations: [] });
const filters: Filters = {
  query: '',
  maxPrice: 10000,
  guests: 1,
  amenities: [],
  checkIn: '',
  checkOut: '',
  sort: 'recommended',
};
afterEach(() => vi.unstubAllGlobals());
describe('reservation rules', () => {
  it('creates a booking with a reference index and immutable booked rate', () => {
    const d = fresh();
    const next = createBooking(d, d.users[0], booking, now);
    const r = next.reservations[0];
    expect(r.total).toBe(7200);
    expect(r.nightlyRate).toBe(2400);
    expect(r.reference).toMatch(/^LS-/);
    expect(buildIndexes(next).references.get(r.reference)?.id).toBe(r.id);
    const updated = saveProperty(next, d.users[2], { ...d.properties[0], price: 9999 });
    expect(updated.reservations[0].nightlyRate).toBe(2400);
    expect(d.reservations).toHaveLength(0);
  });
  it('rejects overlapping dates but permits adjacent stays', () => {
    const d = fresh();
    const next = createBooking(d, d.users[0], booking, now);
    for (const [checkIn, checkOut] of [
      ['2030-01-09', '2030-01-11'],
      ['2030-01-12', '2030-01-15'],
      ['2030-01-11', '2030-01-12'],
      ['2030-01-09', '2030-01-15'],
      ['2030-01-10', '2030-01-13'],
    ])
      expect(() => createBooking(next, d.users[1], { ...booking, checkIn, checkOut }, now)).toThrow(
        /reserved/,
      );
    expect(available('stay-01', '2030-01-08', '2030-01-10', next.reservations)).toBe(true);
    expect(() =>
      createBooking(
        next,
        d.users[1],
        { ...booking, checkIn: '2030-01-13', checkOut: '2030-01-15' },
        now,
      ),
    ).not.toThrow();
  });
  it('cancels and releases dates, while preventing other guests and hosts from cancelling', () => {
    const d = fresh();
    const next = createBooking(d, d.users[0], booking, now),
      id = next.reservations[0].id;
    expect(() => cancelBooking(next, d.users[1], id, now)).toThrow();
    expect(() => cancelBooking(next, d.users[2], id, now)).toThrow();
    expect(() => cancelBooking(next, d.users[0], id, '2030-01-11')).toThrow();
    const cancelled = cancelBooking(next, d.users[0], id, now);
    expect(available('stay-01', booking.checkIn, booking.checkOut, cancelled.reservations)).toBe(
      true,
    );
    expect(() => cancelBooking(cancelled, d.users[0], id, now)).toThrow(/already/);
    expect(cancelBooking(next, d.users[4], id, '2030-01-11').reservations[0].status).toBe(
      'cancelled',
    );
  });
  it('rejects invalid dates, past dates, capacities, and non-guest accounts', () => {
    const d = fresh();
    for (const patch of [
      { checkIn: '2029-12-31' },
      { checkOut: booking.checkIn },
      { checkIn: 'bad' },
      { checkOut: '2030-02-30' },
      { guests: 0 },
      { guests: 3 },
      { guests: 1.5 },
    ])
      expect(() => createBooking(d, d.users[0], { ...booking, ...patch }, now)).toThrow();
    expect(() => createBooking(d, d.users[2], booking, now)).toThrow(/guest/);
    expect(() => createBooking(d, d.users[4], booking, now)).toThrow(/guest/);
  });
  it('rejects unpublished, suspended, or removed properties at confirmation', () => {
    const d = fresh();
    expect(() =>
      createBooking(
        { ...d, properties: d.properties.map((p) => ({ ...p, published: false })) },
        d.users[0],
        booking,
        now,
      ),
    ).toThrow(/no longer/);
    const suspended = toggleSuspension(d, d.users[4], 'stay-01');
    expect(() => createBooking(suspended, d.users[0], booking, now)).toThrow(/no longer/);
    expect(() => createBooking({ ...d, properties: [] }, d.users[0], booking, now)).toThrow(
      /no longer/,
    );
  });
  it('uses date-only arithmetic across months and leap years', () => {
    expect(nights('2028-02-28', '2028-03-01')).toBe(2);
    expect(addDays('2028-02-28', 2)).toBe('2028-03-01');
    expect(validDate('2030-02-30')).toBe(false);
    expect(() => validateDates('2030-01-01', '2030-01-02', now)).not.toThrow();
  });
});

describe('listing management and search', () => {
  it('enforces ownership, input validation, and suspension control', () => {
    const d = fresh(),
      p = d.properties[0],
      host = d.users[2];
    expect(() => saveProperty(d, d.users[3], p)).toThrow(/own/);
    expect(() => saveProperty(d, d.users[0], p)).toThrow(/hosts/);
    for (const patch of [
      { price: 0 },
      { capacity: 0 },
      { bedrooms: -1 },
      { lat: 0 },
      { lng: NaN },
      { title: '  ' },
    ])
      expect(() => saveProperty(d, host, { ...p, ...patch })).toThrow();
    const suspended = toggleSuspension(d, d.users[4], p.id);
    const edited = saveProperty(suspended, host, { ...p, title: 'New name', suspended: false });
    expect(edited.properties[0].suspended).toBe(true);
    expect(() => toggleSuspension(d, host, p.id)).toThrow(/admins/);
    expect(toggleSuspension(suspended, d.users[4], p.id).properties[0].suspended).toBe(false);
  });
  it('adds a new host-owned listing', () => {
    const d = fresh();
    const next = saveProperty(d, d.users[2], {
      ...d.properties[0],
      id: 'new-stay',
      title: 'New listing',
    });
    expect(next.properties).toHaveLength(16);
    expect(buildIndexes(next).properties.get('new-stay')?.title).toBe('New listing');
  });
  it('places every fictional listing inside the North Caloocan search area', () => {
    const d = fresh();
    for (const p of d.properties) {
      expect(p.lat).toBeGreaterThanOrEqual(region.bounds.south);
      expect(p.lat).toBeLessThanOrEqual(region.bounds.north);
      expect(p.lng).toBeGreaterThanOrEqual(region.bounds.west);
      expect(p.lng).toBeLessThanOrEqual(region.bounds.east);
    }
    expect(findProperties(d, { ...filters, query: 'Camarin' })).toHaveLength(3);
    expect(findProperties(d, { ...filters, query: 'Makati' })).toHaveLength(0);
  });
  it('filters, sorts, and fuzzy-matches live listings', () => {
    const d = fresh();
    const all = findProperties(d, filters);
    expect(all).toHaveLength(15);
    expect(findProperties(d, { ...filters, query: 'North Caloocan' })).toHaveLength(15);
    const balcony = findProperties(d, { ...filters, query: 'blacony' });
    expect(balcony.length).toBeGreaterThan(0);
    expect(balcony.every((r) => r.property.amenities.includes('Balcony'))).toBe(true);
    expect(findProperties(d, { ...filters, query: 'blacony helicopter' })).toHaveLength(0);
    expect(
      findProperties(d, { ...filters, maxPrice: 2000, amenities: ['Balcony'], guests: 4 }).map(
        (r) => r.property.id,
      ),
    ).toEqual(['stay-05']);
    const low = findProperties(d, { ...filters, sort: 'price-low' });
    expect(low[0].property.price).toBe(1900);
    expect(findProperties(d, { ...filters, sort: 'price-high' })[0].property.price).toBe(4800);
    const suspended = toggleSuspension(d, d.users[4], 'stay-01');
    expect(findProperties(suspended, filters)).toHaveLength(14);
  });
  it('excludes booked dates and restores them after cancellation', () => {
    const d = fresh(),
      next = createBooking(d, d.users[0], booking, now);
    const f = { ...filters, checkIn: booking.checkIn, checkOut: booking.checkOut };
    expect(findProperties(next, f).some((r) => r.property.id === 'stay-01')).toBe(false);
    expect(
      findProperties(cancelBooking(next, d.users[0], next.reservations[0].id, now), f).some(
        (r) => r.property.id === 'stay-01',
      ),
    ).toBe(true);
  });
});

describe('local persistence and fresh demo', () => {
  function mockStorage() {
    const entries: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => entries[key] ?? null,
      setItem: (key: string, value: string) => {
        entries[key] = value;
      },
    });
    return entries;
  }
  it('starts the North Caloocan dataset without overwriting saved prototype data', () => {
    const entries = mockStorage();
    entries['little-stay-data-v1'] = 'original prototype data';
    const fresh = loadData();
    expect(fresh.data.properties[0].neighborhood).toBe('Camarin');
    persistData(fresh.data);
    expect(entries['little-stay-data-v1']).toBe('original prototype data');
    expect(entries[STORAGE_KEY]).toBeTruthy();
  });
  it('round trips mutations and rebuilds lookup indexes on reload', () => {
    mockStorage();
    const d = fresh(),
      next = createBooking(d, d.users[0], booking, now);
    persistData(next);
    const restored = loadData();
    expect(restored.warning).toBe('');
    expect(restored.data).toEqual(next);
    expect(buildIndexes(restored.data).references.get(next.reservations[0].reference)).toEqual(
      next.reservations[0],
    );
  });
  it('recovers corrupt data and reports storage failures', () => {
    const entries = mockStorage();
    entries[STORAGE_KEY] = 'invalid';
    expect(loadData().warning).not.toBe('');
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('full');
      },
    });
    expect(loadData().data.properties).toHaveLength(15);
    expect(() => persistData(fresh())).toThrow('full');
  });
  it('resets persisted changes to five accounts and fifteen original listings', () => {
    mockStorage();
    const d = fresh();
    persistData(saveProperty(d, d.users[2], { ...d.properties[0], title: 'Changed' }));
    persistData(seedData());
    expect(loadData().data.properties[0].title).toBe('The Sunday Studio');
    expect(loadData().data.users).toHaveLength(5);
    expect(loadData().data.reservations).toHaveLength(2);
  });
});
