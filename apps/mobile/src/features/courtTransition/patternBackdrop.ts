/**
 * The brand line pattern, drawn INSIDE the court's GL scene.
 *
 * Why it is here at all. The Book tab stands on the pattern (owner,
 * 2026-09-05) and the court's GL surface covers most of the tab, so the pattern
 * has to get behind the court somehow. The obvious way — clear the surface
 * transparent and let the page's own pattern view show through — was tried and
 * froze the rally on device: a full-screen translucent GL layer, over the
 * ball's translucent layer, over the pattern's SVG, with 4x MSAA and the
 * sheet's blur sampling the stack. The court's surface therefore stays OPAQUE
 * (Court3D's header has the whole account) and the pattern is drawn as geometry
 * instead: 22 triangles in one draw call against a full-screen composite per
 * frame, which is why this file exists rather than a one-word change to the
 * clear colour.
 *
 * Why it can be geometry. The artwork is straight bands — the brand's eleven,
 * tiled out to seventy-four so a phone reads a pattern rather than a few lines
 * (see theme/brandPattern.ts, PATTERN_FIELD, which the page draws too).
 * react-native-svg strokes them; here each one is the quad that stroke covers —
 * two triangles, flat caps, no join to solve because a band is a single
 * segment. That is not an approximation of the stroke, it is what the stroke
 * IS.
 *
 * Why it is parented to the CAMERA. The pattern is a backdrop: it must sit
 * still on the glass while the camera orbits 50 degrees through the transition.
 * A child of the camera is in camera space by construction, so it cannot swing
 * — and `place` then only has to answer "where on the glass", never "where in
 * the court".
 *
 * It draws with no depth at all (`depthTest` and `depthWrite` both off, at
 * `renderOrder` -1): first of everything, writing nothing, so the turf, the
 * plinth and the cage all paint over it in the order they always did, and the
 * scene's transparent parts — cage glass, fence mesh, the net — blend over the
 * pattern instead of over a flat colour.
 */
import * as THREE from 'three';
import {
  PATTERN_DEFAULT_WIDTH,
  PATTERN_FIELD,
  slicePattern,
  type PatternSlice,
} from '../../theme/brandPattern';

/**
 * How far in front of the camera the backdrop hangs.
 *
 * Nothing depth-tests it, so the only thing this has to clear is the FRUSTUM:
 * makeCamera builds its perspective camera with near 5, far 200 (camera.ts),
 * and a backdrop nearer than 5 is clipped away in its entirety — which is
 * exactly what happened when this was 1, and it cost a device round trip to
 * find. `place` scales the artwork by the frustum size at this depth, so the
 * value itself does not change what is drawn, only whether it survives.
 */
const DISTANCE = 10;

export interface BackdropViewport {
  /**
   * The box the pattern is sliced over, in dp: the box the PAGE's copy of it
   * occupies. Both are measured by onLayout in the same coordinate space (see
   * the Book tab), so neither has to know what that space is.
   */
  boxWidth: number;
  boxHeight: number;
  /** The GL view's top-left corner inside that box, in dp. */
  offsetX: number;
  offsetY: number;
  /** The GL view's own size, in dp. */
  viewWidth: number;
  viewHeight: number;
}

export interface PatternBackdrop {
  /** Add this to the camera. */
  group: THREE.Group;
  /**
   * Put the pattern where the page has it.
   *
   * `liftPx` is the court layer's own translateY (0 at the court view, -60 at
   * the booking view). The GL surface rides inside that lifted Animated.View,
   * so anything drawn in it rides too — and a backdrop that rode would tear a
   * 60 px seam against the page's copy of the pattern, which does not move.
   * Subtracting the lift here pins the artwork to the PAGE instead of to the
   * surface, which is the whole point of slicing over the page's own box.
   */
  place(view: BackdropViewport, liftPx: number): void;
  /**
   * Follows the theme. Takes the ink ALREADY blended into the page colour —
   * see patternInk, and `transparent: false` below for why it has to be.
   */
  setInk(color: string): void;
  dispose(): void;
}

