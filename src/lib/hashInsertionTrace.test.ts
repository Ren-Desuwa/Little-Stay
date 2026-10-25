import { describe, expect, it } from 'vitest';
import { HashTable } from './algorithms';
import { traceHashInsertions } from './hashInsertionTrace';

describe('hash insertion playback', () => {
  it('places colliding keys only at completion and preserves earlier snapshots', () => {
    const frames = traceHashInsertions(['Pool', 'WiFi', 'Parking'], 1);
    const completed = frames.filter((frame) => frame.phase === 'complete');
    expect(frames[0].buckets).toEqual([[]]);
    expect(completed.map((frame) => frame.buckets[0])).toEqual([
      ['Pool'],
      ['Pool', 'WiFi'],
      ['Pool', 'WiFi', 'Parking'],
    ]);
    expect(completed[2].narration).toContain('chain position 3');
    expect(completed[2].comparisons).toBe(2);
  });
  it('updates duplicate keys without adding overflow entries', () => {
    const frames = traceHashInsertions(['Pool', 'Pool'], 3);
    const last = frames.at(-1)!;
    expect(last.inserted).toBe(1);
    expect(last.buckets.flat()).toEqual(['Pool']);
    expect(last.narration).toContain('Updated');
  });
  it('matches the actual table after rehashing at each capacity', () => {
    for (const capacity of [1, 3, 7, 17]) {
      const keys = ['Camarin', 'Deparo', 'WiFi', 'Tala', '🏠'];
      const table = new HashTable<string>(capacity);
      keys.forEach((key) => table.set(key, key));
      expect(traceHashInsertions(keys, capacity).at(-1)?.buckets).toEqual(
        table.buckets.map((bucket) => bucket.map((entry) => entry.key)),
      );
    }
    expect(traceHashInsertions([], 7)).toEqual([]);
  });
});
