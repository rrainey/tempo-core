// lib/formation/coordinates.ts
import { Vector3, GeodeticCoordinates } from './types';
import { slerp } from './orientation-estimator';

export type AltitudeMode = 'GPS' | 'Barometric';

// Constants
const EARTH_RADIUS_M = 6371000; // Earth radius in meters (approximate)

/**
 * Convert WGS-84 geodetic coordinates to North-East-Down (NED) frame
 * relative to a dropzone center point
 */
export function wgs84ToNEDDZ(
  point: GeodeticCoordinates,
  dzCenter: GeodeticCoordinates
): Vector3 {
  // Convert degrees to radians
  const lat1 = dzCenter.lat_deg * Math.PI / 180;
  const lon1 = dzCenter.lon_deg * Math.PI / 180;
  const lat2 = point.lat_deg * Math.PI / 180;
  const lon2 = point.lon_deg * Math.PI / 180;

  // Calculate differences
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;

  // Calculate bearing using haversine formula components
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - 
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = Math.atan2(y, x); // radians from north

  // Calculate great circle distance
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = EARTH_RADIUS_M * c;

  // Convert to NED coordinates
  const north = distance * Math.cos(bearing);
  const east = distance * Math.sin(bearing);
  const down = dzCenter.alt_m - point.alt_m; // Positive down

  return { x: north, y: east, z: down };
}

/**
 * Transform NED coordinates from DZ frame to Base Exit Frame
 * Base Exit Frame: origin at base jumper position, X-axis along ground track
 */
export function nedDZToBaseExitFrame(
  nedPos: Vector3,
  baseNEDPos: Vector3,
  baseGroundTrack_deg: number
): Vector3 {
  // Translate to base position
  const translated = {
    x: nedPos.x - baseNEDPos.x,
    y: nedPos.y - baseNEDPos.y,
    z: nedPos.z - baseNEDPos.z
  };
  
  // Rotate to align with base jumper's ground track
  const rotation = -baseGroundTrack_deg * Math.PI / 180; // Negative for proper rotation direction
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  
  return {
    x: translated.x * cosR - translated.y * sinR,  // Forward along track
    y: translated.x * sinR + translated.y * cosR,  // Right
    z: translated.z                                 // Down
  };
}

/**
 * Interpolate position between time series samples
 */
export function interpolatePosition(
  timeSeries: TimeSeriesPoint[],
  timeOffset: number
): TimeSeriesPoint & { isInterpolated: boolean } {
  if (timeSeries.length === 0) {
    throw new Error('Cannot interpolate from empty time series');
  }

  // Handle edge cases
  if (timeOffset <= timeSeries[0].timeOffset) {
    return { ...timeSeries[0], isInterpolated: false };
  }
  if (timeOffset >= timeSeries[timeSeries.length - 1].timeOffset) {
    return { ...timeSeries[timeSeries.length - 1], isInterpolated: false };
  }

  // Find surrounding samples
  let before = timeSeries[0];
  let after = timeSeries[1];
  
  for (let i = 0; i < timeSeries.length - 1; i++) {
    if (timeSeries[i].timeOffset <= timeOffset && 
        timeSeries[i + 1].timeOffset > timeOffset) {
      before = timeSeries[i];
      after = timeSeries[i + 1];
      break;
    }
  }

  // Calculate interpolation factor
  const dt = after.timeOffset - before.timeOffset;
  const t = (timeOffset - before.timeOffset) / dt;
  
  // Check if this is a data gap (> 0.5s between samples for 4Hz GPS)
  const isInterpolated = dt > 0.5;
  
  // Linear interpolation for position
  const location = {
    lat_deg: before.location.lat_deg + t * (after.location.lat_deg - before.location.lat_deg),
    lon_deg: before.location.lon_deg + t * (after.location.lon_deg - before.location.lon_deg),
    alt_m: before.location.alt_m + t * (after.location.alt_m - before.location.alt_m)
  };
  
  // Linear interpolation for barometric altitude
  const baroAlt_ft = before.baroAlt_ft + t * (after.baroAlt_ft - before.baroAlt_ft);

  // Linear interpolation for calibrated barometric altitude
  const adjBaroAlt_ftAGL = (before.adjBaroAlt_ftAGL != null && after.adjBaroAlt_ftAGL != null)
    ? before.adjBaroAlt_ftAGL + t * (after.adjBaroAlt_ftAGL - before.adjBaroAlt_ftAGL)
    : undefined;

  // Linear interpolation for timeSinceMidnight_sec (cross-device alignment reference)
  const timeSinceMidnight_sec = (before.timeSinceMidnight_sec != null && after.timeSinceMidnight_sec != null)
    ? before.timeSinceMidnight_sec + t * (after.timeSinceMidnight_sec - before.timeSinceMidnight_sec)
    : (before.timeSinceMidnight_sec ?? after.timeSinceMidnight_sec);

  // Use latest values for track and speed (more accurate than interpolation)
  const groundtrack_degT = after.groundtrack_degT || before.groundtrack_degT;
  const groundspeed_kmph = after.groundspeed_kmph || before.groundspeed_kmph;
  
  // Interpolate pre-computed vertical speed (GNSS-derived, stored at load time)
  // rather than recomputing from raw baro deltas which amplifies sensor noise.
  const verticalSpeed_mps = (before.verticalSpeed_mps != null && after.verticalSpeed_mps != null)
    ? before.verticalSpeed_mps + t * (after.verticalSpeed_mps - before.verticalSpeed_mps)
    : (before.verticalSpeed_mps ?? after.verticalSpeed_mps);

  // SLERP interpolation for orientation quaternion
  const orientation_q = (before.orientation_q && after.orientation_q)
    ? slerp(before.orientation_q, after.orientation_q, t)
    : (before.orientation_q || after.orientation_q);

  return {
    timeOffset,
    timeSinceMidnight_sec,
    location,
    baroAlt_ft,
    adjBaroAlt_ftAGL,
    groundtrack_degT,
    groundspeed_kmph,
    verticalSpeed_mps,
    normalizedFallRate_mph: (before.normalizedFallRate_mph != null && after.normalizedFallRate_mph != null)
      ? before.normalizedFallRate_mph + t * (after.normalizedFallRate_mph - before.normalizedFallRate_mph)
      : (before.normalizedFallRate_mph ?? after.normalizedFallRate_mph),
    orientation_q,
    isInterpolated
  };
}

