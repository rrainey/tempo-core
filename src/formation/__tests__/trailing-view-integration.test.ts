import {
  projectFormationAtTime,
  interpolateAtMidnightTime,
  ParticipantData,
  TimeSeriesPoint,
} from '../coordinates';
import { GeodeticCoordinates } from '../types';

// ---------------------------------------------------------------------------
// Setup: construct a synthetic 3-way formation with known geometry
// ---------------------------------------------------------------------------

/** DZ center (Skydive Dallas) */
const DZ: GeodeticCoordinates = { lat_deg: 33.454, lon_deg: -96.377, alt_m: 200 };

/** Approximate meters-per-degree at the DZ latitude */
const DEG_PER_M_LAT = 1 / (Math.PI / 180 * 6371000);
const DEG_PER_M_LON = 1 / (Math.PI / 180 * 6371000 * Math.cos(33.454 * Math.PI / 180));

/** Offset a geodetic position by (north, east, up) meters */
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
 * Build a two-sample time series for a jumper at a given GPS position.
 * Two identical samples bracket t=10s so interpolatePosition works.
 */
function makeTimeSeries(
  gps: GeodeticCoordinates,
  groundtrack_degT?: number,
): TimeSeriesPoint[] {
  const base: TimeSeriesPoint = {
    timeOffset: 0,
    location: gps,
    baroAlt_ft: gps.alt_m * 3.28084,
    groundtrack_degT,
    groundspeed_kmph: 200,
  };
  return [
    { ...base, timeOffset: 0 },
    { ...base, timeOffset: 20 },
  ];
}

/** Build a ParticipantData record */
function makeParticipant(
  id: string,
  name: string,
  gps: GeodeticCoordinates,
  groundtrack_degT?: number,
): ParticipantData {
  return {
    userId: id,
    jumpLogId: `log-${id}`,
    name,
    color: '#ffffff',
    isBase: id === 'base',
    isVisible: true,
    timeSeries: makeTimeSeries(gps, groundtrack_degT),
  };
}

// ---------------------------------------------------------------------------
// Formation geometry: base heading south (180°), two wings 10m to each side
//
//    [left-wing]  ←10m→  [BASE]  ←10m→  [right-wing]
//                           ↓
//                      heading 180° (south)
//
// In NED terms with 180° ground track:
//   "right of track" = west = negative east
//   "left of track"  = east = positive east
// ---------------------------------------------------------------------------

const EXIT_ALT = 4000; // meters MSL
const TRACK = 180;     // heading south

const baseGPS = offsetGPS(DZ, 500, -300, EXIT_ALT - DZ.alt_m);

// Right wing: 10m to the right of base. On a 180° heading, right = west = -east
const rightWingGPS = offsetGPS(baseGPS, 0, -10, -3); // 10m right, 3m low
// Left wing: 10m to the left. On 180° heading, left = east = +east
const leftWingGPS = offsetGPS(baseGPS, 0, 10, 3);    // 10m left, 3m high

// ---------------------------------------------------------------------------
// Tests: GNSS → Base Exit Frame via projectFormationAtTime
//
// These validate the coordinate pipeline from GPS positions to base-frame
// output. The viewer renders base-frame positions directly in Three.js
// world space (via a fixed axis mapping), so the base-frame values are
// what determines what appears on screen.
// ---------------------------------------------------------------------------

