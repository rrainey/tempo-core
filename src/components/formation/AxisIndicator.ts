// components/formation/AxisIndicator.ts
//
// Generates a set of axis-indicator overlays for verifying camera and
// orientation setup in the FormationViewer.
//
// Three overlays are created, one per principal plane of the Base Frame
// (mapped to Three.js world via: X=forward, Y=up(-down), Z=right):
//
//   Overhead (XZ plane, Y=0):  shows Base +X (forward) and +Y (right)
//   Side     (XY plane, Z=0):  shows Base +X (forward) and +Z (down)
//   Trail    (YZ plane, X=0):  shows Base +Y (right) and +Z (down)
//
// Each overlay consists of:
//   - Rounded arrow pair at the origin showing positive axis directions
//   - "+X"/"+Y"/"+Z" text labels at the arrow tips

import * as THREE from 'three';

const LABEL_HEIGHT = 3;            // meters — text character height
const ARROW_LENGTH = 12;           // meters — shaft length
const ARROW_HEAD_LENGTH = 2.5;     // meters
const ARROW_HEAD_WIDTH = 1.5;      // meters
const SHAFT_WIDTH = 0.3;           // meters
const CURVE_RADIUS = 2;            // radius of the rounded elbow
const THICKNESS = 0.08;            // extrusion depth (very thin)

const COLOR_X = 0xff4444;  // red — forward
const COLOR_Y = 0x44ff44;  // green — right
const COLOR_Z = 0x4488ff;  // blue — down

// ─── Text geometry from line segments ──────────────────────────

/**
 * Build a flat mesh of a text string from simple stroke paths.
 * Characters are ~1 unit tall; caller scales to desired height.
 */
function createTextMesh(text: string, color: number): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });

  // Simple stroke-font: each character is a set of line pairs (x0,y0,x1,y1)
  // in a 0.6w × 1.0h cell.  We'll build thin quads for each stroke.
  const glyphs: Record<string, number[][]> = {
    '+': [[0.1,0.5, 0.5,0.5], [0.3,0.3, 0.3,0.7]],
    'X': [[0.05,0, 0.55,1], [0.55,0, 0.05,1]],
    'Y': [[0.05,1, 0.3,0.5], [0.55,1, 0.3,0.5], [0.3,0.5, 0.3,0]],
    'Z': [[0.05,1, 0.55,1], [0.55,1, 0.05,0], [0.05,0, 0.55,0]],
  };

  let cursor = 0;
  const strokeWidth = 0.08;

  for (const ch of text) {
    const strokes = glyphs[ch];
    if (!strokes) { cursor += 0.4; continue; }

    for (const [x0, y0, x1, y1] of strokes) {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.001) continue;

      // Perpendicular for width
      const nx = -dy / len * strokeWidth / 2;
      const ny = dx / len * strokeWidth / 2;

      const shape = new THREE.Shape();
      shape.moveTo(cursor + x0 + nx, y0 + ny);
      shape.lineTo(cursor + x1 + nx, y1 + ny);
      shape.lineTo(cursor + x1 - nx, y1 - ny);
      shape.lineTo(cursor + x0 - nx, y0 - ny);
      shape.closePath();

      const geo = new THREE.ShapeGeometry(shape);
      group.add(new THREE.Mesh(geo, mat));
    }
    cursor += 0.65;
  }

  return group;
}

// ─── Arrow with rounded elbow ──────────────────────────────────

/**
 * Create one axis arrow lying along +X in local coords,
 * with an arrowhead at the tip.  Returns a Group.
 */
function createArrow(color: number): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });

  // Shaft: thin rectangle from (CURVE_RADIUS, 0) to (ARROW_LENGTH, 0)
  const shaftStart = CURVE_RADIUS;
  const shaftEnd = ARROW_LENGTH;
  const hw = SHAFT_WIDTH / 2;

  const shaftShape = new THREE.Shape();
  shaftShape.moveTo(shaftStart, -hw);
  shaftShape.lineTo(shaftEnd, -hw);
  shaftShape.lineTo(shaftEnd, hw);
  shaftShape.lineTo(shaftStart, hw);
  shaftShape.closePath();
  group.add(new THREE.Mesh(new THREE.ShapeGeometry(shaftShape), mat));

  // Arrowhead: triangle at the tip
  const headShape = new THREE.Shape();
  headShape.moveTo(shaftEnd, -ARROW_HEAD_WIDTH / 2);
  headShape.lineTo(shaftEnd + ARROW_HEAD_LENGTH, 0);
  headShape.lineTo(shaftEnd, ARROW_HEAD_WIDTH / 2);
  headShape.closePath();
  group.add(new THREE.Mesh(new THREE.ShapeGeometry(headShape), mat));

  return group;
}

/**
 * Create a rounded 90° elbow connecting two arrows at the origin.
 * The elbow curves from the +Y direction to the +X direction.
 */
