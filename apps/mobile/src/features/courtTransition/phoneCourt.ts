/**
 * The phone's court: the shared scene (@touch/court3d/scene) with the one option
 * whose default is NOT the phone's, the brand pattern hung behind the glass, and
 * the logo painted on the turf (courtLogo.ts). `lean` (the same picture, cheaper
 * frames: scene.ts) is the caller's to switch on, and Court3D does on Android
 * only. `scene` (the Book tab's rally, or the Coaches tab's drill), `view`
 * (the Book's orbit, or the Play and Coaches tabs' straight-down horizontal
 * view) and `instancing` (what the renderer can draw) pass through. Every other option is left at its default, which is the
 * phone's.
 *
 * THE LOGO IN THE TOP VIEW is 1.3× the Book court's size, centred on the court
 * (z 0) with the gap between its two text rows on the court's centre line, and turned 90° counter-clockwise so it reads upright and landscape in
 * the middle of the Join and Coaches pages (it used to run top to bottom,
 * Majed, 2026-10-11).
 */
import {
  buildCourtScene,
  type CourtScene,
  type CourtSceneKind,
  type CourtView,
} from '@touch/court3d/scene';
import type { CourtQuality } from './quality';
import { buildPatternBackdrop } from './patternBackdrop';
import { buildCourtLogo } from './courtLogo';

export interface PhoneCourtOptions {
  scene?: CourtSceneKind;
  view?: CourtView;
  /** The renderer can draw instanced meshes (scene.ts `instancing`). */
  instancing?: boolean;
  /**
   * Only the rackets and the ball, for a page that draws the field itself: no field
   * (scene.ts `field`), no pattern behind it, no logo.
   */
  overlay?: boolean;
}

export function buildPhoneCourt(
  quality: CourtQuality,
  lean = false,
  { scene = 'rally', view = 'book', instancing = false, overlay = false }: PhoneCourtOptions = {},
): CourtScene {
  const court = buildCourtScene(quality, {
    backdrop: overlay ? undefined : buildPatternBackdrop,
    lean,
    scene,
    view,
    instancing,
    field: !overlay,
  });
  if (overlay) return court;
  // Top view (Join, Coaches): the badge sits in the middle of the landscape court.
  const logo = buildCourtLogo(view === 'top' ? 0 : undefined, view === 'top');
  // Seen from above, screen-up is -x, so a quarter turn about y stands the lockup upright (90° counter-clockwise on screen).
  // ×1.3: 10.4 m across the 20 m court, still short of the Coaches machine at z -6.
  if (view === 'top') {
    logo.group.rotation.y = Math.PI / 2;
    logo.group.scale.setScalar(1.3);
  }
  court.scene.add(logo.group);
  return {
    ...court,
    dispose() {
      logo.dispose();
      court.dispose();
    },
  };
}
