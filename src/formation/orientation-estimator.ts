// lib/formation/orientation-estimator.ts
//
// Estimates skydiver body orientation from AHRS quaternion data ($PIM2)
// and raw accelerometer data (KMLDataV1.accel_mps2).
//
// See docs/tempo-imu-orientation-estimation.md for algorithm design.

import type { KMLDataV1, IM2Packet } from '../analysis/dropkick-reader';
import type { JumpEvents } from '../analysis/event-detector';

// ─── Types ──────────────────────────────────────────────────────

export interface Quaternion {
  w: number;
  x: number;
  y: number;
  z: number;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface QuaternionSample {
  timeOffset: number;
  q: Quaternion;
}

export interface OrientationEstimate {
  q_D_to_B: Quaternion;          // Fixed rotation: Device frame → Body frame
  q_NED_to_R: Quaternion | null; // Heading correction: NED → AHRS reference frame
  quality: number;                // 0–1, based on orthogonality of raw axes
  freefallWindowUsed: [number, number];
  landingWindowUsed: [number, number];
}

// ─── Quaternion Math ────────────────────────────────────────────

function qMultiply(a: Quaternion, b: Quaternion): Quaternion {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

function qConjugate(q: Quaternion): Quaternion {
  return { w: q.w, x: -q.x, y: -q.y, z: -q.z };
}

function qNormalize(q: Quaternion): Quaternion {
  const len = Math.sqrt(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z);
  if (len < 1e-12) return { w: 1, x: 0, y: 0, z: 0 };
  return { w: q.w / len, x: q.x / len, y: q.y / len, z: q.z / len };
}

function qDot(a: Quaternion, b: Quaternion): number {
  return a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Rotate vector v by quaternion q: result = q ⊗ [0,v] ⊗ q*
 */
export function quaternionRotateVector(q: Quaternion, v: Vec3): Vec3 {
  const qv: Quaternion = { w: 0, x: v.x, y: v.y, z: v.z };
  const result = qMultiply(qMultiply(q, qv), qConjugate(q));
  return { x: result.x, y: result.y, z: result.z };
}

/**
 * Spherical linear interpolation between two quaternions.
 */
export function slerp(q1: Quaternion, q2: Quaternion, t: number): Quaternion {
  let dot = qDot(q1, q2);

  // Ensure shortest path
  let q2adj = q2;
  if (dot < 0) {
    q2adj = { w: -q2.w, x: -q2.x, y: -q2.y, z: -q2.z };
    dot = -dot;
  }

  // If quaternions are very close, use linear interpolation
  if (dot > 0.9995) {
    return qNormalize({
      w: q1.w + t * (q2adj.w - q1.w),
      x: q1.x + t * (q2adj.x - q1.x),
      y: q1.y + t * (q2adj.y - q1.y),
      z: q1.z + t * (q2adj.z - q1.z),
    });
  }

  const theta = Math.acos(Math.min(dot, 1));
  const sinTheta = Math.sin(theta);
  const w1 = Math.sin((1 - t) * theta) / sinTheta;
  const w2 = Math.sin(t * theta) / sinTheta;

  return qNormalize({
    w: w1 * q1.w + w2 * q2adj.w,
    x: w1 * q1.x + w2 * q2adj.x,
    y: w1 * q1.y + w2 * q2adj.y,
    z: w1 * q1.z + w2 * q2adj.z,
  });
}

// ─── Vector Math ────────────────────────────────────────────────

function vecAdd(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function vecScale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function vecDot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function vecCross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function vecLength(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function vecNormalize(v: Vec3): Vec3 {
  const len = vecLength(v);
  if (len < 1e-12) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

// ─── Body Axis Estimation ───────────────────────────────────────

/**
 * Gravity direction in the AHRS reference frame.
 *
 * Madgwick Fusion is configured for NED (North-East-Down) convention:
 * X=North, Y=East, Z=Down.  Gravity points along +Z.
 *
 * The AHRS quaternion q rotates from Earth (NED) → Sensor (Device).
 * We rotate this gravity vector into device frame to find where "down"
 * points in the device's coordinate system.
 */
const GRAVITY_IN_REF_FRAME: Vec3 = { x: 0, y: 0, z: 1 };

/**
 * Estimate body +X_b axis from stable freefall.
 *
 * During stable belly-to-earth freefall, body +X_b (out of chest) points
 * approximately straight down. The AHRS quaternion q(t) represents
 * Earth→Sensor. We rotate the gravity reference vector into device frame
 * via each quaternion sample, then average over the stable window.
 *
 * Returns the mean gravity direction in device frame (= body +X_b estimate).
 */
function estimateBodyXAxis(
  im2Packets: IM2Packet[],
  freefallWindow: [number, number]
): Vec3 | null {
  const [tStart, tEnd] = freefallWindow;

  // Filter packets within the freefall window
  const samples = im2Packets.filter(
    p => p.timeOffset !== undefined && p.timeOffset >= tStart && p.timeOffset <= tEnd
  );

  if (samples.length < 10) {
    console.warn(`[Orientation] Too few PIM2 samples in freefall window: ${samples.length}`);
    return null;
  }

  // Accumulate gravity direction in device frame
  let sum: Vec3 = { x: 0, y: 0, z: 0 };
  for (const s of samples) {
    // q represents Earth→Sensor (Fusion convention)
    const q: Quaternion = { w: s.q0, x: s.q1, y: s.q2, z: s.q3 };
    const gravInDevice = quaternionRotateVector(q, GRAVITY_IN_REF_FRAME);
    sum = vecAdd(sum, gravInDevice);
  }

  const mean = vecScale(sum, 1 / samples.length);
  const len = vecLength(mean);

  if (len < 0.3) {
    console.warn(`[Orientation] Freefall gravity vector too scattered: magnitude=${len.toFixed(3)}`);
    return null;
  }

  console.log(`[Orientation] Body +X_b from freefall (${samples.length} samples): mean magnitude=${len.toFixed(3)}`);
  return vecNormalize(mean);
}

/**
 * Estimate body +Z_b axis from prior-landing accelerometer data.
 *
 * Under canopy near landing (150–50 ft AGL), the jumper hangs approximately
 * upright. The accelerometer reads −g in the direction of body +Z_b (down
 * when standing). So: ẑ_b = normalize(−mean(accel)).
 *
 * Uses raw accelerometer data from KMLDataV1.accel_mps2 (already averaged
 * per GNSS interval), NOT the quaternion.
 */
function estimateBodyZAxis(
  kmlEntries: KMLDataV1[],
  landingWindow: [number, number]
): Vec3 | null {
  const [tStart, tEnd] = landingWindow;

  // Filter entries within the landing window that have accelerometer data
  const entries = kmlEntries.filter(
    e => e.timeOffset >= tStart && e.timeOffset <= tEnd && e.accel_mps2 !== null
  );

  if (entries.length < 5) {
    console.warn(`[Orientation] Too few accel samples in landing window: ${entries.length}`);
    return null;
  }

  // Accumulate accelerometer readings
  let sum: Vec3 = { x: 0, y: 0, z: 0 };
  for (const e of entries) {
    const a = e.accel_mps2!;
    sum = vecAdd(sum, a);
  }

  const mean = vecScale(sum, 1 / entries.length);

  // Verify roughly 1g magnitude (9.81 ± 3 m/s²)
  const mag = vecLength(mean);
  if (mag < 6 || mag > 13) {
    console.warn(`[Orientation] Accel magnitude out of range in landing window: ${mag.toFixed(2)} m/s²`);
    return null;
  }

  // Body +Z_b = normalize(−mean(accel))
  // Accelerometer reads −g in the gravity direction when quasi-steady
  const negMean = vecScale(mean, -1);
  console.log(`[Orientation] Body +Z_b from landing accel (${entries.length} samples): accel magnitude=${mag.toFixed(2)} m/s²`);
  return vecNormalize(negMean);
}

// ─── Axis Orthogonalization & Rotation Matrix ───────────────────

/**
 * Orthogonalize x̂ and ẑ body axes, prioritizing ẑ (more reliable).
 * Returns three orthonormal body axes in device frame.
 */
function orthogonalizeAxes(
  xRaw: Vec3,
  zRaw: Vec3
): { xHat: Vec3; yHat: Vec3; zHat: Vec3 } {
  // Keep ẑ as-is (directly from accelerometer, high confidence)
  const zHat = vecNormalize(zRaw);

  // Remove ẑ component from x̂ to enforce orthogonality
  const xPrime = vecAdd(xRaw, vecScale(zHat, -vecDot(xRaw, zHat)));
  const xHat = vecNormalize(xPrime);

  // Complete right-handed system: ŷ = ẑ × x̂
  const yHat = vecNormalize(vecCross(zHat, xHat));

  return { xHat, yHat, zHat };
}

/**
 * Convert three orthonormal column vectors (body axes in device frame)
 * to a quaternion representing the rotation from Device → Body frame.
 *
 * R_B→D = [x̂ | ŷ | ẑ] (columns = body axes in device coords)
 * R_D→B = R_B→D^T
 *
 * We convert R_D→B to a quaternion using Shepperd's method.
 */
function rotationMatrixToQuaternion(
  xHat: Vec3,
  yHat: Vec3,
  zHat: Vec3
): Quaternion {
  // R_D→B: rows are body axes in device coords
  // r[row][col]
  const r00 = xHat.x, r01 = xHat.y, r02 = xHat.z;
  const r10 = yHat.x, r11 = yHat.y, r12 = yHat.z;
  const r20 = zHat.x, r21 = zHat.y, r22 = zHat.z;

  const trace = r00 + r11 + r22;

  let w: number, x: number, y: number, z: number;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (r21 - r12) * s;
    y = (r02 - r20) * s;
    z = (r10 - r01) * s;
  } else if (r00 > r11 && r00 > r22) {
    const s = 2 * Math.sqrt(1 + r00 - r11 - r22);
    w = (r21 - r12) / s;
    x = 0.25 * s;
    y = (r01 + r10) / s;
    z = (r02 + r20) / s;
  } else if (r11 > r22) {
    const s = 2 * Math.sqrt(1 + r11 - r00 - r22);
    w = (r02 - r20) / s;
    x = (r01 + r10) / s;
    y = 0.25 * s;
    z = (r12 + r21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + r22 - r00 - r11);
    w = (r10 - r01) / s;
    x = (r02 + r20) / s;
    y = (r12 + r21) / s;
    z = 0.25 * s;
  }

  return qNormalize({ w, x, y, z });
}

// ─── Flight Window Detection ────────────────────────────────────

/**
 * Find the stable freefall window for +X_b estimation.
 * Default: exit+12s to min(exit+22s, deployment-20s).
 * Must have at least 3s of usable window.
 */
function getFreefallWindow(
  jumpEvents: JumpEvents
): [number, number] | null {
  if (jumpEvents.exitOffsetSec === undefined) return null;

  const start = jumpEvents.exitOffsetSec + 12;

  let end: number;
  if (jumpEvents.deploymentOffsetSec !== undefined) {
    end = Math.min(jumpEvents.exitOffsetSec + 22, jumpEvents.deploymentOffsetSec - 20);
  } else {
    end = jumpEvents.exitOffsetSec + 22;
  }

  if (end - start < 3) {
    console.warn(`[Orientation] Freefall window too short: ${(end - start).toFixed(1)}s`);
    return null;
  }

  return [start, end];
}

/**
 * Find the prior-landing window (150–50 ft AGL) for +Z_b estimation.
 * Scans KML entries for the altitude range using baroAlt_ft (AGL).
 */
function getLandingWindow(
  kmlEntries: KMLDataV1[]
): [number, number] | null {
  // Find entries in the 150–50 ft AGL range, searching from the end
  // (we want the final approach, not any earlier pass through this altitude)
  let windowStart: number | null = null;
  let windowEnd: number | null = null;

  // Scan backwards to find the last time we were in this altitude band
  for (let i = kmlEntries.length - 1; i >= 0; i--) {
    const alt = kmlEntries[i].baroAlt_ft;
    if (alt === null) continue;

    if (alt >= 50 && alt <= 150) {
      if (windowEnd === null) {
        windowEnd = kmlEntries[i].timeOffset;
      }
      windowStart = kmlEntries[i].timeOffset;
    } else if (windowEnd !== null) {
      // We've left the band — stop
      break;
    }
  }

  if (windowStart === null || windowEnd === null || windowEnd - windowStart < 2) {
    console.warn('[Orientation] Could not find adequate prior-landing window (150-50 ft AGL)');
    return null;
  }

  return [windowStart, windowEnd];
}

/**
 * Find the final-approach window for heading estimation.
 * Uses landing - 15s to landing - 5s: the jumper is on straight-in
 * final, stable, and not maneuvering.
 */
function getFinalApproachWindow(
  jumpEvents: JumpEvents
): [number, number] | null {
  if (jumpEvents.landingOffsetSec === undefined) return null;

  const start = jumpEvents.landingOffsetSec - 15;
  const end = jumpEvents.landingOffsetSec - 5;

  if (start < 0 || end - start < 3) {
    console.warn(`[Orientation] Final approach window too short or invalid`);
    return null;
  }

  return [start, end];
}

/**
 * Estimate the heading correction quaternion q_NED→R.
 *
 * During final approach (landing - 15s to landing - 5s), the jumper faces
 * into the direction of travel.  We compare:
 *   - Body +X_b heading in R-frame (from q_D→B ⊗ q_R→D)
 *   - GPS ground track heading (from $GNVTG, in NED)
 *
 * The difference is the yaw angle between R and NED.  q_NED→R is a
 * rotation about the gravity axis (NED +Z = down) by that offset.
 *
 * @param im2Packets   Raw $PIM2 quaternion samples with timeOffset
 * @param kmlEntries   Parsed log entries (for GPS ground track)
 * @param q_D_to_B     Estimated device-to-body rotation
 * @param jumpEvents   Detected jump events (for landing time)
 */
function estimateHeadingCorrection(
  im2Packets: IM2Packet[],
  kmlEntries: KMLDataV1[],
  q_D_to_B: Quaternion,
  jumpEvents: JumpEvents
): Quaternion | null {
  const window = getFinalApproachWindow(jumpEvents);
  if (!window) return null;

  const [tStart, tEnd] = window;
  console.log(`[Orientation] Final approach window: ${tStart.toFixed(1)}s to ${tEnd.toFixed(1)}s`);

  // Collect GPS ground track headings in the window
  const gpsHeadings: number[] = [];
  for (const e of kmlEntries) {
    if (e.timeOffset >= tStart && e.timeOffset <= tEnd &&
        e.groundtrack_degT !== null && e.groundtrack_degT !== undefined &&
        e.groundspeed_kmph !== null && e.groundspeed_kmph !== undefined &&
        e.groundspeed_kmph > 5) { // require meaningful ground speed
      gpsHeadings.push(e.groundtrack_degT);
    }
  }

  if (gpsHeadings.length < 3) {
    console.warn(`[Orientation] Too few GPS track samples in final approach: ${gpsHeadings.length}`);
    return null;
  }

  // Compute mean GPS heading (circular mean to handle 360°/0° wraparound)
  let sinSum = 0, cosSum = 0;
  for (const h of gpsHeadings) {
    const rad = h * Math.PI / 180;
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  }
  const gpsHeading_rad = Math.atan2(sinSum / gpsHeadings.length, cosSum / gpsHeadings.length);

  // Compute mean body +X_b heading in R-frame over the same window.
  // Body +X_b in R-frame = q_R→B* ⊗ [0, 1,0,0] ⊗ q_R→B, but it's easier
  // to compute q_R→B = q_D→B ⊗ q_R→D then rotate the +X unit vector.
  const pim2Samples = im2Packets.filter(
    p => p.timeOffset !== undefined && p.timeOffset >= tStart && p.timeOffset <= tEnd
  );

  if (pim2Samples.length < 10) {
    console.warn(`[Orientation] Too few PIM2 samples in final approach: ${pim2Samples.length}`);
    return null;
  }

  let bodyHdgSinSum = 0, bodyHdgCosSum = 0;
  let validCount = 0;
  const BODY_X: Vec3 = { x: 1, y: 0, z: 0 }; // +X_b in body frame

  for (const s of pim2Samples) {
    const q_R_to_D: Quaternion = { w: s.q0, x: s.q1, y: s.q2, z: s.q3 };
    const q_R_to_B = computeBodyOrientation(q_D_to_B, q_R_to_D);

    // Body +X_b in R-frame: rotate body X by inverse of q_R_to_B
    const q_B_to_R = qConjugate(q_R_to_B);
    const xInR = quaternionRotateVector(q_B_to_R, BODY_X);

    // Project onto horizontal plane (NED convention: X=North, Y=East, Z=Down)
    // Since R is gravity-aligned, its X-Y plane is horizontal
    const horizLen = Math.sqrt(xInR.x * xInR.x + xInR.y * xInR.y);
    if (horizLen < 0.1) continue; // nearly vertical, skip

    const hdg_rad = Math.atan2(xInR.y, xInR.x); // atan2(east, north) = heading from north
    bodyHdgSinSum += Math.sin(hdg_rad);
    bodyHdgCosSum += Math.cos(hdg_rad);
    validCount++;
  }

  if (validCount < 5) {
    console.warn(`[Orientation] Too few valid heading samples: ${validCount}`);
    return null;
  }

  const bodyHeading_rad = Math.atan2(bodyHdgSinSum / validCount, bodyHdgCosSum / validCount);

  // The yaw offset: how much to rotate R about its Z-axis (down) to align with NED
  const yawOffset_rad = gpsHeading_rad - bodyHeading_rad;

  console.log(
    `[Orientation] Heading correction: GPS=${(gpsHeading_rad * 180 / Math.PI).toFixed(1)}°, ` +
    `body-in-R=${(bodyHeading_rad * 180 / Math.PI).toFixed(1)}°, ` +
    `yaw offset=${(yawOffset_rad * 180 / Math.PI).toFixed(1)}° ` +
    `(${gpsHeadings.length} GPS, ${validCount} PIM2 samples)`
  );

  // q_NED→R is a rotation about the Z-axis (down in NED) by -yawOffset.
  // q = [cos(θ/2), 0, 0, sin(θ/2)] for rotation about Z by θ.
  // We want to rotate FROM NED TO R, which is by -yawOffset.
  const halfAngle = -yawOffset_rad / 2;
  return qNormalize({
    w: Math.cos(halfAngle),
    x: 0,
    y: 0,
    z: Math.sin(halfAngle),
  });
}

// ─── Main Entry Point ───────────────────────────────────────────

/**
 * Estimate body orientation (R_Device→Body) from AHRS quaternion data
 * and raw accelerometer data.
 *
 * Returns the fixed rotation q_D→B plus quality metrics,
 * or null if estimation fails.
 */
export function estimateOrientation(
  im2Packets: IM2Packet[],
  kmlEntries: KMLDataV1[],
  jumpEvents: JumpEvents
): OrientationEstimate | null {
  // Step 1: Determine flight phase windows
  const freefallWindow = getFreefallWindow(jumpEvents);
  if (!freefallWindow) {
    console.warn('[Orientation] No usable freefall window — skipping orientation estimation');
    return null;
  }

  const landingWindow = getLandingWindow(kmlEntries);
  if (!landingWindow) {
    console.warn('[Orientation] No usable landing window — skipping orientation estimation');
    return null;
  }

  console.log(`[Orientation] Freefall window: ${freefallWindow[0].toFixed(1)}s to ${freefallWindow[1].toFixed(1)}s`);
  console.log(`[Orientation] Landing window: ${landingWindow[0].toFixed(1)}s to ${landingWindow[1].toFixed(1)}s`);

  // Step 2: Estimate body axes in device frame
  const xRaw = estimateBodyXAxis(im2Packets, freefallWindow);
  if (!xRaw) return null;

  const zRaw = estimateBodyZAxis(kmlEntries, landingWindow);
  if (!zRaw) return null;

  // Step 3: Quality metric — angle between raw axes should be ~90°
  const rawDot = Math.abs(vecDot(xRaw, zRaw));
  const angleDeg = Math.acos(Math.min(rawDot, 1)) * 180 / Math.PI;
  const deviationFrom90 = Math.abs(90 - angleDeg);
  const quality = Math.max(0, Math.min(1, 1 - deviationFrom90 / 30));

  console.log(`[Orientation] Raw axis angle: ${angleDeg.toFixed(1)}° (ideal=90°), quality=${quality.toFixed(2)}`);

  if (quality < 0.1) {
    console.warn('[Orientation] Quality too low — axes nearly parallel, skipping');
    return null;
  }

  // Step 4: Orthogonalize and build rotation matrix → quaternion
  const { xHat, yHat, zHat } = orthogonalizeAxes(xRaw, zRaw);
  const q_D_to_B = rotationMatrixToQuaternion(xHat, yHat, zHat);

  console.log(`[Orientation] Estimated q_D→B: w=${q_D_to_B.w.toFixed(4)}, x=${q_D_to_B.x.toFixed(4)}, y=${q_D_to_B.y.toFixed(4)}, z=${q_D_to_B.z.toFixed(4)}`);

  // Step 5: Heading correction — solve yaw offset between R and NED
  // using GPS ground track during final approach
  const q_NED_to_R = estimateHeadingCorrection(im2Packets, kmlEntries, q_D_to_B, jumpEvents);
  if (q_NED_to_R) {
    console.log(`[Orientation] Estimated q_NED→R: w=${q_NED_to_R.w.toFixed(4)}, x=${q_NED_to_R.x.toFixed(4)}, y=${q_NED_to_R.y.toFixed(4)}, z=${q_NED_to_R.z.toFixed(4)}`);
  } else {
    console.warn('[Orientation] Heading correction unavailable — orientation will have arbitrary heading');
  }

  return {
    q_D_to_B,
    q_NED_to_R,
    quality,
    freefallWindowUsed: freefallWindow,
    landingWindowUsed: landingWindow,
  };
}

// ─── Human-Assisted Orientation Estimation ─────────────────────

/**
 * Result of human-assisted orientation calibration.
 * q_ref is the AHRS quaternion at calibration time.  Orientation at any
 * time t is the relative rotation: q_R_to_D(t) ⊗ conj(q_ref).
 * At t_cal this gives identity — the mesh's belly-down default pose.
 */
export interface HumanAssistedCalibration {
  q_ref: Quaternion;              // q_R_to_D at calibration time
  calibrationTimeOffset: number;
}

/**
 * Perform human-assisted orientation calibration.
 *
 * The user asserts that at calibrationTimeOffset, all jumpers are in
 * stable belly-to-earth freefall.  We record the AHRS quaternion at
 * that moment as the reference.  Orientation at any time t is then
 * the relative rotation from calibration:
 *
 *   orientation_q(t) = q_R_to_D(t) ⊗ conj(q_ref)
 *
 * At t_cal this yields identity — the mesh's belly-down default pose.
 * At other times it tracks how the device (and body) have rotated
 * relative to that belly-down reference.
 *
 * The accel vector is used to validate the calibration point (confirm
 * the jumper is in steady flight with ~1g reading).
 */
export function calibrateOrientationHumanAssisted(
  kmlEntries: KMLDataV1[],
  im2Packets: IM2Packet[],
  calibrationTimeOffset: number,
): HumanAssistedCalibration | null {
  // Validate: check accel magnitude near calibration time
  const accelEntries = kmlEntries.filter(
    e => e.accel_mps2 !== null &&
         e.timeOffset >= calibrationTimeOffset - 0.5 &&
         e.timeOffset <= calibrationTimeOffset + 0.5
  );

  if (accelEntries.length > 0) {
    let accelSum: Vec3 = { x: 0, y: 0, z: 0 };
    for (const e of accelEntries) {
      accelSum = vecAdd(accelSum, e.accel_mps2!);
    }
    const meanAccel = vecScale(accelSum, 1 / accelEntries.length);
    const mag = vecLength(meanAccel);
    console.log(
      `[Orientation] Human-assisted: accel at t=${calibrationTimeOffset.toFixed(1)}s ` +
      `(${accelEntries.length} samples): magnitude=${mag.toFixed(2)} m/s² ` +
      `(expect ~9.8 for stable freefall at terminal)`
    );
    if (mag < 4) {
      console.warn(`[Orientation] Accel magnitude very low (${mag.toFixed(1)} m/s²) — ` +
        `jumper may not be at terminal velocity yet`);
    }
  }

  // Get AHRS quaternion at calibration time (interpolate PIM2)
  const sorted = im2Packets
    .filter(p => p.timeOffset !== undefined)
    .sort((a, b) => a.timeOffset! - b.timeOffset!);

  if (sorted.length < 2) {
    console.warn('[Orientation] Insufficient PIM2 data for calibration');
    return null;
  }

  let before = sorted[0];
  let after = sorted[1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].timeOffset! <= calibrationTimeOffset &&
        sorted[i + 1].timeOffset! > calibrationTimeOffset) {
      before = sorted[i];
      after = sorted[i + 1];
      break;
    }
  }

  const dt = after.timeOffset! - before.timeOffset!;
  const t = dt > 0 ? (calibrationTimeOffset - before.timeOffset!) / dt : 0;
  const q_before: Quaternion = { w: before.q0, x: before.q1, y: before.q2, z: before.q3 };
  const q_after: Quaternion = { w: after.q0, x: after.q1, y: after.q2, z: after.q3 };
  const q_ref = slerp(q_before, q_after, t);

  console.log(
    `[Orientation] Human-assisted calibration: q_ref at t=${calibrationTimeOffset.toFixed(1)}s: ` +
    `w=${q_ref.w.toFixed(4)}, x=${q_ref.x.toFixed(4)}, y=${q_ref.y.toFixed(4)}, z=${q_ref.z.toFixed(4)}`
  );

  return { q_ref, calibrationTimeOffset };
}

/**
 * Belly-to-earth rotation in the Base Frame.
 *
 * The mesh at identity is a standing person (chest→+X, head→-Z).
 * During stable belly-to-earth freefall, the chest points toward +Z (earth/down).
 * This is a -90° pitch about the +Y axis (right):
 *   +X (chest) → +Z (down)
 *   -Z (head)  → +X (forward along track)
 */
const Q_BELLY_DOWN: Quaternion = {
  w: Math.cos(-Math.PI / 4),  // cos(-45°) = 0.7071
  x: 0,
  y: Math.sin(-Math.PI / 4),  // sin(-45°) = -0.7071
  z: 0,
};

/**
 * Interpolate PIM2 quaternions to time points using human-assisted calibration.
 *
 * The mesh identity pose is standing (chest→+X).  At calibration time the
 * jumper is belly-to-earth, so we premultiply by Q_BELLY_DOWN.  The AHRS
 * relative rotation from calibration tracks further attitude changes.
 *
 *   orientation_q(t) = Q_BELLY_DOWN ⊗ q_R_to_D(t) ⊗ conj(q_ref)
 *
 * At t_cal: Q_BELLY_DOWN ⊗ identity = Q_BELLY_DOWN (belly-to-earth pose).
 * At other times: AHRS-tracked rotation composes on top.
 * Heading (yaw) is resolved by the user's azimuth wheel on the client.
 */
export function interpolateQuaternionsHumanAssisted(
  im2Packets: IM2Packet[],
  targetTimeOffsets: number[],
  q_ref: Quaternion
): QuaternionSample[] {
  const sorted = im2Packets
    .filter(p => p.timeOffset !== undefined)
    .sort((a, b) => a.timeOffset! - b.timeOffset!);

  if (sorted.length < 2) return [];

  const q_ref_inv = qConjugate(q_ref);
  const results: QuaternionSample[] = [];

  for (const targetT of targetTimeOffsets) {
    if (targetT < sorted[0].timeOffset! || targetT > sorted[sorted.length - 1].timeOffset!) {
      continue;
    }

    let before = sorted[0];
    let after = sorted[1];
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].timeOffset! <= targetT && sorted[i + 1].timeOffset! > targetT) {
        before = sorted[i];
        after = sorted[i + 1];
        break;
      }
    }

    const dt = after.timeOffset! - before.timeOffset!;
    const t = dt > 0 ? (targetT - before.timeOffset!) / dt : 0;

    const q_before: Quaternion = { w: before.q0, x: before.q1, y: before.q2, z: before.q3 };
    const q_after: Quaternion = { w: after.q0, x: after.q1, y: after.q2, z: after.q3 };
    const q_R_to_D = slerp(q_before, q_after, t);

    // AHRS-relative rotation from calibration pose
    const q_delta = qNormalize(qMultiply(q_R_to_D, q_ref_inv));

    // Premultiply belly-down: at t_cal this gives the belly-down pose,
    // at other times the AHRS delta composes on top.
    const q_out = qNormalize(qMultiply(Q_BELLY_DOWN, q_delta));

    results.push({ timeOffset: targetT, q: q_out });
  }

