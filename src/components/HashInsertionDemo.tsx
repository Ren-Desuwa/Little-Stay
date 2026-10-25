import { useMemo, useRef, useState } from 'react';
import { useWordFlight } from './useWordFlight';
import { HashTable } from '../lib/algorithms';
import { traceHashInsertions } from '../lib/hashInsertionTrace';
import { PlaybackControls, useAlgorithmPlayback } from './AlgorithmPlayback';

const examples = [
  'Camarin',
  'Deparo',
  'Bagumbong',
  'Tala',
  'Bagong Silang',
  'Balcony',
  'Pool',
  'WiFi',
  'Parking',
  'Studio',
  'Family suite',
  'Garden',
];
export default function HashInsertionDemo() {
  const [input, setInput] = useState(examples.join('\n'));
  const [capacity, setCapacity] = useState(7);
  const keys = useMemo(
    () =>
      input
        .split('\n')
        .map((key) => key.trim().slice(0, 64))
        .filter(Boolean)
        .slice(0, 40),
    [input],
  );
  const frames = useMemo(() => traceHashInsertions(keys, capacity), [keys, capacity]);
  const playback = useAlgorithmPlayback({
    totalSteps: frames.length,
    resetKey: JSON.stringify([keys, capacity]),
    defaultDelay: 650,
    stepDelay: (step) => (frames[step - 1]?.phase === 'complete' ? 1400 : 650),
  });
  const frame = playback.step ? frames[playback.step - 1] : undefined;
  const buckets = frame?.buckets ?? Array.from({ length: capacity }, () => [] as string[]);
  const collisions = buckets.reduce((count, bucket) => count + Math.max(0, bucket.length - 1), 0);
  const wordRef = useRef<HTMLDivElement>(null);
  const workbenchRef = useRef<HTMLDivElement>(null);
  const destinationRef = useRef<HTMLElement>(null);
  const flightRef = useRef<HTMLDivElement>(null);
  const currentWord = frame?.key ?? keys[0] ?? '';
  const characters = [...currentWord];
  const processed =
    frame?.phase === 'character' ? (frame.characterIndex ?? -1) + 1 : frame ? characters.length : 0;
  const placed = frame?.phase === 'complete';

  useWordFlight({
    sourceRef: wordRef,
    targetRef: destinationRef,
    containerRef: workbenchRef,
    tokenRef: flightRef,
    active: placed,
    runKey: JSON.stringify([playback.step, keys, capacity]),
    speed: playback.speed,
    playing: playback.playing,
    finished: playback.finished,
  });

  function collisionExample() {
    const table = new HashTable<string>(capacity);
    const target = table.hash('Stay-1');
    const colliding: string[] = [];
    for (let i = 1; colliding.length < 8; i++) {
      const key = `Stay-${i}`;
      if (table.hash(key) === target) colliding.push(key);
    }
    setInput(colliding.join('\n'));
    playback.reset();
  }
  return (
    <div className="lab-panel">
      <div className="section-heading">
        <div>
          <h2>Hash it. Pick a bucket. Place the record.</h2>
          <p>
            Add keys and play the insertions. Watch collisions extend a bucket’s overflow chain.
          </p>
        </div>
        <span className="badge">INSERTION DEMO</span>
      </div>
      <div className="form-row">
        <label>
          Keys to hash · one per line
          <textarea
            rows={6}
            value={input}
            maxLength={2600}
            onChange={(event) => setInput(event.target.value)}
            aria-describedby="hash-input-help"
          />
          <small id="hash-input-help">
            Up to 40 keys, 64 characters each. Duplicate keys update the existing entry.
          </small>
        </label>
        <div className="hash-insertion-options">
          <label>
            Bucket count
            <select value={capacity} onChange={(event) => setCapacity(Number(event.target.value))}>
              {[1, 3, 7, 17].map((count) => (
                <option key={count} value={count}>
                  {count} bucket{count === 1 ? '' : 's'}
                </option>
              ))}
            </select>
          </label>
          <button className="outline" onClick={collisionExample}>
            Load 8 colliding keys
          </button>
          <button
            className="outline"
            onClick={() => {
              setInput(examples.join('\n'));
              playback.reset();
            }}
          >
            Load 12 example keys
          </button>
          <button className="text-button" onClick={() => setInput('')}>
            Clear keys
          </button>
        </div>
      </div>
      <div className="stats-grid">
        <div>
          <strong>{frame?.inserted ?? 0}</strong>
          <span>records placed</span>
        </div>
        <div>
          <strong>{capacity}</strong>
          <span>buckets</span>
        </div>
        <div>
          <strong>{collisions}</strong>
          <span>overflow chain entries</span>
        </div>
        <div>
          <strong>{((frame?.inserted ?? 0) / capacity).toFixed(2)}</strong>
          <span>load factor</span>
        </div>
      </div>
      <PlaybackControls playback={playback} label="hash insertion" disabled={!keys.length} />
      <div className="hash-workbench" ref={workbenchRef}>
        <div className="hash-flight-token hash-word-token" ref={flightRef} aria-hidden="true">
          {currentWord}
        </div>
        <div className="algorithm-stage hash-calculation-stage">
          <div className="hash-word-label">
            {placed ? `Word → bucket ${frame.bucket}` : 'Current word'}
          </div>
          <div className={`hash-word-token ${placed ? 'is-placed' : ''}`} ref={wordRef}>
            {currentWord || 'Add a word above'}
          </div>
          <div className="hash-key-stream" aria-label="Word letters">
            {characters.map((character, index) => (
              <span
                key={index}
                className={`hash-character ${frame?.phase === 'character' && frame.characterIndex === index ? 'trace-active' : index < processed ? 'trace-visited' : ''}`}
                aria-current={
                  frame?.phase === 'character' && frame.characterIndex === index
                    ? 'step'
                    : undefined
                }
              >
                {character === ' ' ? '␠' : character}
              </span>
            ))}
          </div>
          <div className="algorithm-kicker">
            {frame
              ? `${frame.phase === 'complete' ? 'RECORD PLACED' : 'HASH AND INSERT'} · ${frame.key}`
              : 'EMPTY TABLE · READY TO INSERT'}
          </div>
          <div className="hash-word-label">
            {frame?.phase === 'character'
              ? `Calculating letter ${(frame.characterIndex ?? 0) + 1} of ${characters.length}: “${frame.character}”`
              : frame
                ? `Destination: bucket ${frame.bucket}`
                : 'Start with h = 5381'}
          </div>
          <div className="hash-accumulator">{frame?.hash ?? 5381}</div>
          <div className="algorithm-formula">
            {frame?.phase === 'character'
              ? `(${frame.previousHash} × 33 XOR ${frame.characterCode}) >>> 0 = ${frame.hash}`
              : frame
                ? `${frame.hash} % ${capacity} = bucket ${frame.bucket}`
                : 'h = 5381'}
          </div>
          <p className="algorithm-caption" role="status">
            {frame?.narration ??
              'Press Play to place each key in its bucket, or use Next step to inspect each operation.'}
          </p>
        </div>
        <div className="bucket-grid insertion-buckets" aria-label="Hash insertion buckets">
          {buckets.map((bucket, index) => (
            <div key={index} className={`bucket ${frame?.bucket === index ? 'highlight' : ''}`}>
              <span className="bucket-number">
                Bucket {index}
                <br />
                {bucket.length} records
              </span>
              <div>
                {bucket.length ? (
                  bucket.map((key, position) => (
                    <div className="insertion-entry" key={key}>
                      <span>{position ? '↳ overflow' : 'head'}</span>
                      <code
                        ref={placed && frame.key === key ? destinationRef : undefined}
                        className={`hash-chain-entry hash-word-token ${frame?.phase === 'complete' && frame.key === key ? 'trace-match' : ''}`}
                        title={`Bucket ${index}, chain position ${position + 1}`}
                      >
                        {key}
                      </code>
                    </div>
                  ))
                ) : (
                  <span className="empty-bucket">empty</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="technical-note">
        Overflow here means another entry in a collision chain. Buckets grow with separate chaining;
        records are never discarded. The accumulator wraps to unsigned 32-bit on each character.
        Changing the keys or bucket count resets playback. Demo keys stay in this lab.
      </p>
    </div>
  );
}
