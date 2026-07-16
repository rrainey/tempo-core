// analysis/torso-orientation.ts
//
// Estimate the jumper's torso attitude from the Tempo-BT IMU stream.
//
// The device rides in a chest pocket, so the IMU frame is (approximately)
// rigid with respect to the torso, with its flat-face normal (IMU ±Z)
// pointing fore/aft. Two constant transforms make the logged AHRS
// quaternions ($PIM2) meaningful:
//
//   R(T←IMU)  how the device sits in the pocket. Determined by the classical
//             TRIAD method over a calibration window of quiet, unaccelerated
//             canopy flight: torso-down = -(mean specific force), and
//             torso-forward = the IMU ±Z axis projected onto the horizontal.
//   ψ         the AHRS yaw offset. The firmware Fusion AHRS runs NED with the
//             magnetometer disabled, so its pitch/roll are gravity-corrected
//             but its "north" is arbitrary and drifts with gyro bias. The
//             GNSS ground track over the calibration window pins it.
//
// Torso attitude at any time t is then
//   R(NED←T)(t) = Rz(ψ) · R(E←IMU)(t from $PIM2) · R(T←IMU)ᵀ
//
// Torso frame convention: X forward (out of the chest when upright), Y right,
// Z down (head-to-feet). "Upright facing travel" is defined by the harness-
// suspended posture during the calibration window, so any recline under
// canopy is baked into the reference. Belly-to-earth freefall reads
// pitch ≈ -90°; that expectation also disambiguates the ±Z pocket sign.
//
// Known bias: the ground track equals the torso heading only in zero wind
// (crab angle otherwise). See docs/event-algorithms.md future work.
//
// Dependency-free on purpose (like nmea-hygiene.ts) so jest can load it
// without the geodesy ESM chain.

export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3]; // row-major

const G_MPS2 = 9.80665;
const DEG = 180 / Math.PI;

