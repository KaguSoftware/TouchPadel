/**
 * The coaching drill's two props (drill.ts has the motion): the ball machine
 * and the coach watching beside it. Built only for `scene: 'drill'` (scene.ts);
 * the rally's court never builds them.
 *
 * Low-poly and in the court's own stylisation: the rackets stand in for the
 * players, so the coach is the one figure on the court and is kept to a
 * mannequin (capsule legs and torso, two-piece capsule arms with a hand each,
 * a head and a cap), and the
 * machine to a drum on four legs with a box-ish hopper of balls on top and one
 * barrel that turns. About twenty meshes between them, every one sharing a
 * handful of materials.
 *
 * Colours are the court's (scene.ts), no new hue: NAVY for the machine's
 * frame and the coach's legs, the seam's white for the drum and the shirt, LIME
 * for the balls in the hopper, the barrel's mouth and the coach's cap, and the
 * brand gray (#BCBDBF, tokens.ts) for the head. Like everything else in the
 * scene these are lit MeshStandardMaterials, so they render lifted and
 * desaturated, not as these hexes.
 *
 * Shadows only on `full`, like the rest of the court: every mesh casts there
 * and none on `lite`, which also takes the rounder segment counts down.
 */
import * as THREE from 'three';
import type { CourtQuality } from './quality';
import { COACH, COACH_ARM, COACH_YAW, MACHINE } from './drill';

const NAVY = 0x172c4f;
const LIME = 0xa5d06f;
/** The ball seam's white (scene.ts), not pure white: it is lit, and #fff blows out. */
const WHITE = 0xf3f5f9;
/** Brand gray #BCBDBF. */
const GRAY = 0xbcbdbf;

export interface DrillProps {
  /** Add to the court scene: the machine and the coach, already placed. */
  group: THREE.Group;
  /** The barrel's pivot, Euler YXZ: `rotation.set(-MACHINE.pitch, yaw, 0)`. */
  barrel: THREE.Group;
  /** Inside the barrel: `position.z = -MACHINE.recoil · kick`. */
  recoil: THREE.Group;
  /** The coach's body, pivoting at the feet: the idle sway (`rotation.x`, `.z`). */
  coachBody: THREE.Group;
  /** The coach's head: `rotation.y` is its turn off the body's heading. */
  coachHead: THREE.Group;
  /**
   * The coach's arms, right then left (drill.ts ArmPose): the shoulder takes
   * `rotation.set(-lift, yaw, 0)` (Euler YXZ), the elbow `rotation.x = -bend`.
   */
  coachArms: { shoulder: THREE.Group; elbow: THREE.Group }[];
  disposables: { dispose(): void }[];
}

