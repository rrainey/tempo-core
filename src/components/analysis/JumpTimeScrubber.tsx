// components/analysis/JumpTimeScrubber.tsx
//
// Unified time-window control for the jump charts: a context strip showing
// the whole log's altitude silhouette with exit/deploy/landing ticks, a
// draggable selection window, and phase presets snapped to the detected
// events. One instance scopes every chart below it — per-chart brushes are
// deliberately gone, so the charts can never show disagreeing slices.
//
// Controlled component: `value` is the visible window in the same time base
// as `altitudeData` (log time or jump-elapsed — the control doesn't care);
// null means "full log".

import React, { useCallback, useMemo, useRef } from 'react';
import { Card, Group, Text, Button } from '@mantine/core';
import { TimeSeriesPoint } from '../../analysis/log-parser';

const EXIT_COLOR = '#00ff88';
const DEPLOY_COLOR = '#ffaa00';
const LANDING_COLOR = '#ff3355';

const VIEW_W = 1000; // svg viewBox width (px mapping done via bounding rect)
const VIEW_H = 64;
const MIN_WINDOW_S = 2;

export { computePresetWindows } from './jump-time-window';
export type { TimeWindow, PresetWindow } from './jump-time-window';
import { computePresetWindows, type TimeWindow, type PresetWindow } from './jump-time-window';

interface JumpTimeScrubberProps {
  altitudeData: TimeSeriesPoint[];
  exitOffsetSec?: number;
  deploymentOffsetSec?: number;
  landingOffsetSec?: number;
  value: TimeWindow | null;
  onChange: (window: TimeWindow | null) => void;
}

type DragMode = 'left' | 'right' | 'pan';

