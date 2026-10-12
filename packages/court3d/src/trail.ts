/**
 * The ball's ghost trail as ONE draw call (scene.ts, `instancing`).
 *
 * The trail is 36 white spheres, each shrinking and fading behind the last.
 * Drawn as 36 meshes it was 36 draw calls a frame on the ball's own surface,
 * every one of them a run of JSI calls on Android's JS thread (merge.ts has the
 * why). Here it is an InstancedMesh: the radius rides each instance's matrix and
 * the opacity an `instanceAlpha` attribute patched into MeshBasicMaterial.
 *
 * The picture does not change. Every ghost is the same white blended over what
 * is under it, and white-over-white at alphas a and b leaves 1 − (1 − a)(1 − b)
 * of white in either order, so drawing them in one pass rather than three's
 * per-object depth sort lands on the same pixels.
 *
 * Only on a GL that can draw instances (WebGL2, or WebGL1 with
 * ANGLE_instanced_arrays): without it three silently draws nothing for an
 * instanced mesh, so scene.ts falls back to 36 meshes there.
 */
import * as THREE from 'three';

type Point = { x: number; y: number; z: number };

export interface GhostTrail {
  mesh: THREE.InstancedMesh;
  /**
   * Ghost i at `at`, `scale` times its own size (the top view's height growth,
   * the drill's ball scale), or hidden (`at` null). Takes effect at `commit`.
   */
  place(i: number, at: Point | null, scale: number): void;
  /**
   * Write the frame's ghosts, centred on `origin` (the ball) so three sorts the
   * trail against the overlay's other transparent things where the ball is.
   * A frame with no ghost shown draws nothing at all.
   */
  commit(origin: Point): void;
  dispose(): void;
}

/**
 * @param count   ghosts, newest first
 * @param radius  the sphere every ghost is scaled from
 * @param size    ghost i's radius, as a multiple of `radius`
 * @param alpha   ghost i's opacity
 */
export function buildGhostTrail(
  count: number,
  radius: number,
  size: (i: number) => number,
  alpha: (i: number) => number,
): GhostTrail {
  const geometry = new THREE.SphereGeometry(radius, 12, 10);
  const alphas = new Float32Array(count);
  for (let i = 0; i < count; i++) alphas[i] = alpha(i);
  geometry.setAttribute('instanceAlpha', new THREE.InstancedBufferAttribute(alphas, 1));

  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float instanceAlpha;\nvarying float vInstanceAlpha;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstanceAlpha = instanceAlpha;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vInstanceAlpha;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vInstanceAlpha;');
  };
  // One program for every trail, whatever three would otherwise key it on.
  material.customProgramCacheKey = () => 'court3d-ghost-trail';

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // The instances move every frame and the mesh's own bounds know nothing of
  // them; the trail is always on screen with the ball anyway.
  mesh.frustumCulled = false;
  mesh.visible = false;
  // A hidden ghost is scaled to nothing.
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < count; i++) mesh.setMatrixAt(i, hidden);

  const sizes = Array.from({ length: count }, (_, i) => size(i));
  // This frame's ghosts, written by `place` without allocating: x, y, z, and
  // the scale (0 = hidden).
  const pos = new Float32Array(count * 3);
  const mul = new Float32Array(count);
  const m = new THREE.Matrix4();
  return {
    mesh,
    place(i, p, scale) {
      mul[i] = p ? scale : 0;
      if (!p) return;
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
    },
    commit(origin) {
      mesh.position.set(origin.x, origin.y, origin.z);
      let shown = false;
      for (let i = 0; i < count; i++) {
        const s = sizes[i]! * mul[i]!;
        if (!(s > 0)) {
          mesh.setMatrixAt(i, hidden);
          continue;
        }
        m.makeScale(s, s, s).setPosition(
          pos[i * 3]! - origin.x,
          pos[i * 3 + 1]! - origin.y,
          pos[i * 3 + 2]! - origin.z,
        );
        mesh.setMatrixAt(i, m);
        shown = true;
      }
      mesh.visible = shown;
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
