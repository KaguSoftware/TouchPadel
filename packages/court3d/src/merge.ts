/**
 * FEWER DRAW CALLS, THE SAME TRIANGLES.
 *
 * On a phone every draw call is paid on the JS thread: expo-gl forwards each
 * GL call over JSI, and three issues a dozen or more of them per mesh (program,
 * uniforms, attributes, the draw itself). The court was ~170 meshes a frame
 * before the shadow pass drew the casters again (~250 draws a frame with the
 * ball's surface), while the Play build drew the court at 20–30 fps on Android
 * (screen recording, 2026-10-11). Most of those meshes never move relative to their parent: the
 * cage's posts, caps, rails and panes, and every part of a racket's body.
 *
 * `mergeStatic` folds a parent's static children into one mesh per draw state —
 * material, renderOrder and the shadow flags — with each child's transform
 * baked into the vertices. Within one draw state three's sort (renderOrder,
 * material, then depth) has nothing left to order, so an opaque material draws
 * exactly what it drew before. A transparent material is sorted as ONE object
 * now, at the centre of its parts (where the merged mesh is placed, for that
 * reason); the court's transparent groups are each a single flat colour, which
 * blends to the same result in any order among themselves.
 *
 * Only `position` and `normal` survive, plus the index: none of these
 * materials carries a texture, so `uv` was never read.
 */
import * as THREE from 'three';

type Drawable = THREE.Mesh | THREE.LineSegments;

const drawable = (o: THREE.Object3D): o is Drawable =>
  (o as THREE.Mesh).isMesh === true || (o as THREE.LineSegments).isLineSegments === true;

/** What has to match for two children to share one draw call. */
function drawState(o: Drawable): string | null {
  const m = o.material;
  // A multi-material mesh draws per geometry group; not worth handling here.
  if (Array.isArray(m)) return null;
  // Wireframe draws from a derived index; merging would wire across parts.
  if ((m as THREE.MeshBasicMaterial).wireframe) return null;
  const kind = (o as THREE.LineSegments).isLineSegments ? 'lines' : 'mesh';
  return [
    kind,
    m.uuid,
    o.renderOrder,
    o.castShadow,
    o.receiveShadow,
    o.visible,
    o.frustumCulled,
  ].join('|');
}

/** One child's geometry in its parent's frame, position + normal + index only. */
function baked(o: Drawable): THREE.BufferGeometry {
  o.updateMatrix();
  const src = o.geometry;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', src.getAttribute('position').clone());
  const normal = src.getAttribute('normal');
  if (normal) g.setAttribute('normal', normal.clone());
  if (src.index) g.setIndex(src.index.clone());
  g.applyMatrix4(o.matrix);
  return g;
}

function concat(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const withNormals = parts.every((g) => g.getAttribute('normal'));
  let vertices = 0;
  let indices = 0;
  for (const g of parts) {
    const n = g.getAttribute('position').count;
    vertices += n;
    indices += g.index ? g.index.count : n;
  }
  const position = new Float32Array(vertices * 3);
  const normal = withNormals ? new Float32Array(vertices * 3) : null;
  const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let v = 0;
  let i = 0;
  for (const g of parts) {
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    for (let k = 0; k < pos.count; k++) {
      position[(v + k) * 3] = pos.getX(k);
      position[(v + k) * 3 + 1] = pos.getY(k);
      position[(v + k) * 3 + 2] = pos.getZ(k);
      if (normal) {
        normal[(v + k) * 3] = nor.getX(k);
        normal[(v + k) * 3 + 1] = nor.getY(k);
        normal[(v + k) * 3 + 2] = nor.getZ(k);
      }
    }
    if (g.index) {
      for (let k = 0; k < g.index.count; k++) index[i + k] = v + g.index.getX(k);
      i += g.index.count;
    } else {
      for (let k = 0; k < pos.count; k++) index[i + k] = v + k;
      i += pos.count;
    }
    v += pos.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  if (normal) out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

/**
 * Merge `parent`'s direct children that pass `isStatic` into one mesh per draw
 * state, in place. A draw state with a single child is left as it was. Returns
 * the new geometries, for the caller's dispose list; the replaced children's
 * own geometries are the caller's to dispose as before (they may be shared).
 */
export function mergeStatic(
  parent: THREE.Object3D,
  isStatic: (o: THREE.Object3D) => boolean = () => true,
): THREE.BufferGeometry[] {
  const groups = new Map<string, Drawable[]>();
  for (const o of parent.children) {
    if (!drawable(o) || !isStatic(o) || o.children.length > 0) continue;
    const key = drawState(o);
    if (key === null) continue;
    const list = groups.get(key);
    if (list) list.push(o);
    else groups.set(key, [o]);
  }
  const made: THREE.BufferGeometry[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const first = list[0]!;
    const geometry = concat(list.map(baked));
    // Centre the merged mesh on its parts: three sorts transparent objects by
    // their origin's depth, and the centre is where the group as a whole sits.
    geometry.computeBoundingBox();
    const centre = geometry.boundingBox!.getCenter(new THREE.Vector3());
    geometry.translate(-centre.x, -centre.y, -centre.z);
    geometry.computeBoundingSphere();
    const merged = first instanceof THREE.LineSegments
      ? new THREE.LineSegments(geometry, first.material)
      : new THREE.Mesh(geometry, first.material);
    merged.position.copy(centre);
    merged.renderOrder = first.renderOrder;
    merged.castShadow = first.castShadow;
    merged.receiveShadow = first.receiveShadow;
    merged.frustumCulled = first.frustumCulled;
    merged.name = first.name;
    for (const o of list) parent.remove(o);
    parent.add(merged);
    made.push(geometry);
  }
  return made;
}
