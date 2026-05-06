// analysis/fall-rate-series.ts
//
// Compute a per-sample fall rate time series (raw + density-calibrated mph)
// for the freefall analysis window (exit + 12s → deployment − 2s).
//
// Rate is recomputed from a centered ±0.5 s GNSS-altitude window so the
// quantization from consecutive-sample diffs (~2.24 mph at 10 Hz / 0.1 m
// altitude resolution) shrinks below visible noise (~0.22 mph). The
// per-entry rateOfDescent_fpm value used elsewhere is left untouched.

import type { ParsedLogData } from './log-parser';
import type { JumpEvents } from './event-detector';
import { calibrateFallRate } from '../formation/coordinates';

export interface FallRateSeriesPoint {
  time: number; // seconds from log start
  raw_mph: number | null;
  calibrated_mph: number | null;
}

export interface FallRateAnalysisWindow {
  startOffset: number;
  endOffset: number;
  duration: number;
}

export interface FallRateSeriesResult {
  series: FallRateSeriesPoint[];
  analysisWindow: FallRateAnalysisWindow;
}

const WINDOW_START_DELAY = 12; // seconds after exit
const WINDOW_END_MARGIN = 2;   // seconds before deployment
const RATE_WINDOW_HALF_SEC = 0.5;

/**
 * Compute the fall rate series for the given parsed log + detected events.
 * Returns null if exit or deployment were not detected, or if the analysis
 * window is invalid.
 */
export function computeFallRateSeries(
  data: ParsedLogData,
  events: JumpEvents,
): FallRateSeriesResult | null {
  if (events.exitOffsetSec == null || events.deploymentOffsetSec == null) {
    return null;
  }

  const windowStart = events.exitOffsetSec + WINDOW_START_DELAY;
  const windowEnd = events.deploymentOffsetSec - WINDOW_END_MARGIN;
  if (windowEnd <= windowStart) return null;

  type AltSample = { t: number; alt_m: number };
  const gnss: AltSample[] = [];
  for (const e of data.logEntries) {
    if (e.location !== null && !isNaN(e.location.alt_m)) {
      gnss.push({ t: e.timeOffset, alt_m: e.location.alt_m });
    }
  }

  const lowerBound = (target: number): number => {
    let lo = 0;
    let hi = gnss.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (gnss[mid].t < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const smoothedRate_mps = (t: number): number | null => {
    if (gnss.length < 2) return null;
    const iA = lowerBound(t - RATE_WINDOW_HALF_SEC);
    const iB = lowerBound(t + RATE_WINDOW_HALF_SEC);
    const a = iA < gnss.length ? gnss[iA] : null;
    const b = iB < gnss.length ? gnss[iB] : null;
    if (!a || !b || b.t <= a.t) return null;
    return -(b.alt_m - a.alt_m) / (b.t - a.t);
  };

  const series: FallRateSeriesPoint[] = [];
  for (const entry of data.logEntries) {
    if (entry.rateOfDescent_fpm === null) continue;
    const inWindow =
      entry.timeOffset >= windowStart &&
      entry.timeOffset <= windowEnd &&
      entry.rateOfDescent_fpm >= 0;
    if (inWindow) {
      const windowRate_mps = smoothedRate_mps(entry.timeOffset);
      const rate_mps = windowRate_mps ?? entry.rateOfDescent_fpm * 0.00508;
      const rawRate_mph = rate_mps * 2.23694;
      const altitude_ft = entry.baroAlt_ft ?? 7000;
      const calRate_mph = calibrateFallRate(rate_mps, altitude_ft);
      series.push({
        time: entry.timeOffset,
        raw_mph: rawRate_mph,
        calibrated_mph: calRate_mph,
      });
    } else {
      series.push({
        time: entry.timeOffset,
        raw_mph: null,
        calibrated_mph: null,
      });
    }
  }

  return {
    series,
    analysisWindow: {
      startOffset: Math.round(windowStart * 10) / 10,
      endOffset: Math.round(windowEnd * 10) / 10,
      duration: Math.round((windowEnd - windowStart) * 10) / 10,
    },
  };
}