export function JumpTimeScrubber({
  altitudeData,
  exitOffsetSec,
  deploymentOffsetSec,
  landingOffsetSec,
  value,
  onChange,
}: JumpTimeScrubberProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ mode: DragMode; grabOffsetS: number } | null>(null);

  const domain = useMemo<TimeWindow | null>(() => {
    if (altitudeData.length < 2) return null;
    return [altitudeData[0].timestamp, altitudeData[altitudeData.length - 1].timestamp];
  }, [altitudeData]);

  // Downsampled altitude silhouette as an area path.
  const silhouette = useMemo(() => {
    if (!domain) return '';
    const [t0, t1] = domain;
    const span = t1 - t0 || 1;
    const step = Math.max(1, Math.floor(altitudeData.length / 400));
    let minAlt = Infinity, maxAlt = -Infinity;
    for (const p of altitudeData) {
      if (p.value < minAlt) minAlt = p.value;
      if (p.value > maxAlt) maxAlt = p.value;
    }
    const altSpan = maxAlt - minAlt || 1;
    const x = (t: number) => ((t - t0) / span) * VIEW_W;
    const y = (a: number) => 6 + (1 - (a - minAlt) / altSpan) * (VIEW_H - 12);
    let d = `M0,${VIEW_H}`;
    for (let i = 0; i < altitudeData.length; i += step) {
      const p = altitudeData[i];
      d += ` L${x(p.timestamp).toFixed(1)},${y(p.value).toFixed(1)}`;
    }
    d += ` L${VIEW_W},${VIEW_H} Z`;
    return d;
  }, [altitudeData, domain]);

  const presets = useMemo(
    () => (domain ? computePresetWindows(domain, exitOffsetSec, deploymentOffsetSec, landingOffsetSec) : []),
    [domain, exitOffsetSec, deploymentOffsetSec, landingOffsetSec]
  );

  const timeToX = useCallback(
    (t: number) => (domain ? ((t - domain[0]) / (domain[1] - domain[0] || 1)) * VIEW_W : 0),
    [domain]
  );

  const clientXToTime = useCallback(
    (clientX: number): number => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || !domain) return 0;
      const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return domain[0] + frac * (domain[1] - domain[0]);
    },
    [domain]
  );

  const effective = useMemo<TimeWindow | null>(() => {
    if (!domain) return null;
    return value ?? [domain[0], domain[1]];
  }, [value, domain]);

  const emit = useCallback(
    (w: TimeWindow) => {
      if (!domain) return;
      const lo = Math.max(domain[0], Math.min(w[0], w[1] - MIN_WINDOW_S));
      const hi = Math.min(domain[1], Math.max(w[1], lo + MIN_WINDOW_S));
      // snapping back to (almost) the full domain clears the window entirely
      if (lo - domain[0] < 0.5 && domain[1] - hi < 0.5) onChange(null);
      else onChange([lo, hi]);
    },
    [domain, onChange]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!domain || !effective) return;
      const rect = svgRef.current!.getBoundingClientRect();
      const t = clientXToTime(e.clientX);
      const pxPerSec = rect.width / (domain[1] - domain[0] || 1);
      const grabTolS = 12 / pxPerSec; // ~12 px hit zone around each handle
      let mode: DragMode;
      if (Math.abs(t - effective[0]) < grabTolS) mode = 'left';
      else if (Math.abs(t - effective[1]) < grabTolS) mode = 'right';
      else if (t > effective[0] && t < effective[1]) mode = 'pan';
      else {
        // click outside the window: center the current window span there
        const span = effective[1] - effective[0];
        emit([t - span / 2, t + span / 2]);
        mode = 'pan';
      }
      dragRef.current = { mode, grabOffsetS: t - effective[0] };
      svgRef.current!.setPointerCapture(e.pointerId);
    },
    [domain, effective, clientXToTime, emit]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag || !effective || !domain) return;
      const t = clientXToTime(e.clientX);
      if (drag.mode === 'left') emit([t, effective[1]]);
      else if (drag.mode === 'right') emit([effective[0], t]);
      else {
        const span = effective[1] - effective[0];
        let lo = t - drag.grabOffsetS;
        lo = Math.max(domain[0], Math.min(lo, domain[1] - span));
        emit([lo, lo + span]);
      }
    },
    [effective, domain, clientXToTime, emit]
  );

  const onPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = null;
    svgRef.current?.releasePointerCapture(e.pointerId);
  }, []);

  if (!domain || !effective) return null;

  const isActive = (p: PresetWindow): boolean => {
    if (p.window === null) return value === null;
    if (value === null) return false;
    return Math.abs(p.window[0] - value[0]) < 0.25 && Math.abs(p.window[1] - value[1]) < 0.25;
  };

  const x0 = timeToX(effective[0]);
  const x1 = timeToX(effective[1]);
  const fmt = (t: number) => `${t.toFixed(1)}s`;

  const ticks: { t: number; color: string; label: string }[] = [];
  if (exitOffsetSec !== undefined) ticks.push({ t: exitOffsetSec, color: EXIT_COLOR, label: 'exit' });
  if (deploymentOffsetSec !== undefined) ticks.push({ t: deploymentOffsetSec, color: DEPLOY_COLOR, label: 'deploy' });
  if (landingOffsetSec !== undefined) ticks.push({ t: landingOffsetSec, color: LANDING_COLOR, label: 'landing' });

  return (
    <Card withBorder p="sm" data-testid="jump-time-scrubber">
      <Group gap={6} mb={8}>
        {presets.map(p => (
          <Button
            key={p.label}
            size="compact-xs"
            radius="xl"
            variant={isActive(p) ? 'light' : 'subtle'}
            color={isActive(p) ? undefined : 'gray'}
            onClick={() => onChange(p.window)}
          >
            {p.label}
          </Button>
        ))}
        <Text size="xs" c="dimmed" ml="auto" ff="monospace" data-testid="scrubber-readout">
          {value ? `${fmt(value[0])} → ${fmt(value[1])} · ${(value[1] - value[0]).toFixed(1)}s shown` : 'full log'}
        </Text>
      </Group>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        style={{
          width: '100%',
          height: VIEW_H,
          display: 'block',
          borderRadius: 6,
          background: '#0b0b0d',
          cursor: 'ew-resize',
          touchAction: 'none',
          userSelect: 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => onChange(null)}
      >
        <path d={silhouette} fill="rgba(102,204,255,0.16)" stroke="#66ccff" strokeOpacity={0.5} strokeWidth={1} />
        {ticks.map(tk => (
          <line
            key={tk.label}
            x1={timeToX(tk.t)} x2={timeToX(tk.t)} y1={2} y2={VIEW_H - 2}
            stroke={tk.color} strokeWidth={1.5} strokeDasharray="4 3" opacity={0.8}
          />
        ))}
        {/* dimmed out-of-window regions */}
        <rect x={0} y={0} width={Math.max(0, x0)} height={VIEW_H} fill="rgba(0,0,0,0.55)" />
        <rect x={x1} y={0} width={Math.max(0, VIEW_W - x1)} height={VIEW_H} fill="rgba(0,0,0,0.55)" />
        {/* selection frame + handles */}
        <rect
          x={x0} y={0} width={Math.max(0, x1 - x0)} height={VIEW_H}
          fill="rgba(245,158,11,0.08)" stroke="rgba(245,158,11,0.7)" strokeWidth={1}
        />
        <rect x={x0 - 5} y={VIEW_H / 2 - 14} width={10} height={28} rx={3} fill="#f59e0b" />
        <rect x={x1 - 5} y={VIEW_H / 2 - 14} width={10} height={28} rx={3} fill="#f59e0b" />
      </svg>
    </Card>
  );
}
