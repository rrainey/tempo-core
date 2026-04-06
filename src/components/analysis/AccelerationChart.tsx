// components/analysis/AccelerationChart.tsx

import React, { useMemo } from 'react';
import { Card, Text, Group, Badge } from '@mantine/core';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Label,
  Brush,
} from 'recharts';
import { TimeSeriesPoint } from '../../analysis/log-parser';

const G = 9.81; // m/s^2

interface ChartDataPoint {
  time: number;
  accelG: number;
  event?: 'exit' | 'deploy' | 'landing';
}

interface AccelerationChartProps {
  accelerationData: TimeSeriesPoint[]; // magnitude in m/s^2
  exitOffsetSec?: number;
  deploymentOffsetSec?: number;
  landingOffsetSec?: number;
}

export function AccelerationChart({
  accelerationData,
  exitOffsetSec,
  deploymentOffsetSec,
  landingOffsetSec,
}: AccelerationChartProps) {
  const chartData = useMemo(() => {
    const data: ChartDataPoint[] = accelerationData.map(pt => ({
      time: pt.timestamp,
      accelG: pt.value / G,
    }));

    // Mark events
    for (const point of data) {
      if (exitOffsetSec !== undefined && Math.abs(point.time - exitOffsetSec) < 0.5) {
        point.event = 'exit';
      } else if (deploymentOffsetSec !== undefined && Math.abs(point.time - deploymentOffsetSec) < 0.5) {
        point.event = 'deploy';
      } else if (landingOffsetSec !== undefined && Math.abs(point.time - landingOffsetSec) < 0.5) {
        point.event = 'landing';
      }
    }

    return data;
  }, [accelerationData, exitOffsetSec, deploymentOffsetSec, landingOffsetSec]);

  const peakG = useMemo(() => {
    if (chartData.length === 0) return 0;
    return Math.max(...chartData.map(d => d.accelG));
  }, [chartData]);

  // Y-axis: 0 to max(5, peakG * 1.1)
  const yMax = useMemo(() => {
    return Math.max(5, peakG * 1.1);
  }, [peakG]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const data = payload[0]?.payload as ChartDataPoint | undefined;
    if (!data) return null;
    return (
      <Card p="xs" withBorder style={{ fontSize: '0.8rem' }}>
        <Text size="sm" fw={500}>{Number(label).toFixed(1)}s</Text>
        <Text size="xs" c="#ff6b9d">{data.accelG.toFixed(2)} g</Text>
        {data.event && (
          <Badge size="xs" mt={4} color={
            data.event === 'exit' ? 'green' :
            data.event === 'deploy' ? 'orange' :
            'red'
          } style={{ color: 'black' }}>
            {data.event.toUpperCase()}
          </Badge>
        )}
      </Card>
    );
  };

  if (chartData.length === 0) {
    return (
      <Card withBorder p="md">
        <Text c="dimmed" ta="center">No IMU acceleration data available</Text>
      </Card>
    );
  }

  return (
    <Card withBorder p="md">
      <Group justify="space-between" mb="xs">
        <Text fw={500}>IMU Acceleration</Text>
        <Group gap="xs">
          <Badge size="xs" color="pink" variant="light">
            Peak: {peakG.toFixed(2)} g
          </Badge>
          <Badge size="xs" color="green" variant="light">Exit</Badge>
          <Badge size="xs" color="orange" variant="light">Deploy</Badge>
          <Badge size="xs" color="red" variant="light">Landing</Badge>
        </Group>
      </Group>

      <Text size="xs" c="dimmed" mb="sm">
        Acceleration magnitude from onboard IMU. 1.0 g at rest; values above 2.5 g are unusual.
      </Text>

      <ResponsiveContainer width="100%" height={300}>
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
            domain={[0, yMax]}
            label={{
              value: 'Acceleration (g)',
              angle: -90,
              position: 'insideLeft',
              style: { fill: '#c5c0c9' },
            }}
            tickFormatter={(v) => v.toFixed(1)}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={false}
          />

          {/* 1g reference */}
          <ReferenceLine
            y={1.0}
            stroke="#c5c0c9"
            strokeDasharray="4 4"
            opacity={0.4}
          >
            <Label
              value="1 g"
              position="right"
              fill="#c5c0c9"
              style={{ fontSize: '0.7rem' }}
            />
          </ReferenceLine>

          {/* 2.5g advisory reference */}
          <ReferenceLine
            y={2.5}
            stroke="#ffaa00"
            strokeDasharray="4 4"
            opacity={0.4}
          >
            <Label
              value="2.5 g"
              position="right"
              fill="#ffaa00"
              style={{ fontSize: '0.7rem' }}
            />
          </ReferenceLine>

          {/* Event markers */}
          {exitOffsetSec !== undefined && (
            <ReferenceLine
              x={exitOffsetSec}
              stroke="#00ff88"
              strokeDasharray="5 5"
              opacity={0.7}
            >
              <Label value="Exit" position="top" fill="#00ff88" offset={10} style={{ textAnchor: 'middle' }} />
            </ReferenceLine>
          )}
          {deploymentOffsetSec !== undefined && (
            <ReferenceLine
              x={deploymentOffsetSec}
              stroke="#ffaa00"
              strokeDasharray="5 5"
              opacity={0.7}
            >
              <Label value="Deploy" position="top" fill="#ffaa00" offset={10} style={{ textAnchor: 'middle' }} />
            </ReferenceLine>
          )}
          {landingOffsetSec !== undefined && (
            <ReferenceLine
              x={landingOffsetSec}
              stroke="#ff3355"
              strokeDasharray="5 5"
              opacity={0.7}
            >
              <Label value="Landing" position="top" fill="#ff3355" offset={10} style={{ textAnchor: 'middle' }} />
            </ReferenceLine>
          )}

          <Line
            type="monotone"
            dataKey="accelG"
            stroke="#ff6b9d"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />

          <Brush
            dataKey="time"
            height={30}
            stroke="#556677"
            fill="#001a29"
            tickFormatter={(v) => `${Number(v).toFixed(0)}s`}
          />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
