/**
 * The phone's court: the shared scene (@touch/court3d/scene) with the one option
 * whose default is NOT the phone's, the brand pattern hung behind the glass, and
 * the logo painted on the turf (courtLogo.ts). Every other option is left at its
 * default, which is the phone's.
 */
import { buildCourtScene, type CourtScene } from '@touch/court3d/scene';
import type { CourtQuality } from './quality';
import { buildPatternBackdrop } from './patternBackdrop';
import { buildCourtLogo } from './courtLogo';

export function buildPhoneCourt(quality: CourtQuality): CourtScene {
  const court = buildCourtScene(quality, { backdrop: buildPatternBackdrop });
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
