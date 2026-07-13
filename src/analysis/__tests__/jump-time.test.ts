// Tests for the jump-elapsed display time base (exit = t0).

import {
  jumpTimeOrigin, shiftTimeSeries, shiftGPSPoints, shiftEvents,
  shiftAnalysisWindow, shiftTimeField, timeAxisLabel,
} from '../jump-time';
import type { GPSPoint } from '../log-parser';

const SERIES = [
  { timestamp: 0, value: 1 },
  { timestamp: 870, value: 2 },
  { timestamp: 900, value: 3 },
];

describe('jump-time', () => {
  it('origin is the exit offset, or null when exit was not inferred', () => {
    expect(jumpTimeOrigin({ exitOffsetSec: 879 })).toBe(879);
    expect(jumpTimeOrigin({})).toBeNull();
    expect(jumpTimeOrigin(null)).toBeNull();
  });

  it('shifts instants: climb becomes negative, exit becomes zero', () => {
    const shifted = shiftTimeSeries(SERIES, 879);
    expect(shifted.map(p => p.timestamp)).toEqual([-879, -9, 21]);
    expect(shifted.map(p => p.value)).toEqual([1, 2, 3]); // values untouched
  });

  it('null origin is the identity (log time fallback)', () => {
    expect(shiftTimeSeries(SERIES, null)).toBe(SERIES);
    expect(shiftTimeField([{ time: 5 }], null)[0].time).toBe(5);
    expect(timeAxisLabel(null)).toBe('Time (seconds)');
  });

  it('shifts events consistently; exit lands exactly at 0', () => {
    const events = { exitOffsetSec: 879, deploymentOffsetSec: 946.9, landingOffsetSec: 1052.7 };
    const shifted = shiftEvents(events, 879);
    expect(shifted.exitOffsetSec).toBe(0);
    expect(shifted.deploymentOffsetSec).toBeCloseTo(67.9);
    expect(shifted.landingOffsetSec).toBeCloseTo(173.7);
    // absent offsets stay absent rather than becoming NaN
    const partial: { exitOffsetSec: number; landingOffsetSec?: number } = { exitOffsetSec: 879 };
    expect(shiftEvents(partial, 879).landingOffsetSec).toBeUndefined();
  });

  it('shifts window bounds but never the duration span', () => {
    const w = { startOffset: 891, endOffset: 944.9, duration: 53.9 };
    const shifted = shiftAnalysisWindow(w, 879);
    expect(shifted.startOffset).toBeCloseTo(12);
    expect(shifted.endOffset).toBeCloseTo(65.9);
    expect(shifted.duration).toBeCloseTo(53.9);
  });

  it('shifts GPS points preserving position fields', () => {
    const gps: GPSPoint[] = [
      { timestamp: 880, latitude: 33.45, longitude: -96.37, altitude_ftAGL: 12000 },
    ];
    const shifted = shiftGPSPoints(gps, 879);
    expect(shifted[0].timestamp).toBeCloseTo(1);
    expect(shifted[0].latitude).toBe(33.45);
  });

  it('labels the axis by the base in use', () => {
    expect(timeAxisLabel(879)).toBe('Time since exit (seconds)');
  });
});
