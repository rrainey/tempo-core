// components/analysis/AltitudeComparisonChart.tsx

import React, { useMemo, useState, useCallback } from 'react';
import { Card, Text, Group, Badge, Slider, Stack } from '@mantine/core';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Brush,
} from 'recharts';
import { TimeSeriesPoint } from '../../lib/analysis/log-parser';

const METERS_TO_FEET = 3.28084;

interface ChartDataPoint {
  time: number;
  baroAlt: number | undefined;
  gpsAlt: number | undefined;
  pressure: number | undefined;
}

interface AltitudeComparisonChartProps {
  baroAltitudeData: TimeSeriesPoint[];
  gpsAltitudeData: TimeSeriesPoint[];
  staticPressureData: TimeSeriesPoint[];
  dzSurfacePressureAltitude_m: number;
}

export function AltitudeComparisonChart({
  baroAltitudeData,
  gpsAltitudeData,
  staticPressureData,
  dzSurfacePressureAltitude_m,
}: AltitudeComparisonChartProps) {
  const dzElevation_ft = dzSurfacePressureAltitude_m * METERS_TO_FEET;

  // Merge all sources into a unified time-aligned array
  const chartData = useMemo(() => {
    const dataMap = new Map<number, ChartDataPoint>();

    for (const pt of baroAltitudeData) {
      const t = Math.round(pt.timestamp * 10) / 10;
      const existing = dataMap.get(t);
      if (existing) {
        existing.baroAlt = pt.value + dzElevation_ft;
      } else {
        dataMap.set(t, { time: t, baroAlt: pt.value + dzElevation_ft, gpsAlt: undefined, pressure: undefined });
      }
    }

    for (const pt of gpsAltitudeData) {
      const t = Math.round(pt.timestamp * 10) / 10;
      const existing = dataMap.get(t);
      if (existing) {
        existing.gpsAlt = pt.value;
      } else {
        dataMap.set(t, { time: t, baroAlt: undefined, gpsAlt: pt.value, pressure: undefined });
      }
    }

    for (const pt of staticPressureData) {
      const t = Math.round(pt.timestamp * 10) / 10;
      const existing = dataMap.get(t);
      if (existing) {
        existing.pressure = pt.value;
      } else {
        dataMap.set(t, { time: t, baroAlt: undefined, gpsAlt: undefined, pressure: pt.value });
      }
    }

    return Array.from(dataMap.values()).sort((a, b) => a.time - b.time);
  }, [baroAltitudeData, gpsAltitudeData, staticPressureData, dzElevation_ft]);

  // Baro-GPS comparison stats
  const stats = useMemo(() => {
    let diffSum = 0;
    let diffSqSum = 0;
    let diffCount = 0;
    let maxDiff = -Infinity;
    let minDiff = Infinity;

    for (const pt of chartData) {
      if (pt.baroAlt !== undefined && pt.gpsAlt !== undefined) {
        const diff = pt.baroAlt - pt.gpsAlt;
        diffSum += diff;
        diffSqSum += diff * diff;
        diffCount++;
        if (diff > maxDiff) maxDiff = diff;
        if (diff < minDiff) minDiff = diff;
      }
    }
    if (diffCount === 0) return null;

    const meanDiff = diffSum / diffCount;
    const stdDiff = Math.sqrt(Math.max(0, diffSqSum / diffCount - meanDiff * meanDiff));
    return { meanDiff, stdDiff, maxDiff, minDiff, count: diffCount };
  }, [chartData]);

  // Pressure noise (first-difference sigma)
  const pressureStats = useMemo(() => {
    const pts = chartData.filter(d => d.pressure !== undefined).map(d => d.pressure!);
    if (pts.length < 2) return null;

    let diffSum = 0;
    let diffSqSum = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = pts[i] - pts[i - 1];
      diffSum += d;
      diffSqSum += d * d;
    }
    const n = pts.length - 1;
    const meanDiff = diffSum / n;
    const noiseSigma = Math.sqrt(Math.max(0, diffSqSum / n - meanDiff * meanDiff));
    return { noiseSigma_hPa: noiseSigma, samples: pts.length };
  }, [chartData]);

  // Y-axis bounds
  const yMin = useMemo(() => {
    const alts = chartData.flatMap(d => {
      const v: number[] = [];
      if (d.baroAlt !== undefined) v.push(d.baroAlt);
      if (d.gpsAlt !== undefined) v.push(d.gpsAlt);
      return v;
    });
    if (alts.length === 0) return 0;
    const min = Math.min(...alts);
    const range = Math.max(...alts) - min;
    return Math.max(0, min - range * 0.05);
  }, [chartData]);

  const yMax = useMemo(() => {
    const alts = chartData.flatMap(d => {
      const v: number[] = [];
      if (d.baroAlt !== undefined) v.push(d.baroAlt);
      if (d.gpsAlt !== undefined) v.push(d.gpsAlt);
      return v;
    });
    if (alts.length === 0) return 1000;
    const max = Math.max(...alts);
    const range = max - Math.min(...alts);
    return max + range * 0.05;
  }, [chartData]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const data = payload[0]?.payload as ChartDataPoint | undefined;
    if (!data) return null;
    return (
      <Card p="xs" withBorder style={{ fontSize: '0.8rem' }}>
        <Text size="sm" fw={500}>{Number(label).toFixed(1)}s</Text>
        {data.baroAlt !== undefined && (
          <Text size="xs" c="#66ccff">Baro: {data.baroAlt.toFixed(0)} ft MSL</Text>
        )}
        {data.gpsAlt !== undefined && (
          <Text size="xs" c="#ff9944">GPS: {data.gpsAlt.toFixed(0)} ft MSL</Text>
        )}
        {data.baroAlt !== undefined && data.gpsAlt !== undefined && (
          <Text size="xs" c="dimmed">
            {'\u0394'} {(data.baroAlt - data.gpsAlt).toFixed(0)} ft
          </Text>
        )}
        {data.pressure !== undefined && (
          <Text size="xs" c="#88cc88">Pressure: {data.pressure.toFixed(2)} hPa</Text>
        )}
      </Card>
    );
  };

  if (chartData.length === 0) {
    return (
      <Card withBorder p="md">
        <Text c="dimmed" ta="center">No altitude comparison data available</Text>
      </Card>
    );
  }

  const hasGPS = gpsAltitudeData.length > 0;
  const hasPressure = staticPressureData.length > 0;

  return (
    <Card withBorder p="md">
      <Group justify="space-between" mb="xs">
        <Text fw={500}>Altitude Source Comparison</Text>
        <Group gap="xs">
          <Badge size="xs" color="cyan" variant="light">Baro (MSL)</Badge>
          {hasGPS && <Badge size="xs" color="orange" variant="light">GPS (MSL)</Badge>}
          {hasPressure && <Badge size="xs" color="green" variant="light">Pressure</Badge>}
        </Group>
      </Group>

      <Text size="xs" c="dimmed" mb="sm">
        Use the brush control below the chart to zoom into a time segment.
      </Text>

      <ResponsiveContainer width="100%" height={380}>
        <LineChart
          data={chartData}
          margin={{ top: 10, right: 20, left: 10, bottom: 35 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#004455" opacity={0.5} />
          <XAxis
            dataKey="time"
            stroke="#c5c0c9"
            domain={['dataMin', 'dataMax']}
            label={{
              value: 'Time (seconds)',
              position: 'insideBottom',
              offset: -10,
              style: { fill: '#c5c0c9' },
            }}
          />
          <YAxis
            stroke="#c5c0c9"
            domain={[yMin, yMax]}
            label={{
              value: 'Altitude (ft MSL)',
              angle: -90,
              position: 'insideLeft',
              style: { fill: '#c5c0c9' },
            }}
            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v))}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={false}
          />

          <Line
            type="monotone"
            dataKey="baroAlt"
            stroke="#66ccff"
            strokeWidth={2}
            dot={false}
            connectNulls
            name="Baro Alt (MSL)"
            isAnimationActive={false}
          />

          {hasGPS && (
            <Line
              type="monotone"
              dataKey="gpsAlt"
              stroke="#ff9944"
              strokeWidth={1.5}
              dot={false}
              connectNulls
              name="GPS Alt (MSL)"
              isAnimationActive={false}
            />
          )}

          <Brush
            dataKey="time"
            height={30}
            stroke="#556677"
            fill="#001a29"
            tickFormatter={(v) => `${Number(v).toFixed(0)}s`}
          />
        </LineChart>
      </ResponsiveContainer>

      {/* Stats */}
      {(stats || pressureStats) && (
        <Group gap="lg" mt="sm">
          {stats && (
            <>
              <Text size="xs" c="dimmed">
                Mean Baro-GPS {'\u0394'}: <Text span fw={500} c={Math.abs(stats.meanDiff) > 100 ? 'yellow' : undefined}>
                  {stats.meanDiff > 0 ? '+' : ''}{stats.meanDiff.toFixed(0)} ft
                </Text>
              </Text>
              <Text size="xs" c="dimmed">
                Std Dev: <Text span fw={500}>{stats.stdDiff.toFixed(0)} ft</Text>
              </Text>
              <Text size="xs" c="dimmed">
                Range: <Text span fw={500}>{stats.minDiff.toFixed(0)} to {stats.maxDiff.toFixed(0)} ft</Text>
              </Text>
            </>
          )}
          {pressureStats && (
            <Text size="xs" c="dimmed">
              Pressure Noise ({'\u03C3'}): <Text span fw={500} c="#88cc88">
                {pressureStats.noiseSigma_hPa.toFixed(3)} hPa
              </Text>
              <Text span c="dimmed"> ({pressureStats.samples} samples)</Text>
            </Text>
          )}
        </Group>
      )}
    </Card>
  );
}
