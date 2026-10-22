/**
 * The Book tab's 3D court (`Court3D`) as the fixed backdrop of a scrolling
 * page: the Play and Coaches tabs (Majed, 2026-10-11: "why aren't you using the
 * 3D one like the one in the Book page").
 *
 * TOP-DOWN, HORIZONTAL, NO PITCH (Majed, 2026-10-11). The court is always seen
 * from a bird's-eye view here (`view="top"`, packages/court3d camera.ts
 * topCameraPose): straight down, its length running left to right across the
 * phone, the net a vertical line in the middle, framed to fill the stage's
 * width with a small margin. Never the upright Book court and never an angled
 * view: they cost the GPU more for nothing on these pages. So nothing here
 * pitches or lifts: the page scrolls over a court that stays exactly where it
 * is, progress stays at 0, and the court draws at Court3D's TOP_FPS (45).
 * It is also built on the `lite` tier (no shadow pass, 2× MSAA): seen from
 * straight above, the shadow map bought almost nothing for its cost; the
 * ball's ground disc stands in for its shadow.
 * And it is ONE GL surface where the Book has two (Court3D ONE_SURFACE), with
 * its static court merged and its trail instanced (scene.ts): about half the
 * Book court's draw calls, and one framebuffer instead of two.
 *
 * WHAT PLAYS ON IT. `scene` passes straight through to Court3D: the Book tab's
 * rally by default, the coaching drill (Coaches: a ball machine and a coach on
 * the right half feeding the four rackets on the left in turn, packages/court3d
 * drill.ts), or the next open match (Play: `join`, its taken seats warming up
 * and its open ones marked as the `join` prop says, packages/court3d join.ts).
 * The rackets swing the Book tab's own clip in all three.
 *
 * Everything else is Court3D's own: the frame loop that stops when the tab
 * loses focus or the app leaves the foreground, Reduce Motion holding the
 * picture still. A phone without GL gets no court at all, only the page's
 * pattern (`onUnavailable`); there is no flat stand-in.
 *
 * THE PATTERN. The court's surface clears opaque and draws the same crop of the
 * brand pattern behind its scene (patternBackdrop), so the caller measures the
 * page's pattern and this stage in one coordinate space and passes the box,
 * as the Book tab does (`courtPatternBox`).
 *
 * Decorative: hidden from screen readers and takes no touches. The Play tab's
 * open spots are reached through targets of the page's own, over the court
 * (projectTop), and a caption that says what they are.
 */
import { useState } from 'react';
import { Animated, AppState, View } from 'react-native';
import { TOP_VIEW } from '@touch/court3d/camera';
import type { CourtSceneKind } from '@touch/court3d/scene';
import type { JoinSeats } from '@touch/court3d/join';
import { startCourtPrewarm, type CourtBuildSpec } from '../features/courtTransition/courtPrewarm';
import { COURT_LEAN } from '../features/courtTransition/deviceQuality';
import { buildPhoneCourt } from '../features/courtTransition/phoneCourt';
import { useReduceMotion } from '../lib/useReduceMotion';
import { addBreadcrumb, describeError } from '../lib/telemetry';
import { Court3D } from './Court3D';

/** Every stage court is seen from above on the lite tier (see the header). */
const STAGE_VIEW = 'top' as const;
const STAGE_QUALITY = 'lite' as const;

/**
 * The stage courts the guest has not opened yet, built in the background once
 * the Book tab has done its own heavy work (courtPrewarm.ts has the why and the
 * pacing): Play's open match first, then Coaches' drill. Each is built exactly
 * as its CourtStage will ask for it, so the tab takes it as its own.
 */
const PREWARM: readonly CourtBuildSpec[] = (['join', 'drill'] as const).map((scene) => ({
  scene,
  view: STAGE_VIEW,
  quality: STAGE_QUALITY,
  lean: COURT_LEAN,
}));

