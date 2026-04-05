import { wgs84ToNEDDZ, nedDZToBaseExitFrame } from '../coordinates';
import { GeodeticCoordinates, Vector3 } from '../types';

// ---------------------------------------------------------------------------
// Test fixtures — realistic skydiving scenario at Skydive Dallas
// ---------------------------------------------------------------------------

/** DZ ground center */
const DZ: GeodeticCoordinates = {
  lat_deg: 33.454,
  lon_deg: -96.377,
  alt_m: 200,
};

/** Exit altitude (≈13,000 ft MSL) */
const EXIT_ALT_M = 4000;

/**
 * Local scale factors at the DZ latitude (33.454°N), using R = 6,371,000 m.
 * These let us construct GPS positions with known meter-scale offsets.
 */
const DEG_PER_M_LAT = 1 / (Math.PI / 180 * 6371000);                             // ~8.993e-6
const DEG_PER_M_LON = 1 / (Math.PI / 180 * 6371000 * Math.cos(33.454 * Math.PI / 180)); // ~1.078e-5

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Offset a geodetic position by (north, east, up) meters.
 * Valid for formation-scale offsets (<1 km) where the linear
 * approximation of the lat/lon grid is sub-meter accurate.
 */
function offsetGPS(
  origin: GeodeticCoordinates,
  north_m: number,
  east_m: number,
  up_m: number
): GeodeticCoordinates {
  return {
    lat_deg: origin.lat_deg + north_m * DEG_PER_M_LAT,
    lon_deg: origin.lon_deg + east_m * DEG_PER_M_LON,
    alt_m: origin.alt_m + up_m,
  };
}

/**
 * Full pipeline: GNSS geodetic → NED (DZ) → Base Exit Frame.
 */
function gnssToBaseFrame(
  jumperGPS: GeodeticCoordinates,
  baseGPS: GeodeticCoordinates,
  dzCenter: GeodeticCoordinates,
  baseTrack_deg: number
): Vector3 {
  const jumperNED = wgs84ToNEDDZ(jumperGPS, dzCenter);
  const baseNED = wgs84ToNEDDZ(baseGPS, dzCenter);
  return nedDZToBaseExitFrame(jumperNED, baseNED, baseTrack_deg);
}

