import { HashTable, indexById, matchText, geoBounds } from './algorithms';
export type Role = 'guest' | 'host' | 'admin';
export type User = { id: string; name: string; role: Role };
export const amenities = [
  'WiFi',
  'Air conditioning',
  'Kitchen',
  'Pool',
  'Gym',
  'Balcony',
  'Parking',
  'Workspace',
] as const;
export type Property = {
  id: string;
  hostId: string;
  title: string;
  neighborhood: string;
  description: string;
  price: number;
  capacity: number;
  bedrooms: number;
  amenities: string[];
  lat: number;
  lng: number;
  image: string;
  published: boolean;
  suspended: boolean;
};
export type Reservation = {
  id: string;
  reference: string;
  propertyId: string;
  guestId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  nightlyRate: number;
  total: number;
  status: 'confirmed' | 'cancelled';
  createdAt: string;
};
export type Data = {
  version: 1;
  users: User[];
  properties: Property[];
  reservations: Reservation[];
};
export const money = (n: number) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(n);
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(value: string, days: number) {
  const d = new Date(value + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function nights(start: string, end: string) {
  return (Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000;
}
export function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function validateDates(start: string, end: string, now = today()) {
  if (!validDate(start) || !validDate(end))
    throw new Error('Choose valid check-in and checkout dates.');
  if (start < now) throw new Error('Check-in cannot be in the past.');
  if (end <= start) throw new Error('Checkout must be after check-in.');
}
export function available(
  propertyId: string,
  start: string,
  end: string,
  reservations: Reservation[],
) {
  return !reservations.some(
    (r) =>
      r.propertyId === propertyId &&
      r.status === 'confirmed' &&
      start < r.checkOut &&
      end > r.checkIn,
  );
}
export function buildIndexes(data: Data) {
  const references = new HashTable<Reservation>();
  data.reservations.forEach((r) => references.set(r.reference, r));
  return {
    users: indexById(data.users),
    properties: indexById(data.properties),
    reservations: indexById(data.reservations),
    references,
  };
}
export function createBooking(
  data: Data,
  actor: User,
  input: { propertyId: string; checkIn: string; checkOut: string; guests: number },
  now = today(),
): Data {
  if (actor.role !== 'guest' || !data.users.some((u) => u.id === actor.id && u.role === 'guest'))
    throw new Error('Switch to a guest account to book a stay.');
  const property = buildIndexes(data).properties.get(input.propertyId);
  if (!property || !property.published || property.suspended)
    throw new Error('This property is no longer available for booking.');
  validateDates(input.checkIn, input.checkOut, now);
  if (!Number.isInteger(input.guests) || input.guests < 1 || input.guests > property.capacity)
    throw new Error(`Choose between 1 and ${property.capacity} guests.`);
  if (!available(property.id, input.checkIn, input.checkOut, data.reservations))
    throw new Error('Those dates are already reserved. Please choose another stay.');
  const id = `res-${crypto.randomUUID()}`;
  const reference = `LS-${id.slice(4, 12).toUpperCase()}`;
  if (data.reservations.some((r) => r.reference === reference))
    return createBooking(data, actor, input, now);
  const reservation: Reservation = {
    ...input,
    id,
    reference,
    guestId: actor.id,
    nightlyRate: property.price,
    total: property.price * nights(input.checkIn, input.checkOut),
    status: 'confirmed',
    createdAt: new Date().toISOString(),
  };
  return { ...data, reservations: [reservation, ...data.reservations] };
}
export function cancelBooking(data: Data, actor: User, id: string, now = today()): Data {
  const r = buildIndexes(data).reservations.get(id);
  if (!r) throw new Error('Reservation not found.');
  if (r.status !== 'confirmed') throw new Error('This reservation has already been cancelled.');
  if (
    actor.role !== 'admin' &&
    !(actor.role === 'guest' && r.guestId === actor.id && r.checkIn >= now)
  )
    throw new Error('You cannot cancel this reservation.');
  return {
    ...data,
    reservations: data.reservations.map((v) => (v.id === id ? { ...v, status: 'cancelled' } : v)),
  };
}
export function saveProperty(data: Data, actor: User, property: Property): Data {
  if (actor.role !== 'host') throw new Error('Only hosts can edit listings.');
  const existing = buildIndexes(data).properties.get(property.id);
  if (property.hostId !== actor.id || (existing && existing.hostId !== actor.id))
    throw new Error('You can only edit your own listings.');
  if (!property.title.trim() || !property.neighborhood.trim() || !property.description.trim())
    throw new Error('Complete the title, neighborhood, and description.');
  if (!Number.isFinite(property.price) || property.price <= 0)
    throw new Error('Enter a nightly price greater than zero.');
  if (
    !Number.isInteger(property.capacity) ||
    property.capacity < 1 ||
    property.capacity > 20 ||
    !Number.isInteger(property.bedrooms) ||
    property.bedrooms < 0 ||
    property.bedrooms > 10
  )
    throw new Error('Capacity must be 1–20 and bedrooms 0–10.');
  if (
    !Number.isFinite(property.lat) ||
    !Number.isFinite(property.lng) ||
    property.lat < geoBounds.south ||
    property.lat > geoBounds.north ||
    property.lng < geoBounds.west ||
    property.lng > geoBounds.east
  )
    throw new Error('Place the property inside the supported Makati map area.');
  const safe = {
    ...property,
    title: property.title.trim(),
    neighborhood: property.neighborhood.trim(),
    suspended: existing?.suspended ?? false,
  };
  return {
    ...data,
    properties: existing
      ? data.properties.map((p) => (p.id === safe.id ? safe : p))
      : [...data.properties, safe],
  };
}
export function toggleSuspension(data: Data, actor: User, id: string): Data {
  if (actor.role !== 'admin') throw new Error('Only admins can suspend listings.');
  if (!buildIndexes(data).properties.get(id)) throw new Error('Property not found.');
  return {
    ...data,
    properties: data.properties.map((p) => (p.id === id ? { ...p, suspended: !p.suspended } : p)),
  };
}
export const searchableText = (p: Property) =>
  `${p.title} ${p.neighborhood} Makati ${p.amenities.join(' ')}`;
export type Filters = {
  query: string;
  maxPrice: number;
  guests: number;
  amenities: string[];
  checkIn: string;
  checkOut: string;
  sort: string;
};
export function findProperties(data: Data, f: Filters) {
  return data.properties
    .filter(
      (p) =>
        p.published &&
        !p.suspended &&
        (f.maxPrice === 10000 || p.price <= f.maxPrice) &&
        p.capacity >= f.guests &&
        f.amenities.every((a) => p.amenities.includes(a)) &&
        (!f.checkIn || !f.checkOut || available(p.id, f.checkIn, f.checkOut, data.reservations)),
    )
    .map((property) => ({ property, ...matchText(f.query, searchableText(property)) }))
    .filter((p) => p.accepted)
    .sort(
      (a, b) =>
        a.score - b.score ||
        (f.sort === 'price-low'
          ? a.property.price - b.property.price
          : f.sort === 'price-high'
            ? b.property.price - a.property.price
            : a.property.id.localeCompare(b.property.id)),
    );
}
