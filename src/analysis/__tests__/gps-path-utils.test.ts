// Tests for the descent-focused map framing (GNSSPathMap initial view).

import { calculateBounds, calculateDescentBounds } from '../gps-path-utils';
import type { GPSPoint } from '../log-parser';

function p(timestamp: number, latitude: number, longitude: number): GPSPoint {
  return { timestamp, latitude, longitude, altitude_ftAGL: 0 };
}

// A track: climb wanders far east, descent stays in a tight box, then a
// post-landing taxi point further west.
const CLIMB = [p(0, 33.40, -96.50), p(100, 33.60, -96.10)];
const DESCENT = [p(200, 33.44, -96.38), p(250, 33.45, -96.37), p(300, 33.46, -96.36)];
const LANDED = [p(400, 33.47, -96.55)];
const TRACK = [...CLIMB, ...DESCENT, ...LANDED];

describe('calculateDescentBounds', () => {
  it('frames only exit→landing points when both offsets are known', () => {
    expect(calculateDescentBounds(TRACK, 200, 300)).toEqual([
      -96.38, 33.44, -96.36, 33.46,
    ]);
  });

  it('extends to the end of the log when no landing offset is available', () => {
    expect(calculateDescentBounds(TRACK, 200, undefined)).toEqual([
      -96.55, 33.44, -96.36, 33.47,
    ]);
  });

  it('returns null without an exit offset (caller falls back to full track)', () => {
    expect(calculateDescentBounds(TRACK, undefined, 300)).toBeNull();
  });

  it('returns null when fewer than two descent points exist', () => {
    expect(calculateDescentBounds(TRACK, 299, 300)).toBeNull();
    expect(calculateDescentBounds([], 200, 300)).toBeNull();
  });

  it('descent bounds are a strict subset of the full-track bounds', () => {
    const full = calculateBounds(TRACK)!;
    const descent = calculateDescentBounds(TRACK, 200, 300)!;
    expect(descent[0]).toBeGreaterThanOrEqual(full[0]); // west
    expect(descent[1]).toBeGreaterThanOrEqual(full[1]); // south
    expect(descent[2]).toBeLessThanOrEqual(full[2]); // east
    expect(descent[3]).toBeLessThanOrEqual(full[3]); // north
  });
});
