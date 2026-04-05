import { wgs84ToNEDDZ, nedDZToBaseExitFrame } from '../coordinates';
import { GeodeticCoordinates, Vector3 } from '../types';

// ---------------------------------------------------------------------------
// Reference drop zones used across tests
// ---------------------------------------------------------------------------

/** Mid-latitude DZ (Skydive Dallas, ~33°N) — typical operating location */
const DZ_DALLAS: GeodeticCoordinates = {
  lat_deg: 33.454,
  lon_deg: -96.377,
  alt_m: 200,
};

/** Equatorial DZ — worst case for spherical approximation */
const DZ_EQUATOR: GeodeticCoordinates = {
  lat_deg: 0,
  lon_deg: 0,
  alt_m: 0,
};

/** High-latitude DZ (~60°N) — tests longitude convergence */
const DZ_NORTH60: GeodeticCoordinates = {
  lat_deg: 60,
  lon_deg: 25,
  alt_m: 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Independent haversine distance calculation for cross-checking.
 * Returns meters between two geodetic points (ignoring altitude).
 */
function haversineDistanceMeters(
  a: GeodeticCoordinates,
  b: GeodeticCoordinates
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat_deg - a.lat_deg);
  const dLon = toRad(b.lon_deg - a.lon_deg);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat_deg)) * Math.cos(toRad(b.lat_deg)) * sinLon * sinLon;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// ---------------------------------------------------------------------------
// wgs84ToNEDDZ
// ---------------------------------------------------------------------------

