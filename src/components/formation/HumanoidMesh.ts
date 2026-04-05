// components/formation/HumanoidMesh.ts
//
// Procedural Three.js humanoid figure in standard freefall arch position.
//
// At identity quaternion, the mesh represents a standing person in the
// Base Frame, mapped to Three.js world via baseFrameToWorld():
//
//   Base Frame        Three.js local
//   +X (chest/fwd) →  +X
//   +Y (right)     →  +Z
//   -Z (head/up)   →  +Y
//
// The orientation_q from the calibration + AHRS pipeline rotates this
// identity pose into the actual body attitude within the Base Frame.
// The Base→Three.js quaternion conversion then maps it to world space.

import * as THREE from 'three';

// ─── Constants ──────────────────────────────────────────────────

// Scale: the figure is ~6 units across (comparable to the previous 2-unit radius sphere)
const TORSO_LENGTH = 2.5;
const TORSO_WIDTH = 1.8;
const TORSO_DEPTH = 0.6;
const HEAD_RADIUS = 0.5;

const LIMB_RADIUS = 0.2;
const UPPER_ARM_LENGTH = 1.8;
const LOWER_ARM_LENGTH = 1.5;
const UPPER_LEG_LENGTH = 1.8;
const LOWER_LEG_LENGTH = 1.5;

// ─── Helpers ────────────────────────────────────────────────────

function createLimbSegment(
  radius: number,
  length: number,
  material: THREE.Material
): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radius, radius, length, 8);
  // Shift geometry so pivot is at one end (top of cylinder)
  geo.translate(0, -length / 2, 0);
  return new THREE.Mesh(geo, material);
}

// ─── Main Builder ───────────────────────────────────────────────

/**
 * Create a stylized humanoid mesh in a freefall arch position.
 *
 * The figure is built in "body frame" orientation:
 *   - The figure's chest faces local -Y (so that body +X_b = local +Y = "out of chest")
 *   - Right hand is local +X
 *   - Feet direction is local +Z
 *
 * Actually we build in a convenient construction space and then apply a
 * final rotation so the group's local axes match the body frame convention:
 *   Body +X_b (out of chest) → Group local -Z (Three.js forward)
 *   Body +Y_b (right)        → Group local +X
 *   Body +Z_b (down standing)→ Group local +Y (down)
 *
 * When the orientation quaternion is identity, the figure should be in
 * a belly-to-earth arch: chest facing down.
 */
