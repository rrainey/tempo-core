// components/formation/FormationViewer.tsx
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ViewControls, VIEW_CONFIGURATIONS } from './ViewControls';
import { Stack, Select, Button, Group, Slider, Text, SegmentedControl } from '@mantine/core';
import { IconPlayerPlay, IconPlayerPause } from '@tabler/icons-react';
import { projectFormationAtTime } from '../../formation/coordinates';
import type { AltitudeMode, ParticipantData, ProjectedPosition } from '../../formation/coordinates';
import type { GeodeticCoordinates } from '../../formation/types';
import { createHumanoidMesh, disposeHumanoidMesh } from './HumanoidMesh';
import { createAxisIndicators, disposeAxisIndicators } from './AxisIndicator';
import { VideoOverlay } from './VideoOverlay';
import type { VideoInfo } from './VideoOverlay';

export interface FormationData {
  id: string;
  startTime: Date;
  baseJumperId: string;
  jumpRunTrack_degTrue: number;
  participants: ParticipantData[];
  dzElevation_m?: number;
  timelineStart?: number;
  timelineEnd?: number;
}

export type OrientationMethod = 'automatic' | 'humanAssisted';

export interface CalibrationState {
  method: OrientationMethod;
  calibrationTimeOffset?: number;
  jumperAzimuths: Record<string, number>;
}

interface FormationViewerProps {
  formation: FormationData;
  dzCenter: GeodeticCoordinates;
  altitudeMode: AltitudeMode;
  calibration?: CalibrationState | null;
  videos?: VideoInfo[];
  onAltitudeModeChange?: (mode: AltitudeMode) => void;
  onBaseChange?: (newBaseId: string) => void;
  onTimeChange?: (time: number) => void;
}

// ─── helpers ────────────────────────────────────────────────────

function getTimelineBounds(formation: FormationData) {
  const allTimes = formation.participants.flatMap(p =>
    p.timeSeries.map(ts => ts.timeOffset)
  );
  const dataMin = allTimes.length > 0 ? Math.min(...allTimes) : 0;
  const dataMax = allTimes.length > 0 ? Math.max(...allTimes) : 0;

  return {
    min: formation.timelineStart ?? dataMin,
    max: formation.timelineEnd ?? dataMax,
  };
}

/**
 * Fixed mapping from Base Exit Frame to Three.js world coordinates.
 *
 *   Base Frame        Three.js
 *   x (forward)  →    X
 *   y (right)    →    Z
 *   z (down)     →   -Y   (Three.js Y is up)
 *
 * Applied once — view changes are handled entirely by camera placement.
 */
function baseFrameToWorld(pos: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(pos.x, -pos.z, pos.y);
}

/**
 * Convert a quaternion from the Base Frame to Three.js world space.
 *
 * Base Frame axes map to Three.js via: X→X, Y→Z, Z→-Y.
 * For quaternion q = w + xi + yj + zk in Base Frame:
 *   i→i', j→k', k→-j'  ⟹  Three.js (w, x, -z, y)
 *
 * Three.js Quaternion constructor: (x, y, z, w)
 */
function baseQuatToWorld(q: { w: number; x: number; y: number; z: number }): THREE.Quaternion {
  return new THREE.Quaternion(q.x, -q.z, q.y, q.w);
}

// ─── view orientation legend ────────────────────────────────────

const VIEW_ORIENTATION_CONFIG: Record<string, {
  vertLabel: string;
  horizLabel: string;
  horizDir: 'left' | 'right';
}> = {
  godsEye:  { vertLabel: 'Fwd',   horizLabel: 'Right', horizDir: 'right' },
  side:     { vertLabel: 'Up',    horizLabel: 'Fwd',   horizDir: 'left' },
  trailing: { vertLabel: 'Up',    horizLabel: 'Right', horizDir: 'right' },
};

