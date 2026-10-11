/**
 * The seam between the two hosts. The phone and the site build the same court,
 * and the three things they do differently are options. Spin and the shadow map
 * default to the phone's; the backdrop defaults to none, and the phone passes its
 * pattern (apps/mobile courtTransition/phoneCourt.ts, tested there). These pin that
 * each option does what its host asks of it.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { buildCourtScene, type BackdropViewport, type CourtBackdrop } from '../scene';

const VIEW: BackdropViewport = {
  boxWidth: 390,
  boxHeight: 844,
  offsetX: 0,
  offsetY: 132,
  viewWidth: 390,
  viewHeight: 646,
};

function stubBackdrop() {
  const backdrop: CourtBackdrop = {
    group: new THREE.Group(),
    place: vi.fn(),
    setInk: vi.fn(),
    dispose: vi.fn(),
  };
  return backdrop;
}

/** The ball: the overlay's one group (its seams ride inside it). */
const ballOf = (court: ReturnType<typeof buildCourtScene>) =>
  court.overlay.children.find((o) => o instanceof THREE.Group)!;

const sunOf = (court: ReturnType<typeof buildCourtScene>) =>
  court.scene.children.find(
    (o): o is THREE.DirectionalLight => o instanceof THREE.DirectionalLight,
  )!;

/** Draw `seconds` of rally at `hz`, the way a host's loop does. */
function play(court: ReturnType<typeof buildCourtScene>, seconds: number, hz: number) {
  const frames = Math.round(seconds * hz);
  for (let i = 1; i <= frames; i++) court.update(i / hz, 0, 0);
}

