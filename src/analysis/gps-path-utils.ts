// lib/analysis/gps-path-utils.ts

import type { GPSPoint } from './log-parser';

export type JumpPhase = 'all' | 'climb' | 'freefall' | 'canopy' | 'landed';

// GeoJSON types for path rendering
export interface GeoJSONLineString {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
}

export interface GeoJSONPoint {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
}

export interface GeoJSONPointCollection {
  type: 'FeatureCollection';
  features: GeoJSONPoint[];
}

// Phase colors matching the altitude chart event markers
export const PHASE_COLORS = {
  climb: '#00ff88',    // Green - matches Exit marker
  freefall: '#ffaa00', // Orange - matches Deploy marker
  canopy: '#ff3355',   // Red - matches Landing marker
  landed: '#555555',   // Dark gray - after landing
  all: '#ddff55'       // Tempo brand color - fallback
} as const;

export interface GPSBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/**
 * Convert GPS points array to a GeoJSON LineString feature
 */
export function gpsToGeoJSON(gpsData: GPSPoint[]): GeoJSONLineString {
  const coordinates: [number, number][] = gpsData.map(point => [point.longitude, point.latitude]);

  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates
    }
  };
}

/**
 * Convert GPS points to GeoJSON with properties for each point
 * Used for hover interactions where we need access to point data
 */
export function gpsToGeoJSONWithProperties(gpsData: GPSPoint[]): GeoJSONLineString {
  const coordinates: [number, number][] = gpsData.map(point => [point.longitude, point.latitude]);

  return {
    type: 'Feature',
    properties: {
      // Store point data as arrays for retrieval during hover
      timestamps: gpsData.map(p => p.timestamp),
      groundspeeds: gpsData.map(p => p.groundspeed_kmph ?? null),
      altitudes: gpsData.map(p => p.altitude_ftAGL)
    },
    geometry: {
      type: 'LineString',
      coordinates
    }
  };
}

/**
 * Create a GeoJSON FeatureCollection of points for hover detection
 */
export function gpsToPointFeatures(
  gpsData: GPSPoint[],
  exitOffset?: number,
  deploymentOffset?: number,
  landingOffset?: number
): GeoJSONPointCollection {
  const features: GeoJSONPoint[] = gpsData.map((point, index) => {
    const phase = getPhaseForTimestamp(point.timestamp, exitOffset, deploymentOffset, landingOffset);

    return {
      type: 'Feature' as const,
      properties: {
        index,
        timestamp: point.timestamp,
        groundspeed_kmph: point.groundspeed_kmph ?? null,
        groundspeed_mph: point.groundspeed_kmph ? kmphToMph(point.groundspeed_kmph) : null,
        altitude: point.altitude_ftAGL,
        heading: point.groundTrack_degT ?? null,
        phase
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [point.longitude, point.latitude] as [number, number]
      }
    };
  });

  return {
    type: 'FeatureCollection',
    features
  };
}

/**
 * Determine which phase a timestamp falls into
 */
export function getPhaseForTimestamp(
  timestamp: number,
  exitOffset?: number,
  deploymentOffset?: number,
  landingOffset?: number
): JumpPhase {
  if (exitOffset === undefined) return 'all';

  if (timestamp < exitOffset) {
    return 'climb';
  }

  if (deploymentOffset !== undefined && timestamp >= exitOffset && timestamp < deploymentOffset) {
    return 'freefall';
  }

  if (landingOffset !== undefined && timestamp >= landingOffset) {
    return 'landed';
  }

  if (deploymentOffset !== undefined && timestamp >= deploymentOffset) {
    return 'canopy';
  }

  // Default if we only have exit offset
  return timestamp >= exitOffset ? 'freefall' : 'climb';
}

/**
 * Filter GPS points by jump phase
 */
export function filterByPhase(
  gpsData: GPSPoint[],
  phase: JumpPhase,
  exitOffset?: number,
  deploymentOffset?: number,
  landingOffset?: number
): GPSPoint[] {
  if (phase === 'all') {
    return gpsData;
  }

  return gpsData.filter(point => {
    const pointPhase = getPhaseForTimestamp(
      point.timestamp,
      exitOffset,
      deploymentOffset,
      landingOffset
    );
    return pointPhase === phase;
  });
}

/**
 * Calculate bounding box for GPS points
 * Returns [west, south, east, north] (minLon, minLat, maxLon, maxLat)
 */
