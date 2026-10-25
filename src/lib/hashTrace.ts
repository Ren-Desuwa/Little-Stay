import type { HashTable } from './algorithms';

export type HashTraceFrame = {
  phase: 'character' | 'bucket' | 'compare' | 'complete';
  hash: number;
  comparisons: number;
  found: boolean;
  narration: string;
  previousHash?: number;
  character?: string;
  characterIndex?: number;
  characterCode?: number;
  bucket?: number;
  entryIndex?: number;
};

/** Follow the same character iteration and unsigned DJB2 operations as HashTable.hash. */
export function traceHashLookup<T>(table: HashTable<T>, key: string): HashTraceFrame[] {
  const frames: HashTraceFrame[] = [];
  let hash = 5381;
  let characterIndex = 0;
  for (const character of key) {
    const previousHash = hash;
    const characterCode = character.charCodeAt(0);
    hash = (Math.imul(hash, 33) ^ characterCode) >>> 0;
    frames.push({
      phase: 'character',
      hash,
      previousHash,
      character,
      characterIndex,
      characterCode,
      comparisons: 0,
      found: false,
      narration: `Read ${JSON.stringify(character)} (${characterCode}). Multiply the accumulator by 33, XOR the character code, and keep an unsigned 32-bit result.`,
    });
    characterIndex++;
  }

  const bucket = hash % table.capacity;
  frames.push({
    phase: 'bucket',
    hash,
    bucket,
    comparisons: 0,
    found: false,
    narration: `The hash is ${hash}. Taking ${hash} modulo ${table.capacity} selects bucket ${bucket}.`,
  });

  let comparisons = 0;
  let found = false;
  for (const [entryIndex, entry] of table.buckets[bucket].entries()) {
    comparisons++;
    found = entry.key === key;
    frames.push({
      phase: 'compare',
      hash,
      bucket,
      entryIndex,
      comparisons,
      found,
      narration: found
        ? `Comparison ${comparisons}: ${JSON.stringify(entry.key)} matches the lookup key. Return this record.`
        : `Comparison ${comparisons}: ${JSON.stringify(entry.key)} differs from the lookup key. Continue along the collision chain.`,
    });
    if (found) break;
  }

  frames.push({
    phase: 'complete',
    hash,
    bucket,
    comparisons,
    found,
    narration: found
      ? `Record found in bucket ${bucket} after ${comparisons} comparison${comparisons === 1 ? '' : 's'}.`
      : comparisons === 0
        ? `Bucket ${bucket} is empty. No record matches this key; no key comparisons were needed.`
        : `The collision chain ended after ${comparisons} comparison${comparisons === 1 ? '' : 's'}. No record matches this key.`,
  });
  return frames;
}
