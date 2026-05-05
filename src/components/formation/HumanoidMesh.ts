// components/formation/HumanoidMesh.ts
//
// Procedural Three.js humanoid figure in standard freefall arch position.
//
// At identity quaternion, the mesh represents a standing person in the
// Base Frame, mapped to Three.js world via baseFrameToWorld():
//
//   Base Frame        Three.js local
//   +X (chest/fwd) ->  +X
//   +Y (right)     ->  +Z
//   -Z (head/up)   ->  +Y
//
// The orientation_q from the calibration + AHRS pipeline rotates this
// identity pose into the actual body attitude within the Base Frame.
// The Base->Three.js quaternion conversion then maps it to world space.

import * as THREE from 'three';

// ---- Constants (1 unit ~ 23 cm, calibrated from head diameter) ----------

// Torso -- split into upper chest and lower abdomen for arch articulation
const UPPER_CHEST_LENGTH = 1.35;
const LOWER_ABDOMEN_LENGTH = 1.1;
const TORSO_WIDTH = 2.0;
const CHEST_DEPTH = 0.9;
const ABDOMEN_DEPTH = 0.8;
const HEAD_RADIUS = 0.5;

// Limbs
const LIMB_RADIUS = 0.22;
const UPPER_ARM_LENGTH = 1.4;
const LOWER_ARM_LENGTH = 1.15;
const UPPER_LEG_LENGTH = 1.9;
const LOWER_LEG_LENGTH = 1.8;

// Hands
const HAND_WIDTH = 0.45;
const HAND_LENGTH = 0.7;
const HAND_THICKNESS = 0.12;

// Feet
const FOOT_WIDTH = 0.35;
const FOOT_LENGTH = 0.9;
const FOOT_HEIGHT = 0.2;

// Parachute container
const CONTAINER_WIDTH = 1.4;
const CONTAINER_HEIGHT = 1.6;
const CONTAINER_DEPTH = 0.45;

// ---- Helpers ------------------------------------------------------------

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

// ---- Main Builder -------------------------------------------------------

