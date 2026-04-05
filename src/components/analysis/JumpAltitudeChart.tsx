// components/home/JumpAltitudeChart.tsx

import React, { useMemo } from 'react';
import { Card, Text, Badge, Group } from '@mantine/core';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Dot,
  Label,
} from 'recharts';
import { TimeSeriesPoint } from '../../lib/analysis/log-parser';

interface ChartDataPoint {
  time: number; // seconds from start
  altitude: number; // feet
  vspeed?: number; // feet per minute
  event?: 'exit' | 'deploy' | 'landing';
}

interface JumpAltitudeChartProps {
  altitudeData: TimeSeriesPoint[];
  vspeedData?: TimeSeriesPoint[];
  exitOffsetSec?: number;
  deploymentOffsetSec?: number;
  landingOffsetSec?: number;
  showVSpeed?: boolean;
}

export function JumpAltitudeChart({
  altitudeData,
  vspeedData,
  exitOffsetSec,
  deploymentOffsetSec,
  landingOffsetSec,
  showVSpeed = false
}: JumpAltitudeChartProps) {
  
  // Prepare chart data
  const chartData = useMemo(() => {
    // Create a map to merge altitude and vspeed data
    const dataMap = new Map<number, ChartDataPoint>();
    
    // Add altitude data
    altitudeData.forEach(point => {
      dataMap.set(point.timestamp, {
        time: point.timestamp,
        altitude: point.value,
        event: undefined
      });
    });
    
    // Add vspeed data if available
    if (vspeedData && showVSpeed) {
      vspeedData.forEach(point => {
        const existing = dataMap.get(point.timestamp);
        if (existing) {
          existing.vspeed = point.value;
        } else {
          dataMap.set(point.timestamp, {
            time: point.timestamp,
            altitude: 0, // Will be interpolated
            vspeed: point.value,
            event: undefined
          });
        }
      });
    }
    
    // Convert to array and sort by time
    const data = Array.from(dataMap.values()).sort((a, b) => a.time - b.time);
    
    // Mark events
    data.forEach(point => {
      if (exitOffsetSec && Math.abs(point.time - exitOffsetSec) < 0.5) {
        point.event = 'exit';
      } else if (deploymentOffsetSec && Math.abs(point.time - deploymentOffsetSec) < 0.5) {
        point.event = 'deploy';
      } else if (landingOffsetSec && Math.abs(point.time - landingOffsetSec) < 0.5) {
        point.event = 'landing';
      }
    });
    
    return data;
  }, [altitudeData, vspeedData, showVSpeed, exitOffsetSec, deploymentOffsetSec, landingOffsetSec]);

  // Calculate altitude at each event time for label positioning
  const getAltitudeAtTime = (time: number): number => {
    const point = chartData.find(d => Math.abs(d.time - time) < 1);
    if (point) return point.altitude;
    
    // Interpolate if needed
    const before = chartData.filter(d => d.time <= time).pop();
    const after = chartData.find(d => d.time >= time);
    if (before && after && before.time !== after.time) {
      const ratio = (time - before.time) / (after.time - before.time);
      return before.altitude + (after.altitude - before.altitude) * ratio;
    }
    return 0;
  };

  // Custom dot for events
  const renderEventDot = (props: any) => {
    const { cx, cy, payload } = props;
    const colors = {
      exit: '#00ff88',
      deploy: '#ffaa00',
      landing: '#ff3355',
    };

    if (payload.event) {
      return (
        <circle
          cx={cx}
          cy={cy}
          r={6}
          fill={colors[payload.event as keyof typeof colors]}
          stroke="#ffffff"
          strokeWidth={2}
          style={{
                color: "black",
              }}
        />
      );
    }
    return null;
  };

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload[0]) {
      const data = payload[0].payload;
      return (
        <Card p="s" withBorder>
          <Text size="sm" fw={500}>
            {label.toFixed(1)}s
          </Text>
          <Text size="s" c="dimmed">
            {data.altitude.toFixed(0).toLocaleString()} ft
          </Text>
          {data.vspeed !== undefined && (
            <Text size="s" c="dimmed">
              {Math.round(data.vspeed)} fpm
            </Text>
          )}
          {data.event && (
            <Badge size="xs" mt={4} color={
              data.event === 'exit' ? 'green' :
              data.event === 'deploy' ? 'orange' :
              'red' } style={{
                color: "black",
              }}>
              {data.event.toUpperCase()}
            </Badge>
          )}
        </Card>
      );
    }
    return null;
  };

  if (chartData.length === 0) {
    return (
      <Card withBorder p="md">
        <Text c="dimmed" ta="center">No altitude data available</Text>
      </Card>
    );
  }

  // Find min/max for Y axis
  const minAlt = Math.min(...chartData.map(d => d.altitude));
  const maxAlt = Math.max(...chartData.map(d => d.altitude));
  const altRange = maxAlt - minAlt;
  const yMin = Math.max(0, minAlt - altRange * 0.1);
  const yMax = maxAlt + altRange * 0.1;

  // Calculate label positions to avoid overlap
  const eventAltitudes = {
    exit: exitOffsetSec ? getAltitudeAtTime(exitOffsetSec) : 0,
    deploy: deploymentOffsetSec ? getAltitudeAtTime(deploymentOffsetSec) : 0,
    landing: landingOffsetSec ? getAltitudeAtTime(landingOffsetSec) : 0,
  };

  // Determine label positions (offset from lines to avoid overlap)
  const labelOffsets = {
    exit: eventAltitudes.exit > maxAlt * 0.8 ? -20 : 20,
    deploy: Math.abs(eventAltitudes.deploy - eventAltitudes.exit) < altRange * 0.1 ? 
      (eventAltitudes.deploy < eventAltitudes.exit ? -40 : 40) : 20,
    landing: eventAltitudes.landing < minAlt + altRange * 0.2 ? 20 : -20,
  };

  return (
    <Card withBorder p="md">
      <Group justify="space-between" mb="md">
        <Text fw={500}>Altitude Profile</Text>
        <Group gap="xs">
          <Badge size="xs" color="green" leftSection={<div style={{
            width: 8, height: 8, borderRadius: '50%', backgroundColor: '#00ff88'
          }} />}>
            Exit
          </Badge>
          <Badge size="xs" color="orange" leftSection={<div style={{
            width: 8, height: 8, borderRadius: '50%', backgroundColor: '#ffaa00'
          }} />}>
            Deploy
          </Badge>
          <Badge size="xs" color="red" leftSection={<div style={{
            width: 8, height: 8, borderRadius: '50%', backgroundColor: '#ff3355'
          }} />}>
            Landing
          </Badge>
        </Group>
      </Group>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart
          data={chartData}
          margin={{ top: 35, right: 20, left: 10, bottom: 35 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#004455" opacity={0.5} />
          <XAxis
            dataKey="time"
            stroke="#c5c0c9"
            label={{
              value: 'Time (seconds)',
              position: 'insideBottom',
              offset: -10,
              style: { fill: '#c5c0c9' },
            }}
            domain={['dataMin', 'dataMax']}
          />
          <YAxis
            stroke="#c5c0c9"
            domain={[yMin, yMax]}
            label={{
              value: 'Altitude (ft)',
              angle: -90,
              position: 'insideLeft',
              style: { fill: '#c5c0c9' },
            }}
            tickFormatter={(value) => value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}
          />
          <Tooltip 
            content={<CustomTooltip />}
            cursor={false} // This removes the cursor/crosshair
          />
          
          {/* Event markers */}
          {exitOffsetSec && (
            <ReferenceLine
              x={exitOffsetSec}
              stroke="#00ff88"
              strokeDasharray="5 5"
              opacity={0.7}
            >
              <Label 
                value="Exit" 
                position="top" 
                fill="#00ff88"
                offset={labelOffsets.exit}
                style={{ textAnchor: 'middle' }}
              />
            </ReferenceLine>
          )}
          {deploymentOffsetSec && (
            <ReferenceLine
              x={deploymentOffsetSec}
              stroke="#ffaa00"
              strokeDasharray="5 5"
              opacity={0.7}
            >
              <Label 
                value="Deploy" 
                position={labelOffsets.deploy > 0 ? "top" : "bottom"}
                fill="#ffaa00"
                offset={Math.abs(labelOffsets.deploy)}
                style={{ textAnchor: 'middle' }}
              />
            </ReferenceLine>
          )}
          {landingOffsetSec && (
            <ReferenceLine
              x={landingOffsetSec}
              stroke="#ff3355"
              strokeDasharray="5 5"
              opacity={0.7}
            >
              <Label 
                value="Landing" 
                position={labelOffsets.landing > 0 ? "top" : "bottom"}
                fill="#ff3355"
                offset={Math.abs(labelOffsets.landing)}
                style={{ textAnchor: 'middle' }}
              />
            </ReferenceLine>
          )}
          
          <Line
            type="monotone"
            dataKey="altitude"
            stroke="#66ccff"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
          
          {showVSpeed && (
            <Line
              yAxisId="vspeed"
              type="monotone"
              dataKey="vspeed"
              stroke="#855bf0"
              strokeWidth={1}
              strokeDasharray="3 3"
              dot={false}
            />
          )}
          
          {/* Event dots */}
          {chartData.filter(d => d.event).map((point, index) => (
            <Dot
              key={`event-${index}`}
              cx={0}
              cy={0}
              r={6}
              fill={
                point.event === 'exit' ? '#00ff88' :
                point.event === 'deploy' ? '#ffaa00' :
                '#ff3355'
              }
              stroke="#ffffff"
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}