/**
 * Interpolate position at a given timeSinceMidnight_sec value.
 * Used for cross-device alignment: given an absolute UTC-derived time,
 * find the position in any device's timeline.
 */
export function interpolateAtMidnightTime(
  timeSeries: TimeSeriesPoint[],
  targetMidnightSec: number
): (TimeSeriesPoint & { isInterpolated: boolean }) | null {
  if (timeSeries.length === 0) return null;

  // Find first and last entries with timeSinceMidnight_sec
  let firstIdx = -1;
  let lastIdx = -1;
  for (let i = 0; i < timeSeries.length; i++) {
    if (timeSeries[i].timeSinceMidnight_sec != null) {
      if (firstIdx === -1) firstIdx = i;
      lastIdx = i;
    }
  }
  if (firstIdx === -1) return null;

  // Clamp to bounds
  if (targetMidnightSec <= timeSeries[firstIdx].timeSinceMidnight_sec!) {
    return { ...timeSeries[firstIdx], isInterpolated: false };
  }
  if (targetMidnightSec >= timeSeries[lastIdx].timeSinceMidnight_sec!) {
    return { ...timeSeries[lastIdx], isInterpolated: false };
  }

  // Find bracketing samples
  let before = timeSeries[firstIdx];
  let after = timeSeries[firstIdx];
  for (let i = firstIdx; i < lastIdx; i++) {
    const cur = timeSeries[i];
    const next = timeSeries[i + 1];
    if (cur.timeSinceMidnight_sec != null && next.timeSinceMidnight_sec != null &&
        cur.timeSinceMidnight_sec <= targetMidnightSec &&
        next.timeSinceMidnight_sec > targetMidnightSec) {
      before = cur;
      after = next;
      break;
    }
  }

  // Compute interpolation factor in midnight-time space, then convert
  // to the equivalent timeOffset and delegate to interpolatePosition()
  // so all field interpolation logic stays in one place.
  const dt = after.timeSinceMidnight_sec! - before.timeSinceMidnight_sec!;
  if (dt === 0) return { ...before, isInterpolated: false };
  const t = (targetMidnightSec - before.timeSinceMidnight_sec!) / dt;
  const interpTimeOffset = before.timeOffset + t * (after.timeOffset - before.timeOffset);

  return interpolatePosition(timeSeries, interpTimeOffset);
}

/**
 * Fall rate calibration table from coordinate-frames.md
 */
