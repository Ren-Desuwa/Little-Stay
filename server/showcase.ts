import type { InStatement, InValue } from '@libsql/client';
import { openDatabase, seedDatabase, hashPassword } from './db.js';
import { region } from '../src/lib/region.js';
import { propertyPhotos } from '../src/lib/seed.js';

/** Fictional course-demo records; imported once, only with explicit demo opt-in. */
export function showcaseStatements(): InStatement[] {
  const source = openDatabase(':memory:');
  try {
    seedDatabase(source);
    source
      .prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)')
      .run(
        'host-3',
        'Clara Santos',
        'clara@littlestay.local',
        hashPassword('LittleStay123!'),
        'host',
        'approved',
        0,
        'Fictional demonstration host.',
      );
    const templates = source.prepare('SELECT * FROM properties ORDER BY id').all() as any[];
    const bounds = region.bounds;
    for (let i = 0; i < 55; i++) {
      const template = templates[i % templates.length];
      const detail = JSON.parse(template.details);
      // Spread every portfolio across a lightly jittered grid instead of segregating hosts.
      const rank = (i * 21) % 55;
      const hostId = rank < 3 ? 'host-1' : rank < 15 ? 'host-2' : 'host-3';
      const x = ((i % 8) + 0.5 + (((i * 17) % 7) - 3) * 0.04) / 8;
      const y = (Math.floor(i / 8) + 0.5 + (((i * 11) % 7) - 3) * 0.04) / 7;
      const lat = bounds.south + (bounds.north - bounds.south) * (0.04 + y * 0.92);
      const lng = bounds.west + (bounds.east - bounds.west) * (0.04 + x * 0.92);
      const nearest = templates.reduce((best, p) =>
        (p.lat - lat) ** 2 + (p.lng - lng) ** 2 < (best.lat - lat) ** 2 + (best.lng - lng) ** 2
          ? p
          : best,
      );
      const id = `stay-${String(i + 1).padStart(3, '0')}`;
      const property = {
        ...detail,
        id,
        hostId,
        lat,
        lng,
        neighborhood: nearest.neighborhood,
        title: `${nearest.neighborhood} ${detail.propertyType} ${i + 1}`,
        address: `Fictional unit ${i + 1}, ${nearest.neighborhood}, North Caloocan`,
        description: `Fictional listing for the Little Stay course demonstration. ${detail.description}`,
        images: propertyPhotos(i),
        image: propertyPhotos(i)[0],
      };
      source
        .prepare(
          'INSERT INTO properties VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET host_id=excluded.host_id,title=excluded.title,neighborhood=excluded.neighborhood,lat=excluded.lat,lng=excluded.lng,details=excluded.details',
        )
        .run(
          id,
          hostId,
          property.title,
          property.neighborhood,
          template.price,
          template.capacity,
          lat,
          lng,
          1,
          0,
          'approved',
          JSON.stringify(property),
        );
    }
    const statements: InStatement[] = [];
    for (const table of ['users', 'properties', 'reservations', 'reviews']) {
      const rows = source
        .prepare(`SELECT * FROM ${table}${table === 'users' ? " WHERE role!='admin'" : ''}`)
        .all();
      for (const row of rows) {
        const columns = Object.keys(row);
        statements.push({
          sql: `INSERT INTO ${table} (${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
          args: Object.values(row) as InValue[],
        });
      }
    }
    return statements;
  } finally {
    source.close();
  }
}
