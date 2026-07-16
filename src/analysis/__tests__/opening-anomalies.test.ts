// Opening anomalies: off-heading openings and line twists, per the working
// definitions in docs/event-algorithms.md.
//
// Synthetic timeline (deployment at t=100):
//   t 90..100   stable belly-to-earth freefall, pitch -80, facing 120°T
//   t 100..104  opening transition (pitch -80 → 0)
//   t 104..     upright canopy flight; yaw per scenario
// Pitch -80 (not -90) keeps the ZYX Euler decomposition non-degenerate when
// synthesizing; the detector itself never relies on Euler yaw in freefall.

import { analyzeOpening, impliedFreefallHeading_degT, unwrapYaw_deg } from '../opening-anomalies';
import type { TorsoAttitude, TrackSample, ImuSample } from '../torso-orientation';

const DEPLOY = 100;
const ACTIVATION = 106;

interface Scenario {
  canopyYaw?: (t: number) => number;      // yaw after transition (default 130)
  preYaw?: (t: number) => number;         // freefall yaw (default 120)
  prePitch?: number;                      // default -80
  spin?: { from: number; to: number; rate_dps: number }; // post-opening spin
  load?: { from: number; to: number; g: number };        // elevated load
}

function build(s: Scenario = {}) {
  const attitude: TorsoAttitude[] = [];
  const imu: ImuSample[] = [];
  const track: TrackSample[] = [];
  const preYaw = s.preYaw ?? (() => 120);
  const prePitch = s.prePitch ?? -80;

  let spinAccum = 0;
  let lastT = DEPLOY + 4;
  for (let t = 90; t <= 130; t += 0.05) {
    let roll = 0, pitch: number, yaw: number;
    if (t < DEPLOY) {
      pitch = prePitch; yaw = preYaw(t);
    } else if (t < DEPLOY + 4) {
      const f = (t - DEPLOY) / 4;
      pitch = prePitch * (1 - f);
      yaw = preYaw(DEPLOY) + (((s.canopyYaw?.(DEPLOY + 4) ?? 130) - preYaw(DEPLOY) + 540) % 360 - 180) * f;
    } else {
      pitch = 0;
      yaw = s.canopyYaw ? s.canopyYaw(t) : 130;
      if (s.spin && t >= s.spin.from && t <= s.spin.to) {
        spinAccum += s.spin.rate_dps * (t - Math.max(lastT, s.spin.from));
        lastT = t;
      }
      yaw = (yaw + spinAccum + 360 * 10) % 360;
    }
    attitude.push({ t, roll_deg: roll, pitch_deg: pitch, yaw_degT: (yaw + 360) % 360 });

    const g = s.load && t >= s.load.from && t <= s.load.to ? s.load.g : 1.0;
    imu.push({ t, ax: 0, ay: 0, az: 9.80665 * g, gx: 0, gy: 0, gz: 0 });
  }
  for (let t = 90; t <= 130; t += 0.5) {
    track.push({ t, track_degT: 130, speed_mps: t < DEPLOY ? 10 : 6 });
  }
  return { attitude, imu, track };
}

describe('impliedFreefallHeading_degT', () => {
  it('projects the feet-to-head axis for a belly-flyer', () => {
    expect(impliedFreefallHeading_degT({ t: 0, roll_deg: 0, pitch_deg: -80, yaw_degT: 120 }))
      .toBeCloseTo(120, 1);
  });
  it('returns null when the body is upright (axis vertical)', () => {
    expect(impliedFreefallHeading_degT({ t: 0, roll_deg: 0, pitch_deg: 0, yaw_degT: 90 }))
      .toBeNull();
  });
});

describe('unwrapYaw_deg', () => {
  it('unwraps through the 360/0 seam', () => {
    const u = unwrapYaw_deg([350, 10, 30, 350, 310]);
    expect(u).toEqual([350, 370, 390, 350, 310]);
  });
});

describe('analyzeOpening', () => {
  it('labels a clean on-heading opening: determinate, no anomalies', () => {
    const { attitude, imu, track } = build(); // freefall 120 → canopy 130
    const r = analyzeOpening(attitude, track, imu, DEPLOY, ACTIVATION)!;
    expect(r.determinate).toBe(true);
    expect(r.freefallHeading_degT).toBeCloseTo(120, 0);
    expect(r.canopyHeading_degT).toBeCloseTo(130, 0);
    expect(r.offHeading_deg).toBeCloseTo(10, 0);
    expect(r.offHeadingOpening).toBe(false);
    expect(r.lineTwist).toBe('none');
    expect(r.yawExcursion_deg).toBeLessThan(60);
  });

  it('flags a 120° off-heading opening', () => {
    const { attitude, imu, track } = build({ canopyYaw: () => 240 });
    const r = analyzeOpening(attitude, track, imu, DEPLOY, ACTIVATION)!;
    expect(r.determinate).toBe(true);
    expect(r.offHeading_deg).toBeCloseTo(120, 0);
    expect(r.offHeadingOpening).toBe(true);
    expect(r.lineTwist).toBe('none');
  });

  it('detects a benign line twist (720° spin, steady track, ordinary loads)', () => {
    const { attitude, imu, track } = build({
      spin: { from: DEPLOY + 4, to: DEPLOY + 12, rate_dps: 90 }, // 720°
    });
    const r = analyzeOpening(attitude, track, imu, DEPLOY, ACTIVATION)!;
    expect(r.yawExcursion_deg).toBeGreaterThan(360);
    expect(r.lineTwist).toBe('benign');
  });

  it('detects an aggressive line twist (spin + sustained 1.8 g)', () => {
    const { attitude, imu, track } = build({
      spin: { from: DEPLOY + 4, to: DEPLOY + 12, rate_dps: 90 },
      load: { from: DEPLOY + 4, to: DEPLOY + 12, g: 1.8 },
    });
    const r = analyzeOpening(attitude, track, imu, DEPLOY, ACTIVATION)!;
    expect(r.peakLoad_g).toBeGreaterThanOrEqual(1.5);
    expect(r.lineTwist).toBe('aggressive');
  });

  it('is indeterminate when the jumper is spinning before deployment', () => {
    const { attitude, imu, track } = build({
      preYaw: t => (120 + 120 * (t - 90)) % 360, // 120°/s flat spin
    });
    const r = analyzeOpening(attitude, track, imu, DEPLOY, ACTIVATION)!;
    expect(r.determinate).toBe(false);
    expect(r.indeterminateReason).toMatch(/unstable/);
    expect(r.offHeadingOpening).toBeUndefined();
    expect(r.lineTwist).toBe('none'); // twist still evaluated
  });

  it('is indeterminate when not belly-to-earth before deployment', () => {
    const { attitude, imu, track } = build({ prePitch: 0 }); // upright/sitting
    const r = analyzeOpening(attitude, track, imu, DEPLOY, ACTIVATION)!;
    expect(r.determinate).toBe(false);
    expect(r.indeterminateReason).toMatch(/vertical|belly/);
  });

  it('returns null without attitude coverage around deployment', () => {
    const { imu, track } = build();
    expect(analyzeOpening([], track, imu, DEPLOY, ACTIVATION)).toBeNull();
  });
});
