import { useMemo, useRef, useEffect, useState } from 'react';
import {
  constructionSteps,
  locateCell,
  planeBounds,
  project,
  voronoi,
  type Point,
} from '../lib/algorithms';
import { type Property } from '../lib/model';
import { PlaybackControls, useAlgorithmPlayback } from './AlgorithmPlayback';
import StayMap, { type MapConstruction } from './StayMap';

function bisectorSegment(a: number, b: number, c: number): Point[] {
  const intersections: Point[] = [];
  const add = (point: Point) => {
    if (!intersections.some((other) => Math.hypot(point.x - other.x, point.y - other.y) < 1e-7))
      intersections.push(point);
  };
  planeBounds.forEach((point, index) => {
    const next = planeBounds[(index + 1) % planeBounds.length];
    const from = a * point.x + b * point.y - c;
    const to = a * next.x + b * next.y - c;
    if (Math.abs(from) < 1e-9) add(point);
    if (from * to < 0) {
      const fraction = from / (from - to);
      add({
        x: point.x + (next.x - point.x) * fraction,
        y: point.y + (next.y - point.y) * fraction,
      });
    }
  });
  return intersections.slice(0, 2);
}

export default function VoronoiDemo({ properties }: { properties: Property[] }) {
  const [siteId, setSiteId] = useState(properties[0]?.id ?? '');
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const site = properties.find((property) => property.id === siteId) ?? properties[0];
  const geometryKey = properties
    .map((property) => `${property.id}:${property.lat}:${property.lng}`)
    .join('|');
  const resetKey = `${site?.id ?? ''}/${geometryKey}`;
  const steps = useMemo(
    () => (site ? constructionSteps(site, properties) : []),
    [site, properties],
  );
  const competitors = useMemo(
    () =>
      [...properties]
        .filter((property) => property.id !== site?.id)
        .sort((a, b) => a.id.localeCompare(b.id)),
    [properties, site?.id],
  );
  const playback = useAlgorithmPlayback({
    totalSteps: Math.max(0, steps.length - 1),
    resetKey,
    defaultDelay: 1300,
  });
  const lastStep = useRef({ step: 0, resetKey });
  const step =
    lastStep.current.resetKey === resetKey
      ? Math.min(playback.step, Math.max(0, steps.length - 1))
      : 0;
  const current = steps[step];
  const competitor = step > 0 ? competitors[step - 1] : undefined;
  const animate = useMemo(
    () => lastStep.current.resetKey === resetKey && lastStep.current.step + 1 === step,
    [step, resetKey],
  );
  useEffect(() => {
    lastStep.current = { step, resetKey };
  }, [step, resetKey]);
  const construction = useMemo<MapConstruction | undefined>(() => {
    if (!site || !current) return undefined;
    const seedPoint = project(site.lat, site.lng);
    const otherPoint = competitor ? project(competitor.lat, competitor.lng) : undefined;
    const coincident =
      otherPoint && Math.hypot(otherPoint.x - seedPoint.x, otherPoint.y - seedPoint.y) < 1e-9;
    const clip =
      otherPoint && !coincident
        ? {
            a: 2 * (otherPoint.x - seedPoint.x),
            b: 2 * (otherPoint.y - seedPoint.y),
            c: otherPoint.x ** 2 + otherPoint.y ** 2 - seedPoint.x ** 2 - seedPoint.y ** 2,
          }
        : undefined;
    return {
      key: `${resetKey}/${step}`,
      polygon: current.polygon,
      previousPolygon: steps[Math.max(0, step - 1)]?.polygon,
      bisector: clip ? bisectorSegment(clip.a, clip.b, clip.c) : undefined,
      clip,
      seed: site,
      competitor,
      animate,
      duration: 650 / playback.speed,
    };
  }, [site, current, competitor, resetKey, step, steps, animate, playback.speed]);
  const cells = useMemo(() => voronoi(properties), [properties]);
  const nearestId = pin ? locateCell(project(pin.lat, pin.lng), cells) : undefined;
  const complete = !!site && step === steps.length - 1 && (step > 0 || competitors.length === 0);
  const coincident = !!construction?.competitor && !construction.clip;
  const caption = !site
    ? 'No published properties to construct.'
    : competitor
      ? coincident
        ? `${site.title} and ${competitor.title} share a location. The lowest property ID owns this cell.`
        : `Compare ${site.title} with ${competitor.title}. Keep the area nearer the selected seed; discard the area across their perpendicular bisector.`
      : `Start with the entire demo boundary for ${site.title}. Each comparison will clip away points closer to another seed.`;

  return (
    <div className="lab-panel">
      <div className="section-heading">
        <div>
          <h2>Every place has a neighborhood.</h2>
          <p>
            Build each cell by clipping the map at perpendicular bisectors. Play the construction,
            then click a point to locate its nearest seed.
          </p>
        </div>
        <span className="badge">COMPUTATIONAL GEOMETRY</span>
      </div>
      <div className="form-row">
        <label>
          Seed property
          <select
            value={site?.id ?? ''}
            disabled={!site}
            onChange={(event) => setSiteId(event.target.value)}
          >
            {!properties.length && <option value="">No published properties</option>}
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <PlaybackControls
        playback={playback}
        label="Voronoi construction"
        disabled={steps.length <= 1}
      />
      <div className="algorithm-stage">
        <span className="algorithm-kicker">
          {complete
            ? 'CELL CONSTRUCTED'
            : step === 0
              ? 'START WITH THE BOUNDARY'
              : `CLIP ${step} / ${competitors.length}`}
        </span>
        <p className="algorithm-caption" role="status">
          {caption}
        </p>
        <div className="algorithm-formula">
          {competitor && !coincident
            ? 'Keep d(point, selected seed) ≤ d(point, competitor)'
            : site
              ? `${competitors.length} seed comparison${competitors.length === 1 ? '' : 's'} · ${current?.polygon.length ?? 0} polygon vertices`
              : 'Add a published property to begin'}
        </div>
      </div>
      <div className="voronoi-legend" aria-label="Map construction legend">
        <span>
          <i className="voronoi-kept" /> Kept area / selected seed
        </span>
        <span>
          <i className="voronoi-discarded" /> Discarded this step
        </span>
        <span>
          <i className="voronoi-bisector" /> Bisector / competitor
        </span>
      </div>
      <StayMap
        properties={properties}
        activeId={site?.id}
        overlay
        pin={pin}
        onPin={setPin}
        construction={construction}
      />
      {complete && (
        <p className="algorithm-complete" role="status">
          {competitors.length === 0
            ? 'One seed owns the entire bounded area. There are no other seeds to compare.'
            : current?.polygon.length
              ? `Cell complete after ${competitors.length} comparisons. Every point in the green polygon is nearest to ${site?.title}.`
              : `Cell complete after ${competitors.length} comparisons. This seed has no cell inside the demo boundary.`}
        </p>
      )}
      <div className="lookup-result">
        <span>{cells.filter((cell) => cell.polygon.length).length} nonempty cells</span>
        <strong>
          {pin
            ? `Nearest: ${properties.find((property) => property.id === nearestId)?.title ?? 'Outside the demo boundary'}`
            : 'Click the map to test point location'}
        </strong>
      </div>
      <p className="technical-note">
        Coordinates are projected to a local plane in kilometers. Distance is approximate
        straight-line proximity, not travel time. Shared boundaries and coincident seeds choose the
        lowest property ID. Cell construction uses repeated half-plane clipping; point location
        scans the bounded cells.
      </p>
    </div>
  );
}
