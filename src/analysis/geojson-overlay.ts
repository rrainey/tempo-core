// analysis/geojson-overlay.ts
// GeoJSON overlay types and utilities.
// Ported from tempo-insights (src/lib/overlays/geojson-overlay.ts) for use by
// map components such as GNSSPathMap. App/storage-specific metadata (upload
// bookkeeping, DB ids) was intentionally left behind — this module carries only
// the pure, rendering-relevant pieces.

export interface GeoJSONFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: {
    type: 'Polygon' | 'MultiPolygon' | 'LineString' | 'MultiLineString' | 'Point' | 'MultiPoint';
    coordinates: number[] | number[][] | number[][][] | number[][][][];
  };
  id?: number | string;
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

/**
 * Calculate bounding box from GeoJSON feature collection
 */
export function calculateGeoJSONBounds(
  geojson: GeoJSONFeatureCollection
): { minLon: number; minLat: number; maxLon: number; maxLat: number } | null {
  if (!geojson.features || geojson.features.length === 0) {
    return null;
  }

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  const processCoordinates = (coords: number[] | number[][] | number[][][] | number[][][][]) => {
    if (typeof coords[0] === 'number') {
      // Point: [lon, lat]
      const [lon, lat] = coords as number[];
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    } else {
      // Array of coordinates - recurse
      for (const coord of coords) {
        processCoordinates(coord as number[] | number[][] | number[][][]);
      }
    }
  };

  for (const feature of geojson.features) {
    if (feature.geometry && feature.geometry.coordinates) {
      processCoordinates(feature.geometry.coordinates);
    }
  }

  if (minLon === Infinity) return null;

  return { minLon, minLat, maxLon, maxLat };
}

/**
 * Check if two bounding boxes intersect
 */
export function boundsIntersect(
  bounds1: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  bounds2: { minLon: number; minLat: number; maxLon: number; maxLat: number }
): boolean {
  return !(
    bounds1.maxLon < bounds2.minLon ||
    bounds1.minLon > bounds2.maxLon ||
    bounds1.maxLat < bounds2.minLat ||
    bounds1.minLat > bounds2.maxLat
  );
}

/**
 * Validate GeoJSON structure
 */
export function validateGeoJSON(data: unknown): { valid: boolean; error?: string } {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Invalid JSON object' };
  }

  const obj = data as Record<string, unknown>;

  if (obj.type !== 'FeatureCollection') {
    return { valid: false, error: 'Root type must be FeatureCollection' };
  }

  if (!Array.isArray(obj.features)) {
    return { valid: false, error: 'features must be an array' };
  }

  for (let i = 0; i < obj.features.length; i++) {
    const feature = obj.features[i] as Record<string, unknown>;

    if (feature.type !== 'Feature') {
      return { valid: false, error: `Feature ${i} must have type "Feature"` };
    }

    if (!feature.geometry || typeof feature.geometry !== 'object') {
      return { valid: false, error: `Feature ${i} must have a geometry object` };
    }

    const geometry = feature.geometry as Record<string, unknown>;
    const validTypes = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'];

    if (!validTypes.includes(geometry.type as string)) {
      return { valid: false, error: `Feature ${i} has invalid geometry type: ${geometry.type}` };
    }

    if (!Array.isArray(geometry.coordinates)) {
      return { valid: false, error: `Feature ${i} must have coordinates array` };
    }
  }

  return { valid: true };
}

/**
 * Default overlay style
 */
export const DEFAULT_OVERLAY_STYLE = {
  fillColor: '#3388ff',
  fillOpacity: 0.2,
  strokeColor: '#3388ff',
  strokeWidth: 2
};

/**
 * Landing area overlay style (for DZ areas)
 */
export const LANDING_AREA_STYLE = {
  fillColor: '#22cc44',
  fillOpacity: 0.15,
  strokeColor: '#22cc44',
  strokeWidth: 2
};