  return results;
}

// ─── Shared Utilities ──────────────────────────────────────────

/**
 * Compute body orientation quaternion at a given time.
 *
 * q_R→B(t) = q_D→B ⊗ q_R→D(t)
 *
 * The AHRS quaternion q(t) from $PIM2 represents Earth→Sensor (R→D).
 * We chain it with the fixed q_D→B to get the body orientation relative
 * to the AHRS reference frame.
 */
export function computeBodyOrientation(
  q_D_to_B: Quaternion,
  q_R_to_D: Quaternion
): Quaternion {
  return qNormalize(qMultiply(q_D_to_B, q_R_to_D));
}

/**
 * Construct a quaternion representing a rotation about the NED Z-axis (down)
 * by a given angle in degrees.  Used for the NED→BaseExitFrame yaw rotation.
 */
function yawQuaternion(angle_deg: number): Quaternion {
  const halfAngle = (angle_deg * Math.PI / 180) / 2;
  return { w: Math.cos(halfAngle), x: 0, y: 0, z: Math.sin(halfAngle) };
}

/**
 * Interpolate quaternion samples from $PIM2 onto GNSS time points,
 * producing body orientation in the Base Exit Frame.
 *
 * Full chain:
 *   q_BEF→B(t) = q_D→B ⊗ q_R→D(t) ⊗ q_NED→R ⊗ q_BEF→NED
 *
 * Where q_BEF→NED is a yaw rotation by the jump run track angle
 * (the Base Exit Frame X-axis is aligned with the aircraft track,
 * while NED X-axis is North).
 *
 * If q_NED_to_R is null (heading correction unavailable), the output
 * is q_R→B — correct pitch/roll but arbitrary heading.
 */
