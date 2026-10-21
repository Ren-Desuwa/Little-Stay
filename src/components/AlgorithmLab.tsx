import { useMemo, useState } from 'react';
import { ArrowRight, FlaskConical, Hash, ScanText, MapPinned } from 'lucide-react';
import { buildIndexes, searchableText, type Data, type Property } from '../lib/model';
import {
  HashTable,
  constructionSteps,
  distanceMatrix,
  locateCell,
  matchText,
  project,
  voronoi,
} from '../lib/algorithms';
import StayMap from './StayMap';
export default function AlgorithmLab({ data, properties }: { data: Data; properties: Property[] }) {
  const [tab, setTab] = useState('hash'),
    [tableName, setTableName] = useState('properties'),
    [key, setKey] = useState('stay-01'),
    [capacity, setCapacity] = useState(17);
  const [query, setQuery] = useState('blacony'),
    [candidate, setCandidate] = useState('balcony');
  const [siteId, setSiteId] = useState(properties[0]?.id ?? ''),
    [step, setStep] = useState(0),
    [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const indexes = useMemo(() => buildIndexes(data), [data]);
  const table = useMemo(() => {
    const t = new HashTable<unknown>(capacity);
    indexes[tableName as keyof typeof indexes].buckets.flat().forEach((e) => t.set(e.key, e.value));
    return t;
  }, [indexes, tableName, capacity]);
  const result = table.lookup(key);
  const a = query.toLowerCase().slice(0, 24),
    b = candidate.toLowerCase().slice(0, 24),
    matrix = distanceMatrix(a, b),
    match = matchText(query, candidate);
  const site = properties.find((p) => p.id === siteId) ?? properties[0];
  const steps = site ? constructionSteps(site, properties) : [];
  const cells = useMemo(() => voronoi(properties), [properties]);
  const nearestId = pin ? locateCell(project(pin.lat, pin.lng), cells) : undefined;
  return (
    <section className="page-section lab-page">
      <div className="eyebrow">
        <FlaskConical size={15} /> BUILT TO BE UNDERSTOOD
      </div>
      <h1>Behind every little stay.</h1>
      <p className="page-intro">
        Three custom algorithms. Real features. Explore what happens underneath.
      </p>
      <div className="lab-tabs" role="tablist" aria-label="Algorithms">
        {[
          ['hash', 'Hashing', Hash],
          ['fuzzy', 'Fuzzy search', ScanText],
          ['voronoi', 'Voronoi', MapPinned],
        ].map(([id, label, Icon]) => {
          const C = Icon as typeof Hash;
          return (
            <button
              key={id as string}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'active' : ''}
              onClick={() => setTab(id as string)}
            >
              <C size={17} />
              {label as string}
            </button>
          );
        })}
      </div>
      {tab === 'hash' && (
        <div className="lab-panel">
          <div className="section-heading">
            <div>
              <h2>A shortcut to the right record.</h2>
              <p>
                DJB2-style string hashing with separate chaining. The application uses this table
                for ID and booking-reference lookups.
              </p>
            </div>
            <span className="badge">CUSTOM IMPLEMENTATION</span>
          </div>
          <div className="stats-grid">
            <div>
              <strong>{table.size}</strong>
              <span>records</span>
            </div>
            <div>
              <strong>{table.capacity}</strong>
              <span>buckets</span>
            </div>
            <div>
              <strong>{table.collisions}</strong>
              <span>collisions</span>
            </div>
            <div>
              <strong>{table.loadFactor.toFixed(2)}</strong>
              <span>load factor</span>
            </div>
          </div>
          <div className="form-row three">
            <label>
              Lab bucket capacity
              <select value={capacity} onChange={(e) => setCapacity(Number(e.target.value))}>
                <option value="17">17 · application default</option>
                <option value="7">7 · explore collisions</option>
                <option value="3">3 · longer chains</option>
              </select>
            </label>
            <label>
              Index
              <select
                value={tableName}
                onChange={(e) => {
                  setTableName(e.target.value);
                  setKey(
                    e.target.value === 'properties'
                      ? 'stay-01'
                      : e.target.value === 'users'
                        ? 'guest-1'
                        : e.target.value === 'references'
                          ? (data.reservations[0]?.reference ?? 'LS-DEMO0001')
                          : (data.reservations[0]?.id ?? 'res-demo-01'),
                  );
                }}
              >
                <option value="properties">Properties by ID</option>
                <option value="users">Users by ID</option>
                <option value="reservations">Reservations by ID</option>
                <option value="references">Booking references</option>
              </select>
            </label>
            <label>
              Lookup key
              <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="stay-01" />
            </label>
          </div>
          <div className="lookup-result">
            <code>{key || '(empty key)'}</code>
            <ArrowRight size={17} />
            <span>bucket {result.bucket}</span>
            <ArrowRight size={17} />
            <strong>{result.value ? 'Record found' : 'No matching record'}</strong>
            <span>
              {result.comparisons} comparison{result.comparisons !== 1 ? 's' : ''}
            </span>
          </div>
          {result.value !== undefined && (
            <pre className="record-result">{JSON.stringify(result.value, null, 2)}</pre>
          )}
          <div className="bucket-grid">
            {table.buckets.map((bucket, i) => (
              <div key={i} className={`bucket ${result.bucket === i ? 'highlight' : ''}`}>
                <span className="bucket-number">{String(i).padStart(2, '0')}</span>
                <div>
                  {bucket.length ? (
                    bucket.map((entry) => <code key={entry.key}>{entry.key}</code>)
                  ) : (
                    <span className="empty-bucket">empty</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="technical-note">
            Expected average lookup O(1); worst case O(n). A collision adds another record to the
            same bucket. Changing capacity rehashes records in this lab; application indexes use 17
            buckets. Reservation records here are limited to the current account’s access.
          </p>
        </div>
      )}
      {tab === 'fuzzy' && (
        <div className="lab-panel">
          <div className="section-heading">
            <div>
              <h2>A typo shouldn’t get in the way.</h2>
              <p>
                Levenshtein distance counts insertions, deletions, and substitutions. Search uses
                the same implementation.
              </p>
            </div>
            <span className="badge">DYNAMIC PROGRAMMING</span>
          </div>
          <div className="form-row">
            <label>
              Search word
              <input value={query} maxLength={24} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <label>
              Candidate word
              <input
                value={candidate}
                maxLength={24}
                onChange={(e) => setCandidate(e.target.value)}
              />
            </label>
          </div>
          <div className="lookup-result">
            <strong>Edit distance: {matrix[a.length][b.length]}</strong>
            <span className={`status ${match.accepted ? 'confirmed' : 'cancelled'}`}>
              {match.accepted ? 'Accepted match' : 'Outside tolerance'}
            </span>
          </div>
          <div className="matrix-scroll">
            <table className="distance-matrix">
              <thead>
                <tr>
                  <th></th>
                  <th>∅</th>
                  {[...b].map((c, i) => (
                    <th key={i}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.map((row, i) => (
                  <tr key={i}>
                    <th>{i === 0 ? '∅' : a[i - 1]}</th>
                    {row.map((v, j) => (
                      <td key={j} className={i === a.length && j === b.length ? 'final-cell' : ''}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="technical-note">
            Tolerance: 0 edits for 1–2 characters, 1 edit for 3–4, and 2 edits for 5+. Every query
            word must match. Runtime O(mn) per word pair.
          </p>
          <h3>Matches across current listings</h3>
          <div className="match-list">
            {properties
              .map((p) => ({ p, match: matchText(query, searchableText(p)) }))
              .filter((v) => v.match.accepted)
              .map(({ p, match: m }) => (
                <div key={p.id}>
                  <strong>{p.title}</strong>
                  <span>
                    {m.matches.map((v) => `${v.token} → ${v.word} (${v.distance})`).join(' · ') ||
                      'All listings match an empty query'}
                  </span>
                </div>
              ))}
            {!properties.some((p) => matchText(query, searchableText(p)).accepted) && (
              <p>No matching properties.</p>
            )}
          </div>
        </div>
      )}
      {tab === 'voronoi' && (
        <div className="lab-panel">
          <div className="section-heading">
            <div>
              <h2>Every place has a neighborhood.</h2>
              <p>
                Build each cell by clipping the map at perpendicular bisectors. Click a point to
                locate its nearest seed.
              </p>
            </div>
            <span className="badge">COMPUTATIONAL GEOMETRY</span>
          </div>
          <div className="form-row">
            <label>
              Seed property
              <select
                value={site?.id ?? ''}
                onChange={(e) => {
                  setSiteId(e.target.value);
                  setStep(0);
                }}
              >
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Construction step: {Math.min(step, Math.max(0, steps.length - 1))} of{' '}
              {Math.max(0, steps.length - 1)}
              <input
                type="range"
                min="0"
                max={Math.max(0, steps.length - 1)}
                value={Math.min(step, Math.max(0, steps.length - 1))}
                onChange={(e) => setStep(Number(e.target.value))}
              />
            </label>
          </div>
          <p className="step-caption">
            {steps[Math.min(step, steps.length - 1)]?.label ??
              'No published properties to construct.'}
          </p>
          <StayMap
            properties={properties}
            activeId={site?.id}
            overlay
            pin={pin}
            onPin={setPin}
            stepPolygon={steps[Math.min(step, steps.length - 1)]?.polygon}
          />
          <div className="lookup-result">
            <span>{cells.filter((c) => c.polygon.length).length} nonempty cells</span>
            <strong>
              {pin
                ? `Nearest: ${properties.find((p) => p.id === nearestId)?.title ?? 'Outside the demo boundary'}`
                : 'Click the map to test point location'}
            </strong>
          </div>
          <p className="technical-note">
            Coordinates are projected to a local plane in kilometers. Distance is approximate
            straight-line proximity, not travel time. Shared boundaries and coincident seeds choose
            the lowest property ID. Cell construction uses repeated half-plane clipping; point
            location scans the bounded cells.
          </p>
        </div>
      )}
    </section>
  );
}