function ViewOrientationLegend({ viewMode }: { viewMode: string }) {
  const config = VIEW_ORIENTATION_CONFIG[viewMode];
  if (!config) return null;

  const { vertLabel, horizLabel, horizDir } = config;

  // Layout: origin at bottom-left or bottom-right depending on horizDir
  // SVG viewBox is 100x100 with room for labels outside the arrows
  const goesRight = horizDir === 'right';
  const ox = goesRight ? 16 : 84;   // origin x
  const oy = 74;                     // origin y
  const vTipY = 14;                  // vertical arrow tip y
  const hTipX = goesRight ? 84 : 16; // horizontal arrow tip x
  const headSize = 5;

  return (
    <div style={{
      position: 'absolute',
      bottom: 12,
      left: 12,
      pointerEvents: 'none',
    }}>
      <svg width="90" height="90" viewBox="0 0 100 100">
        {/* Vertical arrow: origin → up */}
        <line x1={ox} y1={oy} x2={ox} y2={vTipY + 8} stroke="#c5c0c9" strokeWidth="2" />
        <polygon
          points={`${ox},${vTipY} ${ox - headSize},${vTipY + 10} ${ox + headSize},${vTipY + 10}`}
          fill="#c5c0c9"
        />
        {/* Vertical label — to the side of the arrowhead */}
        <text
          x={ox + (goesRight ? 10 : -10)}
          y={vTipY + 4}
          fill="#c5c0c9"
          fontSize="12"
          fontWeight="500"
          textAnchor={goesRight ? 'start' : 'end'}
          dominantBaseline="middle"
        >
          {vertLabel}
        </text>

        {/* Horizontal arrow: origin → left or right */}
        <line
          x1={ox}
          y1={oy}
          x2={hTipX + (goesRight ? -8 : 8)}
          y2={oy}
          stroke="#c5c0c9"
          strokeWidth="2"
        />
        <polygon
          points={goesRight
            ? `${hTipX},${oy} ${hTipX - 10},${oy - headSize} ${hTipX - 10},${oy + headSize}`
            : `${hTipX},${oy} ${hTipX + 10},${oy - headSize} ${hTipX + 10},${oy + headSize}`}
          fill="#c5c0c9"
        />
        {/* Horizontal label — beyond the arrowhead */}
        <text
          x={hTipX + (goesRight ? 2 : -2)}
          y={oy - 8}
          fill="#c5c0c9"
          fontSize="12"
          fontWeight="500"
          textAnchor={goesRight ? 'end' : 'start'}
          dominantBaseline="auto"
        >
          {horizLabel}
        </text>
      </svg>
    </div>
  );
}

// ─── component ──────────────────────────────────────────────────

