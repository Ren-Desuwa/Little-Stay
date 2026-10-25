import { describe, expect, it } from 'vitest';
import { HashTable } from './algorithms';
import { traceHashLookup } from './hashTrace';

describe('hash lookup animation trace', () => {
  it('shows every character accumulator and stops at the matching collision entry', () => {
    const table = new HashTable<string>(1);
    table.set('first', 'first record');
    table.set('target', 'matching record');
    table.set('last', 'last record');
    const frames = traceHashLookup(table, 'target');
    const characterFrames = frames.filter((frame) => frame.phase === 'character');
    let expectedHash = 5381;
    for (const [index, character] of [...'target'].entries()) {
      expectedHash = (Math.imul(expectedHash, 33) ^ character.charCodeAt(0)) >>> 0;
      expect(characterFrames[index].hash).toBe(expectedHash);
    }
    expect(
      frames.filter((frame) => frame.phase === 'compare').map((frame) => frame.entryIndex),
    ).toEqual([0, 1]);
    expect(frames.at(-1)).toMatchObject({
      phase: 'complete',
      bucket: table.hash('target'),
      comparisons: table.lookup('target').comparisons,
      found: true,
    });
  });

  it('checks an entire collision chain for a missing key', () => {
    const table = new HashTable<number>(1);
    table.set('first', 1);
    table.set('second', 2);
    const frames = traceHashLookup(table, 'missing');
    expect(frames.at(-1)).toMatchObject({ bucket: 0, comparisons: 2, found: false });
    expect(frames.at(-1)?.comparisons).toBe(table.lookup('missing').comparisons);
  });

  it('selects an empty bucket without any comparisons', () => {
    const table = new HashTable<number>(17);
    const frames = traceHashLookup(table, 'missing');
    expect(frames.at(-1)).toMatchObject({
      bucket: table.hash('missing'),
      comparisons: 0,
      found: false,
    });
    expect(frames.some((frame) => frame.phase === 'compare')).toBe(false);
  });

  it.each(['', 'Café', '🏠-01', '👩‍💻', '\ud800'])('matches production hashing for %j', (key) => {
    const table = new HashTable<number>(7);
    table.set(key, 42);
    const frames = traceHashLookup(table, key);
    expect(frames.filter((frame) => frame.phase === 'character')).toHaveLength([...key].length);
    expect(frames.at(-1)).toMatchObject({
      bucket: table.hash(key),
      comparisons: table.lookup(key).comparisons,
      found: true,
    });
    if (key === '') expect(frames[0]).toMatchObject({ phase: 'bucket', hash: 5381 });
  });
});
