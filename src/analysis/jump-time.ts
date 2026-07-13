// analysis/jump-time.ts
//
// "Jump elapsed time": a display time base whose origin is the jumper's
// estimated exit (exit = 0 s; the climb is negative; deployment/landing are
// small positive numbers). The CANONICAL representation everywhere in the
// pipeline remains seconds-from-log-start; these helpers produce shifted
// COPIES for display only. When no exit was detected the origin is null and
// every helper returns its input unchanged (log time), per spec.
//
// Rule of thumb encoded here: shift INSTANTS (timestamps, event offsets,
// window bounds), never DURATIONS (dwell times, spans, sample rates).

import type { TimeSeriesPoint, GPSPoint } from './log-parser';
import type { JumpEvents } from './event-detector';
import type { FallRateAnalysisWindow } from './fall-rate-series';

/** The origin for jump time, or null when it cannot be inferred. */
export function jumpTimeOrigin(events: Pick<JumpEvents, 'exitOffsetSec'> | null | undefined): number | null {
  return events?.exitOffsetSec ?? null;
}

/** Subtract with millisecond rounding — bare IEEE-754 subtraction leaks
 *  artifacts like 235.29999999999995 into axis tick labels. */
function sub(t: number, origin: number): number {
  return Math.round((t - origin) * 1000) / 1000;
}

export function shiftTimeSeries(
  points: TimeSeriesPoint[], origin: number | null
): TimeSeriesPoint[] {
  if (origin === null || origin === 0) return points;
  return points.map(p => ({ ...p, timestamp: sub(p.timestamp, origin) }));
}

export function shiftGPSPoints(points: GPSPoint[], origin: number | null): GPSPoint[] {
  if (origin === null || origin === 0) return points;
  return points.map(p => ({ ...p, timestamp: sub(p.timestamp, origin) }));
}

/** Shift the *OffsetSec instants on a JumpEvents-like object; leaves
 *  altitudes, rates, and absolute UTC timestamps untouched. */
export function shiftEvents<T extends Partial<JumpEvents>>(events: T, origin: number | null): T {
  if (origin === null || origin === 0) return events;
  const shifted = { ...events };
  if (shifted.exitOffsetSec !== undefined) shifted.exitOffsetSec = sub(shifted.exitOffsetSec, origin);
  if (shifted.deploymentOffsetSec !== undefined) shifted.deploymentOffsetSec = sub(shifted.deploymentOffsetSec, origin);
  if (shifted.landingOffsetSec !== undefined) shifted.landingOffsetSec = sub(shifted.landingOffsetSec, origin);
  return shifted;
}

/** Shift window bounds; duration is a span and stays untouched. */
export function shiftAnalysisWindow(
  window: FallRateAnalysisWindow, origin: number | null
): FallRateAnalysisWindow {
  if (origin === null || origin === 0) return window;
  return {
    ...window,
    startOffset: sub(window.startOffset, origin),
    endOffset: sub(window.endOffset, origin),
  };
}

/** Shift any array of records carrying a `time` field (e.g. fall-rate series). */
export function shiftTimeField<T extends { time: number }>(
  points: T[], origin: number | null
): T[] {
  if (origin === null || origin === 0) return points;
  return points.map(p => ({ ...p, time: sub(p.time, origin) }));
}

/** Axis label matching the base in use. */
export function timeAxisLabel(origin: number | null): string {
  return origin !== null ? 'Time since exit (seconds)' : 'Time (seconds)';
}
