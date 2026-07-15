// Preset-window derivation for the unified time scrubber.

import { computePresetWindows } from '../jump-time-window';

const DOMAIN: [number, number] = [-812, 208]; // jump-elapsed base: log start → end

function expectWindow(actual: [number, number] | null, expected: [number, number]) {
  expect(actual).not.toBeNull();
  expect(actual![0]).toBeCloseTo(expected[0], 6);
  expect(actual![1]).toBeCloseTo(expected[1], 6);
}

describe('computePresetWindows', () => {
  it('offers all phases when every event is detected', () => {
    const p = computePresetWindows(DOMAIN, 0, 65.3, 146.1);
    expect(p.map(x => x.label)).toEqual(['Full log', 'Jump', 'Freefall', 'Canopy', 'Landing ±15s']);
    expect(p[0].window).toBeNull();
    expectWindow(p[1].window, [-10, 161.1]); // exit−10 → landing+15
    expectWindow(p[2].window, [-3, 68.3]); // exit−3 → deploy+3
    expectWindow(p[3].window, [62.3, 149.1]); // deploy−3 → landing+3
    expectWindow(p[4].window, [131.1, 161.1]);
  });

  it('drops presets whose events are missing', () => {
    expect(computePresetWindows(DOMAIN, 0, undefined, 146.1).map(x => x.label))
      .toEqual(['Full log', 'Jump', 'Landing ±15s']);
    expect(computePresetWindows(DOMAIN, undefined, undefined, undefined).map(x => x.label))
      .toEqual(['Full log']);
  });

  it('clamps windows to the data domain', () => {
    // landing near the end of the log: +15 s would overrun
    const p = computePresetWindows([-812, 150], 0, 65.3, 146.1);
    const landing = p.find(x => x.label === 'Landing ±15s')!;
    expectWindow(landing.window, [131.1, 150]);
  });
});
