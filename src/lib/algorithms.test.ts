import { describe, expect, it } from 'vitest';
import {
  HashTable,
  constructionSteps,
  distanceMatrix,
  levenshtein,
  locateCell,
  matchText,
  nearestSite,
  planeBounds,
  project,
  voronoi,
} from './algorithms';
import { seedData } from './seed';

describe('separate-chaining hash table', () => {
  it('finds colliding keys, updates in place, and deletes without losing neighbors', () => {
    const t = new HashTable<number>(1);
    t.set('guest-1', 1);
    t.set('stay-01', 2);
    t.set('booking', 3);
    expect(t.collisions).toBe(2);
    expect(t.loadFactor).toBe(3);
    expect(t.lookup('booking')).toEqual({ value: 3, comparisons: 3, bucket: 0 });
    t.set('stay-01', 20);
    expect(t.size).toBe(3);
    expect(t.get('stay-01')).toBe(20);
    expect(t.delete('stay-01')).toBe(true);
    expect(t.get('booking')).toBe(3);
    expect(t.get('stay-01')).toBeUndefined();
    expect(t.delete('missing')).toBe(false);
  });
  it('reports unsuccessful comparison counts and handles empty keys', () => {
    const t = new HashTable<string>(1);
    t.set('', 'empty');
    t.set('a', 'value');
    expect(t.lookup('b').comparisons).toBe(2);
    expect(t.get('')).toBe('empty');
    expect(() => new HashTable(0)).toThrow();
  });
});

describe('Levenshtein and multiword search', () => {
  it.each([
    ['', '', 0],
    ['', 'hello', 5],
    ['kitten', 'sitting', 3],
    ['blacony', 'balcony', 2],
    ['pool', 'pool', 0],
  ])('distance %s → %s is %i', (a, b, expected) => expect(levenshtein(a, b)).toBe(expected));
  it('builds a complete dynamic programming matrix', () => {
    expect(distanceMatrix('a', 'b')).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });
  it('applies all three tolerance tiers', () => {
    expect(matchText('ab', 'ac').accepted).toBe(false);
    expect(matchText('pol', 'pool').accepted).toBe(true);
    expect(matchText('pool', 'pall').accepted).toBe(false);
    expect(matchText('blacony', 'balcony').accepted).toBe(true);
  });
  it('normalizes accents and requires every query word to match', () => {
    expect(matchText('SALCÉDO blacony', 'Salcedo Village Balcony').accepted).toBe(true);
    expect(matchText('balcony helicopter', 'Salcedo balcony').accepted).toBe(false);
    expect(matchText('   ', '').accepted).toBe(true);
    expect(matchText('pool', '').accepted).toBe(false);
    expect(matchText('balcony', 'balcony').score).toBeLessThan(
      matchText('blacony', 'balcony').score,
    );
  });
});

describe('bounded Voronoi clipping and point location', () => {
  const sites = seedData().properties;
  it('agrees with brute force over a deterministic grid', () => {
    const cells = voronoi(sites);
    for (let x = -1.9; x <= 2; x += 0.137)
      for (let y = -1.9; y <= 1.9; y += 0.173) {
        const point = { x, y };
        expect(locateCell(point, cells)).toBe(nearestSite(point, sites)?.id);
      }
  });
  it('contains each distinct seed in its own region', () => {
    const cells = voronoi(sites);
    sites.forEach((s) => expect(locateCell(project(s.lat, s.lng), cells)).toBe(s.id));
  });
  it('handles zero and one site, and outside points', () => {
    expect(voronoi([])).toEqual([]);
    expect(locateCell({ x: 0, y: 0 }, [])).toBeUndefined();
    expect(voronoi([sites[0]])[0].polygon).toEqual(planeBounds);
    expect(locateCell({ x: 100, y: 100 }, voronoi(sites))).toBeUndefined();
  });
  it('uses lowest IDs for coincident sites and shared boundaries', () => {
    const same = [
      { id: 'b', lat: 14.558, lng: 121.024 },
      { id: 'a', lat: 14.558, lng: 121.024 },
    ];
    expect(locateCell({ x: 0, y: 0 }, voronoi(same))).toBe('a');
    expect(voronoi(same).find((c) => c.id === 'b')?.polygon).toEqual([]);
    const pair = [
      { id: 'b', lat: 14.558, lng: 121.03 },
      { id: 'a', lat: 14.558, lng: 121.018 },
    ];
    expect(locateCell({ x: 0, y: 0 }, voronoi(pair))).toBe('a');
  });
  it('finishes step construction with the same cell as the production algorithm', () => {
    const steps = constructionSteps(sites[2], sites);
    expect(steps).toHaveLength(sites.length);
    expect(steps.at(-1)?.polygon).toEqual(
      voronoi(sites).find((c) => c.id === sites[2].id)?.polygon,
    );
  });
});
