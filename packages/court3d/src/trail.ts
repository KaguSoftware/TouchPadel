/**
 * The ball's ghost trail as ONE draw call (scene.ts, `lean`).
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
 */
import * as THREE from 'three';

export interface GhostTrail {
  mesh: THREE.InstancedMesh;
  /**
   * Draw the first `positions.length` ghosts (the visible ones are always a
   * prefix: the newest come first), centred on `origin` so three sorts the
   * trail against the overlay's other transparent things where the ball is.
   */
  place(origin: THREE.Vector3, positions: readonly { x: number; y: number; z: number }[]): void;
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
  mesh.count = 0;
  mesh.visible = false;

  const scales = Array.from({ length: count }, (_, i) => size(i));
  const m = new THREE.Matrix4();
  return {
    mesh,
    place(origin, positions) {
      const n = Math.min(positions.length, count);
      mesh.position.copy(origin);
      for (let i = 0; i < n; i++) {
        const p = positions[i]!;
        const s = scales[i]!;
        m.makeScale(s, s, s).setPosition(p.x - origin.x, p.y - origin.y, p.z - origin.z);
        mesh.setMatrixAt(i, m);
      }
      mesh.count = n;
      mesh.visible = n > 0;
      if (n > 0) mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
