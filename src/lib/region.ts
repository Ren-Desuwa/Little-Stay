/** Rectangular search extent for fictional listings, not an official city boundary. */
export const region = {
  name: 'North Caloocan',
  mapLabel: 'NORTH CALOOCAN',
  center: { lat: 14.7605, lng: 121.0425 },
  defaultNeighborhood: 'Camarin',
  defaultPropertyLocation: { lat: 14.756, lng: 121.0493 },
  bounds: { south: 14.728, north: 14.793, west: 121.005, east: 121.08 },
} as const;