/**
 * Create a stylized humanoid mesh in a freefall arch position.
 *
 * Scene graph (construction space, Y-up):
 *
 *   innerGroup
 *     +- upperChest (box, pitched forward for arch)
 *     |    +- head (sphere)
 *     |    +- container (box, on back)
 *     |    +- rightUpperArm -> rightForearm -> rightHand
 *     |    +- leftUpperArm  -> leftForearm  -> leftHand
 *     |    +- lowerAbdomen (box, pitched back for arch)
 *     |         +- rightUpperLeg -> rightLowerLeg -> rightFoot
 *     |         +- leftUpperLeg  -> leftLowerLeg  -> leftFoot
 *
 * Construction space is then rotated into body-frame convention via
 * pivotGroup so the final local axes match the Base Frame mapping.
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

  // == Build in construction space (Y-up, facing +Z) ==

  // -- Upper Chest --
  const chestGeo = new THREE.BoxGeometry(TORSO_WIDTH, CHEST_DEPTH, UPPER_CHEST_LENGTH);
  const upperChest = new THREE.Mesh(chestGeo, material);
  // Pitch the chest back/up for the arch (head lifts away from ground)
  upperChest.rotation.x = 0.18;
  group.add(upperChest);

  // -- Head -- sphere at the front-top of chest
  const headGeo = new THREE.SphereGeometry(HEAD_RADIUS, 12, 12);
  const head = new THREE.Mesh(headGeo, material);
  head.position.set(0, CHEST_DEPTH * 0.3, UPPER_CHEST_LENGTH / 2 + HEAD_RADIUS * 0.5);
  head.rotation.x = 0.3; // looking down in arch
  upperChest.add(head);

  // -- Parachute Container -- on the back of the chest
  // Shoulder end (+Z) protrudes ~30% less than the hip end (-Z); back-face stays flush.
  const containerGeo = new THREE.BoxGeometry(CONTAINER_WIDTH, CONTAINER_DEPTH, CONTAINER_HEIGHT, 1, 1, 1);
  const shoulderTaper = CONTAINER_DEPTH * 0.3;
  const containerPos = containerGeo.attributes.position;
  for (let i = 0; i < containerPos.count; i++) {
    if (containerPos.getZ(i) > 0 && containerPos.getY(i) < 0) {
      containerPos.setY(i, containerPos.getY(i) + shoulderTaper);
    }
  }
  containerPos.needsUpdate = true;
  containerGeo.computeVertexNormals();
  const container = new THREE.Mesh(containerGeo, material);
  container.position.set(
    0,
    -(CHEST_DEPTH / 2 + CONTAINER_DEPTH / 2),
    -UPPER_CHEST_LENGTH * 0.1 - CONTAINER_HEIGHT * 0.2 // base shifted toward hips
  );
  upperChest.add(container);

  // -- Lower Abdomen -- child of chest, hinged at waist
  const abdomenGeo = new THREE.BoxGeometry(TORSO_WIDTH * 0.85, ABDOMEN_DEPTH, LOWER_ABDOMEN_LENGTH);
  const lowerAbdomen = new THREE.Mesh(abdomenGeo, material);
  // Position at the bottom edge of the chest
  lowerAbdomen.position.set(0, 0, -UPPER_CHEST_LENGTH / 2 - LOWER_ABDOMEN_LENGTH / 2);
  // Pitch the abdomen forward to complete the arch (hips lift, belly convex)
  lowerAbdomen.rotation.x = -0.15;
  upperChest.add(lowerAbdomen);

  // == Arms (children of upperChest) ==

  // -- Right upper arm -- shoulder at top-right of chest
  const rightUpperArm = createLimbSegment(LIMB_RADIUS, UPPER_ARM_LENGTH, material);
  rightUpperArm.position.set(TORSO_WIDTH / 2, 0, UPPER_CHEST_LENGTH * 0.3);
  rightUpperArm.rotation.z = Math.PI / 3;    // outward
  rightUpperArm.rotation.x = -Math.PI / 6;   // slightly forward
  upperChest.add(rightUpperArm);

  // Right forearm -- elbow
  const rightForearm = createLimbSegment(LIMB_RADIUS * 0.85, LOWER_ARM_LENGTH, material);
  rightForearm.position.set(0, -UPPER_ARM_LENGTH, 0);
  rightForearm.rotation.z = -0.2;
  rightForearm.rotation.x = 0.3;
  rightUpperArm.add(rightForearm);

  // Right hand -- flat box at wrist, length along forearm axis (-Y)
  const rightHandGeo = new THREE.BoxGeometry(HAND_WIDTH, HAND_LENGTH, HAND_THICKNESS);
  rightHandGeo.translate(0, -HAND_LENGTH / 2, 0); // pivot at wrist end
  const rightHand = new THREE.Mesh(rightHandGeo, material);
  rightHand.position.set(0, -LOWER_ARM_LENGTH, 0);
  rightForearm.add(rightHand);

  // -- Left upper arm (mirror) --
  const leftUpperArm = createLimbSegment(LIMB_RADIUS, UPPER_ARM_LENGTH, material);
  leftUpperArm.position.set(-TORSO_WIDTH / 2, 0, UPPER_CHEST_LENGTH * 0.3);
  leftUpperArm.rotation.z = -Math.PI / 3;
  leftUpperArm.rotation.x = -Math.PI / 6;
  upperChest.add(leftUpperArm);

  // Left forearm -- elbow
  const leftForearm = createLimbSegment(LIMB_RADIUS * 0.85, LOWER_ARM_LENGTH, material);
  leftForearm.position.set(0, -UPPER_ARM_LENGTH, 0);
  leftForearm.rotation.z = 0.2;
  leftForearm.rotation.x = 0.3;
  leftUpperArm.add(leftForearm);

  // Left hand -- flat box at wrist, length along forearm axis (-Y)
  const leftHandGeo = new THREE.BoxGeometry(HAND_WIDTH, HAND_LENGTH, HAND_THICKNESS);
  leftHandGeo.translate(0, -HAND_LENGTH / 2, 0);
  const leftHand = new THREE.Mesh(leftHandGeo, material);
  leftHand.position.set(0, -LOWER_ARM_LENGTH, 0);
  leftForearm.add(leftHand);

  // == Legs (children of lowerAbdomen) ==

  // -- Right upper leg -- hip at bottom-right of abdomen
  const rightUpperLeg = createLimbSegment(LIMB_RADIUS * 1.1, UPPER_LEG_LENGTH, material);
  rightUpperLeg.position.set(TORSO_WIDTH * 0.2, 0, -LOWER_ABDOMEN_LENGTH / 2);
  rightUpperLeg.rotation.z = 0.15;            // slight outward splay
  rightUpperLeg.rotation.x = Math.PI / 3;     // angled back
  lowerAbdomen.add(rightUpperLeg);

  // Right lower leg -- knee
  const rightLowerLeg = createLimbSegment(LIMB_RADIUS * 0.9, LOWER_LEG_LENGTH, material);
  rightLowerLeg.position.set(0, -UPPER_LEG_LENGTH, 0);
  rightLowerLeg.rotation.x = -Math.PI / 2 * 0.8; // kicked up behind
  rightUpperLeg.add(rightLowerLeg);

  // Right foot -- box at ankle
  const rightFootGeo = new THREE.BoxGeometry(FOOT_WIDTH, FOOT_HEIGHT, FOOT_LENGTH);
  rightFootGeo.translate(0, -FOOT_HEIGHT / 2, -FOOT_LENGTH * 0.3); // pivot at ankle, extend backward
  const rightFoot = new THREE.Mesh(rightFootGeo, material);
  rightFoot.position.set(0, -LOWER_LEG_LENGTH, 0);
  rightFoot.rotation.x = 0.3; // toes pointed slightly
  rightLowerLeg.add(rightFoot);

  // -- Left upper leg (mirror) --
  const leftUpperLeg = createLimbSegment(LIMB_RADIUS * 1.1, UPPER_LEG_LENGTH, material);
  leftUpperLeg.position.set(-TORSO_WIDTH * 0.2, 0, -LOWER_ABDOMEN_LENGTH / 2);
  leftUpperLeg.rotation.z = -0.15;
  leftUpperLeg.rotation.x = Math.PI / 3;
  lowerAbdomen.add(leftUpperLeg);

  // Left lower leg -- knee
  const leftLowerLeg = createLimbSegment(LIMB_RADIUS * 0.9, LOWER_LEG_LENGTH, material);
  leftLowerLeg.position.set(0, -UPPER_LEG_LENGTH, 0);
  leftLowerLeg.rotation.x = -Math.PI / 2 * 0.8;
  leftUpperLeg.add(leftLowerLeg);

  // Left foot -- box at ankle
  const leftFootGeo = new THREE.BoxGeometry(FOOT_WIDTH, FOOT_HEIGHT, FOOT_LENGTH);
  leftFootGeo.translate(0, -FOOT_HEIGHT / 2, -FOOT_LENGTH * 0.3);
  const leftFoot = new THREE.Mesh(leftFootGeo, material);
  leftFoot.position.set(0, -LOWER_LEG_LENGTH, 0);
  leftFoot.rotation.x = 0.3;
  leftLowerLeg.add(leftFoot);

  // == Final rotation: construction space -> Three.js local (= Base Frame mapped) ==
  //
  // Construction space: chest=+Y, right=+X, head=+Z
  // Three.js local at identity (matching Base Frame via baseFrameToWorld):
  //   chest -> +X,  head -> +Y,  right -> +Z
  //
  // Mapping: Xc->+Z, Yc->+X, Zc->+Y  ->  Euler XYZ = (-pi/2, 0, -pi/2)
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
