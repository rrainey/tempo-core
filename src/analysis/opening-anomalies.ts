// analysis/opening-anomalies.ts
//
// Detect abnormal parachute openings from the torso attitude series
// (torso-orientation.ts) plus GNSS track and IMU load. Working definitions
// (no formal industry definitions exist; see docs/event-algorithms.md):
//
// OFF-HEADING OPENING — the canopy's initial line of flight differs by more
// than 45° from the heading implied by the jumper's freefall body position.
// The implied heading is the direction the jumper would face if rotated
// belly-to-earth → head-up about the body Y axis: the horizontal projection
// of the torso −Z (feet-to-head) axis. Requires a stable body position in
// the seconds before deployment; a spinning or tumbling deployment is
// labeled INDETERMINATE instead.
//
// LINE TWIST — after deployment the jumper rotates through ≥ 360° of yaw
// with little accompanying change in ground track (the canopy flies on while
// the jumper spins beneath it). BENIGN when loads stay ordinary; AGGRESSIVE
// when the rotation coincides with sustained net acceleration ≥ 1.5 g.
//
// Measurement choices:
// - Headings compare TORSO YAW to TORSO YAW (pre vs. post deployment), not
//   ground track: wind displaces the track of a perfectly on-heading opening,
//   and a same-sensor difference ~30 s apart also cancels AHRS yaw drift and
//   any wind-crab error in the calibration. The ground-track version is
//   reported as a diagnostic.
// - The freefall implied heading is computed from the −Z axis projection
//   directly (NOT from ZYX Euler yaw, which is gimbal-degenerate at the
//   belly-to-earth pitch of −90°).

import { rotationFromEuler } from './torso-orientation';
import type { TorsoAttitude, TrackSample, ImuSample } from './torso-orientation';

const DEG = 180 / Math.PI;
const G_MPS2 = 9.80665;

export type LineTwistClass = 'none' | 'benign' | 'aggressive';

export interface OpeningAnalysis {
  /** False when the pre-deployment body position was too unstable to define
   *  an expected heading (off-heading is then not evaluated). */
  determinate: boolean;
  indeterminateReason?: string;

  // Off-heading opening
  freefallHeading_degT?: number;   // implied by body position before deployment
  canopyHeading_degT?: number;     // torso yaw once flying and settled
  offHeading_deg?: number;         // |wrapped difference|, 0..180
  offHeadingOpening?: boolean;     // offHeading_deg > threshold (default 45°)
  /** Diagnostic: same comparison made against the initial canopy GROUND
   *  track — wind-contaminated, but independent of the AHRS. */
  offHeadingVsTrack_deg?: number;

  // Line twist (evaluated even when off-heading is indeterminate)
  yawExcursion_deg: number;        // peak |unwrapped yaw − yaw at deployment|
  trackSpread_deg?: number;        // circular spread of ground track meanwhile
  peakLoad_g: number;              // max 1 s rolling mean load post-deployment
  lineTwist: LineTwistClass;

  /** Times used, for charting/inspection. */
  windows: {
    stability: [number, number];
    /** Earliest flyable heading — source of canopyHeading_degT. */
    immediate?: [number, number];
    /** First fully quiet flight — end of the twist-rotation window. */
    settle?: [number, number];
    twist: [number, number];
  };
}

export interface OpeningAnalysisOptions {
  offHeadingThreshold_deg?: number;   // default 45
  twistRotationThreshold_deg?: number; // default 360
  aggressiveLoadThreshold_g?: number; // default 1.5
  /** Pre-deployment stability window, seconds before deployment. */
  stabilityWindow?: [number, number]; // default [6, 2]
  maxHeadingSpread_deg?: number;      // stability gate, default 15
  minBellyPitch_deg?: number;         // gate: mean pitch must be ≤ this (default -45)
}

function wrap180(d: number): number {
  let x = d % 360;
  if (x > 180) x -= 360;
  if (x < -180) x += 360;
  return x;
}

function circularMean_deg(vals: number[]): number {
  let s = 0, c = 0;
  for (const v of vals) { s += Math.sin(v / DEG); c += Math.cos(v / DEG); }
  return ((Math.atan2(s, c) * DEG) + 360) % 360;
}

/** Circular standard deviation (deg) from the mean resultant length. */
function circularStd_deg(vals: number[]): number {
  let s = 0, c = 0;
  for (const v of vals) { s += Math.sin(v / DEG); c += Math.cos(v / DEG); }
  const R = Math.hypot(s, c) / vals.length;
  return Math.sqrt(Math.max(0, -2 * Math.log(Math.max(R, 1e-12)))) * DEG;
}

