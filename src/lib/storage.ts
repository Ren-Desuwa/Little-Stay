import { validDate, type Data } from './model';
import { seedData } from './seed';
export const STORAGE_KEY = 'little-stay-north-caloocan-data-v1';
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null;
const text = (v: unknown): v is string => typeof v === 'string';
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const boolean = (v: unknown): v is boolean => typeof v === 'boolean';
const optional = (v: unknown, valid: (value: unknown) => boolean) => v === undefined || valid(v);
const oneOf = (v: unknown, values: string[]) => text(v) && values.includes(v);
const textFields = (row: RecordValue, keys: string[]) => keys.every((key) => text(row[key]));
const dateRange = (start: unknown, end: unknown) =>
  text(start) && text(end) && validDate(start) && validDate(end) && end > start;
const validUser = (u: unknown) =>
  record(u) &&
  textFields(u, ['id', 'name']) &&
  oneOf(u.role, ['guest', 'host', 'admin']) &&
  optional(u.hostStatus, (v) => oneOf(v, ['pending', 'approved', 'rejected'])) &&
  optional(u.suspended, boolean) &&
  ['email', 'bio'].every((key) => optional(u[key], text));
const uniqueIds = (rows: { id: string }[]) => new Set(rows.map((r) => r.id)).size === rows.length;
const optionalRows = (value: unknown, valid: (row: RecordValue) => boolean) =>
  optional(
    value,
    (rows) =>
      Array.isArray(rows) &&
      rows.every((row) => record(row) && text(row.id) && valid(row)) &&
      uniqueIds(rows),
  );
function validData(value: unknown): value is Data {
  if (
    !record(value) ||
    value.version !== 1 ||
    !Array.isArray(value.users) ||
    !Array.isArray(value.properties) ||
    !Array.isArray(value.reservations)
  )
    return false;
  const { users, properties, reservations } = value;
  if (!users.every(validUser)) return false;
  if (
    !properties.every(
      (p) =>
        record(p) &&
        ['id', 'hostId', 'title', 'neighborhood', 'description', 'image'].every((k) =>
          text(p[k]),
        ) &&
        finite(p.price) &&
        p.price > 0 &&
        finite(p.capacity) &&
        Number.isInteger(p.capacity) &&
        p.capacity > 0 &&
        finite(p.bedrooms) &&
        Number.isInteger(p.bedrooms) &&
        p.bedrooms >= 0 &&
        finite(p.lat) &&
        finite(p.lng) &&
        Array.isArray(p.amenities) &&
        p.amenities.every(text) &&
        typeof p.published === 'boolean' &&
        typeof p.suspended === 'boolean' &&
        optional(p.approval, (v) => oneOf(v, ['pending', 'approved', 'rejected'])) &&
        ['address', 'propertyType', 'houseRules', 'checkInInstructions'].every((key) =>
          optional(p[key], text),
        ) &&
        optional(p.images, (v) => Array.isArray(v) && v.every(text)),
    )
  )
    return false;
  if (
    !reservations.every(
      (r) =>
        record(r) &&
        ['id', 'reference', 'propertyId', 'guestId', 'createdAt'].every((k) => text(r[k])) &&
        text(r.checkIn) &&
        validDate(r.checkIn) &&
        text(r.checkOut) &&
        validDate(r.checkOut) &&
        r.checkOut > r.checkIn &&
        finite(r.guests) &&
        Number.isInteger(r.guests) &&
        r.guests > 0 &&
        finite(r.nightlyRate) &&
        r.nightlyRate > 0 &&
        finite(r.total) &&
        oneOf(r.status, ['confirmed', 'cancelled', 'checked-in', 'completed']),
    )
  )
    return false;
  if (
    !optional(value.currentUser, (u) => u === null || validUser(u)) ||
    !optional(value.favorites, (v) => Array.isArray(v) && v.every(text)) ||
    !optionalRows(
      value.calendar,
      (c) =>
        text(c.propertyId) &&
        dateRange(c.start, c.end) &&
        oneOf(c.kind, ['booking', 'blocked']) &&
        optional(c.reason, text),
    ) ||
    !optionalRows(
      value.reviews,
      (r) =>
        textFields(r, ['bookingId', 'propertyId', 'guestId', 'body', 'createdAt']) &&
        finite(r.rating) &&
        Number.isInteger(r.rating) &&
        r.rating >= 1 &&
        r.rating <= 5 &&
        boolean(r.hidden),
    ) ||
    !optionalRows(value.threads, (t) =>
      textFields(t, ['propertyId', 'guestId', 'hostId', 'updatedAt']),
    ) ||
    !optionalRows(value.messages, (m) =>
      textFields(m, ['threadId', 'senderId', 'body', 'createdAt']),
    ) ||
    !optionalRows(
      value.notifications,
      (n) => textFields(n, ['userId', 'body', 'createdAt']) && boolean(n.read),
    ) ||
    !optionalRows(value.audit, (a) => textFields(a, ['actorId', 'action', 'targetId', 'createdAt']))
  )
    return false;
  const data = value as Data;
  return (
    uniqueIds(data.users) &&
    uniqueIds(data.properties) &&
    uniqueIds(data.reservations) &&
    new Set(data.reservations.map((r) => r.reference)).size === data.reservations.length &&
    data.properties.every((p) => data.users.some((u) => u.id === p.hostId && u.role === 'host')) &&
    data.reservations.every(
      (r) =>
        data.properties.some((p) => p.id === r.propertyId) &&
        data.users.some((u) => u.id === r.guestId && u.role === 'guest'),
    )
  );
}
export function loadData(): { data: Data; warning: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { data: seedData(), warning: '' };
    const data: unknown = JSON.parse(raw);
    if (!validData(data)) throw new Error('Invalid saved data');
    return { data, warning: '' };
  } catch {
    return {
      data: seedData(),
      warning:
        'Saved demo data could not be loaded. A fresh demo is ready; saving may replace the old data.',
    };
  }
}
export function persistData(data: Data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