/**
 * The field's bands as quads, in the panel's own y-down units.
 *
 * Butt caps, to match `strokeLinecap="butt"` on the page: the quad stops dead
 * at the endpoint rather than overhanging by half a width. Non-indexed — at six
 * vertices a band, an index buffer would cost more than it saved.
 */
function bandGeometry(width: number): THREE.BufferGeometry {
  const half = width / 2;
  const positions = new Float32Array(PATTERN_FIELD.length * 18);
  let i = 0;
  const push = (x: number, y: number) => {
    positions[i++] = x;
    positions[i++] = y;
    positions[i++] = 0;
  };
  for (const [x1, y1, x2, y2] of PATTERN_FIELD) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    // The stroke's own normal, half a width out on each side.
    const nx = (-dy / len) * half;
    const ny = (dx / len) * half;
    const ax = x1 + nx,
      ay = y1 + ny;
    const bx = x1 - nx,
      by = y1 - ny;
    const cx = x2 - nx,
      cy = y2 - ny;
    const dx2 = x2 + nx,
      dy2 = y2 + ny;
    push(ax, ay);
    push(bx, by);
    push(cx, cy);
    push(ax, ay);
    push(cx, cy);
    push(dx2, dy2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

export function buildPatternBackdrop(
  fovDeg: number,
  bandWidth: number = PATTERN_DEFAULT_WIDTH,
): PatternBackdrop {
  const geometry = bandGeometry(bandWidth);
  const material = new THREE.MeshBasicMaterial({
    depthTest: false,
    depthWrite: false,
    // OPAQUE, deliberately. three draws the transparent list after the opaque
    // one, so a translucent backdrop would paint over the court rather than
    // behind it; the page's alpha is blended into the colour instead, which it
    // can be because nothing is ever behind this but the clear colour
    // (theme/brandPattern.ts, patternInk).
    transparent: false,
    // The group flips Y to get from the panel's y-down frame to three's y-up
    // one, which reverses every triangle's winding. Cheaper to draw both faces
    // than to rewrite the buffer.
    side: THREE.DoubleSide,
    // The brand green is a brand value, not a lit surface: it must arrive on
    // screen as itself, the way react-native-svg paints it on the rest of the
    // page. Tone mapping would pull it toward the renderer's idea of white.
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; // it lives in camera space; the frustum test is meaningless
  mesh.renderOrder = -1;
  const group = new THREE.Group();
  group.name = 'brand_pattern_backdrop';
  group.add(mesh);

  const halfFov = ((fovDeg / 2) * Math.PI) / 180;

  return {
    group,
    place(view, liftPx) {
      if (view.viewWidth <= 0 || view.viewHeight <= 0) return;
      // The frustum's own size where the backdrop hangs, and what one dp of the
      // view is worth there. The fov is VERTICAL, so height leads.
      const frustumHeight = 2 * DISTANCE * Math.tan(halfFov);
      const frustumWidth = (frustumHeight * view.viewWidth) / view.viewHeight;
      const unitsPerPx = frustumHeight / view.viewHeight;

      // Where the page puts the artwork's top-left, in the pattern box's dp …
      const cut: PatternSlice = slicePattern(view.boxWidth, view.boxHeight);
      // … then the same point in the GL view's own dp, with the layer's lift
      // taken back out so the backdrop stays with the page, not the surface.
      const localX = cut.x - view.offsetX;
      const localY = cut.y - view.offsetY - liftPx;

      group.position.set(
        -frustumWidth / 2 + localX * unitsPerPx,
        frustumHeight / 2 - localY * unitsPerPx,
        -DISTANCE,
      );
      // Negative Y: the geometry is in the panel's y-down frame.
      const k = cut.scale * unitsPerPx;
      group.scale.set(k, -k, 1);
    },
    setInk(color) {
      material.color.set(color);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
