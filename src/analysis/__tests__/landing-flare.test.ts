// Landing-flare profile: approach-aligned X axis, touchdown-relative heights,
// statute-mph groundspeed, load callouts.

import { buildFlareProfile } from '../landing-flare';
import type { GPSPoint, TimeSeriesPoint } from '../log-parser';

// Synthetic straight-in approach: due EAST at 10 m/s, descending steadily
// from 60 m over 20 s, touchdown at t=1000. 5 Hz fixes.
function syntheticApproach() {
  const gps: GPSPoint[] = [];
  const baro: TimeSeriesPoint[] = [];
  const accel: TimeSeriesPoint[] = [];
  const lat0 = 33.4569, lon0 = -96.377;
  const mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  for (let i = 0; i <= 110; i++) {
    const t = 978 + i * 0.2; // 978..1000+2s
    const dt = t - 1000; // 0 at touchdown
    gps.push({
      timestamp: t,
      latitude: lat0,
      longitude: lon0 + (10 * dt) / mPerDegLon, // 10 m/s due east, arriving at lon0
      altitude_ftAGL: 0,
      groundspeed_kmph: 36, // = 22.37 statute mph
      groundTrack_degT: 90,
    });
    baro.push({ timestamp: t, value: Math.max(0, -dt) * 3 * 3.28084 + 5 }); // 3 m/s sink, +5 ft baro offset at touchdown
    accel.push({ timestamp: t, value: 9.81 * (dt > -2 && dt < 0 ? 1.4 : 1.0) }); // flare load in last 2 s
  }
  return { gps, baro, accel };
}

describe('buildFlareProfile', () => {
  const { gps, baro, accel } = syntheticApproach();
  const profile = buildFlareProfile(gps, baro, accel, 1000, { windowS: 18, calloutCount: 9 })!;

  it('aligns X with the final ground path (due east) and puts touchdown at 0', () => {
    expect(profile).not.toBeNull();
    expect(profile.approachHeading_degT).toBeCloseTo(90, 0);
    const xs = profile.points.map(p => p.x_ft);
    // monotonic increasing toward 0 on approach
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    const atTouchdown = profile.points.reduce((b, p) => Math.abs(p.t - 1000) < Math.abs(b.t - 1000) ? p : b);
    expect(Math.abs(atTouchdown.x_ft)).toBeLessThan(3);
    // 18 s at 10 m/s ≈ 590 ft of approach shown
    expect(xs[0]).toBeLessThan(-550);
  });

  it('heights are relative to the touchdown point (baro offset removed)', () => {
    const atTouchdown = profile.points.reduce((b, p) => Math.abs(p.t - 1000) < Math.abs(b.t - 1000) ? p : b);
    expect(Math.abs(atTouchdown.z_ft)).toBeLessThan(1); // the +5 ft baro offset is normalized out
    const first = profile.points[0];
    expect(first.z_ft).toBeGreaterThan(170); // ~18 s * 3 m/s ≈ 177 ft
  });

  it('produces evenly spaced callouts with statute mph and load', () => {
    expect(profile.callouts).toHaveLength(9);
    const dts = profile.callouts.slice(1).map((c, i) => c.t - profile.callouts[i].t);
    for (const dt of dts) expect(dt).toBeCloseTo(18 / 8, 5);
    const c0 = profile.callouts[0];
    expect(c0.groundspeed_mph).toBeCloseTo(22.37, 1); // 36 km/h in STATUTE mph
    // the touchdown callout's ±0.3 s load window straddles flare (1.4 g) and
    // rollout (1.0 g) samples, so the mean sits between them
    const last = profile.callouts[profile.callouts.length - 1];
    expect(last.load_g).toBeGreaterThan(1.1);
  });

  it('returns null when there is no GPS in the window', () => {
    expect(buildFlareProfile([], baro, accel, 1000)).toBeNull();
  });

  it('omits figures when no attitude series is supplied', () => {
    expect(profile.figures).toBeUndefined();
  });

  describe('torso figures', () => {
    // Attitude at 20 Hz over the approach: upright, facing the (due-east)
    // approach until 8 s out, then pitched 30° forward (diving) after.
    const attitude: Array<{ t: number; roll_deg: number; pitch_deg: number; yaw_degT: number }> = [];
    for (let t = 978; t <= 1002; t += 0.05) {
      attitude.push({
        t,
        roll_deg: 0,
        pitch_deg: t < 992 ? 0 : -30,
        yaw_degT: 90,
      });
    }
    const p = buildFlareProfile(gps, baro, accel, 1000, {
      windowS: 18, calloutCount: 9, attitude,
    })!;

    it('places one figure between each pair of callouts', () => {
      expect(p.figures).toHaveLength(8);
      for (let i = 0; i < 8; i++) {
        expect(p.figures![i].t).toBeCloseTo((p.callouts[i].t + p.callouts[i + 1].t) / 2, 5);
        expect(p.figures![i].x_ft).toBeGreaterThan(p.callouts[i].x_ft);
        expect(p.figures![i].x_ft).toBeLessThan(p.callouts[i + 1].x_ft);
      }
    });

    it('projects an upright, approach-facing torso to vertical up / horizontal forward', () => {
      const early = p.figures![0]; // t ≈ 983 — upright phase
      expect(early.up[0]).toBeCloseTo(0, 5);
      expect(early.up[1]).toBeCloseTo(1, 5);
      expect(early.forward[0]).toBeCloseTo(1, 5);
      expect(early.forward[1]).toBeCloseTo(0, 5);
    });

    it('projects a 30° forward pitch as a downrange lean', () => {
      const late = p.figures![p.figures!.length - 1]; // t ≈ 998.9 — diving phase
      // up tilts downrange: (sin 30, cos 30); chest points down by sin 30
      expect(late.up[0]).toBeCloseTo(0.5, 5);
      expect(late.up[1]).toBeCloseTo(Math.sqrt(3) / 2, 5);
      expect(late.forward[0]).toBeCloseTo(Math.sqrt(3) / 2, 5);
      expect(late.forward[1]).toBeCloseTo(-0.5, 5);
    });

    it('foreshortens a torso yawed off the approach axis', () => {
      const side = buildFlareProfile(gps, baro, accel, 1000, {
        windowS: 18, calloutCount: 9,
        attitude: attitude.map(a => ({ ...a, pitch_deg: 0, yaw_degT: 0 })), // facing north, approach east
      })!;
      const f = side.figures![0];
      expect(f.up[1]).toBeCloseTo(1, 5);       // still upright
      expect(f.forward[0]).toBeCloseTo(0, 5);  // chest normal ⊥ chart plane → vanishes
      expect(f.forward[1]).toBeCloseTo(0, 5);
    });
  });
});
