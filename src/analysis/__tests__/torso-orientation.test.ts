// Torso-orientation calibration: TRIAD pocket transform, AHRS yaw-offset
// recovery, ±Z sign disambiguation via freefall, attitude series.
//
// The synthetic jump uses a KNOWN pocket orientation and a KNOWN AHRS yaw
// offset, then checks that estimateTorsoCalibration recovers both.

import {
  Vec3, Mat3,
  matMul, matVec, transpose, rotZ, matToQuat, quatToMat,
  eulerFromMatrix, yawAndTiltResidual, rotationAngle_deg,
  findCalibrationWindow, estimateTorsoCalibration, torsoAttitudeSeries,
  triadPocketTransform,
  ImuSample, TrackSample, QuatSample,
} from '../torso-orientation';

const G = 9.80665;
const DEG = 180 / Math.PI;

function axisAngle(axis: Vec3, deg: number): Mat3 {
  const [x, y, z] = axis;
  const c = Math.cos(deg / DEG), s = Math.sin(deg / DEG), t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

/**
 * Ground truth. Device in the pocket: IMU +Z out of the chest (forward),
 * IMU +X up, IMU +Y left — then twisted 20° about the forward axis to
 * simulate a sloppy pocket. Expressed as R(T←IMU): columns are the images
 * of the IMU basis vectors in torso coordinates.
 */
function pocketTruth(): Mat3 {
  // IMU x → torso -z (up), IMU y → torso -y? Check handedness:
  // choose imu x → (0,0,-1) [up], imu y → (0,-1,0) [left], imu z → (1,0,0) [forward]
  // x̂×ŷ = (0,0,-1)×(0,-1,0) = (0*0 - (-1)(-1), (-1)(0) - 0*0, 0*(-1) - 0*0) = (-1,0,0)  ✗
  // so use imu y → (0,+1,0)? A real IMU frame is right-handed; verify:
  // (0,0,-1)×(0,1,0) = (0*0 - (-1)(1), (-1)(0) - 0(0), 0(1) - 0(0)) = (1,0,0)  ✓ forward
  const R_t_from_imu: Mat3 = [
    // columns: imu x, imu y, imu z in torso coords
    [0, 0, 1],
    [0, 1, 0],
    [-1, 0, 0],
  ];
  // Twist about the torso-forward axis (pocket tilt).
  return matMul(axisAngle([1, 0, 0], 20), R_t_from_imu);
}

const TRACK_CANOPY = 120;   // deg true, calibration leg
const PSI_TRUE = 35;        // AHRS pseudo-north offset (deg)
const POCKET = pocketTruth();

/** Torso NED attitude → synthetic sensor streams at that instant. */
function sensorsAt(R_ned_from_torso: Mat3) {
  const R_ned_from_imu = matMul(R_ned_from_torso, POCKET);
  // Specific force in unaccelerated 1 g flight points UP: (0,0,-g) in NED.
  const f_imu = matVec(transpose(R_ned_from_imu), [0, 0, -G]);
  // AHRS earth frame is NED rotated by -ψ: R(E←IMU) = Rz(-ψ)·R(NED←IMU).
  const R_e_from_imu = matMul(rotZ(-PSI_TRUE), R_ned_from_imu);
  const q = matToQuat(R_e_from_imu);
  return { f_imu, q };
}

/**
 * Timeline:
 *   t 0–60    belly-to-earth freefall, heading 90°T (pitch -90)
 *   t 60–70   turning canopy flight (noisy gyro, sweeping track)
 *   t 70–80   quiet straight canopy leg at 120°T  ← calibration target
 *   t 80–85   post-flare
 */
function syntheticJump() {
  const imu: ImuSample[] = [];
  const track: TrackSample[] = [];
  const quat: QuatSample[] = [];

  const belly = matMul(rotZ(90), axisAngle([0, 1, 0], -90)); // pitch -90
  for (let t = 0; t < 85; t += 0.05) { // 20 Hz
    let R_ned_from_torso: Mat3;
    let gyro: Vec3 = [0, 0, 0];
    if (t < 60) {
      R_ned_from_torso = belly;
    } else if (t < 70) {
      const swing = 40 * Math.sin(2 * Math.PI * (t - 60) / 5);
      R_ned_from_torso = matMul(rotZ(200 + swing), axisAngle([1, 0, 0], 15));
      gyro = [0.4, 0.1, 0.5]; // busy
    } else {
      R_ned_from_torso = rotZ(TRACK_CANOPY);
    }
    const { f_imu, q } = sensorsAt(R_ned_from_torso);
    // small measurement noise on the quiet leg keeps it realistic but winning
    const jitter = t >= 60 && t < 70 ? 2.0 : 0.05;
    imu.push({
      t,
      ax: f_imu[0] + jitter * Math.sin(t * 13.7),
      ay: f_imu[1] + jitter * Math.sin(t * 17.3),
      az: f_imu[2] + jitter * Math.cos(t * 11.1),
      gx: gyro[0], gy: gyro[1], gz: gyro[2],
    });
    quat.push({ t, w: q[0], x: q[1], y: q[2], z: q[3] });
  }
  for (let t = 60; t < 85; t += 0.2) { // 5 Hz GNSS under canopy
    const trackDeg = t < 70 ? 200 + 40 * Math.sin(2 * Math.PI * (t - 60) / 5) : TRACK_CANOPY;
    track.push({ t, track_degT: (trackDeg + 360) % 360, speed_mps: 10 });
  }
  return { imu, track, quat };
}

describe('torso-orientation math kit', () => {
  it('quatToMat / matToQuat round-trip', () => {
    const R = matMul(rotZ(73), axisAngle([1, 0, 0], -28));
    const q = matToQuat(R);
    const R2 = quatToMat(q[0], q[1], q[2], q[3]);
    expect(rotationAngle_deg(matMul(R, transpose(R2)))).toBeCloseTo(0, 5);
  });

  it('eulerFromMatrix recovers ZYX angles', () => {
    const R = matMul(matMul(rotZ(120), axisAngle([0, 1, 0], -30)), axisAngle([1, 0, 0], 10));
    const e = eulerFromMatrix(R);
    expect(e.yaw_deg).toBeCloseTo(120, 5);
    expect(e.pitch_deg).toBeCloseTo(-30, 5);
    expect(e.roll_deg).toBeCloseTo(10, 5);
  });

  it('yawAndTiltResidual isolates the yaw of a near-Z rotation', () => {
    const R = matMul(rotZ(35), axisAngle([1, 0, 0], 2));
    const { yaw_deg, tilt_deg } = yawAndTiltResidual(R);
    expect(yaw_deg).toBeCloseTo(35, 1);
    expect(tilt_deg).toBeCloseTo(2, 1);
  });

  it('triadPocketTransform refuses a flat-lying device', () => {
    // gravity along IMU -Z ⇒ flat-face normal vertical ⇒ pocket assumption broken
    expect(triadPocketTransform([0, 0, G], 1)).toBeNull();
  });
});

describe('calibration on a synthetic jump', () => {
  const { imu, track, quat } = syntheticJump();

  it('window finder picks the quiet straight leg, not the turning one', () => {
    const win = findCalibrationWindow(imu, track, 60, 85, { windowS: 5 })!;
    expect(win).not.toBeNull();
    expect(win.t0).toBeGreaterThanOrEqual(69.5);
    expect(win.stats.trackStd_deg).toBeLessThan(2);
    expect(Math.abs(win.stats.fMagMean_mps2 - G)).toBeLessThan(0.1);
    expect(win.meanTrack_degT).toBeCloseTo(TRACK_CANOPY, 0);
  });

  it('recovers the AHRS yaw offset with a small tilt residual', () => {
    const cal = estimateTorsoCalibration(imu, track, quat, 60, 85, {
      freefall: [10, 50],
    })!;
    expect(cal).not.toBeNull();
    expect(cal.forwardSign).toBe(1);
    expect(cal.yawOffset_deg).toBeCloseTo(PSI_TRUE, 0);
    expect(cal.tiltResidual_deg).toBeLessThan(1.5);
    expect(cal.quatGravityAgreement_deg).toBeLessThan(1.5);
  });

  it('recovered pocket transform matches ground truth', () => {
    const cal = estimateTorsoCalibration(imu, track, quat, 60, 85, {
      freefall: [10, 50],
    })!;
    const err = rotationAngle_deg(matMul(cal.R_torso_from_imu, transpose(POCKET)));
    expect(err).toBeLessThan(1.5);
  });

  it('attitude series: belly-down freefall, upright canopy on the right heading', () => {
    const cal = estimateTorsoCalibration(imu, track, quat, 60, 85, {
      freefall: [10, 50],
    })!;
    const att = torsoAttitudeSeries(quat, cal);
    const at = (t: number) => att.reduce((b, a) => Math.abs(a.t - t) < Math.abs(b.t - t) ? a : b);
    const ff = at(30);
    expect(ff.pitch_deg).toBeLessThan(-85);   // belly to earth
    const canopy = at(75);
    expect(Math.abs(canopy.pitch_deg)).toBeLessThan(2);
    expect(Math.abs(canopy.roll_deg)).toBeLessThan(2);
    expect(canopy.yaw_degT).toBeCloseTo(TRACK_CANOPY, 0);
  });

  it('freefall check flips the sign for a reversed device', () => {
    // Reverse the pocket — antenna in instead of out: the device turned 180°
    // about the torso's vertical axis, so torso-forward maps from IMU -Z.
    const reversed = matMul(rotZ(180), POCKET);

    const imu2: ImuSample[] = [];
    const quat2: QuatSample[] = [];
    const track2: TrackSample[] = track;
    const belly = matMul(rotZ(90), axisAngle([0, 1, 0], -90));
    for (let t = 0; t < 85; t += 0.05) {
      const R_ned_from_torso: Mat3 = t < 60 ? belly
        : t < 70 ? matMul(rotZ(200 + 40 * Math.sin(2 * Math.PI * (t - 60) / 5)), axisAngle([1, 0, 0], 15))
        : rotZ(TRACK_CANOPY);
      const R_ned_from_imu = matMul(R_ned_from_torso, reversed);
      const f = matVec(transpose(R_ned_from_imu), [0, 0, -G]);
      const R_e = matMul(rotZ(-PSI_TRUE), R_ned_from_imu);
      const q = matToQuat(R_e);
      const jitter = t >= 60 && t < 70 ? 2.0 : 0.05;
      imu2.push({
        t, ax: f[0] + jitter * Math.sin(t * 13.7), ay: f[1] + jitter * Math.sin(t * 17.3), az: f[2] + jitter * Math.cos(t * 11.1),
        gx: t >= 60 && t < 70 ? 0.4 : 0, gy: 0, gz: t >= 60 && t < 70 ? 0.5 : 0,
      });
      quat2.push({ t, w: q[0], x: q[1], y: q[2], z: q[3] });
    }

    const cal = estimateTorsoCalibration(imu2, track2, quat2, 60, 85, {
      freefall: [10, 50],
    })!;
    expect(cal.forwardSign).toBe(-1);
    const att = torsoAttitudeSeries(quat2, cal);
    const ff = att.reduce((b, a) => Math.abs(a.t - 30) < Math.abs(b.t - 30) ? a : b);
    expect(ff.pitch_deg).toBeLessThan(-85); // still resolves to belly-down
  });

  it('returns null when there is no usable GNSS in the search range', () => {
    expect(estimateTorsoCalibration(imu, [], quat, 60, 85)).toBeNull();
  });

  it('refuses logs older than firmware 1.2.0 (log version < 112)', () => {
    expect(estimateTorsoCalibration(imu, track, quat, 60, 85, { logVersion: 110 })).toBeNull();
    expect(estimateTorsoCalibration(imu, track, quat, 60, 85, { logVersion: 112 })).not.toBeNull();
    expect(estimateTorsoCalibration(imu, track, quat, 60, 85, { logVersion: 114 })).not.toBeNull();
  });

  it('auto-detects a conjugated quaternion stream (firmware 1.0.0 logs)', () => {
    // Firmware 1.0.0 (log version 110) logged the conjugate quaternion.
    const conj = quat.map(q => ({ t: q.t, w: q.w, x: -q.x, y: -q.y, z: -q.z }));
    const cal = estimateTorsoCalibration(imu, track, conj, 60, 85, {
      freefall: [10, 50],
    })!;
    expect(cal).not.toBeNull();
    expect(cal.quatConvention).toBe('earth-to-sensor');
    expect(cal.yawOffset_deg).toBeCloseTo(PSI_TRUE, 0);
    expect(cal.tiltResidual_deg).toBeLessThan(1.5);
    const att = torsoAttitudeSeries(conj, cal);
    const ff = att.reduce((b, a) => Math.abs(a.t - 30) < Math.abs(b.t - 30) ? a : b);
    expect(ff.pitch_deg).toBeLessThan(-85);
    // and the pristine stream still detects the modern convention
    const calModern = estimateTorsoCalibration(imu, track, quat, 60, 85, { freefall: [10, 50] })!;
    expect(calModern.quatConvention).toBe('sensor-to-earth');
  });
});