export function calculateBounds(gpsData: GPSPoint[]): [number, number, number, number] | null {
  if (gpsData.length === 0) {
    return null;
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  for (const point of gpsData) {
    minLat = Math.min(minLat, point.latitude);
    maxLat = Math.max(maxLat, point.latitude);
    minLon = Math.min(minLon, point.longitude);
    maxLon = Math.max(maxLon, point.longitude);
  }

  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Calculate center point of GPS data
 */
export function calculateCenter(gpsData: GPSPoint[]): [number, number] | null {
  if (gpsData.length === 0) {
    return null;
  }

  const bounds = calculateBounds(gpsData);
  if (!bounds) return null;

  const [minLon, minLat, maxLon, maxLat] = bounds;
  return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
}

/**
 * Convert kilometers per hour to miles per hour
 */
export function kmphToMph(kmph: number): number {
  return kmph * 0.621371;
}

/**
 * Convert meters per second to miles per hour
 */
export function mpsToMph(mps: number): number {
  return mps * 2.23694;
}

/**
 * Format groundspeed for display
 */
export function formatGroundspeed(speedKmph: number | null | undefined): string {
  if (speedKmph === null || speedKmph === undefined) {
    return 'N/A';
  }
  const mph = kmphToMph(speedKmph);
  return `${Math.round(mph)} mph`;
}

/**
 * Get human-readable phase label
 */
export function getPhaseLabel(phase: JumpPhase): string {
  switch (phase) {
    case 'all': return 'All Phases';
    case 'climb': return 'Climb-out';
    case 'freefall': return 'Freefall';
    case 'canopy': return 'Under Canopy';
    case 'landed': return 'Landed';
    default: return 'Unknown';
  }
}

/**
 * Segment GPS data by phase for color-coded rendering
 * Returns an array of segments, each with phase and GeoJSON LineString
 */
export interface PhaseSegment {
  phase: JumpPhase;
  color: string;
  data: GPSPoint[];
  geojson: GeoJSONLineString;
}

export function segmentByPhase(
  gpsData: GPSPoint[],
  exitOffset?: number,
  deploymentOffset?: number,
  landingOffset?: number
): PhaseSegment[] {
  if (gpsData.length === 0) return [];

  // If no event offsets, return single segment with 'all' phase
  if (exitOffset === undefined) {
    return [{
      phase: 'all',
      color: PHASE_COLORS.all,
      data: gpsData,
      geojson: gpsToGeoJSON(gpsData)
    }];
  }

  const segments: PhaseSegment[] = [];
  let currentPhase: JumpPhase | null = null;
  let currentSegment: GPSPoint[] = [];

  for (let i = 0; i < gpsData.length; i++) {
    const point = gpsData[i];
    const phase = getPhaseForTimestamp(point.timestamp, exitOffset, deploymentOffset, landingOffset);

    if (phase !== currentPhase) {
      // Save previous segment if it exists
      if (currentSegment.length > 0 && currentPhase !== null) {
        // Add the first point of the new segment to the end of the previous
        // to ensure line continuity
        const segmentWithOverlap = [...currentSegment];
        if (i < gpsData.length) {
          segmentWithOverlap.push(point);
        }
        segments.push({
          phase: currentPhase,
          color: PHASE_COLORS[currentPhase],
          data: currentSegment,
          geojson: gpsToGeoJSON(segmentWithOverlap)
        });
      }

      // Start new segment
      currentPhase = phase;
      currentSegment = [point];
    } else {
      currentSegment.push(point);
    }
  }

  // Don't forget the last segment
  if (currentSegment.length > 0 && currentPhase !== null) {
    segments.push({
      phase: currentPhase,
      color: PHASE_COLORS[currentPhase],
      data: currentSegment,
      geojson: gpsToGeoJSON(currentSegment)
    });
  }

  return segments;
}

/**
 * Find the closest GPS point to a given coordinate
 * Returns the index of the closest point and the distance in meters
 */
export function findClosestPoint(
  gpsData: GPSPoint[],
  lon: number,
  lat: number
): { index: number; distance: number } | null {
  if (gpsData.length === 0) return null;

  let closestIndex = 0;
  let minDistance = Infinity;

  for (let i = 0; i < gpsData.length; i++) {
    const point = gpsData[i];
    const distance = haversineDistance(lat, lon, point.latitude, point.longitude);

    if (distance < minDistance) {
      minDistance = distance;
      closestIndex = i;
    }
  }

  return { index: closestIndex, distance: minDistance };
}

/**
 * Calculate distance between two points using Haversine formula
 * Returns distance in meters
 */
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}
