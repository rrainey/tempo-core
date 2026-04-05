// components/home/VelocityBinChart.tsx

import React, { useState } from 'react';
import { Card, Text, Group, Badge, Stack, Select } from '@mantine/core';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Rectangle,
  Legend,
  ReferenceLine,
  ReferenceArea
} from 'recharts';
import { IconClock, IconRuler } from '@tabler/icons-react';
import { FALL_RATE_AVG_MIN, FALL_RATE_AVG_MAX } from '../../lib/utils/constants';

interface VelocityBinData {
  fallRate_mph: number;
  elapsed_sec: number;
  calibrated_elapsed_sec: number;
}

interface VelocityBinSummary {
  raw: {
    totalAnalysisTime: number;
    averageFallRate: number;
    minFallRate: number | null;
    maxFallRate: number | null;
  };
  calibrated: {
    totalAnalysisTime: number;
    averageFallRate: number;
    minFallRate: number | null;
    maxFallRate: number | null;
  };
  analysisWindow: {
    startOffset: number;
    endOffset: number;
    duration: number;
  };
}

interface VelocityBinChartProps {
  data: VelocityBinData[];
  summary: VelocityBinSummary;
}

type DisplayMode = 'raw' | 'calibrated' | 'both';

export function VelocityBinChart({ data, summary }: VelocityBinChartProps) {
  const [displayMode, setDisplayMode] = useState<DisplayMode>('raw');

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length > 0) {
      const bin = payload[0].payload;
      
      return (
        <Card p="xs" withBorder>
          <Text size="sm" fw={500}>
            {bin.fallRate_mph} mph
          </Text>
          {displayMode === 'raw' && (
            <>
              <Text size="xs" c="dimmed">
                Raw: {bin.elapsed_sec.toFixed(1)} seconds
              </Text>
              <Text size="xs" c="dimmed">
                {(bin.elapsed_sec / summary.raw.totalAnalysisTime * 100).toFixed(1)}% of time
              </Text>
            </>
          )}
          {displayMode === 'calibrated' && (
            <>
              <Text size="xs" c="dimmed">
                Calibrated: {bin.calibrated_elapsed_sec.toFixed(1)} seconds
              </Text>
              <Text size="xs" c="dimmed">
                {(bin.calibrated_elapsed_sec / summary.calibrated.totalAnalysisTime * 100).toFixed(1)}% of time
              </Text>
              {bin.fallRate_mph >= FALL_RATE_AVG_MIN && bin.fallRate_mph <= FALL_RATE_AVG_MAX && (
                <Badge size="xs" color="green" mt={4}>
                  Average Range
                </Badge>
              )}
            </>
          )}
          {displayMode === 'both' && (
            <>
              <Text size="xs" c="dimmed">
                Raw: {bin.elapsed_sec.toFixed(1)}s ({(bin.elapsed_sec / summary.raw.totalAnalysisTime * 100).toFixed(1)}%)
              </Text>
              <Text size="xs" c="dimmed">
                Cal: {bin.calibrated_elapsed_sec.toFixed(1)}s ({(bin.calibrated_elapsed_sec / summary.calibrated.totalAnalysisTime * 100).toFixed(1)}%)
              </Text>
            </>
          )}
        </Card>
      );
    }
    return null;
  };

  if (!data || data.length === 0) {
    return (
      <Card withBorder p="md">
        <Text c="dimmed" ta="center">No velocity data available</Text>
      </Card>
    );
  }

  // Calculate height based on number of bins
  const chartHeight = Math.max(400, data.length * 20);

  // Get active summary based on display mode
  const activeSummary = displayMode === 'calibrated' ? summary.calibrated : summary.raw;

  // Determine if jumper is in average range (only for calibrated)
  const isInAverageRange = displayMode === 'calibrated' && 
    summary.calibrated.averageFallRate >= FALL_RATE_AVG_MIN && 
    summary.calibrated.averageFallRate <= FALL_RATE_AVG_MAX;

  const isFastJumper = displayMode === 'calibrated' && 
    summary.calibrated.averageFallRate > FALL_RATE_AVG_MAX;

  const isFloatyJumper = displayMode === 'calibrated' && 
    summary.calibrated.averageFallRate < FALL_RATE_AVG_MIN;

  return (
    <Card withBorder p="md">
      <Stack>
        {/* Header */}
        <div>
          <Group justify="space-between" align="flex-start">
            <div>
              <Text fw={500}>Fall Rate Distribution</Text>
              <Text size="xs" c="dimmed" mt={4}>
                Time spent at each fall rate after accelerating to terminal velocity
              </Text>
            </div>
            <Badge size="sm" variant="light">
              {summary.analysisWindow.startOffset.toFixed(0)}-{summary.analysisWindow.endOffset.toFixed(0)}s
            </Badge>
          </Group>
        </div>

        {/* Metrics Row - Side by Side */}
        <Group grow align="stretch">
          {/* Average Fall Rate */}
          <Card withBorder p="sm">
            <Group gap="xs">
              <IconRuler size={20} style={{ opacity: 0.7 }} />
              <div style={{ flex: 1 }}>
                <Text size="xs" c="dimmed">
                  {displayMode === 'calibrated' ? 'Avg Calibrated Rate' : 'Avg Raw Rate'}
                </Text>
                <Group gap={4} align="center">
                  <Text fw={600}>{activeSummary.averageFallRate} mph</Text>
                  {displayMode === 'calibrated' && isInAverageRange && (
                    <Badge size="xs" color="green" variant="light">Average</Badge>
                  )}
                  {displayMode === 'calibrated' && isFastJumper && (
                    <Badge size="xs" color="blue" variant="light">Fast</Badge>
                  )}
                  {displayMode === 'calibrated' && isFloatyJumper && (
                    <Badge size="xs" color="orange" variant="light">Floaty</Badge>
                  )}
                </Group>
              </div>
            </Group>
          </Card>
          
          {/* Analysis Duration */}
          <Card withBorder p="sm">
            <Group gap="xs">
              <IconClock size={20} style={{ opacity: 0.7 }} />
              <div>
                <Text size="xs" c="dimmed">Analysis Duration</Text>
                <Text fw={600}>{summary.analysisWindow.duration.toFixed(0)}s</Text>
              </div>
            </Group>
          </Card>

          {/* Display Mode Selector */}
          <Select
            label="Display Mode"
            value={displayMode}
            onChange={(value) => setDisplayMode(value as DisplayMode)}
            data={[
              { value: 'raw', label: 'Raw Fall Rate' },
              { value: 'calibrated', label: 'Calibrated Fall Rate' },
              { value: 'both', label: 'Both (Comparison)' }
            ]}
            allowDeselect={false}
            styles={{
              root: { flex: 1 }
            }}
          />
        </Group>

        {/* Average Range Info (only show for calibrated) */}
        {displayMode === 'calibrated' && (
          <Card withBorder p="sm" style={{ backgroundColor: 'rgba(221, 255, 85, 0.05)' }}>
            <Stack gap="xs">
              <Text size="sm" fw={500}>Average Jumper Range</Text>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">Reference Range:</Text>
                <Text size="xs" fw={500}>{FALL_RATE_AVG_MIN}-{FALL_RATE_AVG_MAX} mph</Text>
              </Group>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">Your Average:</Text>
                <Text size="xs" fw={500}>{summary.calibrated.averageFallRate} mph</Text>
              </Group>
              {!isInAverageRange && (
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Difference:</Text>
                  <Text size="xs" fw={500} c={isFastJumper ? 'blue' : 'orange'}>
                    {isFastJumper 
                      ? `${summary.calibrated.averageFallRate - FALL_RATE_AVG_MAX} mph faster`
                      : `${FALL_RATE_AVG_MIN - summary.calibrated.averageFallRate} mph slower`
                    }
                  </Text>
                </Group>
              )}
            </Stack>
          </Card>
        )}

        {/* Chart */}
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 10, right: 30, left: 40, bottom: 30 }}
          >
            <CartesianGrid 
              strokeDasharray="3 3" 
              stroke="#004455" 
              opacity={0.5}
              horizontal={true}
              vertical={true}
            />
            <XAxis
              type="number"
              domain={[0, 'dataMax']}
              stroke="#c5c0c9"
              label={{
                value: 'Elapsed Time (seconds)',
                position: 'insideBottom',
                offset: -10,
                style: { fill: '#c5c0c9' },
              }}
            />
            <YAxis
              type="category"
              dataKey="fallRate_mph"
              stroke="#c5c0c9"
              tick={{ fontSize: 12 }}
              label={{
                value: 'Fall Rate (mph)',
                angle: -90,
                position: 'insideLeft',
                style: { fill: '#c5c0c9', textAnchor: 'middle' },
              }}
            />
            <Tooltip 
              content={<CustomTooltip />}
              cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }}
            />
            {displayMode === 'both' && (
              <Legend 
                verticalAlign="top"
                align="left"
                wrapperStyle={{
                  paddingBottom: '20px',
                  paddingLeft: '30px'
                }}
              />
            )}
            
            {/* Average Jumper Band - only show for calibrated mode */}
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
                  label={{
                    value: 'Average Range',
                    position: 'insideRight',
                    fill: '#ffffff',
                    fontSize: 11,
                    fontWeight: 500
                  }}
                />
                <ReferenceLine
                  y={FALL_RATE_AVG_MIN}
                  stroke="#888888"
                  strokeOpacity={0.5}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <ReferenceLine
                  y={FALL_RATE_AVG_MAX}
                  stroke="#888888"
                  strokeOpacity={0.5}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
              </>
            )}
            
            {displayMode === 'raw' && (
              <Bar 
                dataKey="elapsed_sec" 
                fill="#0088ff" 
                radius={[0, 10, 10, 0]} 
                activeBar={<Rectangle fill="#00aaff" stroke="#0088ff" radius={[0, 10, 10, 0]} />}
                name="Raw Fall Rate"
              />
            )}
            
            {displayMode === 'calibrated' && (
              <Bar 
                dataKey="calibrated_elapsed_sec" 
                fill="#ddff55" 
                radius={[0, 10, 10, 0]} 
                activeBar={<Rectangle fill="#eeff88" stroke="#ddff55" radius={[0, 10, 10, 0]} />}
                name="Calibrated Fall Rate"
              />
            )}
            
            {displayMode === 'both' && (
              <>
                <Bar 
                  dataKey="elapsed_sec" 
                  fill="#0088ff" 
                  radius={[0, 10, 10, 0]}
                  name="Raw"
                />
                <Bar 
                  dataKey="calibrated_elapsed_sec" 
                  fill="#ddff55" 
                  radius={[0, 10, 10, 0]}
                  name="Calibrated"
                />
              </>
            )}
          </BarChart>
        </ResponsiveContainer>

        {/* Legend explanation for calibrated mode */}
        {displayMode === 'calibrated' && (
          <Text size="xs" c="dimmed" style={{ fontStyle: 'italic' }}>
            The highlighted band ({FALL_RATE_AVG_MIN}-{FALL_RATE_AVG_MAX} mph) represents the typical fall rate range 
            for an average jumper in belly-to-earth orientation, corrected for air density at altitude.
          </Text>
        )}
      </Stack>
    </Card>
  );
}