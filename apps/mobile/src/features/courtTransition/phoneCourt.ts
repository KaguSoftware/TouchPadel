/**
 * The phone's court: the shared scene (@touch/court3d/scene) with the one option
 * whose default is NOT the phone's, the brand pattern hung behind the glass. Every
 * other option is left at its default, which is the phone's.
 */
import { buildCourtScene, type CourtScene } from '@touch/court3d/scene';
import type { CourtQuality } from './quality';
import { buildPatternBackdrop } from './patternBackdrop';

export function buildPhoneCourt(quality: CourtQuality): CourtScene {
  return buildCourtScene(quality, { backdrop: buildPatternBackdrop });
}
