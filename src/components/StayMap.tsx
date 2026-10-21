import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { geoBounds, project, unproject, voronoi, locateCell, type Point } from '../lib/algorithms';
import { money, type Property } from '../lib/model';

type Props = {
  properties: Property[];
  activeId?: string;
  onSelect?: (id: string) => void;
  overlay?: boolean;
  pin?: { lat: number; lng: number } | null;
  onPin?: (pin: { lat: number; lng: number }) => void;
  editing?: boolean;
  stepPolygon?: Point[];
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
  compact,
}: Props) {
  const root = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    layers = useRef<L.LayerGroup | null>(null);
  const handlers = useRef({ onPin });
  handlers.current = { onPin };
  const [tileState, setTileState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    if (!root.current) return;
    const bounds = L.latLngBounds(
      [geoBounds.south, geoBounds.west],
      [geoBounds.north, geoBounds.east],
    );
    const instance = L.map(root.current, {
      zoomControl: true,
      minZoom: 13,
      maxZoom: 18,
      maxBounds: bounds.pad(0.08),
      maxBoundsViscosity: 1,
    }).setView([14.5578, 121.025], compact ? 14 : 15);
    map.current = instance;
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    });
    tiles.on('tileload', () => setTileState('ready'));
    tiles.on('tileerror', () => setTileState('error'));
    tiles.addTo(instance);
    layers.current = L.layerGroup().addTo(instance);
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
    };
  }, [compact]);
  useEffect(() => {
    const group = layers.current;
    if (!group) return;
    group.clearLayers();
    const cells = voronoi(properties);
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
    if (stepPolygon?.length)
      L.polygon(stepPolygon.map(unproject), {
        color: '#b66e3e',
        fillOpacity: 0.24,
        weight: 3,
        interactive: false,
      }).addTo(group);
    properties.forEach((p) => {
      const active = p.id === activeId || p.id === nearest;
      const element = document.createElement('span');
      element.textContent = editing ? '⌂' : money(p.price);
      const icon = L.divIcon({
        className: `price-pin ${active ? 'selected' : ''}`,
        html: element,
        iconSize: [74, 32],
        iconAnchor: [37, 16],
      });
      const marker = L.marker([p.lat, p.lng], {
        icon,
        title: `${p.title} — ${money(p.price)} per night`,
        keyboard: true,
      }).addTo(group);
      marker.on('click', () => onSelect?.(p.id));
    });
    if (pin)
      L.circleMarker([pin.lat, pin.lng], {
        radius: 8,
        color: '#fff',
        weight: 3,
        fillColor: '#c76f42',
        fillOpacity: 1,
        interactive: false,
      }).addTo(group);
  }, [properties, activeId, onSelect, overlay, pin, editing, stepPolygon]);
  return (
    <div className={`map-wrap ${compact ? 'compact-map' : ''}`}>
      <div
        ref={root}
        className="leaflet-map"
        aria-label={
          editing ? 'Choose property coordinates on the Makati map' : 'Makati rental properties map'
        }
      />
      <div className="map-instruction">
        {editing
          ? 'Click the map to place your property'
          : onPin
            ? 'Click anywhere to find your nearest stay'
            : 'Property location · Makati City'}
      </div>
      {tileState !== 'ready' && (
        <div className="map-notice" role="status">
          {tileState === 'loading'
            ? 'Loading street map…'
            : 'Street tiles unavailable. Pins and geometry still work; internet is needed for streets.'}
        </div>
      )}
      <span className="map-area">MAKATI CITY · DEMO AREA</span>
    </div>
  );
}
