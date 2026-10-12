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
 * THE LOGO IN THE TOP VIEW is the Book court's, untouched: the same size, the
 * same spot in the far service area and the same orientation, so it runs top
 * to bottom across the horizontal court (Majed, 2026-10-11: "the logo can stay
 * vertical"; "the logo size is inconsistent with the court in book").
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
}

export function buildPhoneCourt(
  quality: CourtQuality,
  lean = false,
  { scene = 'rally', view = 'book', instancing = false }: PhoneCourtOptions = {},
): CourtScene {
  const court = buildCourtScene(quality, {
    backdrop: buildPatternBackdrop,
    lean,
    scene,
    view,
    instancing,
  });
  const logo = buildCourtLogo();
  court.scene.add(logo.group);
  return {
    ...court,
    dispose() {
      logo.dispose();
      court.dispose();
    },
  };
}