/**
 * Heading (deg true) implied by the freefall body position: the horizontal
 * projection of the torso −Z (feet-to-head) axis. Returns null when that
 * axis is near-vertical (projection too short to define a heading).
 */
export function impliedFreefallHeading_degT(a: TorsoAttitude): number | null {
  const R = rotationFromEuler(a.roll_deg, a.pitch_deg, a.yaw_degT);
  // torso −Z in NED = −(third column of R)
  const n = -R[0][2], e = -R[1][2];
  if (Math.hypot(n, e) < 0.3) return null;
  return ((Math.atan2(e, n) * DEG) + 360) % 360;
}

/** Unwrap a yaw series (deg) into a continuous curve. */
export function unwrapYaw_deg(yaw: number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < yaw.length; i++) {
    if (i > 0) acc += wrap180(yaw[i] - yaw[i - 1]);
    out.push((yaw[0] ?? 0) + acc);
  }
  return out;
}

export function analyzeOpening(
  attitude: TorsoAttitude[],
  track: TrackSample[],
  imu: ImuSample[],
  deploymentOffsetSec: number,
  activationOffsetSec?: number,
  options: OpeningAnalysisOptions = {},
): OpeningAnalysis | null {
  const offThresh = options.offHeadingThreshold_deg ?? 45;
  const twistThresh = options.twistRotationThreshold_deg ?? 360;
  const aggThresh = options.aggressiveLoadThreshold_g ?? 1.5;
  const [stabFrom, stabTo] = options.stabilityWindow ?? [6, 2];
  const maxSpread = options.maxHeadingSpread_deg ?? 15;
  const minBellyPitch = options.minBellyPitch_deg ?? -45;

  const deploy = deploymentOffsetSec;
  const inWin = (t: number, t0: number, t1: number) => t >= t0 && t <= t1;

  // ---- Pre-deployment stability & implied heading -------------------------
  const stabilityWindow: [number, number] = [deploy - stabFrom, deploy - stabTo];
  const pre = attitude.filter(a => inWin(a.t, stabilityWindow[0], stabilityWindow[1]));
  if (pre.length < 8) return null; // no usable attitude around deployment

  const impliedHeadings = pre
    .map(impliedFreefallHeading_degT)
    .filter((h): h is number => h !== null);
  const meanPitch = pre.reduce((s, a) => s + a.pitch_deg, 0) / pre.length;

  let determinate = true;
  let indeterminateReason: string | undefined;
  if (impliedHeadings.length < pre.length * 0.8) {
    determinate = false;
    indeterminateReason = 'head-to-feet axis near vertical before deployment (not belly-to-earth)';
  } else if (meanPitch > minBellyPitch) {
    determinate = false;
    indeterminateReason = `mean pre-deployment pitch ${meanPitch.toFixed(0)}° is not belly-to-earth`;
  } else if (circularStd_deg(impliedHeadings) > maxSpread) {
    determinate = false;
    indeterminateReason = `body heading unstable before deployment (spread ${circularStd_deg(impliedHeadings).toFixed(0)}°)`;
  }
  const freefallHeading = determinate ? circularMean_deg(impliedHeadings) : undefined;

  // ---- Post-opening windows ------------------------------------------------
  // Search from canopy activation (or deploy+6 when unknown) to deploy+25.
  const searchFrom = activationOffsetSec ?? deploy + 6;
  const searchTo = deploy + 25;

  const windowRate = (t0: number, len: number) => {
    const seg = attitude.filter(a => inWin(a.t, t0, t0 + len));
    if (seg.length < 6) return null;
    const yawU = unwrapYaw_deg(seg.map(a => a.yaw_degT));
    const dt = seg[seg.length - 1].t - seg[0].t || 1;
    return {
      seg,
      rate: Math.abs(yawU[yawU.length - 1] - yawU[0]) / dt,
      meanPitch: seg.reduce((s, a) => s + a.pitch_deg, 0) / seg.length,
    };
  };

  // "Immediate line of flight": the EARLIEST 2 s of flyable heading — yaw
  // rate under 40°/s (a line-twist spin is far faster; a deliberate post-
  // opening steer is slower but comes later, and taking the earliest window
  // keeps it out of the measurement).
  let immediate: [number, number] | undefined;
  let canopyHeading: number | undefined;
  for (let t0 = searchFrom; t0 + 2 <= searchTo; t0 += 0.5) {
    const w = windowRate(t0, 2);
    if (!w) continue;
    if (w.rate < 40 && w.meanPitch > -35) {
      immediate = [t0, t0 + 2];
      canopyHeading = circularMean_deg(w.seg.map(a => a.yaw_degT));
      break;
    }
  }

  // Fully settled flight (ends the twist-rotation window).
  let settle: [number, number] | undefined;
  for (let t0 = immediate ? immediate[0] : searchFrom; t0 + 3 <= searchTo; t0 += 0.5) {
    const w = windowRate(t0, 3);
    if (!w) continue;
    if (w.rate < 20 && w.meanPitch > -35) { settle = [t0, t0 + 3]; break; }
  }

  // ---- Off-heading verdict -------------------------------------------------
  let offHeading_deg: number | undefined;
  let offHeadingOpening: boolean | undefined;
  let offHeadingVsTrack_deg: number | undefined;
  if (determinate && freefallHeading !== undefined && canopyHeading !== undefined) {
    offHeading_deg = Math.abs(wrap180(canopyHeading - freefallHeading));
    offHeadingOpening = offHeading_deg > offThresh;
  }
  if (determinate && freefallHeading !== undefined && immediate) {
    const tks = track.filter(p => inWin(p.t, immediate![0], immediate![1]) && p.speed_mps > 2);
    if (tks.length >= 2) {
      offHeadingVsTrack_deg = Math.abs(wrap180(
        circularMean_deg(tks.map(p => p.track_degT)) - freefallHeading));
    }
  }

  // ---- Line twist ----------------------------------------------------------
  // Rotation is measured from deployment to the end of the settle window (or
  // deploy+20): peak |unwrapped yaw − yaw at deployment|.
  const twistWindow: [number, number] = [deploy, settle ? settle[1] : deploy + 20];
  const twistSeg = attitude.filter(a => inWin(a.t, twistWindow[0], twistWindow[1]));
  let yawExcursion_deg = 0;
  if (twistSeg.length >= 2) {
    const yawU = unwrapYaw_deg(twistSeg.map(a => a.yaw_degT));
    for (const y of yawU) yawExcursion_deg = Math.max(yawExcursion_deg, Math.abs(y - yawU[0]));
  }

  let trackSpread_deg: number | undefined;
  const twistTracks = track.filter(p => inWin(p.t, twistWindow[0], twistWindow[1]) && p.speed_mps > 2);
  if (twistTracks.length >= 3) trackSpread_deg = circularStd_deg(twistTracks.map(p => p.track_degT));

  // Peak 1 s rolling-mean load under the FLYING canopy: from activation (or
  // deploy+5, whichever is earlier) to the end of the twist window. Opening
  // shock and inflation loads are deliberately excluded — a hard opening is a
  // different anomaly.
  let peakLoad_g = 0;
  const loadStart = Math.min(activationOffsetSec ?? deploy + 5, deploy + 5);
  const loadSeg = imu.filter(s => inWin(s.t, loadStart, twistWindow[1]));
  for (let i = 0; i < loadSeg.length; i++) {
    let sum = 0, n = 0;
    for (let j = i; j < loadSeg.length && loadSeg[j].t <= loadSeg[i].t + 1; j++) {
      const s = loadSeg[j];
      sum += Math.sqrt(s.ax * s.ax + s.ay * s.ay + s.az * s.az); n++;
    }
    if (n >= 4) peakLoad_g = Math.max(peakLoad_g, sum / n / G_MPS2);
  }

  let lineTwist: LineTwistClass = 'none';
  if (yawExcursion_deg >= twistThresh) {
    // "little accompanying change in ground track" — a spiral (track rotating
    // with the jumper) is not a line twist. Spread unavailable ⇒ trust yaw.
    const trackQuiet = trackSpread_deg === undefined || trackSpread_deg < 60;
    if (trackQuiet) lineTwist = peakLoad_g >= aggThresh ? 'aggressive' : 'benign';
    else if (peakLoad_g >= aggThresh) lineTwist = 'aggressive'; // spinning canopy, loaded up
  }

  return {
    determinate,
    indeterminateReason,
    freefallHeading_degT: freefallHeading,
    canopyHeading_degT: canopyHeading,
    offHeading_deg,
    offHeadingOpening,
    offHeadingVsTrack_deg,
    yawExcursion_deg,
    trackSpread_deg,
    peakLoad_g,
    lineTwist,
    windows: { stability: stabilityWindow, immediate, settle, twist: twistWindow },
  };
}