/** Euclidean distance between two 3D points */
function dist3D(a: Vector3, b: Vector3): number {
  return Math.sqrt(
    (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2
  );
}

/** Horizontal (forward/right) distance only */
function distHoriz(v: Vector3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

// ---------------------------------------------------------------------------
// Tests: GNSS positions → Base Exit Frame
// ---------------------------------------------------------------------------

describe('GNSS to Base Exit Frame pipeline', () => {
  // --- Co-located jumpers ------------------------------------------------

  test('co-located jumpers at exit altitude produce (0, 0, 0)', () => {
    const pos = offsetGPS(DZ, 500, -300, EXIT_ALT_M - DZ.alt_m);
    const result = gnssToBaseFrame(pos, pos, DZ, 180);

    expect(result.x).toBeCloseTo(0, 6);
    expect(result.y).toBeCloseTo(0, 6);
    expect(result.z).toBeCloseTo(0, 6);
  });

  // --- Cardinal slot positions on a southbound track (180°) ---------------
  //
  //  Track = 180° (heading south)
  //  Forward (+x) = south,  Right (+y) = west
  //

  describe('southbound track (180°)', () => {
    const baseGPS = offsetGPS(DZ, 800, -400, EXIT_ALT_M - DZ.alt_m);
    const TRACK = 180;

    test('jumper 10m ahead → forward +10, right ≈0', () => {
      // "Ahead" on a southbound track = further south = negative north
      const jumper = offsetGPS(baseGPS, -10, 0, 0);
      const bf = gnssToBaseFrame(jumper, baseGPS, DZ, TRACK);

      expect(bf.x).toBeCloseTo(10, 0);
      expect(bf.y).toBeCloseTo(0, 0);
      expect(bf.z).toBeCloseTo(0, 0);
    });

    test('jumper 10m behind → forward -10, right ≈0', () => {
      const jumper = offsetGPS(baseGPS, 10, 0, 0); // north = behind when heading south
      const bf = gnssToBaseFrame(jumper, baseGPS, DZ, TRACK);

      expect(bf.x).toBeCloseTo(-10, 0);
      expect(bf.y).toBeCloseTo(0, 0);
    });

    test('jumper 8m to the right → forward ≈0, right +8', () => {
      // Right of southbound = west = negative east
      const jumper = offsetGPS(baseGPS, 0, -8, 0);
      const bf = gnssToBaseFrame(jumper, baseGPS, DZ, TRACK);

      expect(bf.x).toBeCloseTo(0, 0);
      expect(bf.y).toBeCloseTo(8, 0);
    });

    test('jumper 8m to the left → forward ≈0, right -8', () => {
      const jumper = offsetGPS(baseGPS, 0, 8, 0); // east = left when heading south
      const bf = gnssToBaseFrame(jumper, baseGPS, DZ, TRACK);

      expect(bf.x).toBeCloseTo(0, 0);
      expect(bf.y).toBeCloseTo(-8, 0);
    });

    test('jumper 5m below → down +5', () => {
      const jumper = offsetGPS(baseGPS, 0, 0, -5);
      const bf = gnssToBaseFrame(jumper, baseGPS, DZ, TRACK);

      expect(bf.x).toBeCloseTo(0, 0);
      expect(bf.y).toBeCloseTo(0, 0);
      expect(bf.z).toBeCloseTo(5, 0);
    });

    test('jumper 5m above → down -5', () => {
      const jumper = offsetGPS(baseGPS, 0, 0, 5);
      const bf = gnssToBaseFrame(jumper, baseGPS, DZ, TRACK);

      expect(bf.z).toBeCloseTo(-5, 0);
    });
  });

  // --- Cardinal slot positions on a northbound track (0°) -----------------

  describe('northbound track (0°)', () => {
    const baseGPS = offsetGPS(DZ, 800, -400, EXIT_ALT_M - DZ.alt_m);
    const TRACK = 0;

    test('jumper 10m ahead (north) → forward +10', () => {
      const jumper = offsetGPS(baseGPS, 10, 0, 0);
      const bf = gnssToBaseFrame(jumper, baseGPS, DZ, TRACK);

      expect(bf.x).toBeCloseTo(10, 0);
      expect(bf.y).toBeCloseTo(0, 0);
    });

    test('jumper 8m to the right (east) → right +8', () => {
      const jumper = offsetGPS(baseGPS, 0, 8, 0);
      const bf = gnssToBaseFrame(jumper, baseGPS, DZ, TRACK);

      expect(bf.x).toBeCloseTo(0, 0);
      expect(bf.y).toBeCloseTo(8, 0);
    });
  });

  // --- Diagonal ground track (225° = southwest) ---------------------------

  describe('southwest track (225°)', () => {
    const baseGPS = offsetGPS(DZ, 500, -200, EXIT_ALT_M - DZ.alt_m);
    const TRACK = 225;

    test('jumper directly ahead → forward +, right ≈0', () => {
      // Forward on 225° = southwest = (-south, -west) in NED = (-north, -east)
      const d = 10;
      const rad = (225 * Math.PI) / 180;
      const jumper = offsetGPS(baseGPS, d * Math.cos(rad), d * Math.sin(rad), 0);
      const bf = gnssToBaseFrame(jumper, baseGPS, DZ, TRACK);

      expect(bf.x).toBeCloseTo(d, 0);
      expect(bf.y).toBeCloseTo(0, 0);
    });

    test('jumper directly to the right → forward ≈0, right +', () => {
      // Right of 225° heading = perpendicular clockwise = 225°+90° = 315° = NW
      const d = 10;
      const rightBearing = ((225 + 90) * Math.PI) / 180;
      const jumper = offsetGPS(baseGPS, d * Math.cos(rightBearing), d * Math.sin(rightBearing), 0);
      const bf = gnssToBaseFrame(jumper, baseGPS, DZ, TRACK);

      expect(bf.x).toBeCloseTo(0, 0);
      expect(bf.y).toBeCloseTo(d, 0);
    });
  });

  // --- Formation geometry ------------------------------------------------

  describe('formation geometry', () => {
    const baseGPS = offsetGPS(DZ, 600, -300, EXIT_ALT_M - DZ.alt_m);
    const TRACK = 195; // typical jump run heading

    test('symmetric 2-way: equal offset left and right', () => {
      // Two wing jumpers 5m to each side of base, same forward position.
      // Right perpendicular of heading θ in NED is (cos(θ+90°), sin(θ+90°)).
      const rightRad = TRACK * Math.PI / 180 + Math.PI / 2;
      const right = offsetGPS(baseGPS,
        5 * Math.cos(rightRad),
        5 * Math.sin(rightRad),
        0
      );
      const left = offsetGPS(baseGPS,
        -5 * Math.cos(rightRad),
        -5 * Math.sin(rightRad),
        0
      );

      const bfR = gnssToBaseFrame(right, baseGPS, DZ, TRACK);
      const bfL = gnssToBaseFrame(left, baseGPS, DZ, TRACK);

      // Forward should be approximately equal (both at same along-track position)
      expect(bfR.x).toBeCloseTo(bfL.x, 0);

      // Lateral should be mirror images
      expect(bfR.y).toBeCloseTo(-bfL.y, 0);
      expect(bfR.y).toBeGreaterThan(0); // right side
      expect(bfL.y).toBeLessThan(0);    // left side

      // Both ~5m from center laterally
      expect(Math.abs(bfR.y)).toBeCloseTo(5, 0);
      expect(Math.abs(bfL.y)).toBeCloseTo(5, 0);
    });

    test('3-way triangle: relative separations are consistent', () => {
      // Base at center. Two wing jumpers form an equilateral triangle behind base.
      // Each wing is 8m behind and 5m to the side.
      const fwdRad = (TRACK * Math.PI) / 180;
      const rightRad = fwdRad + Math.PI / 2;

      // Wing-right: 8m behind, 5m right
      const wingR = offsetGPS(baseGPS,
        -8 * Math.cos(fwdRad) + 5 * Math.cos(rightRad),
        -8 * Math.sin(fwdRad) + 5 * Math.sin(rightRad),
        -2 // 2m low
      );
      // Wing-left: 8m behind, 5m left
      const wingL = offsetGPS(baseGPS,
        -8 * Math.cos(fwdRad) - 5 * Math.cos(rightRad),
        -8 * Math.sin(fwdRad) - 5 * Math.sin(rightRad),
        -2 // 2m low
      );

      const bfR = gnssToBaseFrame(wingR, baseGPS, DZ, TRACK);
      const bfL = gnssToBaseFrame(wingL, baseGPS, DZ, TRACK);

      // Both should be ~8m behind
      expect(bfR.x).toBeCloseTo(-8, 0);
      expect(bfL.x).toBeCloseTo(-8, 0);

      // Right wing at +5m, left wing at -5m laterally
      expect(bfR.y).toBeCloseTo(5, 0);
      expect(bfL.y).toBeCloseTo(-5, 0);

      // Both 2m below
      expect(bfR.z).toBeCloseTo(2, 0);
      expect(bfL.z).toBeCloseTo(2, 0);

      // Separation between wings should be ~10m (lateral only, same forward and down)
      const wingDist = dist3D(bfR, bfL);
      expect(wingDist).toBeCloseTo(10, 0);
    });
  });

  // --- Track invariance of separation distance ----------------------------

  test('3D separation is invariant across ground track headings', () => {
    // Place base and jumper with known offset, rotate through track headings.
    // The 3D separation in base frame should remain constant.
    const baseGPS = offsetGPS(DZ, 500, -200, EXIT_ALT_M - DZ.alt_m);

    // Jumper is 15m north, 10m east, 3m below base in the ground frame
    const jumperGPS = offsetGPS(baseGPS, 15, 10, -3);

    // Expected separation magnitude (unchanged by rotation)
    const expectedDist = Math.sqrt(15 * 15 + 10 * 10 + 3 * 3);

    for (const track of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const bf = gnssToBaseFrame(jumperGPS, baseGPS, DZ, track);
      const dist = Math.sqrt(bf.x ** 2 + bf.y ** 2 + bf.z ** 2);
      expect(dist).toBeCloseTo(expectedDist, 0);
    }
  });

  // --- DZ center independence for relative positions ----------------------

  test('relative base-frame position is independent of DZ center choice', () => {
    // The base frame is relative to the base jumper, so shifting the DZ
    // center should not change the result (within numerical precision).
    const baseGPS = offsetGPS(DZ, 600, -300, EXIT_ALT_M - DZ.alt_m);
    const jumperGPS = offsetGPS(baseGPS, -12, 7, -4);
    const track = 210;

    // Use two different DZ centers
    const bf1 = gnssToBaseFrame(jumperGPS, baseGPS, DZ, track);

    const dz2: GeodeticCoordinates = { lat_deg: 33.5, lon_deg: -96.4, alt_m: 250 };
    const bf2 = gnssToBaseFrame(jumperGPS, baseGPS, dz2, track);

    expect(bf2.x).toBeCloseTo(bf1.x, 1);
    expect(bf2.y).toBeCloseTo(bf1.y, 1);
    expect(bf2.z).toBeCloseTo(bf1.z, 1);
  });

  // --- Sub-meter accuracy at formation scale ------------------------------

  test('10m offsets are accurate to within 0.1m', () => {
    const baseGPS = offsetGPS(DZ, 400, -200, EXIT_ALT_M - DZ.alt_m);
    const track = 180;

    // Jumper 10m ahead and 10m right
    const fwdRad = (track * Math.PI) / 180;
    const rightRad = fwdRad + Math.PI / 2;
    const jumperGPS = offsetGPS(baseGPS,
      10 * Math.cos(fwdRad) + 10 * Math.cos(rightRad),
      10 * Math.sin(fwdRad) + 10 * Math.sin(rightRad),
      0
    );

    const bf = gnssToBaseFrame(jumperGPS, baseGPS, DZ, track);

    expect(Math.abs(bf.x - 10)).toBeLessThan(0.1);
    expect(Math.abs(bf.y - 10)).toBeLessThan(0.1);
    expect(Math.abs(bf.z)).toBeLessThan(0.1);
  });

  // --- Real-world scenario: typical exit separation -----------------------

  test('typical exit: 2 groups 300m apart on jump run', () => {
    // First group exits, second group is 300m further up the line of flight.
    // Track = 180° (southbound). Second group is 300m north of first.
    const baseGPS = offsetGPS(DZ, 500, -300, EXIT_ALT_M - DZ.alt_m);
    const group2GPS = offsetGPS(baseGPS, 300, 0, 0); // 300m north = 300m behind on 180° track

    const bf = gnssToBaseFrame(group2GPS, baseGPS, DZ, 180);

    // 300m behind
    expect(bf.x).toBeCloseTo(-300, 0);
    expect(Math.abs(bf.y)).toBeLessThan(1);
    expect(Math.abs(bf.z)).toBeLessThan(0.01);
  });

  // --- Altitude-only separation in freefall -------------------------------

  test('same GPS footprint, different altitudes → pure vertical separation', () => {
    const baseGPS = offsetGPS(DZ, 500, -300, EXIT_ALT_M - DZ.alt_m);
    // Jumper at same lat/lon but 20m lower
    const lowerGPS = { ...baseGPS, alt_m: baseGPS.alt_m - 20 };

    const bf = gnssToBaseFrame(lowerGPS, baseGPS, DZ, 180);

    expect(Math.abs(bf.x)).toBeLessThan(0.01);
    expect(Math.abs(bf.y)).toBeLessThan(0.01);
    expect(bf.z).toBeCloseTo(20, 0); // 20m below = +20 down
  });
});
