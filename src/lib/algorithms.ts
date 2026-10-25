import { region } from './region';
/** A separate-chaining hash table. Native Map is deliberately not used. */
export class HashTable<T> {
  buckets: { key: string; value: T }[][];
  constructor(public capacity = 17) {
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new Error('Capacity must be a positive integer.');
    this.buckets = Array.from({ length: capacity }, () => []);
  }
  hash(key: string) {
    let h = 5381;
    for (const c of key) h = (Math.imul(h, 33) ^ c.charCodeAt(0)) >>> 0;
    return h % this.capacity;
  }
  set(key: string, value: T) {
    const bucket = this.buckets[this.hash(key)];
    const entry = bucket.find((e) => e.key === key);
    if (entry) entry.value = value;
    else bucket.push({ key, value });
  }
  lookup(key: string): { value: T | undefined; comparisons: number; bucket: number } {
    const bucket = this.hash(key);
    let comparisons = 0;
    for (const entry of this.buckets[bucket]) {
      comparisons++;
      if (entry.key === key) return { value: entry.value, comparisons, bucket };
    }
    return { value: undefined, comparisons, bucket };
  }
  get(key: string) {
    return this.lookup(key).value;
  }
  delete(key: string) {
    const b = this.buckets[this.hash(key)];
    const i = b.findIndex((e) => e.key === key);
    if (i < 0) return false;
    b.splice(i, 1);
    return true;
  }
  get size() {
    return this.buckets.reduce((s, b) => s + b.length, 0);
  }
  get collisions() {
    return this.buckets.reduce((s, b) => s + Math.max(0, b.length - 1), 0);
  }
  get loadFactor() {
    return this.size / this.capacity;
  }
}
export function indexById<T extends { id: string }>(records: T[]) {
  const table = new HashTable<T>();
  records.forEach((r) => table.set(r.id, r));
  return table;
}

export function distanceMatrix(a: string, b: string): number[][] {
  const m = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      m[i][j] = Math.min(
        m[i - 1][j] + 1,
        m[i][j - 1] + 1,
        m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return m;
}
export function levenshtein(a: string, b: string) {
  return distanceMatrix(a, b)[a.length][b.length];
}
export function words(text: string) {
  return (
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? []
  );
}
export function matchText(query: string, text: string) {
  const tokens = words(query);
  const candidates = [...new Set(words(text))];
  const matches = tokens.map((token) => {
    const best = candidates
      .map((word) => ({ token, word, distance: levenshtein(token, word) }))
      .sort((a, b) => a.distance - b.distance || a.word.localeCompare(b.word))[0];
    return best ?? { token, word: '', distance: Infinity };
  });
  const accepted = matches.every(
    (m) => m.distance <= (m.token.length <= 2 ? 0 : m.token.length <= 4 ? 1 : 2),
  );
  return { accepted, score: matches.reduce((s, m) => s + m.distance, 0), matches };
}

export type Point = { x: number; y: number };
export type Site = { id: string; lat: number; lng: number };
export type Cell = { id: string; polygon: Point[] };
const origin = region.center;
export const geoBounds = region.bounds;
const longitudeScale = 111.32 * Math.cos((origin.lat * Math.PI) / 180);
export function project(lat: number, lng: number): Point {
  return { x: (lng - origin.lng) * longitudeScale, y: (lat - origin.lat) * 111.32 };
}
export function unproject(p: Point): [number, number] {
  return [origin.lat + p.y / 111.32, origin.lng + p.x / longitudeScale];
}
const sw = project(geoBounds.south, geoBounds.west),
  ne = project(geoBounds.north, geoBounds.east);
export const planeBounds: Point[] = [sw, { x: ne.x, y: sw.y }, ne, { x: sw.x, y: ne.y }];
const EPS = 1e-9;
export function clipHalfPlane(polygon: Point[], a: number, b: number, c: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i],
      q = polygon[(i + 1) % polygon.length];
    const fp = a * p.x + b * p.y - c,
      fq = a * q.x + b * q.y - c;
    const insideP = fp <= EPS,
      insideQ = fq <= EPS;
    if (insideP) out.push(p);
    if (insideP !== insideQ) {
      // Tolerance can classify a point just outside the line as inside. Keep
      // the intersection on the edge instead of extrapolating past that point.
      const t = Math.max(0, Math.min(1, fp / (fp - fq)));
      out.push(t === 0 ? p : t === 1 ? q : { x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
    }
  }
  return out;
}
export function voronoi(sites: Site[], bounds = planeBounds): Cell[] {
  const sorted = [...sites].sort((a, b) => a.id.localeCompare(b.id));
  return sorted.map((site) => {
    const p = project(site.lat, site.lng);
    let polygon = bounds.map((v) => ({ ...v }));
    for (const other of sorted) {
      if (site.id === other.id) continue;
      const q = project(other.lat, other.lng);
      if (Math.abs(p.x - q.x) < EPS && Math.abs(p.y - q.y) < EPS) {
        if (other.id.localeCompare(site.id) < 0) polygon = [];
        continue;
      }
      polygon = clipHalfPlane(
        polygon,
        2 * (q.x - p.x),
        2 * (q.y - p.y),
        q.x * q.x + q.y * q.y - p.x * p.x - p.y * p.y,
      );
      if (!polygon.length) break;
    }
    return { id: site.id, polygon };
  });
}
export function pointInPolygon(p: Point, polygon: Point[]) {
  if (polygon.length < 3) return false;
  const twiceArea = polygon.reduce((area, a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    return area + a.x * b.y - b.x * a.y;
  }, 0);
  if (twiceArea <= 0) return false;
  // Clipped cells are counterclockwise convex polygons. Include shared boundaries.
  return polygon.every((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -EPS;
  });
}
export function locateCell(pin: Point, cells: Cell[]) {
  return [...cells]
    .sort((a, b) => a.id.localeCompare(b.id))
    .find((cell) => pointInPolygon(pin, cell.polygon))?.id;
}
export function nearestSite(pin: Point, sites: Site[]) {
  return [...sites].sort((a, b) => {
    const p = project(a.lat, a.lng),
      q = project(b.lat, b.lng);
    const d = (p.x - pin.x) ** 2 + (p.y - pin.y) ** 2 - (q.x - pin.x) ** 2 - (q.y - pin.y) ** 2;
    return Math.abs(d) < EPS ? a.id.localeCompare(b.id) : d;
  })[0];
}
export function constructionSteps(site: Site, sites: Site[]) {
  const p = project(site.lat, site.lng);
  let polygon = planeBounds.map((v) => ({ ...v }));
  const steps = [{ label: `Start with the bounded ${region.name} area`, polygon }];
  for (const other of [...sites].sort((a, b) => a.id.localeCompare(b.id))) {
    if (site.id === other.id) continue;
    const q = project(other.lat, other.lng);
    if (Math.abs(p.x - q.x) < EPS && Math.abs(p.y - q.y) < EPS) {
      if (other.id.localeCompare(site.id) < 0) polygon = [];
    } else
      polygon = clipHalfPlane(
        polygon,
        2 * (q.x - p.x),
        2 * (q.y - p.y),
        q.x * q.x + q.y * q.y - p.x * p.x - p.y * p.y,
      );
    steps.push({ label: `Clip against ${other.id}'s perpendicular bisector`, polygon });
  }
  return steps;
}