const FALL_RATE_CALIBRATION = [
  { alt_ft: 20000, factor: 0.8107 },
  { alt_ft: 18000, factor: 0.8385 },
  { alt_ft: 16000, factor: 0.8667 },
  { alt_ft: 14000, factor: 0.8955 },
  { alt_ft: 12000, factor: 0.9247 },
  { alt_ft: 10000, factor: 0.9545 },
  { alt_ft: 9000, factor: 0.9695 },
  { alt_ft: 8000, factor: 0.9847 },
  { alt_ft: 7000, factor: 1.0000 },
  { alt_ft: 6000, factor: 1.0154 },
  { alt_ft: 5000, factor: 1.0310 },
  { alt_ft: 4000, factor: 1.0467 },
  { alt_ft: 3000, factor: 1.0625 },
  { alt_ft: 2000, factor: 1.0784 },
  { alt_ft: 1000, factor: 1.0945 },
  { alt_ft: 0, factor: 1.1107 }
];

/**
 * Linear interpolation helper
 */
function lerp(x: number, x0: number, x1: number, y0: number, y1: number): number {
  return y0 + (x - x0) * (y1 - y0) / (x1 - x0);
}

/**
 * Calibrate fall rate to normalize for air density changes
 * Returns fall rate normalized to 7000ft reference altitude
 */
export function calibrateFallRate(
  verticalSpeed_mps: number,
  altitude_ft: number
): number {
  // Find surrounding calibration points
  let lower = FALL_RATE_CALIBRATION[0];
  let upper = FALL_RATE_CALIBRATION[0];
  
  for (let i = 0; i < FALL_RATE_CALIBRATION.length - 1; i++) {
    if (altitude_ft >= FALL_RATE_CALIBRATION[i + 1].alt_ft &&
        altitude_ft <= FALL_RATE_CALIBRATION[i].alt_ft) {
      upper = FALL_RATE_CALIBRATION[i];
      lower = FALL_RATE_CALIBRATION[i + 1];
      break;
    }
  }
  
  // Handle edge cases
  if (altitude_ft > FALL_RATE_CALIBRATION[0].alt_ft) {
    upper = lower = FALL_RATE_CALIBRATION[0];
  } else if (altitude_ft < FALL_RATE_CALIBRATION[FALL_RATE_CALIBRATION.length - 1].alt_ft) {
    upper = lower = FALL_RATE_CALIBRATION[FALL_RATE_CALIBRATION.length - 1];
  }
  
  // Interpolate calibration factor
  const factor = upper === lower ? upper.factor :
    lerp(altitude_ft, lower.alt_ft, upper.alt_ft, lower.factor, upper.factor);
  
  // Convert to mph and apply calibration
  const uncalibrated_mph = Math.abs(verticalSpeed_mps) * 2.23694;
  return uncalibrated_mph * factor;
}

/**
 * Project all formation participants at a given time
 */
