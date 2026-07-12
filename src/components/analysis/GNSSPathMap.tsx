// components/analysis/GNSSPathMap.tsx
//
// Per-jumper GNSS flight-path map. Ported from tempo-insights
// (src/components/home/GNSSPathMap.tsx). Key differences from the insights
// original:
//   - Tiles are fetched directly from OpenStreetMap over the internet (no local
//     caching proxy). The tile URL is a prop (`tileUrl`) so consumers can swap
//     in their own tile server if desired.
//   - Overlay types are sourced from @tempo/core (../../analysis/geojson-overlay)
//     rather than an app-local module.

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Card, Text, Group, SegmentedControl, Stack, Paper, Badge } from '@mantine/core';
import { IconMap2, IconParachute, IconPlane, IconCloud, IconFlag } from '@tabler/icons-react';
import maplibregl from 'maplibre-gl';
import type { GPSPoint } from '../../analysis/log-parser';
import {
  type JumpPhase,
  type PhaseSegment,
  PHASE_COLORS,
  filterByPhase,
  gpsToPointFeatures,
  segmentByPhase,
  calculateBounds,
  calculateDescentBounds,
  calculateCenter,
  formatGroundspeed,
  getPhaseLabel
} from '../../analysis/gps-path-utils';
import {
  type GeoJSONFeatureCollection,
  LANDING_AREA_STYLE
} from '../../analysis/geojson-overlay';

// Default OpenStreetMap raster tile endpoint. Fetched live over the internet;
// suitable for low-volume analysis use. See the OSM tile usage policy for
// heavier workloads: https://operations.osmfoundation.org/policies/tiles/
const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

function formatAltitudeAGL(feet: number | null): string {
  return feet !== null ? `${Math.round(feet).toLocaleString()} ft AGL` : '—';
}

// Stable default for `overlays`: an inline `= []` default would be a fresh array
// reference on every render, and `overlays` is a dependency of the map-init
// effect — the map would be destroyed and recreated in an endless loop, never
// painting a frame (and re-fetching tiles continuously).
const NO_OVERLAYS: GeoJSONFeatureCollection[] = [];

interface GNSSPathMapProps {
  gpsData: GPSPoint[];
  exitOffsetSec?: number;
  deploymentOffsetSec?: number;
  landingOffsetSec?: number;
  overlays?: GeoJSONFeatureCollection[];
  /** Raster tile URL template ({z}/{x}/{y}). Defaults to OpenStreetMap. */
  tileUrl?: string;
}

interface HoverInfo {
  x: number;
  y: number;
  groundspeed: string;
  gnssAltAGL: number | null;
  baroAltAGL: number | null;
}

