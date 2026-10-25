import { HashTable } from './algorithms';
import { traceHashLookup, type HashTraceFrame } from './hashTrace';

export type InsertionFrame = HashTraceFrame & {
  key: string;
  buckets: string[][];
  inserted: number;
};

export function traceHashInsertions(keys: string[], capacity: number): InsertionFrame[] {
  const table = new HashTable<string>(capacity);
  const frames: InsertionFrame[] = [];
  for (const key of keys) {
    const trace = traceHashLookup(table, key);
    for (const step of trace) {
      let narration = step.narration;
      if (step.phase === 'compare' && step.found)
        narration = `Key ${JSON.stringify(key)} already exists. Update it without adding a chain entry.`;
      if (step.phase === 'complete') {
        const chainLength = table.buckets[step.bucket!].length;
        table.set(key, key);
        narration = step.found
          ? `Updated ${JSON.stringify(key)} in bucket ${step.bucket}; record count stays ${table.size}.`
          : chainLength
            ? `Collision: place ${JSON.stringify(key)} at chain position ${chainLength + 1} in bucket ${step.bucket}. Separate chaining keeps every record.`
            : `Place ${JSON.stringify(key)} in empty bucket ${step.bucket}.`;
      }
      frames.push({
        ...step,
        narration,
        key,
        buckets: table.buckets.map((bucket) => bucket.map((entry) => entry.key)),
        inserted: table.size,
      });
    }
  }
  return frames;
}
