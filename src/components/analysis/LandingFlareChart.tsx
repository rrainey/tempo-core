// components/analysis/LandingFlareChart.tsx
//
// Notional side-view of the landing flare: X = distance along the final
// approach (feet, 0 at touchdown), Z = height above the touchdown point.
// Callouts along the curve report height, groundspeed (statute mph), and
// load (g). Data preparation: analysis/landing-flare.ts.

import React from 'react';
import { Card, Text, Group, Badge } from '@mantine/core';
import {
  ComposedChart, Line, Scatter, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import type { FlareProfile } from '../../analysis/landing-flare';

interface LandingFlareChartProps {
  profile: FlareProfile;
}

/** Scatter shape: torso-and-head stick figure. The torso segment runs along
 *  the projected up vector with the head at the shoulder end. Projection
 *  foreshortens the figure when the jumper is yawed off the approach axis
 *  (e.g. mid turn), as a true side view should. (The profile data also
 *  carries a chest-forward vector, currently unused in rendering.) */
function TorsoFigureShape(props: any) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null) return <g />;
  const [ux, uz] = payload.up as [number, number];
  const L = 22; // torso length, px
  // SVG y grows downward; chart z grows upward.
  const hipX = cx - (ux * L) / 2, hipY = cy + (uz * L) / 2;
  const shX = cx + (ux * L) / 2, shY = cy - (uz * L) / 2;
  const headX = cx + ux * (L / 2 + 5), headY = cy - uz * (L / 2 + 5);
  return (
    <g stroke="#F59E0B" strokeWidth={2.5} opacity={0.95}>
      <line x1={hipX} y1={hipY} x2={shX} y2={shY} strokeLinecap="round" />
      <circle cx={headX} cy={headY} r={3.2} fill="#F59E0B" strokeWidth={0} />
    </g>
  );
}

/** Scatter shape: marker dot plus a two-line callout, alternating above and
 *  below the curve to reduce collisions on the flat tail. */
function CalloutShape(props: any) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null) return <g />;
  const above = payload.idx % 2 === 0;
  const y0 = above ? cy - 26 : cy + 16;
  const speed = payload.groundspeed_mph != null ? `${Math.round(payload.groundspeed_mph)} mph` : '—';
  const load = payload.load_g != null ? `${payload.load_g.toFixed(1)} g` : '—';
  return (
    <g>
      <circle cx={cx} cy={cy} r={3.5} fill="#66ccff" stroke="#0b0b0d" strokeWidth={1} />
      <text x={cx} y={y0} textAnchor="middle" fill="#e8e6ea" fontSize={11} fontWeight={600}>
        {payload.z_ft.toFixed(1)} ft
      </text>
      <text x={cx} y={y0 + 12} textAnchor="middle" fill="#a1a1aa" fontSize={10}>
        {speed} · {load}
      </text>
    </g>
  );
}

export function LandingFlareChart({ profile }: LandingFlareChartProps) {
  const lineData = profile.points.map(p => ({ x: p.x_ft, z: p.z_ft }));
  const calloutData = profile.callouts.map((c, idx) => ({ ...c, x: c.x_ft, z: c.z_ft, idx }));
  const figureData = (profile.figures ?? []).map(f => ({ ...f, x: f.x_ft, z: f.z_ft }));

  const zMax = Math.max(...profile.points.map(p => p.z_ft));

  return (
    <Card withBorder p="md">
      <Group justify="space-between" mb="xs">
        <Text fw={500}>Landing Flare Profile</Text>
        <Group gap="xs">
          <Badge size="xs" color="cyan" variant="light">
            final {profile.window_s.toFixed(0)} s
          </Badge>
          <Badge size="xs" color="gray" variant="light">
            approach {Math.round(profile.approachHeading_degT)}°T
          </Badge>
        </Group>
      </Group>
      <Text size="xs" c="dimmed" mb="sm">
        Side view along the final-approach ground track; heights relative to the
        touchdown point. Callouts: height · groundspeed (statute mph) · load (g).
        {figureData.length > 0 &&
          ' Amber figures show torso lean (head dot up);' +
          ' a shortened figure is turned away from the approach line.'}
      </Text>

      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart data={lineData} margin={{ top: 34, right: 30, left: 10, bottom: 35 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#004455" opacity={0.5} />
          <XAxis
            dataKey="x"
            type="number"
            domain={['dataMin', 'dataMax']}
            stroke="#c5c0c9"
            tickFormatter={(v: number) => `${Math.round(v)}`}
            label={{
              value: 'Along final approach (ft) — touchdown at 0',
              position: 'insideBottom', offset: -10, style: { fill: '#c5c0c9' },
            }}
          />
          <YAxis
            dataKey="z"
            type="number"
            domain={[0, Math.ceil(zMax * 1.15)]}
            stroke="#c5c0c9"
            tickFormatter={(v: number) => `${Math.round(v)}`}
            label={{
              value: 'Height (ft)', angle: -90, position: 'insideLeft', style: { fill: '#c5c0c9' },
            }}
          />
          <ReferenceLine y={0} stroke="#c5c0c9" opacity={0.5} />
          <ReferenceLine x={0} stroke="#00ff88" strokeDasharray="5 5" opacity={0.6} />
          <Line
            type="monotone" dataKey="z" stroke="#66ccff" strokeWidth={2}
            dot={false} isAnimationActive={false}
          />
          {figureData.length > 0 && (
            <Scatter data={figureData} dataKey="z" shape={<TorsoFigureShape />} isAnimationActive={false} />
          )}
          <Scatter data={calloutData} dataKey="z" shape={<CalloutShape />} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  );
}