export function projectFormationAtTime(
  participants: ParticipantData[],
  timeOffset: number,
  baseJumperId: string,
  dzCenter: GeodeticCoordinates,
  altitudeMode: AltitudeMode = 'GPS',
  jumpRunTrack_degT?: number
): ProjectedPosition[] {
  // Find base jumper
  const baseParticipant = participants.find(p => p.userId === baseJumperId);
  if (!baseParticipant || baseParticipant.timeSeries.length === 0) {
    throw new Error('Base jumper not found or has no data');
  }

  // Interpolate base position at current time (using base jumper's own timeOffset)
  const baseData = interpolatePosition(baseParticipant.timeSeries, timeOffset);
  const baseNEDPos = wgs84ToNEDDZ(baseData.location, dzCenter);

  // The base jumper's timeSinceMidnight_sec at this slider position — used to
  // look up all other participants at the same real-world instant.
  const baseMidnightSec = baseData.timeSinceMidnight_sec;

  // Use the jump run track established at exit, not the instantaneous GPS ground track.
  // The base exit frame azimuth is fixed for the entire jump.
  const baseGroundTrack = jumpRunTrack_degT ?? baseData.groundtrack_degT ?? 0;

  // In Barometric mode, override base NED Z with calibrated baro altitude
  if (altitudeMode === 'Barometric') {
    const baseBaroAlt_m = (baseData.adjBaroAlt_ftAGL ?? baseData.baroAlt_ft) * 0.3048;
    baseNEDPos.z = -baseBaroAlt_m; // NED Down is negative altitude
  }

  // Project all participants
  return participants
    .filter(p => p.isVisible && p.timeSeries.length > 0)
    .map(participant => {
      // For the base jumper, use timeOffset directly (already computed).
      // For other participants, use timeSinceMidnight_sec for cross-device
      // alignment so that all positions correspond to the same UTC instant.
      let data: TimeSeriesPoint & { isInterpolated: boolean };
      if (participant.userId === baseJumperId) {
        data = baseData;
      } else if (baseMidnightSec != null) {
        const synced = interpolateAtMidnightTime(participant.timeSeries, baseMidnightSec);
        data = synced ?? interpolatePosition(participant.timeSeries, timeOffset);
      } else {
        data = interpolatePosition(participant.timeSeries, timeOffset);
      }

      // Transform to NED,DZ then to Base Exit Frame
      const nedPos = wgs84ToNEDDZ(data.location, dzCenter);

      // In Barometric mode, override NED Z with calibrated baro altitude
      if (altitudeMode === 'Barometric') {
        const baroAlt_m = (data.adjBaroAlt_ftAGL ?? data.baroAlt_ft) * 0.3048;
        nedPos.z = -baroAlt_m; // NED Down is negative altitude
      }

      const projected = nedDZToBaseExitFrame(nedPos, baseNEDPos, baseGroundTrack);

      // Calibrate fall rate
      let normalizedFallRate_mph: number | undefined = undefined;
      if (data.verticalSpeed_mps) {
        normalizedFallRate_mph = calibrateFallRate(
          data.verticalSpeed_mps,
          data.baroAlt_ft
        );
      }

      return {
        userId: participant.userId,
        name: participant.name,
        color: participant.color,
        position: projected,
        isDataGap: data.isInterpolated,
        orientation_q: data.orientation_q,
        metrics: {
          baroAlt_ft: data.baroAlt_ft,
          adjBaroAlt_ftAGL: data.adjBaroAlt_ftAGL,
          verticalSpeed_mps: data.verticalSpeed_mps,
          normalizedFallRate_mph,
          groundtrack_degT: data.groundtrack_degT,
          groundspeed_kmph: data.groundspeed_kmph
        }
      };
    });
}

/**
 * Recalibrate adjBaroAlt_ftAGL for all participants relative to a new base jumper.
 * Uses refBaroAlt_ft (stored per participant at the calibration reference time)
 * to compute: scaleFactor = refBaro[newBase] / refBaro[jumper].
 * Returns a new participants array with updated adjBaroAlt_ftAGL values.
 */
export function recalibrateForBase(
  participants: ParticipantData[],
  newBaseId: string
): ParticipantData[] {
  const baseParticipant = participants.find(p => p.userId === newBaseId);
  const baseRef = baseParticipant?.refBaroAlt_ft;

  return participants.map(p => {
    let scaleFactor = 1.0;

    if (baseRef && baseRef > 100 && p.refBaroAlt_ft && p.refBaroAlt_ft > 100) {
      const candidate = baseRef / p.refBaroAlt_ft;
      if (candidate >= 0.90 && candidate <= 1.10) {
        scaleFactor = candidate;
      }
    }

    const newTimeSeries = p.timeSeries.map(pt => ({
      ...pt,
      adjBaroAlt_ftAGL: pt.baroAlt_ft * scaleFactor,
    }));

    return { ...p, timeSeries: newTimeSeries };
  });
}

// Type definitions for the module
export interface TimeSeriesPoint {
  timeOffset: number;
  timeSinceMidnight_sec?: number;  // seconds since midnight UTC — common across all devices
  timestamp?: Date;
  location: GeodeticCoordinates;
  baroAlt_ft: number;
  adjBaroAlt_ftAGL?: number;
  groundspeed_kmph?: number;
  groundtrack_degT?: number;
  verticalSpeed_mps?: number;
  normalizedFallRate_mph?: number;
  orientation_q?: { w: number; x: number; y: number; z: number };
}

export interface ParticipantData {
  userId: string;
  jumpLogId: string;
  name: string;
  color: string;
  isBase: boolean;
  isVisible: boolean;
  timeSeries: TimeSeriesPoint[];
  refBaroAlt_ft?: number; // baro reading at calibration reference time (for cross-device recalibration)
}

export interface ProjectedPosition {
  userId: string;
  name: string;
  color: string;
  position: Vector3;
  isDataGap: boolean;
  orientation_q?: { w: number; x: number; y: number; z: number };
  metrics: {
    baroAlt_ft: number;
    adjBaroAlt_ftAGL?: number;
    verticalSpeed_mps?: number;
    normalizedFallRate_mph?: number;
    groundtrack_degT?: number;
    groundspeed_kmph?: number;
  };
}