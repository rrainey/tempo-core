// components/analysis/FallRateChart.tsx

import { useMemo } from 'react';
import { Card, Text, Group, Badge } from '@mantine/core';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
  Label,
  Legend,
} from 'recharts';
import { FALL_RATE_AVG_MIN, FALL_RATE_AVG_MAX } from '../../utils/constants';
import type { DisplayMode } from './VelocityBinChart';

export interface FallRateSeriesPoint {
  time: number;
  raw_mph: number | null;
  calibrated_mph: number | null;
}

interface FallRateChartProps {
  data: FallRateSeriesPoint[];
  displayMode: DisplayMode;
  exitOffsetSec?: number;
  deploymentOffsetSec?: number;
  landingOffsetSec?: number;
  analysisWindow?: { startOffset: number; endOffset: number };
}

const RAW_COLOR = '#0088ff';
const CAL_COLOR = '#ddff55';

export function FallRateChart({
  data,
  displayMode,
  exitOffsetSec,
  deploymentOffsetSec,
  landingOffsetSec,
  analysisWindow,
}: FallRateChartProps) {
  const terminalVelocityTime = useMemo<number | null>(() => {
    for (const p of data) {
      if (p.raw_mph !== null || p.calibrated_mph !== null) return p.time;
    }
    return null;
  }, [data]);

  const yDomain = useMemo<[number, number]>(() => {
    if (data.length === 0) return [0, 200];
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const p of data) {
      if ((displayMode === 'raw' || displayMode === 'both') && p.raw_mph !== null) {
        if (p.raw_mph < minVal) minVal = p.raw_mph;
        if (p.raw_mph > maxVal) maxVal = p.raw_mph;
      }
      if ((displayMode === 'calibrated' || displayMode === 'both') && p.calibrated_mph !== null) {
        if (p.calibrated_mph < minVal) minVal = p.calibrated_mph;
        if (p.calibrated_mph > maxVal) maxVal = p.calibrated_mph;
      }
    }
    if (!isFinite(minVal) || !isFinite(maxVal)) return [0, 200];
    if (displayMode === 'calibrated' || displayMode === 'both') {
      minVal = Math.min(minVal, FALL_RATE_AVG_MIN);
      maxVal = Math.max(maxVal, FALL_RATE_AVG_MAX);
    }
    const pad = Math.max(5, (maxVal - minVal) * 0.1);
    return [Math.max(0, Math.floor(minVal - pad)), Math.ceil(maxVal + pad)];
  }, [data, displayMode]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const point = payload[0]?.payload as FallRateSeriesPoint | undefined;
    if (!point) return null;
    const showRaw = (displayMode === 'raw' || displayMode === 'both') && point.raw_mph !== null;
    const showCal = (displayMode === 'calibrated' || displayMode === 'both') && point.calibrated_mph !== null;
    if (!showRaw && !showCal) return null;
    return (
      <Card p="xs" withBorder style={{ fontSize: '0.8rem' }}>
        <Text size="sm" fw={500}>{Number(label).toFixed(1)}s</Text>
        {showRaw && (
          <Text size="xs" c={RAW_COLOR}>Raw: {point.raw_mph!.toFixed(1)} mph</Text>
        )}
        {showCal && (
          <Text size="xs" c={CAL_COLOR}>Calibrated: {point.calibrated_mph!.toFixed(1)} mph</Text>
        )}
      </Card>
    );
  };

  if (!data || data.length === 0) {
    return (
      <Card withBorder p="md">
        <Text c="dimmed" ta="center">No fall rate data available</Text>
      </Card>
    );
  }

  return (
    <Card withBorder p="md">
      <Group justify="space-between" mb="xs">
        <div>
          <Text fw={500}>Fall Rate vs Time</Text>
          <Text size="xs" c="dimmed" mt={4}>
            Fall rate within the freefall analysis window
          </Text>
        </div>
        <Group gap="xs">
          {analysisWindow && (
            <Badge size="sm" variant="light">
              {analysisWindow.startOffset.toFixed(0)}-{analysisWindow.endOffset.toFixed(0)}s
            </Badge>
          )}
          <Badge size="xs" color="green" variant="light">Exit</Badge>
          {terminalVelocityTime !== null && (
            <Badge size="xs" color="violet" variant="light">Terminal Velocity</Badge>
          )}
          <Badge size="xs" color="orange" variant="light">Deploy</Badge>
          <Badge size="xs" color="red" variant="light">Landing</Badge>
        </Group>
      </Group>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart
          data={data}
          margin={{ top: 50, right: 20, left: 10, bottom: 35 }}
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
            domain={yDomain}
            label={{
              value:
                displayMode === 'raw' ? 'Raw Fall Rate (mph)' :
                displayMode === 'calibrated' ? 'Calibrated Fall Rate (mph)' :
                'Fall Rate (mph)',
              angle: -90,
              position: 'insideLeft',
              style: { fill: '#c5c0c9' },
            }}
            tickFormatter={(v) => v.toFixed(0)}
          />
          <Tooltip content={<CustomTooltip />} cursor={false} />
          {displayMode === 'both' && (
            <Legend
              verticalAlign="top"
              align="left"
              wrapperStyle={{ paddingBottom: '10px', paddingLeft: '30px' }}
            />
          )}

          {/* Average jumper band — only in calibrated mode */}
          {displayMode === 'calibrated' && (
            <>
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
              <ReferenceLine
                y={FALL_RATE_AVG_MIN}
                stroke="#888888"
                strokeOpacity={0.5}
                strokeDasharray="3 3"
              />
              <ReferenceLine
                y={FALL_RATE_AVG_MAX}
                stroke="#888888"
                strokeOpacity={0.5}
                strokeDasharray="3 3"
              />
            </>
          )}

          {/* Event markers */}
          {exitOffsetSec !== undefined && (
            <ReferenceLine x={exitOffsetSec} stroke="#00ff88" strokeDasharray="5 5" opacity={0.7}>
              <Label value="Exit" position="top" fill="#00ff88" offset={10} style={{ textAnchor: 'middle' }} />
            </ReferenceLine>
          )}
          {terminalVelocityTime !== null && (
            <ReferenceLine x={terminalVelocityTime} stroke="#c4b5fd" strokeDasharray="5 5" opacity={0.7}>
              <Label
                position="top"
                content={(props: any) => {
                  const { viewBox } = props;
                  if (!viewBox) return null;
                  const { x, y } = viewBox;
                  return (
                    <g transform={`translate(${x},${y})`}>
                      <text fill="#c4b5fd" fontSize={12}>
                        <tspan textAnchor="middle" x={0} dy={-18}>Terminal</tspan>
                        <tspan textAnchor="middle" x={0} dy={14}>Velocity</tspan>
                      </text>
                    </g>
                  );
                }}
              />
            </ReferenceLine>
          )}
          {deploymentOffsetSec !== undefined && (
            <ReferenceLine x={deploymentOffsetSec} stroke="#ffaa00" strokeDasharray="5 5" opacity={0.7}>
              <Label value="Deploy" position="top" fill="#ffaa00" offset={10} style={{ textAnchor: 'middle' }} />
            </ReferenceLine>
          )}
          {landingOffsetSec !== undefined && (
            <ReferenceLine x={landingOffsetSec} stroke="#ff3355" strokeDasharray="5 5" opacity={0.7}>
              <Label value="Landing" position="top" fill="#ff3355" offset={10} style={{ textAnchor: 'middle' }} />
            </ReferenceLine>
          )}

          {(displayMode === 'raw' || displayMode === 'both') && (
            <Line
              type="monotone"
              dataKey="raw_mph"
              stroke={RAW_COLOR}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              name="Raw"
              connectNulls={false}
            />
          )}
          {(displayMode === 'calibrated' || displayMode === 'both') && (
            <Line
              type="monotone"
              dataKey="calibrated_mph"
              stroke={CAL_COLOR}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              name="Calibrated"
              connectNulls={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