describe('the backdrop option', () => {
  it('without one, nothing hangs off the camera and the backdrop calls are no-ops', () => {
    const court = buildCourtScene();
    expect(court.camera.children).toHaveLength(0);
    // The camera is still in the scene: update() relies on its world matrix.
    expect(court.camera.parent).toBe(court.scene);
    court.setBackdropViewport(VIEW);
    court.setBackdropInk('#123456');
    expect(() => court.update(0.5, 0, 0)).not.toThrow();
    court.dispose();
  });

  it('with one, it rides the camera, is placed on update once it has a viewport, and is disposed', () => {
    const backdrop = stubBackdrop();
    const court = buildCourtScene('full', { backdrop: () => backdrop });
    expect(backdrop.group.parent).toBe(court.camera);
    court.update(0, 0, 0);
    expect(backdrop.place).not.toHaveBeenCalled(); // nothing to place against yet
    court.setBackdropViewport(VIEW);
    court.update(0, 0, 1);
    // The lift at full pitch is SPEC.court.y[1]: the backdrop cancels it.
    expect(backdrop.place).toHaveBeenLastCalledWith(VIEW, -60);
    court.setBackdropInk('#abcdef');
    expect(backdrop.setInk).toHaveBeenCalledWith('#abcdef');
    court.dispose();
    expect(backdrop.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('the spin option', () => {
  it("'time' spins the ball the same on a 60 Hz and a 120 Hz screen", () => {
    const a = buildCourtScene('full', { spin: 'time' });
    const b = buildCourtScene('full', { spin: 'time' });
    play(a, 1, 60);
    play(b, 1, 120);
    expect(ballOf(a).rotation.x).toBeCloseTo(ballOf(b).rotation.x, 9);
    expect(ballOf(a).rotation.z).toBeCloseTo(ballOf(b).rotation.z, 9);
    expect(ballOf(a).rotation.x).toBeGreaterThan(0);
  });

  it("the default ('frame', the phone's) steps per drawn frame", () => {
    const a = buildCourtScene();
    const b = buildCourtScene();
    play(a, 1, 60);
    play(b, 1, 120);
    expect(ballOf(a).rotation.x).toBeCloseTo(60 * 0.12, 9);
    expect(ballOf(b).rotation.x).toBeCloseTo(120 * 0.12, 9);
  });
});

describe('the shadow map option', () => {
  it("is the phone's 1024 by default and takes the size asked for", () => {
    expect(sunOf(buildCourtScene()).shadow.mapSize.x).toBe(1024);
    const sun = sunOf(buildCourtScene('full', { shadowMapSize: 2048 }));
    expect(sun.castShadow).toBe(true);
    expect(sun.shadow.mapSize.x).toBe(2048);
    expect(sun.shadow.mapSize.y).toBe(2048);
  });

  it('lite casts no shadow at all', () => {
    expect(sunOf(buildCourtScene('lite', { shadowMapSize: 2048 })).castShadow).toBe(false);
  });
});

/**
 * What the renderer would draw, in world space: every visible vertex, keyed
 * by the draw state that paints it (kind, material colour and opacity,
 * renderOrder, shadow flags) and summed into moments — count, Σx, Σx², Σxy,
 * … — so it does not matter how many meshes carry them or in what order,
 * while a part that moved, went missing or changed draw state still shows.
 * The instanced trail is expanded instance by instance, its per-ghost alpha
 * standing in for the opacity.
 */
const drawn = (root: THREE.Object3D) => {
  const out = new Map<string, number[]>();
  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const put = (key: string, g: THREE.BufferGeometry, world: THREE.Matrix4) => {
    const pos = g.getAttribute('position');
    const index = g.index;
    const s = out.get(key) ?? new Array<number>(10).fill(0);
    const n = index ? index.count : pos.count;
    for (let i = 0; i < n; i++) {
      const { x, y, z } = v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(world);
      const terms = [1, x, y, z, x * x, y * y, z * z, x * y, y * z, z * x];
      for (let j = 0; j < 10; j++) s[j]! += terms[j]!;
    }
    out.set(key, s);
  };
  root.traverseVisible((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh && !(o as THREE.LineSegments).isLineSegments) return;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    if (!mat.visible) return;
    const kind = (o as THREE.LineSegments).isLineSegments ? 'lines' : 'mesh';
    const state = (opacity: number) =>
      [kind, mat.type, mat.color?.getHexString(), opacity.toFixed(4), o.renderOrder,
        o.castShadow, o.receiveShadow].join('|');
    const inst = o as THREE.InstancedMesh;
    if (inst.isInstancedMesh) {
      const alpha = mesh.geometry.getAttribute('instanceAlpha');
      for (let i = 0; i < inst.count; i++) {
        inst.getMatrixAt(i, m);
        if (Math.abs(m.determinant()) < 1e-12) continue;
        put(state(mat.opacity * alpha.getX(i)), mesh.geometry, m.premultiply(o.matrixWorld));
      }
    } else {
      put(state(mat.opacity), mesh.geometry, o.matrixWorld);
    }
  });
  return out;
};
const expectSameDraws = (a: Map<string, number[]>, b: Map<string, number[]>) => {
  expect([...a.keys()].sort()).toStrictEqual([...b.keys()].sort());
  for (const [key, sums] of b) {
    const mine = a.get(key)!;
    sums.forEach((x, j) => expect(mine[j], `${key} [${j}]`).toBeCloseTo(x, 2));
  }
};

describe('the lean option', () => {
  it.each(['full', 'lite'] as const)(
    'draws %s exactly as the default does: the same vertices in the same draw states',
    (quality) => {
      const plain = buildCourtScene(quality);
      const lean = buildCourtScene(quality, { lean: true });
      for (let frame = 1; frame <= 240; frame++) {
        const t = frame / 60;
        const k = Math.min(1, frame / 180);
        const p = k;
        for (const court of [plain, lean]) court.update(t, p, k);
        if (frame % 40 === 0) {
          for (const court of [plain, lean]) {
            // What the renderer does before each draw.
            court.scene.updateMatrixWorld();
            court.overlay.updateMatrixWorld();
          }
          expectSameDraws(drawn(lean.scene), drawn(plain.scene));
          expectSameDraws(drawn(lean.overlay), drawn(plain.overlay));
        }
      }
      plain.dispose();
      lean.dispose();
    },
  );

  it.each(['full', 'lite'] as const)('cuts %s to a third of the draw calls or fewer', (quality) => {
    const calls = (court: ReturnType<typeof buildCourtScene>) => {
      court.update(0.3, 0, 0);
      let n = 0;
      for (const root of [court.scene, court.overlay]) {
        root.traverseVisible((o) => {
          if ((o as THREE.Mesh).isMesh || (o as THREE.LineSegments).isLineSegments) n++;
        });
      }
      return n;
    };
    expect(calls(buildCourtScene(quality, { lean: true })) * 3).toBeLessThanOrEqual(
      calls(buildCourtScene(quality)),
    );
  });

  it('freezes only what never moves', () => {
    const court = buildCourtScene('full', { lean: true });
    expect(court.scene.matrixAutoUpdate).toBe(false);
    expect(court.camera.matrixAutoUpdate).toBe(true);
    const frozen = court.scene.children.filter((o) => !o.matrixAutoUpdate);
    expect(frozen.length).toBeGreaterThan(10);
    for (const o of frozen) {
      expect(o instanceof THREE.Mesh || o instanceof THREE.LineSegments).toBe(true);
    }
    // The ball's shadow caster rides the ball every frame.
    const caster = court.scene.children.find(
      (o) => o instanceof THREE.Mesh && o.castShadow && o.geometry instanceof THREE.SphereGeometry,
    )!;
    expect(caster.matrixAutoUpdate).toBe(true);
    court.dispose();
  });

  it('is off by default', () => {
    const court = buildCourtScene();
    expect(court.scene.children.every((o) => o.matrixAutoUpdate)).toBe(true);
    court.dispose();
  });
});

describe('the scene option (rally | drill)', () => {
  const named = (root: THREE.Object3D, name: string) => root.getObjectByName(name);
  /** Every mesh under the drill's props. */
  const propMeshes = (court: ReturnType<typeof buildCourtScene>) => {
    const out: THREE.Mesh[] = [];
    named(court.scene, 'drill')?.traverse((o) => {
      if (o instanceof THREE.Mesh) out.push(o);
    });
    return out;
  };

  it('the default is the rally: no machine, no coach, the court it always was', () => {
    const court = buildCourtScene();
    expect(named(court.scene, 'drill')).toBeUndefined();
    const rally = buildCourtScene('full', { scene: 'rally' });
    expect(rally.scene.children.length).toBe(court.scene.children.length);
    court.dispose();
    rally.dispose();
  });

  it('the drill adds the ball machine and the coach, with a turning barrel and head', () => {
    const court = buildCourtScene('full', { scene: 'drill' });
    expect(named(court.scene, 'ball_machine')).toBeDefined();
    expect(named(court.scene, 'coach')).toBeDefined();
    expect(named(court.scene, 'barrel')).toBeDefined();
    expect(named(court.scene, 'coach_head')).toBeDefined();
    // Four rackets, as on the Book tab.
    const rackets = court.scene.children.filter((o) => o.name === 'padel_racket');
    expect(rackets).toHaveLength(4);
    court.dispose();
  });

  it('casts the props\' shadows on full only', () => {
    const full = buildCourtScene('full', { scene: 'drill' });
    expect(propMeshes(full).some((m) => m.castShadow)).toBe(true);
    const lite = buildCourtScene('lite', { scene: 'drill' });
    expect(propMeshes(lite).length).toBeGreaterThan(10);
    expect(propMeshes(lite).every((m) => !m.castShadow)).toBe(true);
    full.dispose();
    lite.dispose();
  });

  it('applies the drill each frame: the barrel turns, the ball hides between feeds', () => {
    const court = buildCourtScene('full', { scene: 'drill' });
    const barrel = named(court.scene, 'barrel')!;
    court.update(0.3, 0, 0);
    const first = barrel.rotation.y;
    court.update(2.45, 0, 0);
    expect(barrel.rotation.y).not.toBe(first); // turning to the next racket
    court.update(2.5, 0, 0); // a new ball, scale 0, in the barrel
    expect(ballOf(court).visible).toBe(false);
    court.update(2.8, 0, 0);
    expect(ballOf(court).visible).toBe(true);
    court.dispose();
  });

  it.each(['full', 'lite'] as const)(
    'lean draws the %s drill exactly as the default does',
    (quality) => {
      const plain = buildCourtScene(quality, { scene: 'drill' });
      const lean = buildCourtScene(quality, { scene: 'drill', lean: true });
      for (let frame = 1; frame <= 300; frame++) {
        const t = frame / 60;
        const k = Math.min(1, frame / 240);
        for (const court of [plain, lean]) {
          court.update(t, k, k);
          court.scene.updateMatrixWorld();
          court.overlay.updateMatrixWorld();
        }
        if (frame % 25 === 0) {
          expectSameDraws(drawn(lean.scene), drawn(plain.scene));
          expectSameDraws(drawn(lean.overlay), drawn(plain.overlay));
        }
      }
      plain.dispose();
      lean.dispose();
    },
  );
});

describe('the view option (book | top)', () => {
  const lines = (court: ReturnType<typeof buildCourtScene>) =>
    court.scene.children.filter((o) => o instanceof THREE.LineSegments).length;

  it('the default is the Book view: the walls are built', () => {
    const court = buildCourtScene();
    expect(lines(court)).toBeGreaterThan(0);
    court.dispose();
  });

  it.each(['rally', 'drill'] as const)(
    'lean draws the top view %s as the default does, its ghosts grown with the ball',
    (scene) => {
      const plain = buildCourtScene('lite', { view: 'top', scene });
      const lean = buildCourtScene('lite', { view: 'top', scene, lean: true });
      for (let frame = 1; frame <= 300; frame++) {
        for (const court of [plain, lean]) {
          court.update(frame / 60, 0, 0);
          court.scene.updateMatrixWorld();
          court.overlay.updateMatrixWorld();
        }
        if (frame % 25 === 0) expectSameDraws(drawn(lean.overlay), drawn(plain.overlay));
      }
      plain.dispose();
      lean.dispose();
    },
  );

  it('the top view skips the edge-on glass and mesh, keeps the posts and the rackets', () => {
    const book = buildCourtScene('lite');
    const top = buildCourtScene('lite', { view: 'top' });
    expect(lines(top)).toBe(0);
    expect(top.scene.children.length).toBeLessThan(book.scene.children.length);
    expect(top.scene.children.filter((o) => o.name === 'padel_racket')).toHaveLength(4);
    book.dispose();
    top.dispose();
  });

  it.each(['rally', 'drill'] as const)(
    'the %s top view never pitches, whatever progress the host hands in',
    (scene) => {
      const court = buildCourtScene('lite', { view: 'top', scene });
      court.update(1, 0, 0);
      const at0 = [...court.camera.matrixWorld.elements];
      const racket0 = [...court.scene.children.find((o) => o.name === 'padel_racket')!.matrixWorld.elements];
      court.update(1, 1, 1);
      court.scene.updateMatrixWorld();
      expect([...court.camera.matrixWorld.elements]).toEqual(at0);
      // The camera looks straight down.
      const dir = new THREE.Vector3();
      court.camera.getWorldDirection(dir);
      expect(dir.y).toBeCloseTo(-1, 9);
      expect(racket0.length).toBe(16);
      court.dispose();
    },
  );

  it('scales the ball with its height in the top view only', () => {
    const top = buildCourtScene('lite', { view: 'top' });
    const book = buildCourtScene('lite');
    top.update(0.31 * 1.3, 0, 0); // high in the first leg's flight
    book.update(0.31 * 1.3, 0, 0);
    expect(ballOf(top).scale.x).toBeGreaterThan(1.2);
    expect(ballOf(book).scale.x).toBe(1);
    top.dispose();
    book.dispose();
  });
});

describe("the drill coach's arm rig", () => {
  it('puts each hand exactly where drill.coachHand says, frame after frame', async () => {
    const { drillAt, coachHand } = await import('../drill');
    const court = buildCourtScene('lite', { scene: 'drill', view: 'top' });
    const body = court.scene.getObjectByName('coach_arm_right')!.parent!;
    for (const t of [0.2, 0.9, 1.6, 2.1, 7.3]) {
      court.update(t, 0, 0);
      court.scene.updateMatrixWorld(true);
      const { arms } = drillAt(t, 0).coach;
      for (const [name, pose, side] of [
        ['coach_arm_right', arms.right, -1],
        ['coach_arm_left', arms.left, 1],
      ] as const) {
        const shoulder = court.scene.getObjectByName(name)!;
        const handMesh = shoulder.children[1]!.children[1]!; // elbow → [forearm, hand]
        const world = handMesh.getWorldPosition(new THREE.Vector3());
        const local = body.worldToLocal(world);
        const want = coachHand(pose, side);
        expect(local.x).toBeCloseTo(want.x, 6);
        expect(local.y).toBeCloseTo(want.y, 6);
        expect(local.z).toBeCloseTo(want.z, 6);
      }
    }
    court.dispose();
  });

  it('casts the arms\' shadows on full only', () => {
    for (const quality of ['full', 'lite'] as const) {
      const court = buildCourtScene(quality, { scene: 'drill' });
      const meshes: THREE.Mesh[] = [];
      court.scene.getObjectByName('coach_arm_left')!.traverse((o) => {
        if (o instanceof THREE.Mesh) meshes.push(o);
      });
      expect(meshes).toHaveLength(3);
      expect(meshes.every((m) => m.castShadow === (quality === 'full'))).toBe(true);
      court.dispose();
    }
  });
});
