// components/formation/ViewControls.tsx
import React from 'react';
import { Button, Group, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { IconEye, IconArrowsHorizontal, IconFocus } from '@tabler/icons-react';

export interface ViewConfiguration {
  name: string;
  description: string;
  icon: React.ReactNode;
  cameraPosition: { x: number; y: number; z: number };
  cameraUp: { x: number; y: number; z: number };
}

/**
 * Camera presets for viewing the formation.
 *
 * Three.js world axes are mapped from the Base Exit Frame once:
 *   X = forward  (base x — along jump run track at exit)
 *   Y = up       (base -z)
 *   Z = right    (base y — lateral, right of track)
 *
 * Each view is purely a camera placement — positions are never transformed.
 */
export const VIEW_CONFIGURATIONS: Record<string, ViewConfiguration> = {
  godsEye: {
    name: "Overhead View",
    description: "Looking down from above",
    icon: <IconEye size={18} />,
    // Camera above on +Y, looking down. Up = +X so forward (+X) points up on screen.
    cameraPosition: { x: 0, y: 200, z: 0 },
    cameraUp: { x: 1, y: 0, z: 0 },
  },
  side: {
    name: "Side View",
    description: "Looking from the side (perpendicular to jump run)",
    icon: <IconArrowsHorizontal size={18} />,
    // Camera on -Z (left side), looking at origin along +Z.
    // Screen: +X points left (forward), +Y points up.
    cameraPosition: { x: 0, y: 0, z: -200 },
    cameraUp: { x: 0, y: 1, z: 0 },
  },
  trailing: {
    name: "Trailing View",
    description: "Looking forward along jump run",
    icon: <IconFocus size={18} />,
    // Camera behind on -X, looking forward. Screen: Z=right, Y=up.
    cameraPosition: { x: -200, y: 0, z: 0 },
    cameraUp: { x: 0, y: 1, z: 0 },
  }
};

interface ViewControlsProps {
  currentView: string;
  onViewChange: (viewKey: string) => void;
}

export const ViewControls: React.FC<ViewControlsProps> = ({ currentView, onViewChange }) => {
  return (
    <Paper p="xs" withBorder>
      <Stack gap="xs">
        <Text size="sm" fw={500}>Camera View</Text>
        <Group gap="xs">
          {Object.entries(VIEW_CONFIGURATIONS).map(([key, config]) => (
            <Tooltip key={key} label={config.description} position="top">
              <Button
                variant={currentView === key ? 'filled' : 'outline'}
                size="sm"
                leftSection={config.icon}
                onClick={() => onViewChange(key)}
                style={
                  currentView === key
                    ? {
                        backgroundColor: '#228be6',
                        color: 'white',
                        borderColor: '#228be6',
                      }
                    : undefined
                }
              >
                {config.name}
              </Button>
            </Tooltip>
          ))}
        </Group>
      </Stack>
    </Paper>
  );
};
