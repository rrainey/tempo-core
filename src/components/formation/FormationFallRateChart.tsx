// components/formation/FormationFallRateChart.tsx
//
// Compact fall-rate-vs-time strip rendered inside BaseInfoPanel. Shows the
// base jumper's calibrated fall rate over the freefall analysis window and
// a marker dot synced to the formation playback time scrubber. When the
// scrubber is outside the analysis window, the dot pulses at the nearest
// data extent.

import { useMemo } from 'react';
import { Card, Text } from '@mantine/core';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ReferenceDot,
  ResponsiveContainer,
} from 'recharts';
import { FALL_RATE_AVG_MIN, FALL_RATE_AVG_MAX } from '../../utils/constants';
import type { FallRateSeriesPoint } from '../../analysis/fall-rate-series';

interface FormationFallRateChartProps {
  series: FallRateSeriesPoint[];
  currentTime: number;
  timelineStart: number;
  timelineEnd: number;
}

const LINE_COLOR = 'var(--mantine-primary-color-filled)';
const DOT_FILL = '#ffffff';
const DOT_STROKE = 'var(--mantine-primary-color-filled)';
const PULSE_FILL = 'var(--mantine-primary-color-filled)';

const PulsingDot = (props: { cx?: number; cy?: number }) => {
  const { cx, cy } = props;
  if (cx == null || cy == null) return null;
  return (
    <circle cx={cx} cy={cy} r={5} fill={PULSE_FILL} stroke="#000000" strokeWidth={1}>
      <animate
        attributeName="opacity"
        values="0.15;0.75;0.15"
        dur="2.0s"
        repeatCount="indefinite"
      />
    </circle>
  );
};

const SolidDot = (props: { cx?: number; cy?: number }) => {
  const { cx, cy } = props;
  if (cx == null || cy == null) return null;
  return (
    <circle cx={cx} cy={cy} r={5} fill={DOT_FILL} stroke={DOT_STROKE} strokeWidth={2} />
  );
};

export const FormationFallRateChart = ({
  series,
  currentTime,
  timelineStart,
  timelineEnd,
}: FormationFallRateChartProps) => {
  // Subset to in-window samples (non-null calibrated values). The series
  // itself spans the full log with nulls outside the analysis window, but
  // for this compact view we only chart the active portion and let the
  // X-axis show the full formation timeline for context.
  const validPoints = useMemo(
    () => series.filter(p => p.calibrated_mph !== null) as
      Array<{ time: number; calibrated_mph: number }>,
    [series],
  );

  const yDomain = useMemo<[number, number]>(() => {
    if (validPoints.length === 0) return [FALL_RATE_AVG_MIN - 10, FALL_RATE_AVG_MAX + 10];
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of validPoints) {
      if (p.calibrated_mph < lo) lo = p.calibrated_mph;
      if (p.calibrated_mph > hi) hi = p.calibrated_mph;
    }
    lo = Math.min(lo, FALL_RATE_AVG_MIN);
    hi = Math.max(hi, FALL_RATE_AVG_MAX);
    const pad = Math.max(5, (hi - lo) * 0.1);
    return [Math.max(0, Math.floor(lo - pad)), Math.ceil(hi + pad)];
  }, [validPoints]);

  // Compute marker (x, y) and pulsing flag from currentTime.
  const marker = useMemo(() => {
    if (validPoints.length === 0) return null;
    const first = validPoints[0];
    const last = validPoints[validPoints.length - 1];

    if (currentTime <= first.time) {
      return { x: first.time, y: first.calibrated_mph, pulsing: true };
    }
    if (currentTime >= last.time) {
      return { x: last.time, y: last.calibrated_mph, pulsing: true };
    }

    // Binary search for surrounding samples
    let lo = 0;
    let hi = validPoints.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (validPoints[mid].time <= currentTime) lo = mid;
      else hi = mid;
    }
    const a = validPoints[lo];
    const b = validPoints[hi];
    if (b.time === a.time) {
      return { x: a.time, y: a.calibrated_mph, pulsing: false };
    }
    const t = (currentTime - a.time) / (b.time - a.time);
    const y = a.calibrated_mph + t * (b.calibrated_mph - a.calibrated_mph);
    return { x: currentTime, y, pulsing: false };
  }, [validPoints, currentTime]);

  if (validPoints.length === 0) {
    return (
      <Card withBorder p="xs">
        <Text size="xs" c="dimmed" ta="center">
          Calibrated fall rate unavailable for base jumper
        </Text>
      </Card>
    );
  }

  return (
    <Card withBorder p="xs" style={{ position: 'relative' }}>
      <Text size="xs" c="dimmed" mb={4}>
        Base: Calibrated Fall Rate
      </Text>
      {marker && !marker.pulsing && (
        <Text
          fw={600}
          style={{
            position: 'absolute',
            top: 8,
            right: 12,
            fontFamily: 'var(--font-geist-mono), monospace',
            fontSize: 32,
            lineHeight: 1,
            color: LINE_COLOR,
            pointerEvents: 'none',
          }}
        >
          {Math.round(marker.y)}
        </Text>
      )}
      <ResponsiveContainer width="100%" height={200}>
        <LineChart
          data={validPoints}
          margin={{ top: 6, right: 5, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#004455" opacity={0.4} />
          <XAxis
            dataKey="time"
            type="number"
            domain={[timelineStart, timelineEnd]}
            stroke="#c5c0c9"
            tick={{ fontSize: 10 }}
            tickFormatter={(v) => `${Number(v).toFixed(0)}s`}
            allowDataOverflow
          />
          <YAxis
            domain={yDomain}
            stroke="#c5c0c9"
            tick={{ fontSize: 10 }}
            width={30}
            tickFormatter={(v) => v.toFixed(0)}
          />

          {/* Average jumper band */}
          <ReferenceArea
            y1={FALL_RATE_AVG_MIN}
            y2={FALL_RATE_AVG_MAX}
            fill="#555555"
            fillOpacity={0.2}
            stroke="#888888"
            strokeOpacity={0.4}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          <ReferenceLine y={FALL_RATE_AVG_MIN} stroke="#888888" strokeOpacity={0.5} strokeDasharray="3 3" />
          <ReferenceLine y={FALL_RATE_AVG_MAX} stroke="#888888" strokeOpacity={0.5} strokeDasharray="3 3" />

          <Line
            type="monotone"
            dataKey="calibrated_mph"
            stroke={LINE_COLOR}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />

          {marker && (
            <ReferenceDot
              x={marker.x}
              y={marker.y}
              shape={marker.pulsing ? <PulsingDot /> : <SolidDot />}
              ifOverflow="extendDomain"
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
};
