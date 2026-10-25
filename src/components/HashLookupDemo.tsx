import { useEffect, useMemo, useRef, useState } from 'react';
import { HashTable } from '../lib/algorithms';
import { traceHashLookup } from '../lib/hashTrace';
import { buildIndexes, type Data } from '../lib/model';
import { PlaybackControls, useAlgorithmPlayback } from './AlgorithmPlayback';
import { useWordFlight } from './useWordFlight';

type IndexName = keyof ReturnType<typeof buildIndexes>;
function recordLabel(value: unknown) {
  const record = value as Record<string, unknown>;
  return String(record?.title ?? record?.name ?? record?.reference ?? record?.id ?? 'Record');
}
export default function HashLookupDemo({ data }: { data: Data }) {
  const [tableName, setTableName] = useState<IndexName>('properties');
  const [key, setKey] = useState(data.properties[0]?.id ?? 'stay-001');
  const [capacity, setCapacity] = useState(17);
  const [browseBucket, setBrowseBucket] = useState(0);
  const indexes = useMemo(() => buildIndexes(data), [data]);
  const table = useMemo(() => {
    const next = new HashTable<unknown>(capacity);
    indexes[tableName].buckets.flat().forEach((entry) => next.set(entry.key, entry.value));
    return next;
  }, [capacity, indexes, tableName]);
  const frames = useMemo(() => traceHashLookup(table, key), [table, key]);
  const runKey = JSON.stringify([tableName, capacity, key, table.buckets]);
  const playback = useAlgorithmPlayback({
    totalSteps: frames.length,
    resetKey: runKey,
    defaultDelay: 650,
    stepDelay: (step) => (frames[step - 1]?.phase === 'bucket' ? 1400 : 650),
  });
  const frame = playback.step ? frames[playback.step - 1] : undefined;
  const selected = frame?.bucket !== undefined;
  const complete = frame?.phase === 'complete';
  const result = table.lookup(key);
  const characters = [...key];
  const processed =
    frame?.phase === 'character' ? (frame.characterIndex ?? -1) + 1 : frame ? characters.length : 0;
  const sourceRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef<HTMLDivElement>(null);
  const chainRef = useRef<HTMLDivElement>(null);
  const recordRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const viewport = chainRef.current,
      record = recordRef.current;
    if (!viewport) return;
    if (!record) {
      if (frame?.phase === 'bucket' || !frame) viewport.scrollTop = 0;
      return;
    }
    const bounds = viewport.getBoundingClientRect(),
      target = record.getBoundingClientRect();
    const headerHeight =
      viewport.querySelector('.lookup-probe')?.getBoundingClientRect().height ?? 0;
    if (target.top < bounds.top + headerHeight || target.bottom > bounds.bottom)
      viewport.scrollTop +=
        target.top -
        bounds.top -
        headerHeight -
        (viewport.clientHeight - headerHeight - target.height) / 2;
  }, [playback.step, runKey]);
  useWordFlight({
    sourceRef,
    targetRef,
    containerRef,
    tokenRef,
    active: selected,
    runKey,
    speed: playback.speed,
    playing: playback.playing,
    finished: playback.finished,
  });
  const entries = table.buckets.flat();
  const collisionKey = table.buckets.find((bucket) => bucket.length > 1)?.at(-1)?.key;
  const displayBucket = frame?.bucket ?? Math.min(browseBucket, capacity - 1);
  function pick(value: string) {
    setBrowseBucket(table.hash(value));
    setKey(value);
    playback.reset();
  }
  function missingKey() {
    let candidate = 'missing-record';
    while (table.get(candidate) !== undefined) candidate += '-x';
    pick(candidate);
  }
  return (
    <div className="lab-panel">
      <div className="section-heading">
        <div>
          <h2>Follow a key to its record.</h2>
          <p>
            Hash the boxed key, watch it travel to a bucket, then compare each record in the chain.
            Click any record to look it up.
          </p>
        </div>
        <span className="badge">APPLICATION LOOKUP</span>
      </div>
      <div className="form-row three">
        <label>
          Index
          <select
            value={tableName}
            onChange={(event) => {
              const name = event.target.value as IndexName;
              setTableName(name);
              setKey(indexes[name].buckets.flat()[0]?.key ?? 'missing-record');
            }}
          >
            <option value="properties">Properties by ID</option>
            <option value="users">Users by ID</option>
            <option value="reservations">Reservations by ID</option>
            <option value="references">Booking references</option>
          </select>
        </label>
        <label>
          Lab bucket capacity
          <select value={capacity} onChange={(event) => setCapacity(Number(event.target.value))}>
            <option value="17">17 · application default</option>
            <option value="7">7 · explore collisions</option>
            <option value="3">3 · longer chains</option>
          </select>
        </label>
        <label>
          Lookup key
          <input value={key} maxLength={64} onChange={(event) => setKey(event.target.value)} />
        </label>
      </div>
      <div className="demo-presets" role="group" aria-label="Lookup examples">
        <button
          className="outline small"
          disabled={!entries.length}
          onClick={() => pick(entries[0].key)}
        >
          Try a found record
        </button>
        <button
          className="outline small"
          disabled={!collisionKey}
          onClick={() => collisionKey && pick(collisionKey)}
        >
          Try a collision chain
        </button>
        <button className="outline small" onClick={missingKey}>
          Try a missing key
        </button>
      </div>
      <ol className="demo-phases" aria-label="Lookup stages">
        {['Hash letters', 'Go to bucket', 'Compare records', 'Return result'].map(
          (label, index) => (
            <li
              key={label}
              aria-current={
                (complete ? 3 : frame?.phase === 'compare' ? 2 : selected ? 1 : 0) === index
                  ? 'step'
                  : undefined
              }
            >
              {label}
            </li>
          ),
        )}
      </ol>
      <PlaybackControls playback={playback} label="hash lookup" />
      <div className="hash-workbench" ref={containerRef}>
        <div className="hash-flight-token hash-word-token" ref={tokenRef} aria-hidden="true">
          {key || '(empty key)'}
        </div>
        <div className="algorithm-stage hash-calculation-stage">
          <div className="hash-word-label">
            {selected ? `Key → bucket ${frame.bucket}` : 'Key to find'}
          </div>
          <div className={`hash-word-token ${selected ? 'is-placed' : ''}`} ref={sourceRef}>
            {key || '(empty key)'}
          </div>
          <div className="hash-key-stream" aria-label="Lookup key characters">
            {characters.map((character, index) => (
              <span
                key={index}
                aria-current={
                  frame?.phase === 'character' && frame.characterIndex === index
                    ? 'step'
                    : undefined
                }
                className={`hash-character ${frame?.phase === 'character' && frame.characterIndex === index ? 'trace-active' : index < processed ? 'trace-visited' : ''}`}
              >
                {character === ' ' ? '␠' : character}
              </span>
            ))}
          </div>
          <div className="algorithm-kicker">
            {complete
              ? 'LOOKUP COMPLETE'
              : frame?.phase === 'compare'
                ? `COMPARISON ${frame.comparisons}`
                : selected
                  ? 'GO TO THE BUCKET'
                  : 'HASH THE KEY'}
          </div>
          <div className="hash-accumulator">{frame?.hash ?? 5381}</div>
          <div className="algorithm-formula">
            {frame?.phase === 'character'
              ? `(${frame.previousHash} × 33 XOR ${frame.characterCode}) >>> 0 = ${frame.hash}`
              : selected
                ? `${frame.hash} % ${capacity} = bucket ${frame.bucket}`
                : 'h = 5381'}
          </div>
          <p className="algorithm-caption" aria-live={playback.playing ? 'off' : 'polite'}>
            {frame?.narration ?? 'Choose an example or click a record, then press Play.'}
          </p>
          {frame?.phase === 'compare' && (
            <div className={`lookup-comparison ${frame.found ? 'is-match' : ''}`}>
              <code>{key || '(empty key)'}</code>
              <strong>{frame.found ? '=' : '≠'}</strong>
              <code>{table.buckets[frame.bucket!][frame.entryIndex!].key || '(empty key)'}</code>
              <span>
                {frame.found
                  ? 'Same key · return this record'
                  : 'Different key · continue to the next record'}
              </span>
            </div>
          )}
          <p className="hash-word-label">
            {table.size} records · {capacity} buckets · {table.collisions} collisions
          </p>
        </div>
        <div className="lookup-bucket-panel">
          <div className="lookup-overview" role="group" aria-label="Application index buckets">
            {table.buckets.map((bucket, index) => (
              <button
                type="button"
                key={index}
                aria-pressed={displayBucket === index}
                onClick={() => {
                  setBrowseBucket(index);
                  if (bucket.length) pick(bucket[0].key);
                  else playback.reset();
                }}
              >
                <strong>Bucket {index}</strong>
                <span>{bucket.length} records</span>
              </button>
            ))}
          </div>
          <div
            className="bucket-grid insertion-buckets lookup-buckets"
            aria-label="Selected bucket collision chain"
          >
            {[displayBucket].map((index) => {
              const bucket = table.buckets[index];
              return (
                <div key={index} className={`bucket ${frame?.bucket === index ? 'highlight' : ''}`}>
                  <span className="bucket-number">
                    Bucket {index}
                    <br />
                    {bucket.length} records
                  </span>
                  <div className="lookup-chain-scroll" ref={chainRef}>
                    {frame?.bucket === index && (
                      <div className="lookup-probe">
                        <span>Looking for</span>
                        <div ref={targetRef} className="hash-word-token">
                          {key || '(empty key)'}
                        </div>
                      </div>
                    )}
                    {bucket.length ? (
                      bucket.map((entry, entryIndex) => {
                        const checked = frame?.bucket === index && entryIndex < frame.comparisons;
                        const current =
                          frame?.phase === 'compare' &&
                          frame.bucket === index &&
                          frame.entryIndex === entryIndex;
                        const found = checked && entry.key === key;
                        return (
                          <button
                            key={entry.key}
                            type="button"
                            ref={current || found ? recordRef : undefined}
                            className={`lookup-record ${found ? 'trace-match' : current ? 'trace-active' : checked ? 'trace-visited' : ''}`}
                            onClick={() => pick(entry.key)}
                            aria-label={`Look up ${entry.key}: ${recordLabel(entry.value)}`}
                          >
                            <small>
                              {entryIndex ? `↳ chain ${entryIndex + 1}` : 'head'}
                              {found ? ' · found' : checked ? ' · compared' : ''}
                            </small>
                            <code>{entry.key || '(empty key)'}</code>
                            <span>{recordLabel(entry.value)}</span>
                          </button>
                        );
                      })
                    ) : (
                      <span className="empty-bucket">empty · no records to compare</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="lookup-result" role="status">
        <strong>
          {complete ? (frame.found ? 'Record found' : 'No matching record') : 'Result pending'}
        </strong>
        <span>
          {frame?.comparisons ?? 0} comparisons{selected ? ` · bucket ${frame.bucket}` : ''}
        </span>
      </div>
      {complete && frame.found && result.value !== undefined && (
        <div className="lookup-record-result">
          <h3>{recordLabel(result.value)}</h3>
          <p>
            Returned from bucket {result.bucket} after {result.comparisons} comparison
            {result.comparisons === 1 ? '' : 's'}.
          </p>
          <details>
            <summary>Inspect record fields</summary>
            <pre className="record-result">{JSON.stringify(result.value, null, 2)}</pre>
          </details>
        </div>
      )}
      <p className="technical-note">
        This lookup reads application records. It does not insert or move stored records: the moving
        box is the search key. Separate chaining checks colliding keys in order. Expected average
        lookup O(1); worst case O(n). Lab capacity changes rehash this demonstration only.
      </p>
    </div>
  );
}
