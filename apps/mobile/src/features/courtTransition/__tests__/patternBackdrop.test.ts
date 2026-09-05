/**
 * The court's copy of the brand pattern has one job: land on the glass exactly
 * where the page's copy lands. Everything here is that claim, checked by
 * inverting the placement — take a point of the artwork, push it through the
 * group's transform into camera space, project it back out to window dp, and
 * compare against where `slicePattern` puts the same point for react-native-svg.
 *
 * Written this way round on purpose. Asserting the group's position and scale
 * directly would only restate the arithmetic in `place`; going out to window
 * coordinates and back tests the thing that can actually be wrong — a sign, a
 * half, a flipped axis — against the renderer that is not being changed.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PATTERN_DEFAULT_WIDTH, PATTERN_FIELD, slicePattern } from '../../../theme/brandPattern';
import { buildPatternBackdrop, type BackdropViewport } from '../patternBackdrop';
import { makeCamera } from '../camera';
import { SPEC } from '../spec';

const FOV = SPEC.camera.fov;

/** A phone's pattern box, with the court sitting low in it the way the Book tab has it. */
const VIEW: BackdropViewport = {
  boxWidth: 390,
  boxHeight: 844,
  offsetX: 0,
  offsetY: 132,
  viewWidth: 390,
  viewHeight: 646,
};

/** Where the page paints a point of the panel, in the pattern box's dp. */
function onPage(px: number, py: number, view: BackdropViewport) {
  const cut = slicePattern(view.boxWidth, view.boxHeight);
  return { x: cut.x + px * cut.scale, y: cut.y + py * cut.scale };
}

/** Where the GL backdrop paints it, read back out of the placed group. */
function onGlass(
  group: THREE.Object3D,
  px: number,
  py: number,
  view: BackdropViewport,
  lift: number,
) {
  const p = new THREE.Vector3(px, py, 0).applyMatrix4(
    new THREE.Matrix4().compose(group.position, group.quaternion, group.scale),
  );
  // The frustum where the backdrop actually hangs — read off the placed group
  // rather than restating its depth, so this stays right if that depth moves.
  const frustumHeight = 2 * Math.abs(group.position.z) * Math.tan(((FOV / 2) * Math.PI) / 180);
  const frustumWidth = (frustumHeight * view.viewWidth) / view.viewHeight;
  const pxPerUnit = view.viewHeight / frustumHeight;
  // Camera space -> the view's own dp -> the pattern's box, with the surface's
  // lift put back: the layer really is translated, so what the eye sees is
  // offset by it.
  return {
    x: view.offsetX + (p.x + frustumWidth / 2) * pxPerUnit,
    y: view.offsetY + (frustumHeight / 2 - p.y) * pxPerUnit + lift,
  };
}