function createElbow(color: number): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x888888, side: THREE.DoubleSide });

  // Quarter-circle arc from angle 0 (+X) to π/2 (+Y), centered at origin
  const segments = 12;
  const hw = SHAFT_WIDTH / 2;

  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI / 2;
    const a1 = ((i + 1) / segments) * Math.PI / 2;

    const shape = new THREE.Shape();
    shape.moveTo(
      (CURVE_RADIUS - hw) * Math.cos(a0),
      (CURVE_RADIUS - hw) * Math.sin(a0)
    );
    shape.lineTo(
      (CURVE_RADIUS - hw) * Math.cos(a1),
      (CURVE_RADIUS - hw) * Math.sin(a1)
    );
    shape.lineTo(
      (CURVE_RADIUS + hw) * Math.cos(a1),
      (CURVE_RADIUS + hw) * Math.sin(a1)
    );
    shape.lineTo(
      (CURVE_RADIUS + hw) * Math.cos(a0),
      (CURVE_RADIUS + hw) * Math.sin(a0)
    );
    shape.closePath();

    group.add(new THREE.Mesh(new THREE.ShapeGeometry(shape), mat));
  }

  return group;
}

// ─── Single-plane indicator ────────────────────────────────────

/**
 * Build one axis-indicator overlay in the local XY plane.
 * localX arrow points along +X, localY arrow points along +Y.
 * Labels are placed at the arrow tips.
 */
function createPlaneIndicator(
  labelX: string, colorX: number,
  labelY: string, colorY: number,
): THREE.Group {
  const group = new THREE.Group();

  // Elbow connecting the two arrows
  group.add(createElbow(0x888888));

  // Arrow along +X (horizontal)
  group.add(createArrow(colorX));

  // Arrow along +Y (vertical in local plane)
  const arrowY = createArrow(colorY);
  arrowY.rotation.z = Math.PI / 2; // rotate +X arrow to point along +Y
  group.add(arrowY);

  // Label at +X tip
  const textX = createTextMesh(labelX, colorX);
  textX.scale.setScalar(LABEL_HEIGHT);
  textX.position.set(ARROW_LENGTH + ARROW_HEAD_LENGTH + 1, -LABEL_HEIGHT / 2, 0);
  group.add(textX);

  // Label at +Y tip
  const textY = createTextMesh(labelY, colorY);
  textY.scale.setScalar(LABEL_HEIGHT);
  textY.position.set(-LABEL_HEIGHT * 0.4, ARROW_LENGTH + ARROW_HEAD_LENGTH + 1, 0);
  group.add(textY);

  return group;
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Create the full set of axis indicators for all three principal planes.
 * Positioned at the Base Frame origin, aligned with Base Frame axes.
 *
 * Base Frame → Three.js world mapping:
 *   Base +X (forward) → 3js +X
 *   Base +Y (right)   → 3js +Z
 *   Base +Z (down)    → 3js -Y
 *
 * Overhead (3js XZ plane):  shows Base +X (forward, 3js+X) and Base +Y (right, 3js+Z)
 * Side     (3js XY plane):  shows Base +X (forward, 3js+X) and Base +Z (down, 3js-Y)
 * Trail    (3js YZ plane):  shows Base +Y (right, 3js+Z)   and Base +Z (down, 3js-Y)
 */
export function createAxisIndicators(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'axisIndicators';

  // ── Overhead plane (3js XZ, Y=0) ──
  // Local X → 3js +X (Base forward), local Y → 3js +Z (Base right)
  const overhead = createPlaneIndicator('+X', COLOR_X, '+Y', COLOR_Y);
  // createPlaneIndicator builds in local XY.
  // Rotate +90° about X: local Y → 3js +Z, local X stays +X.
  overhead.rotation.x = Math.PI / 2;
  root.add(overhead);

  // ── Side plane (3js XY, Z=0) ──
  // Local X → 3js +X (Base forward), local Y → 3js -Y (Base down = +Z_base)
  const side = createPlaneIndicator('+X', COLOR_X, '+Z', COLOR_Z);
  // Built in local XY.  We want local Y → 3js -Y: reflect by rotating 180° about X.
  // But that flips the text.  Instead: rotate so local+Y maps to 3js-Y.
  // Rotation of π about Z flips Y and X: no good.
  // Scale Y by -1 to flip the Y axis direction.
  side.scale.y = -1;
  root.add(side);

  // ── Trail plane (3js YZ, X=0) ──
  // Local X → 3js +Z (Base right), local Y → 3js -Y (Base down)
  const trail = createPlaneIndicator('+Y', COLOR_Y, '+Z', COLOR_Z);
  // Built in local XY.  Rotate so local X → 3js +Z, local Y → 3js -Y.
  // First rotate -90° about Y: local X → +Z.  Then scale Y=-1 for down.
  trail.rotation.y = -Math.PI / 2;
  trail.scale.y = -1;
  root.add(trail);

  return root;
}

/**
 * Dispose all geometry and materials in an axis indicator group.
 */
export function disposeAxisIndicators(group: THREE.Group): void {
  group.traverse(child => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
  });
}