describe('wgs84ToNEDDZ', () => {
  // --- Identity -----------------------------------------------------------

  test('same point as DZ center returns (0, 0, 0)', () => {
    const ned = wgs84ToNEDDZ(DZ_DALLAS, DZ_DALLAS);
    expect(ned.x).toBeCloseTo(0, 10);
    expect(ned.y).toBeCloseTo(0, 10);
    expect(ned.z).toBeCloseTo(0, 10);
  });

  // --- Pure altitude offset -----------------------------------------------

  test('same lat/lon, higher altitude → negative down (z)', () => {
    const point = { ...DZ_DALLAS, alt_m: 4000 };
    const ned = wgs84ToNEDDZ(point, DZ_DALLAS);
    expect(ned.x).toBeCloseTo(0, 6);
    expect(ned.y).toBeCloseTo(0, 6);
    expect(ned.z).toBeCloseTo(-3800); // 200 - 4000 = -3800
  });

  test('same lat/lon, lower altitude → positive down (z)', () => {
    const point = { ...DZ_DALLAS, alt_m: 50 };
    const ned = wgs84ToNEDDZ(point, DZ_DALLAS);
    expect(ned.z).toBeCloseTo(150); // 200 - 50 = 150
  });

  // --- Cardinal directions -----------------------------------------------

  test('point due north → positive x, near-zero y', () => {
    // 0.01° latitude ~ 1111.95m at any latitude
    const point: GeodeticCoordinates = {
      lat_deg: DZ_DALLAS.lat_deg + 0.01,
      lon_deg: DZ_DALLAS.lon_deg,
      alt_m: DZ_DALLAS.alt_m,
    };
    const ned = wgs84ToNEDDZ(point, DZ_DALLAS);

    expect(ned.x).toBeGreaterThan(1000);
    expect(ned.x).toBeLessThan(1200);
    expect(ned.y).toBeCloseTo(0, 1);
    expect(ned.z).toBeCloseTo(0, 10);
  });

  test('point due south → negative x, near-zero y', () => {
    const point: GeodeticCoordinates = {
      lat_deg: DZ_DALLAS.lat_deg - 0.01,
      lon_deg: DZ_DALLAS.lon_deg,
      alt_m: DZ_DALLAS.alt_m,
    };
    const ned = wgs84ToNEDDZ(point, DZ_DALLAS);

    expect(ned.x).toBeLessThan(-1000);
    expect(ned.x).toBeGreaterThan(-1200);
    expect(ned.y).toBeCloseTo(0, 1);
  });

  test('point due east → near-zero x, positive y', () => {
    const point: GeodeticCoordinates = {
      lat_deg: DZ_DALLAS.lat_deg,
      lon_deg: DZ_DALLAS.lon_deg + 0.01,
      alt_m: DZ_DALLAS.alt_m,
    };
    const ned = wgs84ToNEDDZ(point, DZ_DALLAS);

    expect(ned.x).toBeCloseTo(0, 1);
    expect(ned.y).toBeGreaterThan(800); // shorter than lat degree at 33°N
    expect(ned.y).toBeLessThan(1000);
  });

  test('point due west → near-zero x, negative y', () => {
    const point: GeodeticCoordinates = {
      lat_deg: DZ_DALLAS.lat_deg,
      lon_deg: DZ_DALLAS.lon_deg - 0.01,
      alt_m: DZ_DALLAS.alt_m,
    };
    const ned = wgs84ToNEDDZ(point, DZ_DALLAS);

    expect(ned.x).toBeCloseTo(0, 1);
    expect(ned.y).toBeLessThan(-800);
    expect(ned.y).toBeGreaterThan(-1000);
  });

  // --- Distance magnitude cross-check -----------------------------------

  test('horizontal distance matches independent haversine', () => {
    // Diagonal offset — both lat and lon differ
    const point: GeodeticCoordinates = {
      lat_deg: DZ_DALLAS.lat_deg + 0.005,
      lon_deg: DZ_DALLAS.lon_deg + 0.003,
      alt_m: DZ_DALLAS.alt_m,
    };
    const ned = wgs84ToNEDDZ(point, DZ_DALLAS);

    const nedDist = Math.sqrt(ned.x * ned.x + ned.y * ned.y);
    const refDist = haversineDistanceMeters(DZ_DALLAS, point);

    // Should agree to within 0.01% for sub-km distances
    expect(nedDist).toBeCloseTo(refDist, 1);
  });

  // --- Symmetry -----------------------------------------------------------

  test('equal-magnitude offsets in opposite directions are symmetric', () => {
    const north: GeodeticCoordinates = {
      lat_deg: DZ_DALLAS.lat_deg + 0.005,
      lon_deg: DZ_DALLAS.lon_deg,
      alt_m: DZ_DALLAS.alt_m,
    };
    const south: GeodeticCoordinates = {
      lat_deg: DZ_DALLAS.lat_deg - 0.005,
      lon_deg: DZ_DALLAS.lon_deg,
      alt_m: DZ_DALLAS.alt_m,
    };

    const nedN = wgs84ToNEDDZ(north, DZ_DALLAS);
    const nedS = wgs84ToNEDDZ(south, DZ_DALLAS);

    // North and south x-components should be equal magnitude, opposite sign
    expect(nedN.x).toBeCloseTo(-nedS.x, 2);
    expect(nedN.y).toBeCloseTo(0, 2);
    expect(nedS.y).toBeCloseTo(0, 2);
  });

  // --- Longitude convergence at high latitude ----------------------------

  test('longitude degree is shorter at 60°N than at equator', () => {
    const eastEquator: GeodeticCoordinates = {
      lat_deg: 0,
      lon_deg: 0.01,
      alt_m: 0,
    };
    const east60: GeodeticCoordinates = {
      lat_deg: 60,
      lon_deg: 25.01,
      alt_m: 0,
    };

    const nedEq = wgs84ToNEDDZ(eastEquator, DZ_EQUATOR);
    const ned60 = wgs84ToNEDDZ(east60, DZ_NORTH60);

    // At 60°N, longitude spacing is ~cos(60°) = 0.5× equatorial
    const ratio = Math.abs(ned60.y) / Math.abs(nedEq.y);
    expect(ratio).toBeCloseTo(0.5, 1);
  });

  // --- Formation-scale accuracy ------------------------------------------

  test('100m offset accuracy is sub-meter', () => {
    // ~100m north offset (0.0009° lat ≈ 100m)
    const point: GeodeticCoordinates = {
      lat_deg: DZ_DALLAS.lat_deg + 0.0009,
      lon_deg: DZ_DALLAS.lon_deg,
      alt_m: DZ_DALLAS.alt_m,
    };
    const ned = wgs84ToNEDDZ(point, DZ_DALLAS);
    const refDist = haversineDistanceMeters(DZ_DALLAS, point);

    // At formation scales the NED x component should match haversine within 0.1m
    expect(Math.abs(ned.x - refDist)).toBeLessThan(0.1);
    expect(Math.abs(ned.y)).toBeLessThan(0.1);
  });

  // --- Down sign convention with real scenario ---------------------------

  test('freefall altitude produces correct NED down value', () => {
    // Jumper at 4000m (≈13,000 ft), DZ at 200m
    const jumper: GeodeticCoordinates = {
      lat_deg: DZ_DALLAS.lat_deg + 0.002,
      lon_deg: DZ_DALLAS.lon_deg - 0.001,
      alt_m: 4000,
    };
    const ned = wgs84ToNEDDZ(jumper, DZ_DALLAS);

    // Down = dzCenter.alt_m - point.alt_m = 200 - 4000 = -3800
    // Negative z means the jumper is ABOVE the DZ center
    expect(ned.z).toBeCloseTo(-3800, 0);
  });
});

// ---------------------------------------------------------------------------
// nedDZToBaseExitFrame
// ---------------------------------------------------------------------------