export function interpolateQuaternionsToTimePoints(
  im2Packets: IM2Packet[],
  targetTimeOffsets: number[],
  q_D_to_B: Quaternion,
  q_NED_to_R: Quaternion | null,
  jumpRunTrack_degT: number
): QuaternionSample[] {
  // Filter to packets with valid timeOffset, sorted by time
  const sorted = im2Packets
    .filter(p => p.timeOffset !== undefined)
    .sort((a, b) => a.timeOffset! - b.timeOffset!);

  if (sorted.length < 2) return [];

  // Pre-compute the fixed portion of the chain.
  // q_BEF→NED: Base Exit Frame to NED is a yaw by the jump run track angle.
  // The BEF X-axis points along the track heading; NED X-axis points North.
  // So NED = rotate BEF by +track angle about Z (down).
  // Therefore BEF→NED = yaw(+track), and NED→BEF = yaw(-track).
  const q_BEF_to_NED = yawQuaternion(jumpRunTrack_degT);

  // The fixed suffix applied after each q_R→D(t):
  //   suffix = q_NED→R ⊗ q_BEF→NED   (if heading correction available)
  //   suffix = identity               (if not — output stays in R-frame)
  let suffix: Quaternion | null = null;
  if (q_NED_to_R) {
    suffix = qNormalize(qMultiply(q_NED_to_R, q_BEF_to_NED));
  }

  const results: QuaternionSample[] = [];

  for (const targetT of targetTimeOffsets) {
    // Find bracketing samples
    if (targetT < sorted[0].timeOffset! || targetT > sorted[sorted.length - 1].timeOffset!) {
      continue; // Outside PIM2 data range
    }

    let before = sorted[0];
    let after = sorted[1];

    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].timeOffset! <= targetT && sorted[i + 1].timeOffset! > targetT) {
        before = sorted[i];
        after = sorted[i + 1];
        break;
      }
    }

    // SLERP the raw AHRS quaternion
    const dt = after.timeOffset! - before.timeOffset!;
    const t = dt > 0 ? (targetT - before.timeOffset!) / dt : 0;

    const q_R_to_D_before: Quaternion = { w: before.q0, x: before.q1, y: before.q2, z: before.q3 };
    const q_R_to_D_after: Quaternion = { w: after.q0, x: after.q1, y: after.q2, z: after.q3 };

    const q_R_to_D = slerp(q_R_to_D_before, q_R_to_D_after, t);

    // Chain: q_D→B ⊗ q_R→D(t) ⊗ suffix
    let q_out = computeBodyOrientation(q_D_to_B, q_R_to_D);
    if (suffix) {
      q_out = qNormalize(qMultiply(q_out, suffix));
    }

    results.push({ timeOffset: targetT, q: q_out });
  }

  return results;
}