// ---------------------------------------------------------------------------
// Small linear-algebra kit
// ---------------------------------------------------------------------------

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function norm(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

export function normalize(a: Vec3): Vec3 {
  const n = norm(a);
  return [a[0] / n, a[1] / n, a[2] / n];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function matVec(m: Mat3, v: Vec3): Vec3 {
  return [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
}

export function matMul(a: Mat3, b: Mat3): Mat3 {
  const r: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return r as Mat3;
}

export function transpose(m: Mat3): Mat3 {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ];
}

export function rotZ(deg: number): Mat3 {
  const c = Math.cos(deg / DEG), s = Math.sin(deg / DEG);
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}

/** Angle (deg) of the rotation represented by R. */
export function rotationAngle_deg(m: Mat3): number {
  const tr = m[0][0] + m[1][1] + m[2][2];
  return Math.acos(Math.min(1, Math.max(-1, (tr - 1) / 2))) * DEG;
}

/**
 * Rotation matrix from a unit quaternion (w, x, y, z). With the firmware's
 * Fusion AHRS (NED convention, sensor-relative-to-earth), this maps
 * sensor-frame vectors into the AHRS earth frame: v_e = R · v_s.
 */
export function quatToMat(w: number, x: number, y: number, z: number): Mat3 {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}

/** Inverse of quatToMat, for synthesizing test streams. Returns [w,x,y,z]. */
export function matToQuat(m: Mat3): [number, number, number, number] {
  const tr = m[0][0] + m[1][1] + m[2][2];
  let w: number, x: number, y: number, z: number;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = s / 4;
    x = (m[2][1] - m[1][2]) / s;
    y = (m[0][2] - m[2][0]) / s;
    z = (m[1][0] - m[0][1]) / s;
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    w = (m[2][1] - m[1][2]) / s;
    x = s / 4;
    y = (m[0][1] + m[1][0]) / s;
    z = (m[0][2] + m[2][0]) / s;
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    w = (m[0][2] - m[2][0]) / s;
    x = (m[0][1] + m[1][0]) / s;
    y = s / 4;
    z = (m[1][2] + m[2][1]) / s;
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    w = (m[1][0] - m[0][1]) / s;
    x = (m[0][2] + m[2][0]) / s;
    y = (m[1][2] + m[2][1]) / s;
    z = s / 4;
  }
  return [w, x, y, z];
}

/**
 * Aerospace ZYX Euler angles from R(NED←body): yaw about Z (deg true),
 * pitch about Y, roll about X.
 */
export function eulerFromMatrix(m: Mat3): { roll_deg: number; pitch_deg: number; yaw_deg: number } {
  const pitch = -Math.asin(Math.min(1, Math.max(-1, m[2][0])));
  const roll = Math.atan2(m[2][1], m[2][2]);
  let yaw = Math.atan2(m[1][0], m[0][0]);
  if (yaw < 0) yaw += 2 * Math.PI;
  return { roll_deg: roll * DEG, pitch_deg: pitch * DEG, yaw_deg: yaw * DEG };
}

/** R(NED←body) from aerospace ZYX Euler angles — inverse of eulerFromMatrix. */
export function rotationFromEuler(roll_deg: number, pitch_deg: number, yaw_deg: number): Mat3 {
  const cr = Math.cos(roll_deg / DEG), sr = Math.sin(roll_deg / DEG);
  const cp = Math.cos(pitch_deg / DEG), sp = Math.sin(pitch_deg / DEG);
  const cy = Math.cos(yaw_deg / DEG), sy = Math.sin(yaw_deg / DEG);
  return [
    [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
    [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
    [-sp, cp * sr, cp * cr],
  ];
}

/** Yaw (deg) of the closest pure-Z rotation to R, and the residual tilt (deg). */
export function yawAndTiltResidual(m: Mat3): { yaw_deg: number; tilt_deg: number } {
  const yaw = Math.atan2(m[1][0] - m[0][1], m[0][0] + m[1][1]);
  const residual = matMul(rotZ(-yaw * DEG), m);
  return { yaw_deg: yaw * DEG, tilt_deg: rotationAngle_deg(residual) };
}

// ---------------------------------------------------------------------------
// Input sample types (plain data; callers adapt reader packets to these)
// ---------------------------------------------------------------------------

/** One raw $PIMU sample. t = seconds from log start; accel m/s²; gyro rad/s. */
export interface ImuSample {
  t: number;
  ax: number; ay: number; az: number;
  gx: number; gy: number; gz: number;
}

/** One GNSS velocity sample (from VTG/fix). */
export interface TrackSample {
  t: number;
  track_degT: number;
  speed_mps: number;
}

/** One $PIM2 AHRS quaternion sample (w, x, y, z). */
export interface QuatSample {
  t: number;
  w: number; x: number; y: number; z: number;
}

// ---------------------------------------------------------------------------
// Calibration-window search
// ---------------------------------------------------------------------------

export interface CalibrationWindow {
  t0: number;
  t1: number;
  score: number;
  meanF_imu: Vec3;          // mean specific force in the IMU frame (m/s²)
  meanTrack_degT: number;   // circular-mean ground track
  meanSpeed_mps: number;
  stats: {
    fMagMean_mps2: number;  // mean |f| — want ≈ 9.81
    fMagStd_mps2: number;   // pendulum / turbulence indicator
    gyroRms_rps: number;    // residual rotation
    trackStd_deg: number;   // ground-track linearity
    nImu: number;
    nTrack: number;
  };
}

export interface WindowSearchOptions {
  windowS?: number;      // default 5 (pendulum period is 2–4 s; don't alias it)
  stepS?: number;        // default 0.5
  minSpeed_mps?: number; // default 4 — track direction is meaningless when parked
  minImuSamples?: number;
  minTrackSamples?: number;
}

/**
 * Slide a window over [searchStart, searchEnd] and score each position for
 * "quiet, straight, unaccelerated": |mean|f| − g| and std|f| small, gyro
 * quiet, ground track linear. Returns the best window, or null if nothing
 * qualifies (no GNSS, too slow, too short).
 */
export function findCalibrationWindow(
  imu: ImuSample[],
  track: TrackSample[],
  searchStart_s: number,
  searchEnd_s: number,
  options: WindowSearchOptions = {},
): CalibrationWindow | null {
  const windowS = options.windowS ?? 5;
  const stepS = options.stepS ?? 0.5;
  const minSpeed = options.minSpeed_mps ?? 4;
  const minImu = options.minImuSamples ?? Math.max(8, windowS * 4);
  const minTrack = options.minTrackSamples ?? 3;

  let best: CalibrationWindow | null = null;

  for (let t0 = searchStart_s; t0 + windowS <= searchEnd_s; t0 += stepS) {
    const t1 = t0 + windowS;
    const win = evaluateWindow(imu, track, t0, t1, minSpeed, minImu, minTrack);
    if (win && (!best || win.score < best.score)) best = win;
  }
  return best;
}

function evaluateWindow(
  imu: ImuSample[],
  track: TrackSample[],
  t0: number,
  t1: number,
  minSpeed: number,
  minImu: number,
  minTrack: number,
): CalibrationWindow | null {
  const fx: number[] = [], fy: number[] = [], fz: number[] = [];
  const fMag: number[] = [], gMag: number[] = [];
  for (const s of imu) {
    if (s.t < t0 || s.t > t1) continue;
    fx.push(s.ax); fy.push(s.ay); fz.push(s.az);
    fMag.push(Math.sqrt(s.ax * s.ax + s.ay * s.ay + s.az * s.az));
    gMag.push(Math.sqrt(s.gx * s.gx + s.gy * s.gy + s.gz * s.gz));
  }
  if (fMag.length < minImu) return null;

  let sinSum = 0, cosSum = 0, speedSum = 0, nTrack = 0;
  for (const p of track) {
    if (p.t < t0 || p.t > t1) continue;
    const rad = p.track_degT / DEG;
    sinSum += Math.sin(rad); cosSum += Math.cos(rad);
    speedSum += p.speed_mps; nTrack++;
  }
  if (nTrack < minTrack) return null;
  const meanSpeed = speedSum / nTrack;
  if (meanSpeed < minSpeed) return null;

  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const fMagMean = mean(fMag);
  const fMagStd = Math.sqrt(mean(fMag.map(v => (v - fMagMean) ** 2)));
  const gyroRms = Math.sqrt(mean(gMag.map(v => v * v)));
  // Circular std of track from the mean resultant length.
  const R = Math.sqrt(sinSum * sinSum + cosSum * cosSum) / nTrack;
  const trackStd_deg = Math.sqrt(Math.max(0, -2 * Math.log(Math.max(R, 1e-12)))) * DEG;
  let meanTrack = Math.atan2(sinSum, cosSum) * DEG;
  if (meanTrack < 0) meanTrack += 360;

  // Weighted sum, everything scaled to roughly m/s²-comparable units:
  // 0.1 rad/s residual gyro ≈ 0.5; 10° of track wander ≈ 1.4.
  const score =
    Math.abs(fMagMean - G_MPS2) +
    fMagStd +
    5 * gyroRms +
    (trackStd_deg / DEG) * 8;

  return {
    t0, t1, score,
    meanF_imu: [mean(fx), mean(fy), mean(fz)],
    meanTrack_degT: meanTrack,
    meanSpeed_mps: meanSpeed,
    stats: { fMagMean_mps2: fMagMean, fMagStd_mps2: fMagStd, gyroRms_rps: gyroRms, trackStd_deg, nImu: fMag.length, nTrack },
  };
}

// ---------------------------------------------------------------------------
// TRIAD calibration
// ---------------------------------------------------------------------------

/**
 * Sense of the logged $PIM2 quaternion. Firmware ≥ 1.2.0 (log version ≥ 112)
 * logs sensor→earth; 1.0.0 (110) logged the conjugate. Auto-detected during
 * calibration by checking which sense agrees with the measured gravity.
 */
export type QuatConvention = 'sensor-to-earth' | 'earth-to-sensor';

/** R(E←IMU) from a quaternion sample under a given logging convention. */
export function quatToEarthFromImu(q: QuatSample, convention: QuatConvention): Mat3 {
  const m = quatToMat(q.w, q.x, q.y, q.z);
  return convention === 'sensor-to-earth' ? m : transpose(m);
}

export interface TorsoCalibration {
  window: CalibrationWindow;
  /** +1: IMU +Z faces forward (antenna out, as briefed); -1: reversed. */
  forwardSign: 1 | -1;
  /** Detected $PIM2 logging sense (firmware-version dependent). */
  quatConvention: QuatConvention;
  /** Constant pocket transform: v_torso = R · v_imu. */
  R_torso_from_imu: Mat3;
  /** Yaw aligning the AHRS pseudo-north with true north at calibration time. */
  yawOffset_deg: number;
  /**
   * Tilt left over after modeling the AHRS correction as pure yaw. The AHRS
   * keeps pitch/roll gravity-locked, so this should be small (a few degrees);
   * large values mean the window wasn't unaccelerated or a convention is wrong.
   */
  tiltResidual_deg: number;
  /**
   * Angle between gravity as measured by the mean accelerometer vector and
   * gravity as predicted by the $PIM2 quaternion at calibration time. An
   * independent convention/health check — should also be small.
   */
  quatGravityAgreement_deg: number;
}

/**
 * Minimum log version whose $PIM2 stream this module accepts. Firmware 1.0.0
 * (log version 110) used an incompatible AHRS implementation — validated on
 * the July-2026 corpus: neither the quaternion nor its conjugate agrees with
 * measured gravity on 110 logs (tilt residuals 18–157°), while every log from
 * 1.2.0 (112) on calibrates at ≤ 8°.
 */
export const MIN_TORSO_LOG_VERSION = 112;

export interface CalibrateOptions extends WindowSearchOptions {
  /**
   * The log's $PVER numeric version, when known. Logs older than
   * MIN_TORSO_LOG_VERSION are refused (returns null) — their $PIM2 data
   * cannot be interpreted. Omit only for streams of known-good provenance
   * (e.g. synthetic tests).
   */
  logVersion?: number;
  /**
   * Interval of belly-to-earth freefall used to resolve the ±Z pocket sign
   * (drag at terminal pushes the specific force chest-to-back, so torso-frame
   * f_x must be negative). Omit to trust forwardSign / the +1 default.
   */
  freefall?: [number, number];
  /** Skip freefall disambiguation and use this sign directly. */
  forwardSign?: 1 | -1;
}

/** Build R(T←IMU) for a given pocket sign from the mean specific force. */
export function triadPocketTransform(meanF_imu: Vec3, forwardSign: 1 | -1): Mat3 | null {
  const down = normalize(scale(meanF_imu, -1)); // specific force points up in 1 g flight
  const fwdAssumed: Vec3 = [0, 0, forwardSign]; // IMU ±Z = flat-face normal ≈ fore/aft
  const proj = dot(fwdAssumed, down);
  const xRaw: Vec3 = [
    fwdAssumed[0] - proj * down[0],
    fwdAssumed[1] - proj * down[1],
    fwdAssumed[2] - proj * down[2],
  ];
  // Degenerate if the flat face points near-vertically (device lying flat
  // relative to gravity) — the pocket assumption is broken; refuse.
  if (norm(xRaw) < 0.2) return null;
  const x = normalize(xRaw);
  const z = down;
  const y = cross(z, x);
  return [x, y, z]; // rows: torso axes expressed in IMU coordinates
}

/** Nearest quaternion sample to time t (null if none within maxGap seconds). */
export function nearestQuat(quat: QuatSample[], t: number, maxGap = 1.0): QuatSample | null {
  let best: QuatSample | null = null;
  let bestDt = Infinity;
  for (const q of quat) {
    const dt = Math.abs(q.t - t);
    if (dt < bestDt) { bestDt = dt; best = q; }
  }
  return bestDt <= maxGap ? best : null;
}

/**
 * Full calibration: find the window, run TRIAD for the pocket transform,
 * resolve the ±Z sign, and extract the AHRS yaw offset with diagnostics.
 */
export function estimateTorsoCalibration(
  imu: ImuSample[],
  track: TrackSample[],
  quat: QuatSample[],
  searchStart_s: number,
  searchEnd_s: number,
  options: CalibrateOptions = {},
): TorsoCalibration | null {
  if (options.logVersion !== undefined && options.logVersion < MIN_TORSO_LOG_VERSION) {
    return null;
  }
  const window = findCalibrationWindow(imu, track, searchStart_s, searchEnd_s, options);
  if (!window) return null;

  const tCal = (window.t0 + window.t1) / 2;
  const qCal = nearestQuat(quat, tCal);
  if (!qCal) return null;

  // Detect the $PIM2 logging convention: under a correct sense, the measured
  // specific force (up, in 1 g flight) maps to earth-frame (0,0,-1). Firmware
  // 1.0.0 (log 110) logged the conjugate quaternion; try both and keep the
  // one gravity agrees with.
  const upImu = normalize(window.meanF_imu);
  const agree = (conv: QuatConvention) => {
    const up_e = matVec(quatToEarthFromImu(qCal, conv), upImu);
    return Math.acos(Math.min(1, Math.max(-1, -up_e[2]))) * DEG;
  };
  const quatConvention: QuatConvention =
    agree('sensor-to-earth') <= agree('earth-to-sensor') ? 'sensor-to-earth' : 'earth-to-sensor';
  const R_e_from_imu = quatToEarthFromImu(qCal, quatConvention);

  // Resolve the pocket sign.
  let forwardSign: 1 | -1 = options.forwardSign ?? 1;
  if (options.forwardSign === undefined && options.freefall) {
    const [f0, f1] = options.freefall;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const s of imu) {
      if (s.t < f0 || s.t > f1) continue;
      sx += s.ax; sy += s.ay; sz += s.az; n++;
    }
    if (n > 0) {
      const R_plus = triadPocketTransform(window.meanF_imu, 1);
      if (R_plus) {
        // Belly-to-earth: chest faces the ground, terminal drag pushes the
        // specific force chest→back, i.e. torso-frame f_x < 0.
        const fTorso = matVec(R_plus, [sx / n, sy / n, sz / n]);
        forwardSign = fTorso[0] < 0 ? 1 : -1;
      }
    }
  }

  const R_torso_from_imu = triadPocketTransform(window.meanF_imu, forwardSign);
  if (!R_torso_from_imu) return null;

  // NED attitude at calibration: upright, facing the mean ground track.
  const R_ned_from_imu_cal = matMul(rotZ(window.meanTrack_degT), R_torso_from_imu);

  // AHRS correction R(NED←E) = R(NED←IMU)|cal · R(E←IMU)ᵀ|cal — nearly pure yaw.
  const R_corr = matMul(R_ned_from_imu_cal, transpose(R_e_from_imu));
  const { yaw_deg, tilt_deg } = yawAndTiltResidual(R_corr);

  // Independent check: gravity per accelerometer vs gravity per quaternion.
  const upMeasured_e = matVec(R_e_from_imu, normalize(window.meanF_imu));
  const quatGravityAgreement_deg =
    Math.acos(Math.min(1, Math.max(-1, -upMeasured_e[2]))) * DEG; // want ≈ (0,0,-1)

  return {
    window,
    forwardSign,
    quatConvention,
    R_torso_from_imu,
    yawOffset_deg: yaw_deg,
    tiltResidual_deg: tilt_deg,
    quatGravityAgreement_deg,
  };
}

// ---------------------------------------------------------------------------
// Attitude series
// ---------------------------------------------------------------------------

export interface TorsoAttitude {
  t: number;
  roll_deg: number;
  pitch_deg: number;   // belly-to-earth freefall ≈ -90; upright ≈ 0
  yaw_degT: number;    // true heading of the chest normal
}

/** Torso attitude of a single quaternion sample under a calibration. */
export function torsoAttitudeAt(q: QuatSample, cal: TorsoCalibration): TorsoAttitude {
  const R_ned_from_torso = matMul(
    matMul(rotZ(cal.yawOffset_deg), quatToEarthFromImu(q, cal.quatConvention)),
    transpose(cal.R_torso_from_imu),
  );
  const e = eulerFromMatrix(R_ned_from_torso);
  return { t: q.t, roll_deg: e.roll_deg, pitch_deg: e.pitch_deg, yaw_degT: e.yaw_deg };
}

/** Apply a calibration to the whole $PIM2 stream. */
export function torsoAttitudeSeries(quat: QuatSample[], cal: TorsoCalibration): TorsoAttitude[] {
  return quat.map(q => torsoAttitudeAt(q, cal));
}