describe('nedDZToBaseExitFrame', () => {
  // --- Identity: base at origin, 0° track --------------------------------

  test('zero offset from base at origin with north track → (0, 0, 0)', () => {
    const pos: Vector3 = { x: 0, y: 0, z: 0 };
    const base: Vector3 = { x: 0, y: 0, z: 0 };
    const result = nedDZToBaseExitFrame(pos, base, 0);

    expect(result.x).toBeCloseTo(0, 10);
    expect(result.y).toBeCloseTo(0, 10);
    expect(result.z).toBeCloseTo(0, 10);
  });

  // --- Pure translation (0° track) ---------------------------------------

  test('north track (0°): NED north maps to forward (x)', () => {
    const pos: Vector3 = { x: 100, y: 0, z: -50 };
    const base: Vector3 = { x: 0, y: 0, z: 0 };
    const result = nedDZToBaseExitFrame(pos, base, 0);

    expect(result.x).toBeCloseTo(100, 6); // forward = north
    expect(result.y).toBeCloseTo(0, 6);   // right = east
    expect(result.z).toBeCloseTo(-50, 6); // down preserved
  });

  // --- 90° track (heading east) ------------------------------------------

  test('east track (90°): NED north maps to left (-y)', () => {
    // Base heading east: forward=east, right=south
    // A point 100m north of base should be 100m to the LEFT (-y)
    const pos: Vector3 = { x: 100, y: 0, z: 0 };
    const base: Vector3 = { x: 0, y: 0, z: 0 };
    const result = nedDZToBaseExitFrame(pos, base, 90);

    expect(result.x).toBeCloseTo(0, 4);    // no forward component
    expect(result.y).toBeCloseTo(-100, 4);  // left
    expect(result.z).toBeCloseTo(0, 10);
  });

  test('east track (90°): NED east maps to forward (+x)', () => {
    const pos: Vector3 = { x: 0, y: 100, z: 0 };
    const base: Vector3 = { x: 0, y: 0, z: 0 };
    const result = nedDZToBaseExitFrame(pos, base, 90);

    expect(result.x).toBeCloseTo(100, 4);  // forward
    expect(result.y).toBeCloseTo(0, 4);
  });

  // --- 180° track (heading south) ----------------------------------------

  test('south track (180°): NED north maps to backward (-x)', () => {
    const pos: Vector3 = { x: 100, y: 0, z: 0 };
    const base: Vector3 = { x: 0, y: 0, z: 0 };
    const result = nedDZToBaseExitFrame(pos, base, 180);

    expect(result.x).toBeCloseTo(-100, 4);
    expect(result.y).toBeCloseTo(0, 4);
  });

  // --- Translation + rotation --------------------------------------------

  test('translation is applied before rotation', () => {
    // Base is at (50, 50, 0) NED, heading north (0°)
    // Point is at (150, 50, -10) NED
    // After translation: (100, 0, -10)
    // After 0° rotation: (100, 0, -10) — unchanged
    const pos: Vector3 = { x: 150, y: 50, z: -10 };
    const base: Vector3 = { x: 50, y: 50, z: 0 };
    const result = nedDZToBaseExitFrame(pos, base, 0);

    expect(result.x).toBeCloseTo(100, 6);
    expect(result.y).toBeCloseTo(0, 6);
    expect(result.z).toBeCloseTo(-10, 6);
  });

  // --- Down axis is preserved through rotation ---------------------------

  test('z (down) is invariant under heading rotation', () => {
    const pos: Vector3 = { x: 10, y: 20, z: -3800 };
    const base: Vector3 = { x: 0, y: 0, z: 0 };

    for (const track of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const result = nedDZToBaseExitFrame(pos, base, track);
      expect(result.z).toBeCloseTo(-3800, 6);
    }
  });

  // --- 360° rotation is identity -----------------------------------------

  test('360° track is equivalent to 0° track', () => {
    const pos: Vector3 = { x: 100, y: 50, z: -30 };
    const base: Vector3 = { x: 10, y: 20, z: 0 };

    const r0 = nedDZToBaseExitFrame(pos, base, 0);
    const r360 = nedDZToBaseExitFrame(pos, base, 360);

    expect(r360.x).toBeCloseTo(r0.x, 6);
    expect(r360.y).toBeCloseTo(r0.y, 6);
    expect(r360.z).toBeCloseTo(r0.z, 6);
  });

  // --- Rotation preserves horizontal distance ----------------------------

  test('horizontal distance is invariant under rotation', () => {
    const pos: Vector3 = { x: 100, y: 50, z: 0 };
    const base: Vector3 = { x: 0, y: 0, z: 0 };
    const refDist = Math.sqrt(100 * 100 + 50 * 50);

    for (const track of [0, 30, 73, 120, 200, 315]) {
      const result = nedDZToBaseExitFrame(pos, base, track);
      const dist = Math.sqrt(result.x * result.x + result.y * result.y);
      expect(dist).toBeCloseTo(refDist, 6);
    }
  });
});
