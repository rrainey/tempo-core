// components/formation/BaseInfoPanel.tsx
import React from 'react';
import { Card, Stack, Text, Title, Badge, Group, Divider } from '@mantine/core';
import { interpolatePosition } from '../../formation/coordinates';
import type { AltitudeMode } from '../../formation/coordinates';
import type { FormationData } from './FormationViewer';

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

        {/* Lateral Drift — terse */}
        <Group justify="space-between">
          <Text size="xs" c="dimmed">Lateral drift</Text>
          <Text size="sm" fw={500}>
            {heading.toFixed(0)}° / {groundspeed_mph.toFixed(0)} mph
          </Text>
        </Group>
      </Stack>
    </Card>
  );
};
