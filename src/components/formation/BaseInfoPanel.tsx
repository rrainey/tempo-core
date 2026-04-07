// components/formation/BaseInfoPanel.tsx
import React from 'react';
import { Card, Stack, Text, Title, Badge, Group, Divider } from '@mantine/core';
import { interpolatePosition } from '../../formation/coordinates';
import type { AltitudeMode } from '../../formation/coordinates';
import type { FormationData } from './FormationViewer';

const BARB_COLOR = 'var(--mantine-color-blue-filled)';

function mphToBeaufort(mph: number): number {
  const thresholds = [1, 4, 8, 13, 19, 25, 32, 39, 47, 55, 64, 75];
  for (let i = 0; i < thresholds.length; i++) {
    if (mph < thresholds[i]) return i;
  }
  return 12;
}

/** Standard meteorological wind barb: staff points toward wind origin, barbs encode speed. */
const WindBarb: React.FC<{
  speedMph: number;
  driftHeadingDeg: number;
  size?: number;
}> = ({ speedMph, driftHeadingDeg, size = 32 }) => {
  const knots = Math.round((speedMph * 0.868976) / 5) * 5;
  // Wind comes from the opposite direction to the drift
  const windFromDeg = (driftHeadingDeg + 180) % 360;

  if (knots === 0) {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" style={{ display: 'block' }}>
        <circle cx={20} cy={20} r={6}
          stroke={BARB_COLOR} fill="none" strokeWidth={2} />
      </svg>
    );
  }

  const pennants = Math.floor(knots / 50);
  let rem = knots % 50;
  const longBarbs = Math.floor(rem / 10);
  rem = rem % 10;
  const shortBarbs = Math.floor(rem / 5);

  const elements: React.ReactNode[] = [];
  const staffTip = 3;
  const staffBase = 33;
  let y = staffTip;
  const gap = 3.5;

  // Pennants (filled triangles) at the tip
  for (let i = 0; i < pennants; i++) {
    elements.push(
      <polygon key={`p${i}`}
        points={`20,${y} 11,${y} 20,${y + gap}`}
        fill={BARB_COLOR} />
    );
    y += gap;
  }

  // Long barbs (full lines angled left)
  for (let i = 0; i < longBarbs; i++) {
    elements.push(
      <line key={`l${i}`}
        x1={20} y1={y} x2={11} y2={y - 4}
        stroke={BARB_COLOR} strokeWidth={2} strokeLinecap="round" />
    );
    y += gap;
  }

  // If only a short barb (5 knots), offset it from tip per convention
  if (shortBarbs > 0 && pennants === 0 && longBarbs === 0) {
    y += gap;
  }

  // Short barbs (half-length lines)
  for (let i = 0; i < shortBarbs; i++) {
    elements.push(
      <line key={`s${i}`}
        x1={20} y1={y} x2={15} y2={y - 2.5}
        stroke={BARB_COLOR} strokeWidth={2} strokeLinecap="round" />
    );
    y += gap;
  }

  return (
    <svg width={size} height={size} viewBox="0 0 40 40" style={{ display: 'block' }}>
      <g transform={`rotate(${windFromDeg}, 20, 20)`}>
        <line x1={20} y1={staffTip} x2={20} y2={staffBase}
          stroke={BARB_COLOR} strokeWidth={2} strokeLinecap="round" />
        {elements}
        <circle cx={20} cy={staffBase} r={2} fill={BARB_COLOR} />
      </g>
    </svg>
  );
};

interface BaseInfoPanelProps {
  formation: FormationData;
  currentTime: number;
  baseJumperId: string;
  altitudeMode: AltitudeMode;
}

export const BaseInfoPanel: React.FC<BaseInfoPanelProps> = ({
  formation,
  currentTime,
  baseJumperId,
  altitudeMode
}) => {
  const baseParticipant = formation.participants.find(p => p.userId === baseJumperId);

  if (!baseParticipant) {
    return (
      <Card withBorder>
        <Text c="dimmed">No base jumper selected</Text>
      </Card>
    );
  }

  const currentMetrics = interpolatePosition(baseParticipant.timeSeries, currentTime);

  const altitudeAGL = formation.dzElevation_m
    ? (currentMetrics.location.alt_m - formation.dzElevation_m) * 3.28084
    : null;

  const getFallRateColor = (rate: number) => {
    if (rate < 110) return 'green';
    if (rate > 130) return 'red';
    return 'yellow';
  };

  const baroAlt = (currentMetrics.adjBaroAlt_ftAGL ?? currentMetrics.baroAlt_ft);
  const actualFallRate = (currentMetrics.verticalSpeed_mps ?? 0) * 2.23694;
  const normalizedFallRate = currentMetrics.normalizedFallRate_mph || 0;
  const heading = currentMetrics.groundtrack_degT || 0;
  const groundspeed_mph = (currentMetrics.groundspeed_kmph || 0) * 0.621371;

  return (
    <Card withBorder>
      <Stack gap="xs">
        <Group justify="space-between">
          <Badge size="lg" color="blue">{baseParticipant.name}</Badge>
          <Title order={5}>Base</Title>
        </Group>

        <Divider />

        {/* Fall Rate + Altitude side-by-side */}
        <Group grow gap="md" align="flex-start">
          <Stack gap={2}>
            <Text size="xs" c="dimmed">Fall Rate</Text>
            <Text size="sm" fw={500}>
              {actualFallRate.toFixed(0)} mph
            </Text>
            <Badge
              color={getFallRateColor(normalizedFallRate)}
              size="sm"
              variant="light"
            >
              {normalizedFallRate.toFixed(0)} cal
            </Badge>
          </Stack>

          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              Altitude ({altitudeMode === 'Barometric' ? 'Baro' : 'GPS'})
            </Text>
            <Text size="sm" fw={500}>
              {baroAlt?.toFixed(0) ?? '---'} ft
            </Text>
            {altitudeAGL != null && altitudeMode !== 'Barometric' && (
              <Text size="xs" c="dimmed">
                GPS: {altitudeAGL.toFixed(0)} ft
              </Text>
            )}
          </Stack>
        </Group>

        <Divider />

        {/* Lateral Drift + Wind Barb */}
        <Group justify="space-between" align="center" wrap="nowrap">
          <Text size="xs" c="dimmed">Lateral drift</Text>
          <Group gap={6} align="center" wrap="nowrap">
            <Text size="sm" fw={500}>
              {heading.toFixed(0)}° / {groundspeed_mph.toFixed(0)} mph
            </Text>
            <WindBarb speedMph={groundspeed_mph} driftHeadingDeg={heading} />
            <Text size="xs" c="dimmed">F{mphToBeaufort(groundspeed_mph)}</Text>
          </Group>
        </Group>
      </Stack>
    </Card>
  );
};
