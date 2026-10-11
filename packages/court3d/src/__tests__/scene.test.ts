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

describe('the lean option', () => {
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