export const FormationViewer: React.FC<FormationViewerProps> = ({
  formation,
  dzCenter,
  altitudeMode,
  calibration,
  videos,
  onAltitudeModeChange,
  onBaseChange,
  onTimeChange,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  // Three.js objects stored in a single ref to avoid stale-closure issues
  const threeRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    grid: THREE.GridHelper;
    axes: THREE.AxesHelper;
    frameId: number;
    jumperMeshes: Map<string, THREE.Group>;
    trailLines: Map<string, THREE.Line>;
    axisIndicators: THREE.Group | null;
    disposed: boolean;
  } | null>(null);

  const hasAutoScaled = useRef(false);

  const bounds = getTimelineBounds(formation);

  // ── state ──
  const [currentTime, setCurrentTime] = useState(bounds.min);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [viewMode, setViewMode] = useState<string>('godsEye');
  const [showTrails, setShowTrails] = useState(true);
  const [trailLength, setTrailLength] = useState(3);
  const [baseJumperId, setBaseJumperId] = useState(formation.baseJumperId);
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(true);
  const [showAxisIndicators, setShowAxisIndicators] = useState(false);
  const [activeVideo, setActiveVideo] = useState<VideoInfo | null>(null);

  // ── scene initialisation ──
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const width = el.clientWidth;
    const height = el.clientHeight || 600;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 50000);
    camera.position.set(0, 200, 0); // default: overhead / God's eye view
    camera.up.set(-1, 0, 0);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 5000;
    controls.minDistance = 5;

    // Grid in XZ plane (forward/right ground plane)
    const grid = new THREE.GridHelper(200, 20, 0x444444, 0x222222);
    scene.add(grid);

    const axes = new THREE.AxesHelper(50);
    scene.add(axes);

    // Base Frame axis indicators (off by default)
    const axisInd = createAxisIndicators();
    axisInd.visible = false;
    scene.add(axisInd);

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.4);
    dirLight.position.set(100, 100, 50);
    scene.add(dirLight);

    // Store everything in a single ref
    const ctx = {
      scene,
      camera,
      renderer,
      controls,
      grid,
      axes,
      frameId: 0,
      jumperMeshes: new Map<string, THREE.Group>(),
      trailLines: new Map<string, THREE.Line>(),
      axisIndicators: axisInd,
      disposed: false,
    };
    threeRef.current = ctx;
    hasAutoScaled.current = false;

    // Render loop
    const animate = () => {
      if (ctx.disposed) return;
      ctx.frameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize handler
    const onResize = () => {
      if (!el || ctx.disposed) return;
      const w = el.clientWidth;
      const h = el.clientHeight || 600;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    console.log('[FormationViewer] Scene initialised');

    // Cleanup (handles React Strict Mode double-mount)
    return () => {
      console.log('[FormationViewer] Cleaning up scene');
      ctx.disposed = true;
      cancelAnimationFrame(ctx.frameId);
      window.removeEventListener('resize', onResize);

      // Remove all created meshes and lines from scene, dispose GPU resources
      ctx.jumperMeshes.forEach(group => {
        scene.remove(group);
        disposeHumanoidMesh(group);
      });
      ctx.jumperMeshes.clear();

      ctx.trailLines.forEach(line => {
        scene.remove(line);
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      });
      ctx.trailLines.clear();

      if (ctx.axisIndicators) {
        scene.remove(ctx.axisIndicators);
        disposeAxisIndicators(ctx.axisIndicators);
      }

      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);

      threeRef.current = null;
    };
  }, []); // mount once

  // ── project positions & update meshes ──
  useEffect(() => {
    const ctx = threeRef.current;
    if (!ctx || ctx.disposed) return;

    let positions: ProjectedPosition[];
    try {
      positions = projectFormationAtTime(
        formation.participants,
        currentTime,
        baseJumperId,
        dzCenter,
        altitudeMode,
        formation.jumpRunTrack_degTrue,
      );
    } catch (err) {
      console.error('[FormationViewer] Projection error:', err);
      return;
    }

    for (const pos of positions) {
      let group = ctx.jumperMeshes.get(pos.userId);

      if (!group) {
        // Create humanoid figure
        group = createHumanoidMesh(pos.color);
        ctx.scene.add(group);
        ctx.jumperMeshes.set(pos.userId, group);

        // Name label sprite (attached above the figure)
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const c2d = canvas.getContext('2d');
        if (c2d) {
          c2d.font = '24px Arial';
          c2d.fillStyle = pos.color;
          c2d.textAlign = 'center';
          c2d.fillText(pos.name, 128, 40);
        }
        const tex = new THREE.CanvasTexture(canvas);
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: tex, transparent: true }),
        );
        sprite.scale.set(20, 5, 1);
        sprite.position.y = 5;
        group.add(sprite);

        console.log(`[FormationViewer] Created humanoid for ${pos.name}`);
      }

      // Place directly in world coordinates — no per-view transformation
      group.position.copy(baseFrameToWorld(pos.position));

      // Apply orientation quaternion if available.
      //
      // orientation_q is in the Base Frame. Convert to Three.js world space
      // via baseQuatToWorld (same axis permutation as baseFrameToWorld for positions).
      // The mesh at identity already matches the Base Frame convention.
      //
      // Per-jumper azimuth yaw is applied in Three.js world space (about Y = up).
      if (pos.orientation_q) {
        const meshQ = baseQuatToWorld(pos.orientation_q);

        // Apply per-jumper azimuth offset for real-time visual feedback.
        // Azimuth is a yaw about Base -Z (up) = Three.js +Y.
        const azDeg = calibration?.jumperAzimuths?.[pos.userId] ?? 0;
        if (azDeg !== 0) {
          const azRad = azDeg * Math.PI / 180;
          const yawQ = new THREE.Quaternion(0, Math.sin(azRad / 2), 0, Math.cos(azRad / 2));
          meshQ.premultiply(yawQ);
        }

        group.quaternion.copy(meshQ);
      }

      // Adjust opacity for data gaps
      group.traverse(child => {
        if (child instanceof THREE.Mesh) {
          (child.material as THREE.MeshPhongMaterial).opacity = pos.isDataGap ? 0.5 : 0.9;
        }
      });
    }

    // ── auto-scale camera on first valid projection ──
    if (!hasAutoScaled.current && positions.length > 0) {
      hasAutoScaled.current = true;

      let maxDist = 0;
      for (const pos of positions) {
        const wp = baseFrameToWorld(pos.position);
        maxDist = Math.max(maxDist, wp.length());
      }

      const viewRadius = Math.max(maxDist * 2.5, 50);
      const config = VIEW_CONFIGURATIONS[viewMode];
      if (config) {
        const configDist = Math.sqrt(
          config.cameraPosition.x ** 2 +
          config.cameraPosition.y ** 2 +
          config.cameraPosition.z ** 2
        );
        const scale = viewRadius / configDist;
        ctx.camera.position.set(
          config.cameraPosition.x * scale,
          config.cameraPosition.y * scale,
          config.cameraPosition.z * scale,
        );
        ctx.camera.up.set(config.cameraUp.x, config.cameraUp.y, config.cameraUp.z);
      }
      ctx.camera.lookAt(0, 0, 0);
      ctx.controls.target.set(0, 0, 0);
      ctx.controls.update();

      // Scale grid proportionally
      const s = Math.max(viewRadius * 2, 200) / 200;
      ctx.grid.scale.set(s, s, s);

      console.log(
        `[FormationViewer] Auto-scaled: maxDist=${maxDist.toFixed(1)}m, viewRadius=${viewRadius.toFixed(0)}m`,
      );
    }
  }, [formation, currentTime, viewMode, baseJumperId, dzCenter, altitudeMode, calibration]);

  // ── trails ──
  useEffect(() => {
    const ctx = threeRef.current;
    if (!ctx || ctx.disposed) return;

    if (!showTrails) {
      ctx.trailLines.forEach(line => ctx.scene.remove(line));
      return;
    }

    const trailStart = Math.max(bounds.min, currentTime - trailLength);
    const trailEnd = currentTime;
    const steps = Math.max(Math.ceil((trailEnd - trailStart) * 4), 1);

    for (const participant of formation.participants) {
      if (!participant.isVisible) continue;

      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = trailStart + (i / steps) * (trailEnd - trailStart);
        try {
          const projected = projectFormationAtTime(
            formation.participants,
            t,
            baseJumperId,
            dzCenter,
            altitudeMode,
            formation.jumpRunTrack_degTrue,
          );
          const p = projected.find(pp => pp.userId === participant.userId);
          if (p) points.push(baseFrameToWorld(p.position));
        } catch {
          // skip
        }
      }

      if (points.length > 1) {
        let line = ctx.trailLines.get(participant.userId);
        if (!line) {
          const mat = new THREE.LineBasicMaterial({
            color: new THREE.Color(participant.color),
            opacity: 0.5,
            transparent: true,
          });
          line = new THREE.Line(new THREE.BufferGeometry(), mat);
          ctx.scene.add(line);
          ctx.trailLines.set(participant.userId, line);
        } else {
          line.geometry.dispose();
          line.geometry = new THREE.BufferGeometry();
        }
        line.geometry.setFromPoints(points);
      }
    }
  }, [formation, currentTime, showTrails, trailLength, baseJumperId, dzCenter, altitudeMode, bounds.min]);

  // ── view mode changes → camera position & up only ──
  useEffect(() => {
    const ctx = threeRef.current;
    if (!ctx || ctx.disposed) return;
    const config = VIEW_CONFIGURATIONS[viewMode];
    if (!config) return;

    ctx.camera.position.set(
      config.cameraPosition.x,
      config.cameraPosition.y,
      config.cameraPosition.z,
    );
    ctx.camera.up.set(
      config.cameraUp.x,
      config.cameraUp.y,
      config.cameraUp.z,
    );
    ctx.controls.target.set(0, 0, 0);
    ctx.controls.update();

    // Reset auto-scale so camera re-fits on view change
    hasAutoScaled.current = false;
  }, [viewMode]);

  // ── grid / axes visibility ──
  useEffect(() => {
    const ctx = threeRef.current;
    if (!ctx || ctx.disposed) return;
    ctx.grid.visible = showGrid;
    ctx.axes.visible = showAxes;
    if (ctx.axisIndicators) ctx.axisIndicators.visible = showAxisIndicators;
  }, [showGrid, showAxes, showAxisIndicators]);

  // ── notify parent of time changes ──
  useEffect(() => {
    onTimeChange?.(currentTime);
  }, [currentTime]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── playback animation ──
  useEffect(() => {
    if (!isPlaying) return;
    let lastTs: number | null = null;
    let raf: number;

    const tick = (ts: number) => {
      if (lastTs !== null) {
        const dt = (ts - lastTs) / 1000;
        setCurrentTime(prev => {
          const next = prev + dt * playbackSpeed;
          if (next >= bounds.max) {
            setIsPlaying(false);
            return bounds.max;
          }
          return next;
        });
      }
      lastTs = ts;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, playbackSpeed, bounds.max]);

  // ── event handlers ──
  const handleTimeChange = (value: number) => {
    setCurrentTime(value);
    setIsPlaying(false);
  };

  const handleBaseChange = (value: string | null) => {
    if (!value) return;
    setBaseJumperId(value);
    onBaseChange?.(value);
    hasAutoScaled.current = false;
  };

  // ── render ──
  return (
    <Stack gap="sm" style={{ width: '100%', height: '100%' }}>
      {/* 3D viewport with optional video overlay */}
      <div style={{ position: 'relative', width: '100%', flex: 1, minHeight: '400px' }}>
        <div
          ref={mountRef}
          style={{
            width: '100%',
            height: '100%',
            border: '1px solid #444',
            borderRadius: '8px',
            overflow: 'hidden',
          }}
        />
        {activeVideo && (
          <VideoOverlay
            video={activeVideo}
            formationTime={currentTime}
            isPlaying={isPlaying}
            onFormationTimeChange={t => { setCurrentTime(t); onTimeChange?.(t); }}
            onClose={() => setActiveVideo(null)}
          />
        )}
        <ViewOrientationLegend viewMode={viewMode} />
      </div>

      {/* Playback + timeline — immediately below 3D view */}
      <Group style={{ width: '100%' }} gap="sm">
        <Button onClick={() => setIsPlaying(p => !p)} variant="filled" size="sm">
          {isPlaying ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
        </Button>
        <Select
          value={playbackSpeed.toString()}
          onChange={v => v && setPlaybackSpeed(parseFloat(v))}
          data={[
            { value: '0.25', label: '0.25x' },
            { value: '0.5', label: '0.5x' },
            { value: '1', label: '1x' },
            { value: '2', label: '2x' },
            { value: '4', label: '4x' },
          ]}
          size="xs"
          style={{ width: 80 }}
        />
        <Text size="sm" style={{ minWidth: 50 }}>
          {currentTime.toFixed(1)}s
        </Text>
        <Slider
          value={currentTime}
          onChange={handleTimeChange}
          min={bounds.min}
          max={bounds.max}
          step={0.1}
          style={{ flex: 1 }}
          label={v => `${v.toFixed(1)}s`}
        />
        <Text size="sm" c="dimmed" style={{ minWidth: 50 }}>
          {bounds.max.toFixed(1)}s
        </Text>
      </Group>

      {/* View controls */}
      <ViewControls currentView={viewMode} onViewChange={setViewMode} />

      {/* Display toggles + trails (single row) */}
      <Group>
        <Button variant={showGrid ? 'filled' : 'outline'} size="sm" onClick={() => setShowGrid(v => !v)}>
          Grid
        </Button>
        <Button variant={showAxes ? 'filled' : 'outline'} size="sm" onClick={() => setShowAxes(v => !v)}>
          Axes
        </Button>
        <Button variant={showAxisIndicators ? 'filled' : 'outline'} size="sm" onClick={() => setShowAxisIndicators(v => !v)}>
          Base Frame
        </Button>
        <Button variant={showTrails ? 'filled' : 'outline'} size="sm" onClick={() => setShowTrails(v => !v)}>
          Trails
        </Button>
        {showTrails && (
          <Slider
            value={trailLength}
            onChange={setTrailLength}
            min={1}
            max={10}
            step={0.5}
            size="sm"
            style={{ width: 120 }}
            label={v => `${v}s`}
          />
        )}
        {videos && videos.length > 0 && (
          <Button
            variant={activeVideo ? 'filled' : 'outline'}
            size="sm"
            onClick={() => {
              if (activeVideo) {
                setActiveVideo(null);
              } else {
                setActiveVideo(videos[0]);
              }
            }}
          >
            Video ({videos[0].jumperId})
          </Button>
        )}
        <Text size="sm" fw={500}>Altitude:</Text>
        <SegmentedControl
          value={altitudeMode}
          onChange={v => onAltitudeModeChange?.(v as AltitudeMode)}
          data={[
            { label: 'Baro', value: 'Barometric' },
            { label: 'GPS', value: 'GPS' },
          ]}
          size="xs"
        />
        <Text size="sm">Base:</Text>
        <Select
          value={baseJumperId}
          onChange={handleBaseChange}
          data={formation.participants.map(p => ({ value: p.userId, label: p.name }))}
          size="xs"
          style={{ width: 140 }}
        />
      </Group>
    </Stack>
  );
};
