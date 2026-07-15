// components/analysis/jump-time-window.ts
//
// Pure window math for the unified time scrubber — dependency-free so it is
// trivially testable (the scrubber component itself pulls in Mantine/React).

export type TimeWindow = [number, number];

export interface PresetWindow {
  label: string;
  window: TimeWindow | null; // null = full log
}

/** Phase presets derived from the detected events, clamped to the data domain.
 *  Only presets whose events exist are offered. */
export function computePresetWindows(
  domain: TimeWindow,
  exitOffsetSec?: number,
  deploymentOffsetSec?: number,
  landingOffsetSec?: number
): PresetWindow[] {
  const clamp = (t: number) => Math.min(domain[1], Math.max(domain[0], t));
  const presets: PresetWindow[] = [{ label: 'Full log', window: null }];
  if (exitOffsetSec !== undefined && landingOffsetSec !== undefined) {
    presets.push({ label: 'Jump', window: [clamp(exitOffsetSec - 10), clamp(landingOffsetSec + 15)] });
  }
  if (exitOffsetSec !== undefined && deploymentOffsetSec !== undefined) {
    presets.push({ label: 'Freefall', window: [clamp(exitOffsetSec - 3), clamp(deploymentOffsetSec + 3)] });
  }
  if (deploymentOffsetSec !== undefined && landingOffsetSec !== undefined) {
    presets.push({ label: 'Canopy', window: [clamp(deploymentOffsetSec - 3), clamp(landingOffsetSec + 3)] });
  }
  if (landingOffsetSec !== undefined) {
    presets.push({ label: 'Landing ±15s', window: [clamp(landingOffsetSec - 15), clamp(landingOffsetSec + 15)] });
  }
  return presets;
}
