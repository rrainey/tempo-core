// Landing-area geometry helpers: point-in-polygon, haversine, containment.

import { pointInRing, haversineMeters, findContainingPolygon } from '../gps-path-utils';

// A ~1 km square around the Spaceland Dallas DZ coordinates.
const SQUARE: number[][] = [
  [-96.382, 33.452], [-96.372, 33.452], [-96.372, 33.462], [-96.382, 33.462], [-96.382, 33.452],
];

describe('pointInRing', () => {
  it('detects inside/outside', () => {
    expect(pointInRing(-96.377, 33.457, SQUARE)).toBe(true);
    expect(pointInRing(-96.39, 33.457, SQUARE)).toBe(false);
    expect(pointInRing(-96.377, 33.47, SQUARE)).toBe(false);
  });

  it('works with an unclosed ring too', () => {
    expect(pointInRing(-96.377, 33.457, SQUARE.slice(0, -1))).toBe(true);
  });
});

describe('haversineMeters', () => {
  it('measures known distances', () => {
    // one degree of latitude ≈ 111.2 km
    expect(haversineMeters(33.0, -96.0, 34.0, -96.0)).toBeCloseTo(111195, -3);
    expect(haversineMeters(33.4569, -96.377, 33.4569, -96.377)).toBe(0);
  });
});

describe('findContainingPolygon', () => {
  const collection = {
    features: [
      { geometry: { type: 'Point', coordinates: [-96.377, 33.457] }, properties: { name: 'target' } },
      { geometry: { type: 'Polygon', coordinates: [SQUARE] }, properties: { name: 'Main', class: 'main' } },
    ],
  };

  it('finds the polygon containing a point, skipping non-polygons', () => {
    const hit = findContainingPolygon(collection, -96.377, 33.457);
    expect(hit?.properties.name).toBe('Main');
  });

  it('returns null when outside every polygon', () => {
    expect(findContainingPolygon(collection, -96.5, 33.0)).toBeNull();
  });
});