export function GNSSPathMap({
  gpsData,
  exitOffsetSec,
  deploymentOffsetSec,
  landingOffsetSec,
  overlays = NO_OVERLAYS,
  tileUrl = DEFAULT_TILE_URL
}: GNSSPathMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [selectedPhase, setSelectedPhase] = useState<JumpPhase>('all');
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Filter GPS data based on selected phase
  const filteredData = useMemo(() => filterByPhase(
    gpsData,
    selectedPhase,
    exitOffsetSec,
    deploymentOffsetSec,
    landingOffsetSec
  ), [gpsData, selectedPhase, exitOffsetSec, deploymentOffsetSec, landingOffsetSec]);

  // Segment data by phase for color-coded rendering
  const phaseSegments = useMemo(() => {
    const dataToSegment = selectedPhase === 'all' ? gpsData : filteredData;
    return segmentByPhase(dataToSegment, exitOffsetSec, deploymentOffsetSec, landingOffsetSec);
  }, [gpsData, filteredData, selectedPhase, exitOffsetSec, deploymentOffsetSec, landingOffsetSec]);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || gpsData.length === 0) return;

    const center = calculateCenter(gpsData);
    if (!center) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [tileUrl],
            tileSize: 256,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          }
        },
        layers: [
          {
            id: 'osm-tiles',
            type: 'raster',
            source: 'osm',
            minzoom: 0,
            maxzoom: 19
          }
        ]
      },
      center: center,
      zoom: 14
    });

    // Add navigation controls
    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    // Add scale control
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'imperial' }), 'bottom-left');

    map.on('load', () => {
      mapRef.current = map;
      setMapLoaded(true);

      // Add GeoJSON overlay layers first (so they appear under the flight path)
      overlays.forEach((overlay, index) => {
        const sourceId = `overlay-${index}`;

        map.addSource(sourceId, {
          type: 'geojson',
          // Cast to GeoJSON.FeatureCollection for MapLibre compatibility
          data: overlay as GeoJSON.FeatureCollection
        });

        // Add fill layer for polygons
        map.addLayer({
          id: `${sourceId}-fill`,
          type: 'fill',
          source: sourceId,
          paint: {
            'fill-color': LANDING_AREA_STYLE.fillColor,
            'fill-opacity': LANDING_AREA_STYLE.fillOpacity
          },
          filter: ['any',
            ['==', ['geometry-type'], 'Polygon'],
            ['==', ['geometry-type'], 'MultiPolygon']
          ]
        });

        // Add stroke layer for polygons and lines
        map.addLayer({
          id: `${sourceId}-stroke`,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': LANDING_AREA_STYLE.strokeColor,
            'line-width': LANDING_AREA_STYLE.strokeWidth
          },
          filter: ['any',
            ['==', ['geometry-type'], 'Polygon'],
            ['==', ['geometry-type'], 'MultiPolygon'],
            ['==', ['geometry-type'], 'LineString'],
            ['==', ['geometry-type'], 'MultiLineString']
          ]
        });
      });

      // Add sources for each phase segment (these will appear on top of overlays)
      const phases: JumpPhase[] = ['climb', 'freefall', 'canopy', 'landed'];

      phases.forEach(phase => {
        map.addSource(`path-${phase}`, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: [] }
          }
        });

        // Path outline for visibility
        map.addLayer({
          id: `path-${phase}-outline`,
          type: 'line',
          source: `path-${phase}`,
          layout: {
            'line-join': 'round',
            'line-cap': 'round'
          },
          paint: {
            'line-color': '#000000',
            'line-width': 5,
            'line-opacity': 0.3
          }
        });

        // Main colored path line
        map.addLayer({
          id: `path-${phase}-line`,
          type: 'line',
          source: `path-${phase}`,
          layout: {
            'line-join': 'round',
            'line-cap': 'round'
          },
          paint: {
            'line-color': PHASE_COLORS[phase],
            'line-width': 3
          }
        });
      });

      // Add points source for hover interaction
      map.addSource('points', {
        type: 'geojson',
        data: gpsToPointFeatures(gpsData, exitOffsetSec, deploymentOffsetSec, landingOffsetSec)
      });

      // Invisible points for hover detection
      map.addLayer({
        id: 'path-points',
        type: 'circle',
        source: 'points',
        paint: {
          'circle-radius': 8,
          'circle-color': 'transparent'
        }
      });

      // Initial view: focus on the descent (freefall + canopy) when jump
      // phases are known; otherwise frame the full track. Padding gives a
      // ~15%-of-map-edge margin around the framed extents.
      const bounds =
        calculateDescentBounds(gpsData, exitOffsetSec, landingOffsetSec) ??
        calculateBounds(gpsData);
      if (bounds) {
        map.fitBounds(bounds as [number, number, number, number], {
          padding: Math.round(map.getContainer().clientWidth * 0.15),
          maxZoom: 16
        });
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, [gpsData, overlays, tileUrl]); // Reinitialize when gpsData, overlays, or tile source change

  // Update path segments when phase filter or data changes
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const map = mapRef.current;
    const phases: JumpPhase[] = ['climb', 'freefall', 'canopy', 'landed'];

    // Clear all phase sources first
    phases.forEach(phase => {
      const source = map.getSource(`path-${phase}`) as maplibregl.GeoJSONSource;
      if (source) {
        source.setData({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [] }
        });
      }
    });

    // Update sources with segment data
    phaseSegments.forEach((segment: PhaseSegment) => {
      if (segment.phase === 'all') {
        // If no phase detection, show everything in the 'climb' layer with brand color
        const source = map.getSource('path-climb') as maplibregl.GeoJSONSource;
        if (source) {
          source.setData(segment.geojson);
        }
        // Override the color to brand color for 'all' phase
        map.setPaintProperty('path-climb-line', 'line-color', PHASE_COLORS.all);
      } else {
        const source = map.getSource(`path-${segment.phase}`) as maplibregl.GeoJSONSource;
        if (source) {
          source.setData(segment.geojson);
        }
      }
    });

    // Update points source
    const pointsSource = map.getSource('points') as maplibregl.GeoJSONSource;
    if (pointsSource) {
      pointsSource.setData(
        gpsToPointFeatures(filteredData, exitOffsetSec, deploymentOffsetSec, landingOffsetSec)
      );
    }

    // Fit bounds to the selection. "All" keeps the descent-focused framing
    // (falling back to the full track when phases are unknown) so it matches
    // the initial view; specific phases frame just their own points.
    const bounds =
      selectedPhase === 'all'
        ? calculateDescentBounds(gpsData, exitOffsetSec, landingOffsetSec) ??
          calculateBounds(gpsData)
        : calculateBounds(filteredData);
    if (bounds && filteredData.length > 1) {
      map.fitBounds(bounds as [number, number, number, number], {
        padding: Math.round(map.getContainer().clientWidth * 0.15),
        maxZoom: 16,
        duration: 500
      });
    }
  }, [phaseSegments, filteredData, gpsData, selectedPhase, mapLoaded, exitOffsetSec, deploymentOffsetSec, landingOffsetSec]);

  // Handle hover events
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const map = mapRef.current;

    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      // Query the points layer
      const features = map.queryRenderedFeatures(e.point, {
        layers: ['path-points']
      });

      if (features.length > 0) {
        const feature = features[0];
        const props = feature.properties;

        map.getCanvas().style.cursor = 'pointer';

        setHoverInfo({
          x: e.point.x,
          y: e.point.y,
          groundspeed: formatGroundspeed(props?.groundspeed_kmph),
          gnssAltAGL: typeof props?.gnssAlt_ftAGL === 'number' ? props.gnssAlt_ftAGL : null,
          baroAltAGL: typeof props?.baroAlt_ftAGL === 'number' ? props.baroAlt_ftAGL : null
        });
      } else {
        map.getCanvas().style.cursor = '';
        setHoverInfo(null);
      }
    };

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = '';
      setHoverInfo(null);
    };

    map.on('mousemove', handleMouseMove);
    map.on('mouseleave', 'path-points', handleMouseLeave);

    return () => {
      map.off('mousemove', handleMouseMove);
      map.off('mouseleave', 'path-points', handleMouseLeave);
    };
  }, [mapLoaded]);

  // Determine which phase options to show based on available data
  const getPhaseOptions = useCallback(() => {
    const options: { label: string; value: JumpPhase }[] = [
      { label: 'All', value: 'all' }
    ];

    if (exitOffsetSec !== undefined) {
      options.push({ label: 'Climb-out', value: 'climb' });
      options.push({ label: 'Freefall', value: 'freefall' });
    }

    if (deploymentOffsetSec !== undefined) {
      options.push({ label: 'Under Canopy', value: 'canopy' });
    }

    return options;
  }, [exitOffsetSec, deploymentOffsetSec]);

  const phaseOptions = getPhaseOptions();

  // Get phase color for badge
  const getPhaseColor = (phase: JumpPhase): string => {
    return PHASE_COLORS[phase] || PHASE_COLORS.all;
  };

  if (gpsData.length === 0) {
    return (
      <Card withBorder p="md">
        <Group gap="sm">
          <IconMap2 size={24} style={{ opacity: 0.5 }} />
          <Text c="dimmed">No GPS data available for this jump</Text>
        </Group>
      </Card>
    );
  }

  return (
    <Card withBorder p="md">
      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Group gap="xs">
            <IconMap2 size={20} />
            <Text fw={500}>Flight Path</Text>
          </Group>

          {phaseOptions.length > 1 && (
            <SegmentedControl
              size="xs"
              value={selectedPhase}
              onChange={(value) => setSelectedPhase(value as JumpPhase)}
              data={phaseOptions}
            />
          )}
        </Group>

        {/* Legend */}
        {exitOffsetSec !== undefined && (
          <Group gap="xs" justify="center">
            <Badge
              size="xs"
              variant="filled"
              style={{ backgroundColor: PHASE_COLORS.climb, color: '#000' }}
              leftSection={<IconPlane size={10} />}
            >
              Climb
            </Badge>
            <Badge
              size="xs"
              variant="filled"
              style={{ backgroundColor: PHASE_COLORS.freefall, color: '#000' }}
              leftSection={<IconParachute size={10} />}
            >
              Freefall
            </Badge>
            {deploymentOffsetSec !== undefined && (
              <Badge
                size="xs"
                variant="filled"
                style={{ backgroundColor: PHASE_COLORS.canopy, color: '#fff' }}
                leftSection={<IconCloud size={10} />}
              >
                Canopy
              </Badge>
            )}
            {landingOffsetSec !== undefined && (
              <Badge
                size="xs"
                variant="filled"
                style={{ backgroundColor: PHASE_COLORS.landed, color: '#fff' }}
                leftSection={<IconFlag size={10} />}
              >
                Landed
              </Badge>
            )}
          </Group>
        )}

        <div style={{ position: 'relative' }}>
          <div
            ref={mapContainerRef}
            style={{
              width: '100%',
              aspectRatio: '1 / 1',
              borderRadius: '8px',
              overflow: 'hidden'
            }}
          />

          {/* Hover tooltip */}
          {hoverInfo && (
            <Paper
              shadow="md"
              p="xs"
              style={{
                position: 'absolute',
                left: hoverInfo.x + 10,
                top: hoverInfo.y - 40,
                pointerEvents: 'none',
                zIndex: 1000,
                backgroundColor: 'var(--mantine-color-dark-7)',
                border: '1px solid var(--mantine-color-dark-4)'
              }}
            >
              <Stack gap={4}>
                <Group gap="xs">
                  <Text size="sm" fw={600}>{hoverInfo.groundspeed}</Text>
                </Group>
                <Text size="xs" c="dimmed">
                  GNSS: {formatAltitudeAGL(hoverInfo.gnssAltAGL)}
                </Text>
                <Text size="xs" c="dimmed">
                  Baro: {formatAltitudeAGL(hoverInfo.baroAltAGL)}
                </Text>
              </Stack>
            </Paper>
          )}
        </div>

        {/* Stats footer */}
        <Group gap="md" justify="center">
          <Badge variant="light" color="gray" size="sm">
            {filteredData.length} points
          </Badge>
          {selectedPhase !== 'all' && (
            <Badge
              variant="light"
              size="sm"
              style={{ backgroundColor: `${getPhaseColor(selectedPhase)}33`, color: getPhaseColor(selectedPhase) }}
            >
              {getPhaseLabel(selectedPhase)}
            </Badge>
          )}
        </Group>
      </Stack>
    </Card>
  );
}
