import { region } from '../lib/region';
import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  clipHalfPlane,
  geoBounds,
  project,
  unproject,
  voronoi,
  locateCell,
  type Point,
  type Site,
} from '../lib/algorithms';
import { money, type Property } from '../lib/model';

export type MapConstruction = {
  key: string;
  polygon: Point[];
  previousPolygon?: Point[];
  bisector?: Point[];
  clip?: { a: number; b: number; c: number };
  seed: Site;
  competitor?: Site;
  animate?: boolean;
  duration?: number;
};

type Props = {
  properties: Property[];
  activeId?: string;
  onSelect?: (id: string) => void;
  overlay?: boolean;
  pin?: { lat: number; lng: number } | null;
  onPin?: (pin: { lat: number; lng: number }) => void;
  editing?: boolean;
  stepPolygon?: Point[];
  construction?: MapConstruction;
  compact?: boolean;
};
export default function StayMap({
  properties,
  activeId,
  onSelect,
  overlay = false,
  pin,
  onPin,
  editing = false,
  stepPolygon,
  construction,
  compact,
}: Props) {
  const root = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    layers = useRef<L.LayerGroup | null>(null);
  const constructionLayers = useRef<{
    remaining: L.Polygon;
    discarded: L.Polygon;
    bisector: L.Polyline;
    connection: L.Polyline;
    seed: L.CircleMarker;
    competitor: L.CircleMarker;
  } | null>(null);
  const lastConstructionKey = useRef<string | undefined>(undefined);
  const handlers = useRef({ onPin });
  handlers.current = { onPin };
  const [tileState, setTileState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [zoom, setZoom] = useState(13);
  const cells = useMemo(() => voronoi(properties), [properties]);
  useEffect(() => {
    if (!root.current) return;
    const bounds = L.latLngBounds(
      [geoBounds.south, geoBounds.west],
      [geoBounds.north, geoBounds.east],
    );
    const instance = L.map(root.current, {
      zoomControl: true,
      minZoom: 12,
      maxZoom: 18,
      maxBounds: bounds.pad(0.08),
      maxBoundsViscosity: 1,
    }).fitBounds(bounds, { padding: [24, 40], maxZoom: 14 });
    if (compact && properties.length === 1)
      instance.setView([properties[0].lat, properties[0].lng], 14);
    map.current = instance;
    instance.on('zoomend', () => setZoom(instance.getZoom()));
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    });
    let tileBatchFailed = false;
    tiles.on('loading', () => {
      tileBatchFailed = false;
      setTileState('loading');
    });
    tiles.on('tileerror', () => {
      tileBatchFailed = true;
      setTileState('error');
    });
    tiles.on('load', () => setTileState(tileBatchFailed ? 'error' : 'ready'));
    tiles.addTo(instance);
    layers.current = L.layerGroup().addTo(instance);
    instance.createPane('construction');
    instance.getPane('construction')!.style.zIndex = '430';
    instance.getPane('construction')!.style.pointerEvents = 'none';
    instance.createPane('construction-seeds');
    instance.getPane('construction-seeds')!.style.zIndex = '620';
    instance.getPane('construction-seeds')!.style.pointerEvents = 'none';
    const constructionGroup = L.layerGroup().addTo(instance);
    const style = { pane: 'construction', interactive: false };
    constructionLayers.current = {
      discarded: L.polygon([], {
        ...style,
        color: '#a85c51',
        fillColor: '#c27868',
        weight: 1.5,
        dashArray: '4 5',
        fillOpacity: 0.19,
      }).addTo(constructionGroup),
      remaining: L.polygon([], {
        ...style,
        color: '#37664d',
        fillColor: '#579471',
        fillOpacity: 0.28,
        weight: 3,
      }).addTo(constructionGroup),
      connection: L.polyline([], {
        ...style,
        color: '#6a638e',
        weight: 1.5,
        dashArray: '3 7',
        opacity: 0.65,
      }).addTo(constructionGroup),
      bisector: L.polyline([], {
        ...style,
        color: '#986038',
        weight: 3,
        dashArray: '8 7',
      }).addTo(constructionGroup),
      seed: L.circleMarker([0, 0], {
        ...style,
        pane: 'construction-seeds',
        radius: 8,
        color: '#fff',
        fillColor: '#37664d',
        weight: 3,
        fillOpacity: 0,
        opacity: 0,
      }).addTo(constructionGroup),
      competitor: L.circleMarker([0, 0], {
        ...style,
        pane: 'construction-seeds',
        radius: 8,
        color: '#fff',
        fillColor: '#986038',
        weight: 3,
        fillOpacity: 0,
        opacity: 0,
      }).addTo(constructionGroup),
    };
    instance.on('click', (e: L.LeafletMouseEvent) => {
      if (bounds.contains(e.latlng))
        handlers.current.onPin?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    const resize = new ResizeObserver(() => instance.invalidateSize());
    resize.observe(root.current);
    const timer = window.setTimeout(
      () => setTileState((s) => (s === 'loading' ? 'error' : s)),
      8000,
    );
    return () => {
      window.clearTimeout(timer);
      resize.disconnect();
      instance.remove();
      map.current = null;
      layers.current = null;
      constructionLayers.current = null;
      lastConstructionKey.current = undefined;
    };
  }, [compact]);
  useEffect(() => {
    const group = layers.current;
    if (!group) return;
    group.clearLayers();
    const nearest = pin ? locateCell(project(pin.lat, pin.lng), cells) : undefined;
    if (overlay)
      cells.forEach((cell, i) => {
        if (cell.polygon.length)
          L.polygon(cell.polygon.map(unproject), {
            color: ['#37664d', '#a58a45', '#5c8395', '#a57470'][i % 4],
            weight: cell.id === nearest ? 3 : 1,
            fillOpacity: cell.id === nearest ? 0.26 : 0.09,
            interactive: false,
          }).addTo(group);
      });
    const clusters: Record<string, Property[]> = {};
    properties.forEach((p) => {
      const screen = map.current!.latLngToContainerPoint([p.lat, p.lng]);
      const key = `${Math.floor(screen.x / 76)}:${Math.floor(screen.y / 43)}`;
      (clusters[key] ??= []).push(p);
    });
    Object.values(clusters).forEach((cluster) => {
      const selected = cluster.find((p) => p.id === activeId || p.id === nearest);
      if (cluster.length > 1) {
        const lat = cluster.reduce((s, p) => s + p.lat, 0) / cluster.length,
          lng = cluster.reduce((s, p) => s + p.lng, 0) / cluster.length;
        const element = document.createElement('span');
        element.textContent = String(cluster.length);
        L.marker([lat, lng], {
          icon: L.divIcon({
            className: `cluster-pin ${selected ? 'selected' : ''}`,
            html: element,
            iconSize: [40, 40],
            iconAnchor: [20, 20],
          }),
          title:
            zoom < 18 ? `Zoom into ${cluster.length} stays` : `Choose from ${cluster.length} stays`,
          keyboard: true,
        })
          .on('click', function (this: L.Marker) {
            if (map.current!.getZoom() < 18) {
              map.current!.setView([lat, lng], Math.min(map.current!.getZoom() + 2, 18));
              return;
            }
            const list = document.createElement('div');
            list.className = 'cluster-popup';
            cluster.forEach((p) => {
              const button = document.createElement('button');
              button.type = 'button';
              button.textContent = `${p.title} · ${money(p.price)}`;
              button.addEventListener('click', () => {
                onSelect?.(p.id);
                map.current?.closePopup();
              });
              list.append(button);
            });
            this.bindPopup(list, { maxHeight: 250 }).openPopup();
          })
          .addTo(group);
      } else {
        const p = selected ?? cluster[0],
          active = p.id === activeId || p.id === nearest;
        const element = document.createElement('span');
        element.textContent = editing ? '⌂' : money(p.price);
        L.marker([p.lat, p.lng], {
          icon: L.divIcon({
            className: `price-pin ${active ? 'selected' : ''}`,
            html: element,
            iconSize: [74, 32],
            iconAnchor: [37, 16],
          }),
          title: `${p.title} — ${money(p.price)} per night`,
          keyboard: true,
        })
          .on('click', () => onSelect?.(p.id))
          .addTo(group);
      }
    });
    if (overlay)
      properties.forEach((p) =>
        L.circleMarker([p.lat, p.lng], {
          radius: 2,
          color: '#365c35',
          weight: 1,
          fillOpacity: 0.7,
          interactive: false,
        }).addTo(group),
      );
    if (pin)
      L.circleMarker([pin.lat, pin.lng], {
        radius: 8,
        color: '#fff',
        weight: 3,
        fillColor: '#c76f42',
        fillOpacity: 1,
        interactive: false,
      }).addTo(group);
  }, [properties, activeId, onSelect, overlay, pin, editing, cells, zoom, compact]);
  useEffect(() => {
    const geometry = constructionLayers.current;
    if (!geometry) return;
    const polygon = construction?.polygon ?? stepPolygon ?? [];
    const previous = construction?.previousPolygon ?? polygon;
    const clip = construction?.clip;
    const newStep = construction?.key !== lastConstructionKey.current;
    lastConstructionKey.current = construction?.key;
    geometry.bisector.setLatLngs((construction?.bisector ?? []).map(unproject));
    geometry.connection.setLatLngs(
      construction?.competitor
        ? [
            [construction.seed.lat, construction.seed.lng],
            [construction.competitor.lat, construction.competitor.lng],
          ]
        : [],
    );
    if (construction) geometry.seed.setLatLng([construction.seed.lat, construction.seed.lng]);
    geometry.seed.setStyle({ opacity: construction ? 1 : 0, fillOpacity: construction ? 1 : 0 });
    if (construction?.competitor)
      geometry.competitor.setLatLng([construction.competitor.lat, construction.competitor.lng]);
    geometry.competitor.setStyle({
      opacity: construction?.competitor ? 1 : 0,
      fillOpacity: construction?.competitor ? 1 : 0,
    });
    geometry.discarded.setLatLngs(
      (clip ? clipHalfPlane(previous, -clip.a, -clip.b, -clip.c) : []).map(unproject),
    );
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = construction?.duration ?? 650;
    if (
      !construction?.animate ||
      !newStep ||
      !clip ||
      !previous.length ||
      reducedMotion ||
      duration <= 0
    ) {
      geometry.remaining.setLatLngs(polygon.map(unproject));
      return;
    }
    // Move the clipping plane through the previous polygon; every frame remains an exact half-plane clip.
    const startC = Math.max(
      clip.c,
      ...previous.map((point) => clip.a * point.x + clip.b * point.y),
    );
    let frame = 0;
    let started: number | undefined;
    const animate = (time: number) => {
      started ??= time;
      const progress = Math.min(1, (time - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      geometry.remaining.setLatLngs(
        (progress === 1
          ? polygon
          : clipHalfPlane(previous, clip.a, clip.b, startC + (clip.c - startC) * eased)
        ).map(unproject),
      );
      if (progress < 1) frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [construction, stepPolygon, compact]);
  return (
    <div className={`map-wrap ${compact ? 'compact-map' : ''}`}>
      <div
        ref={root}
        className="leaflet-map"
        aria-label={
          editing
            ? `Choose property coordinates on the ${region.name} map`
            : `${region.name} rental properties map`
        }
      />
      <div className="map-instruction">
        {editing
          ? 'Click the map to place your property'
          : onPin
            ? 'Click anywhere to find your nearest stay'
            : `Property location · ${region.name}`}
      </div>
      {tileState !== 'ready' && (
        <div className="map-notice" role="status">
          {tileState === 'loading'
            ? 'Loading street map…'
            : 'Street tiles unavailable. Pins and geometry still work; internet is needed for streets.'}
        </div>
      )}
      <span className="map-area">{region.mapLabel} · DEMO AREA</span>
    </div>
  );
}
