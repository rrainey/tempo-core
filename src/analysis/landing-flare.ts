// analysis/landing-flare.ts
//
// Landing-flare profile: a side view of the final seconds of flight.
// X = distance along the FINAL-APPROACH ground track (feet, 0 at touchdown,
// negative on approach), Z = height above the touchdown point (feet). The
// ground track is rotated so X aligns with the average ground path of the
// last few seconds of flight — cross-track motion is projected out, which is
// exactly what a "notional profile" wants.
//
// Sources: GNSS fixes (position + VTG groundspeed in km/h — converted to
// STATUTE mph; the knots field of $GNVTG is never used), baro AGL for height
// (surface-referenced and far better behaved than GNSS altitude in ground
// effect), and IMU acceleration magnitude for load factor in g.

import type { GPSPoint, TimeSeriesPoint } from './log-parser';
import { kmphToMph } from './gps-path-utils';

const FT_PER_M = 3.28084;
const G = 9.81;

export interface FlareCallout {
  t: number;             // seconds, log time
  x_ft: number;          // along-approach distance (0 = touchdown)
  z_ft: number;          // height above touchdown point
  groundspeed_mph: number | null; // statute miles per hour
  load_g: number | null; // accel magnitude (load factor)
}

export interface FlareProfile {
  points: Array<{ t: number; x_ft: number; z_ft: number }>;
  callouts: FlareCallout[];
  approachHeading_degT: number; // mean final ground path, degrees true
  window_s: number;             // seconds of flight before touchdown shown
}

interface FlareOptions {
  windowS?: number;         // seconds before touchdown (default 18)
  postS?: number;           // seconds after touchdown to include (default 2)
  calloutCount?: number;    // evenly spaced in time (default 9)
  headingWindowS?: number;  // final segment defining the approach axis (default 6)
}

/** Linear interpolation of a {timestamp,value} series at time t. */
function interpSeries(series: TimeSeriesPoint[], t: number): number | null {
  if (series.length === 0) return null;
  if (t <= series[0].timestamp) return series[0].value;
  if (t >= series[series.length - 1].timestamp) return series[series.length - 1].value;
  let lo = 0, hi = series.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (series[mid].timestamp <= t) lo = mid; else hi = mid;
  }
  const a = series[lo], b = series[hi];
  const f = (t - a.timestamp) / (b.timestamp - a.timestamp || 1);
  return a.value + f * (b.value - a.value);
}

/** Mean of finite series values within [t0, t1]; null if none. */
function meanIn(series: TimeSeriesPoint[], t0: number, t1: number): number | null {
  let sum = 0, n = 0;
  for (const p of series) {
    if (p.timestamp >= t0 && p.timestamp <= t1 && Number.isFinite(p.value)) { sum += p.value; n++; }
  }
  return n ? sum / n : null;
}

export function buildFlareProfile(
  gps: GPSPoint[],
  baroAGL: TimeSeriesPoint[],
  accel: TimeSeriesPoint[],
  landingOffsetSec: number,
  opts: FlareOptions = {}
): FlareProfile | null {
  const windowS = opts.windowS ?? 18;
  const postS = opts.postS ?? 2;
  const calloutCount = opts.calloutCount ?? 9;
  const headingWindowS = opts.headingWindowS ?? 6;

  const t0 = landingOffsetSec - windowS;
  const t1 = landingOffsetSec + postS;
  const fixes = gps.filter(p => p.timestamp >= t0 && p.timestamp <= t1);
  if (fixes.length < 8 || baroAGL.length < 2) return null;

  // Local ENU meters (equirectangular — fine for <1 km) around the touchdown fix.
  const touchdown = fixes.reduce((best, p) =>
    Math.abs(p.timestamp - landingOffsetSec) < Math.abs(best.timestamp - landingOffsetSec) ? p : best);
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((touchdown.latitude * Math.PI) / 180);
  const east = (p: GPSPoint) => (p.longitude - touchdown.longitude) * mPerDegLon;
  const north = (p: GPSPoint) => (p.latitude - touchdown.latitude) * mPerDegLat;

  // Approach axis: displacement over the final headingWindowS before touchdown.
  const headStart = fixes.reduce((best, p) => {
    const target = landingOffsetSec - headingWindowS;
    return Math.abs(p.timestamp - target) < Math.abs(best.timestamp - target) ? p : best;
  });
  let ux = east(touchdown) - east(headStart);
  let uy = north(touchdown) - north(headStart);
  const mag = Math.hypot(ux, uy);
  if (mag < 3) {
    // nearly no ground penetration (deep brakes into wind): fall back to the
    // mean VTG ground track over the heading window
    const tracks = fixes
      .filter(p => p.timestamp >= landingOffsetSec - headingWindowS && p.groundTrack_degT != null)
      .map(p => p.groundTrack_degT as number);
    if (tracks.length === 0) return null;
    // circular mean
    let sx = 0, sy = 0;
    for (const d of tracks) { sx += Math.sin((d * Math.PI) / 180); sy += Math.cos((d * Math.PI) / 180); }
    ux = sx; uy = sy;
  }
  const norm = Math.hypot(ux, uy) || 1;
  ux /= norm; uy /= norm;
  const approachHeading_degT = ((Math.atan2(ux, uy) * 180) / Math.PI + 360) % 360;

  // Height is measured relative to the touchdown point so the profile floor
  // reads 0 even when the baro surface reference has drifted a few feet.
  const aglAtTouchdown = interpSeries(baroAGL, touchdown.timestamp) ?? 0;

  const along = (p: GPSPoint) => (east(p) * ux + north(p) * uy) * FT_PER_M;
  const height = (t: number) => {
    const agl = interpSeries(baroAGL, t);
    return agl === null ? null : agl - aglAtTouchdown;
  };

  const points = fixes
    .map(p => ({ t: p.timestamp, x_ft: along(p), z_ft: height(p.timestamp) }))
    .filter((p): p is { t: number; x_ft: number; z_ft: number } => p.z_ft !== null);

  // Callouts: evenly spaced in time from window start to touchdown.
  const callouts: FlareCallout[] = [];
  for (let i = 0; i < calloutCount; i++) {
    const t = landingOffsetSec - windowS + (i * windowS) / (calloutCount - 1);
    const fix = fixes.reduce((best, p) =>
      Math.abs(p.timestamp - t) < Math.abs(best.timestamp - t) ? p : best);
    const z = height(t);
    if (z === null) continue;
    const load = meanIn(accel, t - 0.3, t + 0.3);
    callouts.push({
      t,
      x_ft: along(fix),
      z_ft: z,
      groundspeed_mph: fix.groundspeed_kmph != null ? kmphToMph(fix.groundspeed_kmph) : null,
      load_g: load !== null ? load / G : null,
    });
  }

  return { points, callouts, approachHeading_degT, window_s: windowS };
}
