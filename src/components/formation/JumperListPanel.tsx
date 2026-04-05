// components/formation/JumperListPanel.tsx
import React, { useMemo } from 'react';
import { Card, Table, Text, Badge, Group, Stack, Title, Divider } from '@mantine/core';
import { projectFormationAtTime, interpolatePosition } from '../../formation/coordinates';
import type { AltitudeMode } from '../../formation/coordinates';
import type { FormationData } from './FormationViewer';
import type { GeodeticCoordinates, Vector3 } from '../../formation/types';

interface JumperMetrics {
  userId: string;
  name: string;
  color: string;
  lateralSeparation_ft: number;
  closureRate_fps: number;
  relativeAltitude_ft: number;
  normalizedFallRate_mph: number;
}

interface JumperListPanelProps {
  formation: FormationData;
  currentTime: number;
  baseJumperId: string;
  dzCenter: GeodeticCoordinates;
  altitudeMode: AltitudeMode;
}

function calculateVelocityVector(
  participant: any,
  timeOffset: number,
  altitudeMode: AltitudeMode = 'GPS'
): Vector3 {
  const dt = 0.25;
  const t1 = Math.max(0, timeOffset - dt/2);
  const t2 = timeOffset + dt/2;

  const pos1 = interpolatePosition(participant.timeSeries, t1);
  const pos2 = interpolatePosition(participant.timeSeries, t2);

  let z: number;
  if (altitudeMode === 'Barometric') {
    const alt1_m = (pos1.adjBaroAlt_ftAGL ?? pos1.baroAlt_ft) * 0.3048;
    const alt2_m = (pos2.adjBaroAlt_ftAGL ?? pos2.baroAlt_ft) * 0.3048;
    z = -(alt2_m - alt1_m) / dt;
  } else {
    z = -(pos2.location.alt_m - pos1.location.alt_m) / dt;
  }

  return {
    x: (pos2.location.lat_deg - pos1.location.lat_deg) * 111320 / dt,
    y: (pos2.location.lon_deg - pos1.location.lon_deg) * 111320 * Math.cos(pos1.location.lat_deg * Math.PI / 180) / dt,
    z
  };
}

export const JumperListPanel: React.FC<JumperListPanelProps> = ({
  formation,
  currentTime,
  baseJumperId,
  dzCenter,
  altitudeMode
}) => {
  const metrics = useMemo(() => {
    try {
      const positions = projectFormationAtTime(
        formation.participants,
        currentTime,
        baseJumperId,
        dzCenter,
        altitudeMode,
        formation.jumpRunTrack_degTrue,
      );

      const baseParticipant = formation.participants.find(p => p.userId === baseJumperId);
      const basePosition = positions.find(p => p.userId === baseJumperId);

      if (!baseParticipant || !basePosition) return [];

      const baseVelocity = calculateVelocityVector(baseParticipant, currentTime, altitudeMode);

      return positions
        .filter(p => p.userId !== baseJumperId)
        .map(jumperPos => {
          const jumperParticipant = formation.participants.find(p => p.userId === jumperPos.userId);
          if (!jumperParticipant) return null;

          const jumperVelocity = calculateVelocityVector(jumperParticipant, currentTime, altitudeMode);

          const dx = jumperPos.position.x - basePosition.position.x;
          const dy = jumperPos.position.y - basePosition.position.y;
          const dz = jumperPos.position.z - basePosition.position.z;
          const distance3D_m = Math.sqrt(dx*dx + dy*dy + dz*dz);

          // Closure rate along line of sight
          const relVel = {
            x: jumperVelocity.x - baseVelocity.x,
            y: jumperVelocity.y - baseVelocity.y,
            z: jumperVelocity.z - baseVelocity.z
          };
          const los = distance3D_m > 0
            ? { x: dx / distance3D_m, y: dy / distance3D_m, z: dz / distance3D_m }
            : { x: 0, y: 0, z: 0 };
          const closureRate_mps = -(relVel.x * los.x + relVel.y * los.y + relVel.z * los.z);

          return {
            userId: jumperPos.userId,
            name: jumperPos.name,
            color: jumperPos.color,
            lateralSeparation_ft: Math.sqrt(dx*dx + dy*dy) * 3.28084,
            closureRate_fps: closureRate_mps * 3.28084,
            relativeAltitude_ft: -dz * 3.28084,
            normalizedFallRate_mph: jumperPos.metrics?.normalizedFallRate_mph || 0
          } as JumperMetrics;
        })
        .filter(m => m !== null)
        .sort((a, b) => a.lateralSeparation_ft - b.lateralSeparation_ft);
    } catch (error) {
      console.error('Error calculating jumper metrics:', error);
      return [];
    }
  }, [formation, currentTime, baseJumperId, dzCenter, altitudeMode]);

  if (metrics.length === 0) {
    return (
      <Card withBorder>
        <Text c="dimmed">No other jumpers in formation</Text>
      </Card>
    );
  }

  return (
    <Card withBorder>
      <Stack gap="xs">
        <Title order={5}>Formation Participants</Title>
        <Divider />

        <div style={{ overflowX: 'auto' }}>
          <Table highlightOnHover>
            <thead>
              <tr>
                <th>Jumper</th>
                <th>Distance</th>
                <th>Closure</th>
                <th>Rel Alt</th>
                <th>Fall Rate</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map(m => (
                <tr key={m.userId}>
                  <td>
                    <Badge color={m.color} variant="filled" size="sm">
                      {m.name}
                    </Badge>
                  </td>
                  <td>
                    <Text size="sm">{m.lateralSeparation_ft.toFixed(0)} ft</Text>
                  </td>
                  <td>
                    <Text size="sm">
                      {m.closureRate_fps > 0 ? '+' : ''}{m.closureRate_fps.toFixed(1)} fps
                    </Text>
                  </td>
                  <td>
                    <Text size="sm">
                      {m.relativeAltitude_ft > 0 ? '+' : ''}{m.relativeAltitude_ft.toFixed(0)} ft
                    </Text>
                  </td>
                  <td>
                    <Text size="sm">{m.normalizedFallRate_mph.toFixed(0)} mph</Text>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>

        {/* Summary */}
        <Divider />
        <Group justify="space-around">
          <Stack gap={0} align="center">
            <Text size="xs" c="dimmed">Closest</Text>
            <Text size="sm" fw={500}>
              {Math.min(...metrics.map(m => m.lateralSeparation_ft)).toFixed(0)} ft
            </Text>
          </Stack>
          <Stack gap={0} align="center">
            <Text size="xs" c="dimmed">Furthest</Text>
            <Text size="sm" fw={500}>
              {Math.max(...metrics.map(m => m.lateralSeparation_ft)).toFixed(0)} ft
            </Text>
          </Stack>
          <Stack gap={0} align="center">
            <Text size="xs" c="dimmed">Avg</Text>
            <Text size="sm" fw={500}>
              {(metrics.reduce((sum, m) => sum + m.lateralSeparation_ft, 0) / metrics.length).toFixed(0)} ft
            </Text>
          </Stack>
        </Group>
      </Stack>
    </Card>
  );
};
