import { useEffect, useMemo, useRef, useState } from 'react';
import { matchText } from '../lib/algorithms';
import { fuzzyTrace } from '../lib/fuzzyTrace';
import { searchableText, type Property } from '../lib/model';
import { PlaybackControls, useAlgorithmPlayback } from './AlgorithmPlayback';

const character = (value: string) => {
  if (value === ' ') return '␣';
  if (/^[\uD800-\uDFFF]$/.test(value))
    return `\\u${value.charCodeAt(0).toString(16).toUpperCase()}`;
  return value;
};

export default function FuzzyDemo({ properties }: { properties: Property[] }) {
  const [query, setQuery] = useState('blacony');
  const [candidate, setCandidate] = useState('balcony');
  const a = query.toLowerCase().slice(0, 24);
  const b = candidate.toLowerCase().slice(0, 24);
  const trace = useMemo(() => fuzzyTrace(a, b), [a, b]);
  const playback = useAlgorithmPlayback({
    totalSteps: trace.frames.length + trace.alignment.length,
    resetKey: JSON.stringify([query, candidate]),
    defaultDelay: 250,
    stepDelay: (step) => (step > trace.frames.length ? 1000 : 250),
  });
  const matrixComplete = playback.step >= trace.frames.length;
  const alignmentIndex = playback.step - trace.frames.length - 1;
  const alignmentFrame = trace.alignment[alignmentIndex];
  const frame = playback.step
    ? trace.frames[Math.min(playback.step, trace.frames.length) - 1]
    : undefined;
  const activeRow = alignmentFrame?.row ?? frame?.row ?? 0;
  const activeColumn = alignmentFrame?.column ?? frame?.column ?? 0;
  const examples = [
    { label: 'Exact match', a: 'pool', b: 'pool' },
    { label: 'Missing letter', a: 'balcny', b: 'balcony' },
    { label: 'Two edits', a: 'blacony', b: 'balcony' },
    { label: 'Outside tolerance', a: 'garden', b: 'parking' },
  ];
  const matrixViewport = useRef<HTMLDivElement>(null);
  const alignmentViewport = useRef<HTMLDivElement>(null);
  const activeCell = useRef<HTMLTableCellElement>(null);

  useEffect(() => {
    const viewport = matrixViewport.current;
    if (!viewport) return;
    if (!playback.step) {
      viewport.scrollTo({ left: 0, top: 0, behavior: 'instant' });
      return;
    }
    const cell = activeCell.current;
    if (!cell) return;
    const bounds = viewport.getBoundingClientRect();
    const target = cell.getBoundingClientRect();
    const left = bounds.left + viewport.clientLeft;
    const top = bounds.top + viewport.clientTop;
    const horizontalMargin = Math.min(target.width + 8, viewport.clientWidth / 4);
    const verticalMargin = Math.min(target.height + 8, viewport.clientHeight / 4);
    let scrollLeft = viewport.scrollLeft;
    let scrollTop = viewport.scrollTop;
    if (target.left < left + horizontalMargin) scrollLeft += target.left - left - horizontalMargin;
    else if (target.right > left + viewport.clientWidth - horizontalMargin)
      scrollLeft += target.right - left - viewport.clientWidth + horizontalMargin;
    if (target.top < top + verticalMargin) scrollTop += target.top - top - verticalMargin;
    else if (target.bottom > top + viewport.clientHeight - verticalMargin)
      scrollTop += target.bottom - top - viewport.clientHeight + verticalMargin;
    // Scroll only this viewport. Immediate movement avoids animation lag and respects reduced motion.
    viewport.scrollTo({ left: scrollLeft, top: scrollTop, behavior: 'instant' });
  }, [playback.step, trace]);

  const match = useMemo(() => matchText(query, candidate), [query, candidate]);
  const listings = useMemo(
    () =>
      properties
        .map((p) => ({ p, match: matchText(query, searchableText(p)) }))
        .filter(({ match: result }) => result.accepted),
    [properties, query],
  );
  const finalDistance = trace.matrix[a.length][b.length];
  const path = new Set(
    matrixComplete
      ? trace.path
          .slice(0, Math.max(1, alignmentIndex + 2))
          .map(({ row, column }) => `${row},${column}`)
      : [],
  );
  let narration =
    'Press Play to initialize the empty prefixes, then fill each cell from left to right.';
  if (frame?.phase === 'initialize') {
    narration =
      frame.row === 0 && frame.column === 0
        ? 'Start at D[0, 0] = 0. Two empty prefixes need no edits.'
        : frame.row === 0
          ? `D[0, ${frame.column}] = ${frame.value}: insert ${frame.column} character${frame.column === 1 ? '' : 's'} to build the candidate prefix from an empty input.`
          : `D[${frame.row}, 0] = ${frame.value}: delete ${frame.row} character${frame.row === 1 ? '' : 's'} to turn the input prefix into an empty candidate.`;
  } else if (frame) {
    const same = a[frame.row - 1] === b[frame.column - 1];
    narration = `Compare “${character(a[frame.row - 1])}” with “${character(b[frame.column - 1])}”. ${same ? 'They match, so the diagonal adds 0.' : 'They differ, so substitution adds 1.'} The cheapest choice gives D[${frame.row}, ${frame.column}] = ${frame.value}.`;
  }

  if (matrixComplete) {
    narration = alignmentFrame
      ? alignmentFrame.operation === 'keep'
        ? `Keep “${character(alignmentFrame.from)}”: the letters match. Cost 0.`
        : alignmentFrame.operation === 'insert'
          ? `Insert “${character(alignmentFrame.to)}” into the search word. Cost 1.`
          : alignmentFrame.operation === 'delete'
            ? `Delete “${character(alignmentFrame.from)}” from the search word. Cost 1.`
            : `Replace “${character(alignmentFrame.from)}” with “${character(alignmentFrame.to)}”. Cost 1.`
      : 'The matrix is complete. Next, follow one optimal alignment to see exactly which edits are needed.';
  }

  return (
    <div className="lab-panel">
      <div className="section-heading">
        <div>
          <h2>A typo shouldn’t get in the way.</h2>
          <p>
            Watch Levenshtein distance count insertions, deletions, and substitutions with the same
            dynamic programming matrix used by search.
          </p>
        </div>
        <span className="badge">DYNAMIC PROGRAMMING</span>
      </div>
      <div className="form-row">
        <label>
          Search word
          <input value={query} maxLength={24} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label>
          Candidate word
          <input
            value={candidate}
            maxLength={24}
            onChange={(event) => setCandidate(event.target.value)}
          />
        </label>
      </div>
      <div className="demo-presets" role="group" aria-label="Fuzzy search examples">
        {examples.map((example) => (
          <button
            key={example.label}
            className="outline small"
            onClick={() => {
              setQuery(example.a);
              setCandidate(example.b);
              playback.reset();
            }}
          >
            {example.label}
          </button>
        ))}
      </div>
      <ol className="demo-phases" aria-label="Fuzzy search stages">
        {['Compare letters', 'Choose edit costs', 'Trace the edits', 'Search decision'].map(
          (label, index) => (
            <li
              key={label}
              aria-current={
                (playback.finished
                  ? 3
                  : matrixComplete
                    ? 2
                    : frame?.phase === 'compare'
                      ? 1
                      : 0) === index
                  ? 'step'
                  : undefined
              }
            >
              {label}
            </li>
          ),
        )}
      </ol>
      <PlaybackControls playback={playback} label="Levenshtein distance" />
      <div className="demo-presets">
        <button
          className="text-button"
          onClick={() => playback.seek(Math.min(a.length + b.length + 2, trace.frames.length))}
        >
          Skip boundary setup
        </button>
        <button
          className="text-button"
          onClick={() => {
            playback.seek(trace.frames.length + Math.min(1, trace.alignment.length));
            requestAnimationFrame(() =>
              alignmentViewport.current?.scrollIntoView({ block: 'center', behavior: 'instant' }),
            );
          }}
        >
          Show edit alignment
        </button>
      </div>
      <div className="algorithm-stage fuzzy-stage">
        <div className="fuzzy-word-pair">
          {[
            {
              label: 'Search word · rows',
              word: a,
              active: activeRow,
              isGap: alignmentFrame?.operation === 'insert',
            },
            {
              label: 'Candidate word · columns',
              word: b,
              active: activeColumn,
              isGap: alignmentFrame?.operation === 'delete',
            },
          ].map(({ label, word, active, isGap }) => (
            <div className="fuzzy-word-box" key={label}>
              <div className="hash-word-label">{label}</div>
              <strong className="hash-word-token">{word || '∅ (empty)'}</strong>
              <div className="hash-key-stream" aria-label={`${label} letters`}>
                {word.split('').map((value, index) => (
                  <span
                    key={index}
                    className={`hash-character ${frame && active === index + 1 && !isGap ? 'trace-active' : frame && index < active - 1 ? 'trace-visited' : ''}`}
                    aria-current={frame && active === index + 1 && !isGap ? 'step' : undefined}
                  >
                    {character(value)}
                  </span>
                ))}
              </div>
              <span className="hash-word-label">
                {isGap
                  ? '∅ · a gap in this alignment'
                  : active
                    ? `Prefix: ${word.slice(0, active)}`
                    : 'Empty prefix: ∅'}
              </span>
            </div>
          ))}
        </div>
        {frame?.phase === 'compare' && !matrixComplete && (
          <div className="fuzzy-letter-comparison">
            <span className="hash-character trace-active">{character(a[frame.row - 1])}</span>
            <strong>{a[frame.row - 1] === b[frame.column - 1] ? '=' : '≠'}</strong>
            <span className="hash-character trace-active">{character(b[frame.column - 1])}</span>
            <span>
              {a[frame.row - 1] === b[frame.column - 1]
                ? 'Same letter · keep costs 0'
                : 'Different letters · substitution costs 1'}
            </span>
          </div>
        )}
        <div className="algorithm-caption" aria-live={playback.playing ? 'off' : 'polite'}>
          <span className="algorithm-kicker">
            {!frame
              ? 'Ready to compare'
              : matrixComplete
                ? playback.finished
                  ? 'Alignment complete'
                  : 'Trace the edits'
                : frame.phase === 'initialize'
                  ? 'Initialize the boundaries'
                  : 'Choose the cheapest edit'}
          </span>
          <p style={{ minHeight: '3.6em' }}>{narration}</p>
          {frame?.phase === 'compare' && !matrixComplete ? (
            <div className="fuzzy-choices" aria-label="Edit cost choices">
              {frame.choices.map((choice) => (
                <div
                  key={choice.operation}
                  className={`fuzzy-choice ${choice.total === frame.value ? 'is-cheapest' : ''}`}
                >
                  <strong>
                    {choice.operation === 'keep'
                      ? '↖ Keep'
                      : choice.operation === 'substitute'
                        ? '↖ Substitute'
                        : choice.operation === 'delete'
                          ? '↑ Delete'
                          : '← Insert'}
                  </strong>
                  <span>
                    D[{choice.cell.row}, {choice.cell.column}] + {choice.cost}
                  </span>
                  <code>
                    {choice.base} + {choice.cost} = {choice.total}
                  </code>
                  <small>{choice.total === frame.value ? 'Minimum cost ✓' : 'Higher cost'}</small>
                </div>
              ))}
            </div>
          ) : (
            <div className="algorithm-formula">
              {matrixComplete
                ? `Minimum edit distance = ${finalDistance} · follow the alignment below`
                : 'D[i, j] = min(delete + 1, insert + 1, diagonal + cost)'}
            </div>
          )}

          {playback.finished && (
            <p className="algorithm-complete">
              Minimum edit distance: <strong>{finalDistance}</strong>. The highlighted path shows
              one optimal alignment.
            </p>
          )}
        </div>
        <div
          className="matrix-scroll"
          ref={matrixViewport}
          tabIndex={0}
          aria-label="Scrollable edit distance matrix"
        >
          <table className="distance-matrix">
            <caption className="sr-only">
              Edit distance from search word row prefixes to candidate word column prefixes.
              Uncomputed cells contain a dot.
            </caption>
            <thead>
              <tr>
                <th scope="col" aria-label="Search word prefix"></th>
                <th scope="col">∅</th>
                {b.split('').map((value, index) => (
                  <th
                    scope="col"
                    key={index}
                    className={frame && activeColumn === index + 1 ? 'fuzzy-axis-active' : ''}
                  >
                    {character(value)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trace.matrix.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <th
                    scope="row"
                    className={frame && activeRow === rowIndex ? 'fuzzy-axis-active' : ''}
                  >
                    {rowIndex === 0 ? '∅' : character(a[rowIndex - 1])}
                  </th>
                  {row.map((value, columnIndex) => {
                    const visible = trace.revealedAt[rowIndex][columnIndex] <= playback.step;
                    const active =
                      activeRow === rowIndex && activeColumn === columnIndex && !!frame;
                    const dependency = frame?.choices.some(
                      ({ cell }) => cell.row === rowIndex && cell.column === columnIndex,
                    );
                    const classes = [
                      visible ? 'trace-visited' : 'trace-pending',
                      dependency && !matrixComplete ? 'trace-dependency' : '',
                      path.has(`${rowIndex},${columnIndex}`) ? 'trace-match' : '',
                      active ? 'trace-active' : '',
                      playback.finished && rowIndex === a.length && columnIndex === b.length
                        ? 'final-cell'
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <td
                        key={columnIndex}
                        ref={active ? activeCell : undefined}
                        className={classes}
                        aria-current={active ? 'step' : undefined}
                        aria-label={`D[${rowIndex}, ${columnIndex}]: ${visible ? value : 'not computed'}`}
                      >
                        {visible ? value : '·'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="matrix-legend" aria-label="Matrix color legend">
          <span>
            <i className="trace-active" />
            Current cell
          </span>
          <span>
            <i className="trace-dependency" />
            Three prior cells
          </span>
          <span>
            <i className="trace-match" />
            Optimal alignment path
          </span>
        </div>
      </div>
      {matrixComplete && (
        <div
          className="fuzzy-alignment"
          ref={alignmentViewport}
          aria-label="Optimal edit alignment"
        >
          <h3>
            Turn “{a || '∅'}” into “{b || '∅'}”
          </h3>
          <p>Read each column from left to right. ∅ marks an insertion or deletion.</p>
          <div className="alignment-strip">
            {trace.alignment.map((edit, index) => (
              <button
                type="button"
                key={index}
                onClick={() => playback.seek(trace.frames.length + index + 1)}
                className={`alignment-step ${index === alignmentIndex ? 'is-active' : ''} ${index <= alignmentIndex ? 'is-revealed' : ''} ${edit.cost ? 'has-edit' : ''}`}
                aria-label={`Alignment step ${index + 1}: ${edit.operation} ${edit.from || 'gap'} to ${edit.to || 'gap'}`}
                aria-current={index === alignmentIndex ? 'step' : undefined}
              >
                <span>{character(edit.from) || '∅'}</span>
                <span>↓</span>
                <span>{character(edit.to) || '∅'}</span>
                <strong>{edit.operation}</strong>
                <small>+{edit.cost}</small>
              </button>
            ))}
          </div>
          {!trace.alignment.length && <p>Both words are empty. No edits are needed.</p>}
          <p className="alignment-total">
            Edits traced:{' '}
            <strong>
              {trace.alignment
                .slice(0, alignmentIndex + 1)
                .reduce((sum, edit) => sum + edit.cost, 0)}
            </strong>{' '}
            / {finalDistance}
          </p>
        </div>
      )}
      <div className="lookup-result" role="status">
        <strong>Edit distance: {playback.finished ? finalDistance : '—'}</strong>
        <span>Search decision:</span>
        <span
          className={`status ${!playback.finished ? 'draft' : match.accepted ? 'confirmed' : 'cancelled'}`}
        >
          {!playback.finished
            ? 'Awaiting comparison'
            : match.accepted
              ? 'Accepted match'
              : 'Outside tolerance'}
        </span>
      </div>
      {playback.finished && (
        <div className="fuzzy-decision" aria-label="Search tolerance explanation">
          {match.matches.length ? (
            match.matches.map((result, index) => {
              const tolerance = result.token.length <= 2 ? 0 : result.token.length <= 4 ? 1 : 2;
              return (
                <p key={index}>
                  <code>{result.token}</code> → <code>{result.word || 'no candidate word'}</code>:{' '}
                  <strong>
                    {Number.isFinite(result.distance)
                      ? `${result.distance} edit${result.distance === 1 ? '' : 's'}`
                      : 'no match'}
                  </strong>{' '}
                  / {tolerance} allowed ·{' '}
                  {result.distance <= tolerance ? 'within tolerance' : 'outside tolerance'}
                </p>
              );
            })
          ) : (
            <p>An empty normalized query matches every listing.</p>
          )}
        </div>
      )}
      <p className="technical-note">
        The matrix lowercases the complete inputs; spaces and accents count, and each cell compares
        a UTF-16 code unit. Search decisions below fold accents and split text into words, so they
        can differ from the full-input distance. Tolerance per query word: 0 edits for 1–2
        characters, 1 for 3–4, and 2 for 5+. Every query word must match. Runtime O(mn) per word
        pair.
      </p>
      <h3>Matches across current listings</h3>
      <div className="match-list">
        {listings.map(({ p, match: result }) => (
          <div key={p.id}>
            <strong>{p.title}</strong>
            <span>
              {result.matches
                .map((value) => `${value.token} → ${value.word} (${value.distance})`)
                .join(' · ') || 'All listings match an empty query'}
            </span>
          </div>
        ))}
        {!listings.length && <p>No matching properties.</p>}
      </div>
    </div>
  );
}