export function buildDrillProps(quality: CourtQuality): DrillProps {
  const full = quality === 'full';
  const round = full ? 16 : 10;
  const disposables: { dispose(): void }[] = [];
  const mat = (color: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o });
    disposables.push(m);
    return m;
  };
  const navy = mat(NAVY, { roughness: 0.5 });
  const white = mat(WHITE, { roughness: 0.6 });
  const lime = mat(LIME, { roughness: 0.55 });
  const gray = mat(GRAY, { roughness: 0.7 });
  const hopperMat = mat(NAVY, { roughness: 0.5, side: THREE.DoubleSide });
  const mesh = (
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    disposables.push(geometry);
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = full;
    parent.add(m);
    return m;
  };
  const group = new THREE.Group();
  group.name = 'drill';

  // ── The machine ───────────────────────────────────────────────────────────
  const machine = new THREE.Group();
  machine.name = 'ball_machine';
  machine.position.set(MACHINE.x, 0, MACHINE.z);
  group.add(machine);
  const leg = new THREE.CylinderGeometry(0.05, 0.05, 0.56, 6);
  for (const [x, z] of [
    [-0.3, -0.3],
    [0.3, -0.3],
    [-0.3, 0.3],
    [0.3, 0.3],
  ] as const) {
    // One geometry for all four legs: dispose it once.
    const m = new THREE.Mesh(leg, navy);
    m.position.set(x, 0.28, z);
    m.castShadow = full;
    machine.add(m);
  }
  disposables.push(leg);
  // The drum the barrel turns in (its centre is the barrel's pivot), on a navy collar.
  mesh(machine, new THREE.CylinderGeometry(0.5, 0.5, 0.08, round), navy, 0, 0.58, 0);
  mesh(machine, new THREE.CylinderGeometry(0.48, 0.48, 0.48, round), white, 0, MACHINE.pivotY, 0);
  // The hopper: an open, square-mouthed funnel of balls on top of the drum.
  const hopper = mesh(
    machine,
    new THREE.CylinderGeometry(0.62, 0.36, 0.48, 4, 1, true),
    hopperMat,
    0,
    MACHINE.pivotY + 0.24 + 0.24,
    0,
  );
  hopper.rotation.y = Math.PI / 4;
  const load = new THREE.SphereGeometry(0.13, full ? 12 : 8, full ? 10 : 6);
  disposables.push(load);
  for (const [x, y, z] of [
    [-0.14, 1.2, -0.14],
    [0.15, 1.2, -0.12],
    [-0.12, 1.2, 0.15],
    [0.14, 1.21, 0.14],
    [0.0, 1.36, 0.02],
  ] as const) {
    const m = new THREE.Mesh(load, lime);
    m.position.set(x, y, z);
    m.castShadow = false; // inside the hopper: the funnel's own shadow covers them
    machine.add(m);
  }
  // The barrel: pivots at the drum's centre, turns (yaw) and is pitched up; the
  // tube rides a recoil group so it can kick back along itself at a launch.
  const barrel = new THREE.Group();
  barrel.name = 'barrel';
  barrel.rotation.order = 'YXZ';
  barrel.position.set(0, MACHINE.pivotY, 0);
  barrel.rotation.set(-MACHINE.pitch, 0, 0);
  machine.add(barrel);
  const recoil = new THREE.Group();
  barrel.add(recoil);
  const tubeLen = MACHINE.barrel - 0.15;
  const tube = mesh(
    recoil,
    new THREE.CylinderGeometry(0.2, 0.24, tubeLen, round),
    navy,
    0,
    0,
    0.15 + tubeLen / 2,
  );
  tube.rotation.x = Math.PI / 2; // a cylinder stands on y; the barrel points along +z
  const mouth = mesh(
    recoil,
    new THREE.TorusGeometry(0.2, 0.045, full ? 8 : 6, round),
    lime,
    0,
    0,
    MACHINE.barrel,
  );
  mouth.castShadow = false; // a ring on the end of a tube that already casts

  // ── The coach ─────────────────────────────────────────────────────────────
  const coach = new THREE.Group();
  coach.name = 'coach';
  coach.position.set(COACH.x, 0, COACH.z);
  coach.rotation.y = COACH_YAW; // local +z is where the coach faces
  group.add(coach);
  const body = new THREE.Group();
  body.rotation.order = 'YXZ';
  coach.add(body);
  const capsuleSegs = full ? 4 : 2;
  // Legs: one navy capsule, feet on the turf (0 → 0.85 m).
  mesh(body, new THREE.CapsuleGeometry(0.15, 0.55, capsuleSegs, round), navy, 0, 0.425, 0);
  // Torso: a white capsule, 0.8 → 1.68 m.
  mesh(body, new THREE.CapsuleGeometry(0.25, 0.38, capsuleSegs, round), white, 0, 1.24, 0);
  // Arms: shoulder → upper arm → elbow → forearm → hand, white sleeves and a
  // gray hand (the head's), so the gestures (drill.ts COACH_KEYS) read from
  // straight above. Right (−x, the coach facing +z) first, then left.
  const upperArm = new THREE.CapsuleGeometry(
    0.07,
    COACH_ARM.upper - 0.1,
    capsuleSegs,
    full ? 8 : 6,
  );
  const foreArm = new THREE.CapsuleGeometry(0.06, COACH_ARM.fore - 0.08, capsuleSegs, full ? 8 : 6);
  const hand = new THREE.SphereGeometry(0.07, full ? 10 : 6, full ? 8 : 5);
  disposables.push(upperArm, foreArm, hand);
  const limb = (parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, y: number) => {
    const piece = new THREE.Mesh(g, m);
    piece.position.set(0, y, 0);
    piece.castShadow = full;
    parent.add(piece);
  };
  const coachArms = ([-1, 1] as const).map((side) => {
    const shoulder = new THREE.Group();
    shoulder.name = side < 0 ? 'coach_arm_right' : 'coach_arm_left';
    shoulder.rotation.order = 'YXZ';
    shoulder.position.set(side * COACH_ARM.shoulderX, COACH_ARM.shoulderY, 0);
    body.add(shoulder);
    limb(shoulder, upperArm, white, -COACH_ARM.upper / 2);
    const elbow = new THREE.Group();
    elbow.rotation.order = 'YXZ';
    elbow.position.set(0, -COACH_ARM.upper, 0);
    shoulder.add(elbow);
    limb(elbow, foreArm, white, -COACH_ARM.fore / 2);
    limb(elbow, hand, gray, -COACH_ARM.fore);
    return { shoulder, elbow };
  });
  const head = new THREE.Group();
  head.name = 'coach_head';
  head.position.set(0, 1.89, 0);
  body.add(head);
  mesh(head, new THREE.SphereGeometry(0.17, round, full ? 12 : 8), gray, 0, 0, 0);
  // The cap: a lime crown over the head's top half and a brim to the front,
  // which is what says where the coach is looking from the top-down camera.
  mesh(
    head,
    new THREE.SphereGeometry(0.178, round, full ? 8 : 5, 0, Math.PI * 2, 0, Math.PI / 2),
    lime,
    0,
    0.01,
    0,
  );
  const brim = mesh(
    head,
    new THREE.CylinderGeometry(0.15, 0.15, 0.022, round),
    lime,
    0,
    0.02,
    0.16,
  );
  brim.scale.set(1, 1, 0.8);

  return { group, barrel, recoil, coachBody: body, coachHead: head, coachArms, disposables };
}