describe('projectFormationAtTime: base-frame output', () => {

  describe('with jump run track provided', () => {
    const participants: ParticipantData[] = [
      makeParticipant('base', 'Riley', baseGPS, TRACK),
      makeParticipant('rw', 'Scott', rightWingGPS, TRACK),
      makeParticipant('lw', 'Russ', leftWingGPS, TRACK),
    ];

    test('base jumper is at origin', () => {
      const projected = projectFormationAtTime(
        participants, 10, 'base', DZ, 'GPS', TRACK);
      const base = projected.find(p => p.userId === 'base')!;

      expect(base.position.x).toBeCloseTo(0, 4);
      expect(base.position.y).toBeCloseTo(0, 4);
      expect(base.position.z).toBeCloseTo(0, 4);
    });

    test('right wing: positive y (lateral right), positive z (below)', () => {
      const projected = projectFormationAtTime(
        participants, 10, 'base', DZ, 'GPS', TRACK);
      const rw = projected.find(p => p.userId === 'rw')!;

      expect(rw.position.y).toBeCloseTo(10, 0);
      expect(rw.position.z).toBeCloseTo(3, 0);
      expect(Math.abs(rw.position.x)).toBeLessThan(1);
    });

    test('left wing: negative y (lateral left), negative z (above)', () => {
      const projected = projectFormationAtTime(
        participants, 10, 'base', DZ, 'GPS', TRACK);
      const lw = projected.find(p => p.userId === 'lw')!;

      expect(lw.position.y).toBeCloseTo(-10, 0);
      expect(lw.position.z).toBeCloseTo(-3, 0);
      expect(Math.abs(lw.position.x)).toBeLessThan(1);
    });

    test('jumper ahead on track has positive x (forward)', () => {
      const aheadGPS = offsetGPS(baseGPS, -50, 0, 0); // south = ahead on 180° heading
      const withAhead = [
        ...participants,
        makeParticipant('ahead', 'Ahead', aheadGPS, TRACK),
      ];

      const projected = projectFormationAtTime(
        withAhead, 10, 'base', DZ, 'GPS', TRACK);
      const ahead = projected.find(p => p.userId === 'ahead')!;

      expect(ahead.position.x).toBeCloseTo(50, 0);
      expect(Math.abs(ahead.position.y)).toBeLessThan(1);
      expect(Math.abs(ahead.position.z)).toBeLessThan(1);
    });
  });

  // -----------------------------------------------------------------------
  // jumpRunTrack_degT overrides per-sample groundtrack_degT.
  // Even when VTG data is missing (undefined per-sample track), providing
  // the jump run track at exit produces correct results.
  // -----------------------------------------------------------------------

  describe('jump run track overrides undefined per-sample ground track', () => {
    const participants: ParticipantData[] = [
      makeParticipant('base', 'Riley', baseGPS, undefined),
      makeParticipant('rw', 'Scott', rightWingGPS, undefined),
      makeParticipant('lw', 'Russ', leftWingGPS, undefined),
    ];

    test('lateral separation is correct despite undefined per-sample track', () => {
      const projected = projectFormationAtTime(
        participants, 10, 'base', DZ, 'GPS', TRACK);
      const rw = projected.find(p => p.userId === 'rw')!;
      const lw = projected.find(p => p.userId === 'lw')!;

      expect(rw.position.y).toBeCloseTo(10, 0);
      expect(lw.position.y).toBeCloseTo(-10, 0);
    });

    test('vertical separation is correct despite undefined per-sample track', () => {
      const projected = projectFormationAtTime(
        participants, 10, 'base', DZ, 'GPS', TRACK);
      const rw = projected.find(p => p.userId === 'rw')!;
      const lw = projected.find(p => p.userId === 'lw')!;

      expect(rw.position.z).toBeCloseTo(3, 0);
      expect(lw.position.z).toBeCloseTo(-3, 0);
    });
  });

  // -----------------------------------------------------------------------
  // Cross-device time alignment via timeSinceMidnight_sec
  //
  // Two jumpers at the same physical location, but their device log
  // timelines are offset by 1 second (russ's log started 1s later).
  // Without midnight-time alignment, raw timeOffset lookup would place
  // russ at a position 1 second stale.
  // -----------------------------------------------------------------------

  describe('cross-device time alignment via timeSinceMidnight_sec', () => {
    // Two GPS positions 50m apart along the jump run (south = forward on 180° heading)
    const posA = offsetGPS(DZ, 500, 0, EXIT_ALT - DZ.alt_m);
    const posB = offsetGPS(DZ, 450, 0, EXIT_ALT - DZ.alt_m); // 50m south (forward)

    // Scott's timeline: log started at midnight+50000s
    // At timeOffset=10 (midnightSec=50010), scott is at posA
    const scottSeries: TimeSeriesPoint[] = [
      { timeOffset: 0,  timeSinceMidnight_sec: 50000, location: posA, baroAlt_ft: 13000, groundtrack_degT: TRACK },
      { timeOffset: 10, timeSinceMidnight_sec: 50010, location: posA, baroAlt_ft: 13000, groundtrack_degT: TRACK },
      { timeOffset: 20, timeSinceMidnight_sec: 50020, location: posA, baroAlt_ft: 13000, groundtrack_degT: TRACK },
    ];

    // Russ's log started 1s later: his timeOffset=0 → midnightSec=50001
    // At timeOffset=9 (midnightSec=50010), russ is at posA (same spot as scott@10)
    // At timeOffset=10 (midnightSec=50011), russ has moved to posB
    const russSeries: TimeSeriesPoint[] = [
      { timeOffset: 0,  timeSinceMidnight_sec: 50001, location: posB, baroAlt_ft: 13000, groundtrack_degT: TRACK },
      { timeOffset: 9,  timeSinceMidnight_sec: 50010, location: posA, baroAlt_ft: 13000, groundtrack_degT: TRACK },
      { timeOffset: 10, timeSinceMidnight_sec: 50011, location: posB, baroAlt_ft: 13000, groundtrack_degT: TRACK },
      { timeOffset: 20, timeSinceMidnight_sec: 50021, location: posB, baroAlt_ft: 13000, groundtrack_degT: TRACK },
    ];

    const participants: ParticipantData[] = [
      { userId: 'scott', jumpLogId: 'log-scott', name: 'Scott', color: '#fff',
        isBase: true, isVisible: true, timeSeries: scottSeries },
      { userId: 'russ', jumpLogId: 'log-russ', name: 'Russ', color: '#f00',
        isBase: false, isVisible: true, timeSeries: russSeries },
    ];

    test('russ is aligned by midnight time, not raw timeOffset', () => {
      // At scott's timeOffset=10 (midnightSec=50010), russ should be at posA
      // (his timeOffset=9, midnightSec=50010), not posB (his timeOffset=10)
      const projected = projectFormationAtTime(
        participants, 10, 'scott', DZ, 'GPS', TRACK);
      const russ = projected.find(p => p.userId === 'russ')!;

      // Both at posA → positions should be nearly identical → near-zero offset
      expect(Math.abs(russ.position.x)).toBeLessThan(1);
      expect(Math.abs(russ.position.y)).toBeLessThan(1);
      expect(Math.abs(russ.position.z)).toBeLessThan(1);
    });

    test('interpolateAtMidnightTime finds correct position by midnight time', () => {
      // Look up russ at midnightSec=50010 → should return position at timeOffset=9
      const result = interpolateAtMidnightTime(russSeries, 50010);
      expect(result).not.toBeNull();
      expect(result!.timeOffset).toBeCloseTo(9, 5);
      // Position should match posA
      expect(result!.location.lat_deg).toBeCloseTo(posA.lat_deg, 6);
      expect(result!.location.lon_deg).toBeCloseTo(posA.lon_deg, 6);
    });

    test('interpolateAtMidnightTime interpolates between samples', () => {
      // midnightSec=50010.5 → halfway between russ's timeOffset=9 and timeOffset=10
      const result = interpolateAtMidnightTime(russSeries, 50010.5);
      expect(result).not.toBeNull();
      expect(result!.timeOffset).toBeCloseTo(9.5, 5);
    });

    test('interpolateAtMidnightTime returns null for empty series', () => {
      expect(interpolateAtMidnightTime([], 50010)).toBeNull();
    });

    test('interpolateAtMidnightTime returns null when no midnight times present', () => {
      const noMidnight: TimeSeriesPoint[] = [
        { timeOffset: 0, location: posA, baroAlt_ft: 13000 },
      ];
      expect(interpolateAtMidnightTime(noMidnight, 50010)).toBeNull();
    });

    test('without timeSinceMidnight_sec, raw timeOffset would show ~50m error', () => {
      // Strip midnight times to simulate the old behavior
      const noMidnight = participants.map(p => ({
        ...p,
        timeSeries: p.timeSeries.map(ts => {
          const { timeSinceMidnight_sec: _, ...rest } = ts;
          return rest;
        }),
      }));

      const projected = projectFormationAtTime(
        noMidnight, 10, 'scott', DZ, 'GPS', TRACK);
      const russ = projected.find(p => p.userId === 'russ')!;

      // Without sync, russ at timeOffset=10 is at posB, 50m from posA
      // In the base exit frame (heading 180°), 50m south = 50m forward
      expect(russ.position.x).toBeCloseTo(50, 0);
    });
  });

  // -----------------------------------------------------------------------
  // Same formation, different ground tracks — lateral should survive
  // -----------------------------------------------------------------------

  describe('lateral separation survives across ground track headings', () => {
    const tracks = [0, 45, 90, 135, 180, 225, 270, 315];

    test.each(tracks)('track %d°: wings have ≈10m lateral spread', (track) => {
      const rightRad = (track + 90) * Math.PI / 180;
      const rwGPS = offsetGPS(baseGPS, 10 * Math.cos(rightRad), 10 * Math.sin(rightRad), -3);
      const lwGPS = offsetGPS(baseGPS, -10 * Math.cos(rightRad), -10 * Math.sin(rightRad), 3);

      const parts: ParticipantData[] = [
        makeParticipant('base', 'Riley', baseGPS, track),
        makeParticipant('rw', 'Scott', rwGPS, track),
        makeParticipant('lw', 'Russ', lwGPS, track),
      ];

      const projected = projectFormationAtTime(
        parts, 10, 'base', DZ, 'GPS', track);
      const rw = projected.find(p => p.userId === 'rw')!;
      const lw = projected.find(p => p.userId === 'lw')!;

      expect(rw.position.y).toBeCloseTo(10, 0);
      expect(lw.position.y).toBeCloseTo(-10, 0);
    });
  });
});