export function prewarmStageCourts(): void {
  startCourtPrewarm(PREWARM, {
    build: (spec, instancing) =>
      buildPhoneCourt(spec.quality, spec.lean, { scene: spec.scene, view: spec.view, instancing }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    // The timeout only bounds a thread that is never idle: the build then
    // lands in the next slot it can get, as one ordinary task.
    idle: () => new Promise((resolve) => requestIdleCallback(() => resolve(), { timeout: 10000 })),
    foreground: () =>
      new Promise((resolve) => {
        if (AppState.currentState === 'active') return resolve();
        const sub = AppState.addEventListener('change', (state) => {
          if (state !== 'active') return;
          sub.remove();
          resolve();
        });
      }),
    onError: (error) => addBreadcrumb('court3d.prewarm.failed', { error: describeError(error) }),
  });
}

/**
 * The hero's height on a page with a court behind it: the window onto the
 * court above the content. A share of the page's frame, so a tall phone shows
 * more of the stage and a short one still leaves content on screen.
 */
export function courtHeroHeight(frameHeight: number): number {
  if (frameHeight <= 0) return 280;
  return Math.round(Math.min(400, Math.max(240, frameHeight * 0.44)));
}

/**
 * A stage sized to the court itself, for a page that wants its content to
 * start right under the court (the Coaches tab; Majed, 2026-10-11: "make the
 * list start higher and the court pushed more upwards").
 *
 * The top view fills the stage's WIDTH with TOP_VIEW.span metres and puts the
 * court's centre `raise` (NDC) above the stage's middle, i.e. at
 * (1 − raise) / 2 of the height from the top (camera.ts). The court's half
 * height on screen is its 10.2 m base plus the post caps, about 5.4 m of the
 * span. So for a court whose top sits `topGap` points under the stage's top:
 *   centre  = topGap + half
 *   height  = centre / ((1 − raise) / 2)
 *   bottom  = centre + half             (where the content may begin)
 * The height is held at or above width / MAX_ASPECT so the camera still fits
 * the width (a wider box would fit the depth instead and shrink the court).
 */
const COURT_HALF_M = 5.4;
const MAX_ASPECT = TOP_VIEW.span / (TOP_VIEW.depth / (1 - TOP_VIEW.raise)) - 0.01;
export function topStageFor(
  width: number,
  topGap = 8,
): { height: number; courtTop: number; courtBottom: number } {
  if (width <= 0) return { height: 0, courtTop: 0, courtBottom: 0 };
  const half = (COURT_HALF_M / TOP_VIEW.span) * width;
  const centreShare = (1 - TOP_VIEW.raise) / 2;
  const height = Math.ceil(Math.max((topGap + half) / centreShare, width / MAX_ASPECT));
  const centre = height * centreShare;
  return { height, courtTop: centre - half, courtBottom: Math.ceil(centre + half) };
}

export interface CourtStageProps {
  /** The stage's top inside its parent, where the court starts. */
  top: number;
  /** The stage's height: the court is framed to the stage's width inside it. */
  height: number;
  /** The page pattern's box and this stage's corner inside it (see the header). */
  patternBox?: { width: number; height: number; offsetX: number; offsetY: number };
  /** What plays on the court (Court3D's `scene`): the rally by default, the coaching drill, or the next open match. */
  scene?: CourtSceneKind;
  /** The `join` scene's seats (Court3D's `join`). */
  join?: JoinSeats;
}

export function CourtStage({ top, height, patternBox, scene, join }: CourtStageProps) {
  const reduceMotion = useReduceMotion();
  // Court3D reads progress every frame; the top view never moves it off 0.
  const [progress] = useState(() => new Animated.Value(0));
  const [unavailable, setUnavailable] = useState(false);

  if (unavailable || height <= 0) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top, start: 0, end: 0, height }}
    >
      <Court3D
        progress={progress}
        direction={1}
        reduceMotion={reduceMotion}
        view={STAGE_VIEW}
        scene={scene}
        join={join}
        quality={STAGE_QUALITY}
        onUnavailable={() => setUnavailable(true)}
        patternBox={patternBox}
        style={{ flex: 1 }}
      />
    </View>
  );
}
