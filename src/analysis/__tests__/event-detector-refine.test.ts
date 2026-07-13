// Tests for IMU-based landing refinement (EventDetector.refineLandingWithIMU).
//
// Synthetic 10 Hz acceleration-magnitude series modeled on the observed
// touchdown signature (test-data/08-solo-bb-20260703): smooth canopy noise,
// a high-load but SMOOTH flare, an impulsive touchdown burst, then ground
// activity. The refiner must key on variability, not load.

import { EventDetector } from '../event-detector';
import type { ParsedLogData, TimeSeriesPoint } from '../log-parser';

const G = 9.81;
const RATE_HZ = 10;

/** Deterministic small-amplitude "noise" (no Math.random in tests). */
function wobble(t: number, amp: number): number {
  return amp * (Math.sin(7.3 * t) * 0.6 + Math.sin(13.1 * t + 1.0) * 0.4);
}

interface Shape {
  flareAt?: number; // smooth 2 s load ramp up to ~2 g
  impulseAt?: number; // touchdown burst + 3 s of ground activity
  exitAt?: number; // falling edge: 1 g aircraft -> ~0.45 g hill, slow rebuild
}

function makeAccel(start: number, end: number, shape: Shape): TimeSeriesPoint[] {
  const out: TimeSeriesPoint[] = [];
  for (let i = 0; i <= (end - start) * RATE_HZ; i++) {
    const t = start + i / RATE_HZ;
    let v = G + wobble(t, 0.3); // quiet canopy ride
    if (shape.flareAt !== undefined && t >= shape.flareAt && t < shape.flareAt + 2) {
      // smooth sustained load: adds mean, adds little short-window variance
      v += 9 * Math.sin((Math.PI * (t - shape.flareAt)) / 2);
    }
    if (shape.impulseAt !== undefined) {
      const dt = t - shape.impulseAt;
      if (dt >= 0 && dt < 0.3) v += 13 - 40 * dt; // sharp impact spike
      else if (dt >= 0.3 && dt < 3) v += wobble(t * 3.7, 4); // run-out / gathering
    }
    if (shape.exitAt !== undefined) {
      const dt = t - shape.exitAt;
      if (dt >= 0 && dt < 0.8) v -= (5.4 / 0.8) * dt; // the cliff
      else if (dt >= 0.8) v -= Math.max(0, 5.4 - 0.3 * (dt - 0.8)); // hill, slow rebuild
      v = Math.max(v, 1.0);
    }
    out.push({ timestamp: t, value: v });
  }
  return out;
}

function dataWith(acceleration: TimeSeriesPoint[]): ParsedLogData {
  return { acceleration } as unknown as ParsedLogData;
}

describe('EventDetector.refineLandingWithIMU', () => {
  it('moves the landing to the touchdown impulse', () => {
    const acc = makeAccel(935, 975, { flareAt: 950, impulseAt: 958.2 });
    const refined = EventDetector.refineLandingWithIMU(dataWith(acc), 957.0);
    expect(refined).toBeGreaterThanOrEqual(957.7);
    expect(refined).toBeLessThanOrEqual(958.5);
  });

  it('is not fooled by a smooth high-load flare', () => {
    const acc = makeAccel(935, 975, { flareAt: 950, impulseAt: 958.2 });
    const refined = EventDetector.refineLandingWithIMU(dataWith(acc), 951.0);
    // window includes the flare (949-952) but the first variance burst is the impact
    expect(refined).toBeGreaterThanOrEqual(957.7);
  });

  it('keeps the coarse time when no impulse exists in the window', () => {
    const acc = makeAccel(935, 975, { flareAt: 950 });
    expect(EventDetector.refineLandingWithIMU(dataWith(acc), 957.0)).toBe(957.0);
  });

  it('keeps the coarse time when IMU data is absent or sparse', () => {
    expect(EventDetector.refineLandingWithIMU(dataWith([]), 957.0)).toBe(957.0);
    const sparse = makeAccel(956, 957, {});
    expect(EventDetector.refineLandingWithIMU(dataWith(sparse), 957.0)).toBe(957.0);
  });

  it('never returns a time outside the search window', () => {
    // impulse well after the window must not be picked up
    const acc = makeAccel(935, 995, { impulseAt: 980 });
    expect(EventDetector.refineLandingWithIMU(dataWith(acc), 957.0)).toBe(957.0);
  });
});

describe('EventDetector.refineExitWithIMU', () => {
  it('moves a late coarse exit back to the departure edge', () => {
    const acc = makeAccel(795, 835, { exitAt: 812.0 });
    const refined = EventDetector.refineExitWithIMU(dataWith(acc), 814.6);
    expect(refined).toBeGreaterThanOrEqual(811.6);
    expect(refined).toBeLessThanOrEqual(812.6);
  });

  it('keeps the coarse time when there is no sub-G run in the window', () => {
    const acc = makeAccel(795, 835, {}); // level flight throughout
    expect(EventDetector.refineExitWithIMU(dataWith(acc), 814.6)).toBe(814.6);
  });

  it('keeps the coarse time when the window is already sub-G (no visible edge)', () => {
    // exit long before the window: coarse estimate pathologically late
    const acc = makeAccel(795, 845, { exitAt: 798.0 });
    expect(EventDetector.refineExitWithIMU(dataWith(acc), 830.0)).toBe(830.0);
  });

  it('keeps the coarse time when IMU data is absent or sparse', () => {
    expect(EventDetector.refineExitWithIMU(dataWith([]), 814.6)).toBe(814.6);
    const sparse = makeAccel(813, 815, {});
    expect(EventDetector.refineExitWithIMU(dataWith(sparse), 814.6)).toBe(814.6);
  });
});