export function createHumanoidMesh(color: string): THREE.Group {
  const group = new THREE.Group();

  const threeColor = new THREE.Color(color);
  const material = new THREE.MeshPhongMaterial({
    color: threeColor,
    transparent: true,
    opacity: 0.9,
    emissive: threeColor,
    emissiveIntensity: 0.3,
  });

  // ── Build in construction space (Y-up, facing +Z) ──
  // We'll rotate the whole group at the end.

  // Torso — slightly arched (curved box)
  const torsoGeo = new THREE.BoxGeometry(TORSO_WIDTH, TORSO_DEPTH, TORSO_LENGTH);
  const torso = new THREE.Mesh(torsoGeo, material);
  // Slight arch: rotate torso tips up
  torso.rotation.x = -0.15; // subtle chest-down arch
  group.add(torso);

  // Head — sphere at the front-top of torso
  const headGeo = new THREE.SphereGeometry(HEAD_RADIUS, 12, 12);
  const head = new THREE.Mesh(headGeo, material);
  head.position.set(0, TORSO_DEPTH * 0.3, TORSO_LENGTH / 2 + HEAD_RADIUS * 0.5);
  // Head tilts down slightly (looking at ground in arch)
  head.rotation.x = 0.3;
  group.add(head);

  // ── Arms ──
  // In arch position: arms extend forward and outward at ~45°
  // Lower limbs are children of upper limbs so they inherit the parent transform.

  // Right upper arm — shoulder joint at torso edge
  const rightUpperArm = createLimbSegment(LIMB_RADIUS, UPPER_ARM_LENGTH, material);
  rightUpperArm.position.set(TORSO_WIDTH / 2, 0, TORSO_LENGTH * 0.3);
  rightUpperArm.rotation.z = Math.PI / 3;   // 45° outward
  rightUpperArm.rotation.x = -Math.PI / 6;   // slightly forward
  group.add(rightUpperArm);

  // Right forearm — elbow joint at end of upper arm
  const rightForearm = createLimbSegment(LIMB_RADIUS * 0.85, LOWER_ARM_LENGTH, material);
  rightForearm.position.set(0, -UPPER_ARM_LENGTH, 0); // attached at end of upper arm
  rightForearm.rotation.z = -0.2;   // slight additional outward bend at elbow
  rightForearm.rotation.x = 0.3;    // slight forward bend
  rightUpperArm.add(rightForearm);

  // Left upper arm (mirror)
  const leftUpperArm = createLimbSegment(LIMB_RADIUS, UPPER_ARM_LENGTH, material);
  leftUpperArm.position.set(-TORSO_WIDTH / 2, 0, TORSO_LENGTH * 0.3);
  leftUpperArm.rotation.z = -Math.PI / 3;
  leftUpperArm.rotation.x = -Math.PI / 6;
  group.add(leftUpperArm);

  // Left forearm — elbow joint at end of upper arm
  const leftForearm = createLimbSegment(LIMB_RADIUS * 0.85, LOWER_ARM_LENGTH, material);
  leftForearm.position.set(0, -UPPER_ARM_LENGTH, 0);
  leftForearm.rotation.z = 0.2;
  leftForearm.rotation.x = 0.3;
  leftUpperArm.add(leftForearm);

  // ── Legs ──
  // In arch position: thighs angle back ~30°, calves kicked up (knees bent ~90°)
  // Lower legs are children of upper legs.

  // Right upper leg — hip joint at torso base
  const rightUpperLeg = createLimbSegment(LIMB_RADIUS * 1.1, UPPER_LEG_LENGTH, material);
  rightUpperLeg.position.set(TORSO_WIDTH * 0.25, 0, -TORSO_LENGTH / 2);
  rightUpperLeg.rotation.z = 0.15;           // slight outward splay
  rightUpperLeg.rotation.x = Math.PI / 3;     // angled back (~36°)
  group.add(rightUpperLeg);

  // Right lower leg — knee joint at end of upper leg
  const rightLowerLeg = createLimbSegment(LIMB_RADIUS * 0.9, LOWER_LEG_LENGTH, material);
  rightLowerLeg.position.set(0, -UPPER_LEG_LENGTH, 0); // attached at knee
  rightLowerLeg.rotation.x = -Math.PI / 2 * 0.8; // kicked up behind (~90° bend)
  rightUpperLeg.add(rightLowerLeg);

  // Left upper leg (mirror)
  const leftUpperLeg = createLimbSegment(LIMB_RADIUS * 1.1, UPPER_LEG_LENGTH, material);
  leftUpperLeg.position.set(-TORSO_WIDTH * 0.25, 0, -TORSO_LENGTH / 2);
  leftUpperLeg.rotation.z = -0.15;
  leftUpperLeg.rotation.x = Math.PI / 3;
  group.add(leftUpperLeg);

  // Left lower leg — knee joint at end of upper leg
  const leftLowerLeg = createLimbSegment(LIMB_RADIUS * 0.9, LOWER_LEG_LENGTH, material);
  leftLowerLeg.position.set(0, -UPPER_LEG_LENGTH, 0);
  leftLowerLeg.rotation.x = -Math.PI / 2 * 0.8;
  leftUpperLeg.add(leftLowerLeg);

  // ── Final rotation: construction space → Three.js local (= Base Frame mapped) ──
  //
  // Construction space: chest=+Y, right=+X, head=+Z
  // Three.js local at identity (matching Base Frame via baseFrameToWorld):
  //   chest → +X,  head → +Y,  right → +Z
  //
  // Mapping: Xc→+Z, Yc→+X, Zc→+Y  →  Euler XYZ = (-π/2, 0, -π/2)
  const pivotGroup = new THREE.Group();
  const innerGroup = group;

  innerGroup.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);

  pivotGroup.add(innerGroup);
  return pivotGroup;
}

/**
 * Dispose all GPU resources in a humanoid mesh group.
 */
export function disposeHumanoidMesh(group: THREE.Group): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (child.material instanceof THREE.Material) {
        child.material.dispose();
      }
    }
  });
}