describe('patternBackdrop', () => {
  it('puts the artwork where the page puts it', () => {
    const backdrop = buildPatternBackdrop(FOV);
    backdrop.place(VIEW, 0);
    for (const [px, py] of [
      [0, 0],
      [239.6797, 349.4609],
      [120, 175],
      [-3.21, 38.81],
    ]) {
      const want = onPage(px!, py!, VIEW);
      const got = onGlass(backdrop.group, px!, py!, VIEW, 0);
      expect(got.x).toBeCloseTo(want.x, 6);
      expect(got.y).toBeCloseTo(want.y, 6);
    }
    backdrop.dispose();
  });

  it('stays put on the page while the court layer lifts', () => {
    const backdrop = buildPatternBackdrop(FOV);
    const want = onPage(120, 175, VIEW);
    // 0 at the court view, -60 at the booking view (SPEC.court.y), and a frame
    // somewhere in between.
    for (const lift of [0, -22.5, SPEC.court.y[1]]) {
      backdrop.place(VIEW, lift);
      const got = onGlass(backdrop.group, 120, 175, VIEW, lift);
      expect(got.x).toBeCloseTo(want.x, 6);
      expect(got.y).toBeCloseTo(want.y, 6);
    }
    backdrop.dispose();
  });

  it('follows the view wherever it is measured in the box', () => {
    const backdrop = buildPatternBackdrop(FOV);
    const want = onPage(60, 300, VIEW);
    for (const [offsetX, offsetY] of [
      [0, 0],
      [0, 132],
      [17, 240],
    ]) {
      const view = { ...VIEW, offsetX: offsetX!, offsetY: offsetY! };
      backdrop.place(view, 0);
      const got = onGlass(backdrop.group, 60, 300, view, 0);
      expect(got.x).toBeCloseTo(want.x, 6);
      expect(got.y).toBeCloseTo(want.y, 6);
    }
    backdrop.dispose();
  });

  it('draws every band of the field as two triangles, and nothing else', () => {
    const backdrop = buildPatternBackdrop(FOV);
    const mesh = backdrop.group.children[0] as THREE.Mesh;
    const position = mesh.geometry.getAttribute('position');
    expect(position.count).toBe(PATTERN_FIELD.length * 6);
    // Behind everything, writing no depth: the court paints over it untouched.
    expect(mesh.renderOrder).toBe(-1);
    const material = mesh.material as THREE.MeshBasicMaterial;
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
    backdrop.dispose();
  });

  it('strokes each band at the artwork width, with butt caps', () => {
    const backdrop = buildPatternBackdrop(FOV);
    const position = (backdrop.group.children[0] as THREE.Mesh).geometry.getAttribute('position');
    PATTERN_FIELD.forEach(([x1, y1, x2, y2], i) => {
      // Quad corners: [start +n, start -n, end -n, ...] — the first triangle.
      const at = (k: number) => new THREE.Vector2(position.getX(k), position.getY(k));
      const a = at(i * 6);
      const b = at(i * 6 + 1);
      const c = at(i * 6 + 2);
      // 4 dp throughout: the positions come back out of a Float32Array, and
      // a panel coordinate near 350 carries ~2e-5 of storage error there.
      // Width: the two sides of the start cap, a full band apart.
      expect(a.distanceTo(b)).toBeCloseTo(PATTERN_DEFAULT_WIDTH, 4);
      // Butt cap: the cap's midpoint is the endpoint itself, not beyond it.
      const startMid = a.clone().add(b).multiplyScalar(0.5);
      expect(startMid.x).toBeCloseTo(x1, 4);
      expect(startMid.y).toBeCloseTo(y1, 4);
      // Length: the band runs the segment's own length, no overhang.
      expect(b.distanceTo(c)).toBeCloseTo(Math.hypot(x2 - x1, y2 - y1), 4);
    });
    backdrop.dispose();
  });

  it('takes a pre-blended ink, and stays OPAQUE so it draws under the court', () => {
    const backdrop = buildPatternBackdrop(FOV);
    const material = (backdrop.group.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    backdrop.setInk('#A5D06F');
    expect(material.color.getHexString()).toBe('a5d06f');
    // The one that matters: three draws the transparent list AFTER the opaque
    // one, so a transparent backdrop would sit on top of the turf and the cage.
    expect(material.transparent).toBe(false);
    backdrop.dispose();
  });

  it('hangs INSIDE the camera frustum, or the whole thing is clipped away', () => {
    // This is a regression, not a hypothetical: the backdrop first shipped at
    // depth 1 against makeCamera's near plane of 5, so it was clipped in its
    // entirety and the court's box rendered as flat clear colour on the phone.
    // Nothing depth-tests the backdrop, so the frustum is the ONLY constraint
    // on this number and nothing else would have caught it.
    const backdrop = buildPatternBackdrop(FOV);
    backdrop.place(VIEW, 0);
    const camera = makeCamera(VIEW.viewWidth / VIEW.viewHeight);
    const depth = -backdrop.group.position.z; // the camera looks down its own -Z
    expect(depth).toBeGreaterThan(camera.near);
    expect(depth).toBeLessThan(camera.far);
    backdrop.dispose();
  });

  it('does nothing on a view with no size, rather than dividing by it', () => {
    const backdrop = buildPatternBackdrop(FOV);
    backdrop.place({ ...VIEW, viewWidth: 0, viewHeight: 0 }, 0);
    expect(Number.isFinite(backdrop.group.scale.x)).toBe(true);
    expect(Number.isFinite(backdrop.group.position.y)).toBe(true);
    backdrop.dispose();
  });
});
