/**
 * Courts built AHEAD of their tab, in the background (Majed, 2026-10-22: "the
 * court loads in like it was never loaded when it was just loaded in the
 * landing page").
 *
 * WHY THERE IS ANYTHING TO DO. Each tab's court is its own GL surface with its
 * own context (Court3D), and a context cannot use another's meshes, so the
 * court the Book tab already drew is no use to Play or Coaches: the first visit
 * to each built its scene from nothing, under the guest's finger. That build is
 * plain JS (three's scene graph needs no context), so it can be done before the
 * tab is ever opened. The GPU half cannot: a tab nobody has opened has no
 * surface on either platform (iOS lays a GLView out only in a window, Android's
 * TextureView only gets a SurfaceTexture once drawn), so the context, the
 * upload and the shader compile still happen on the first visit.
 *
 * LAZY AND SLOW, on purpose (same note): the build shares the JS thread with
 * the Book tab's rally, so a build that lands under it costs the rally frames.
 * So nothing starts until the Book tab has finished its own heavy work (its
 * court painted, then its booking sheet built; app/(tabs)/index.tsx), then it
 * waits SETTLE_MS more, and builds ONE court per idle slot with GAP_MS between
 * them, only while the app is in the foreground. A court whose tab is opened
 * first simply builds itself as before and the background skips it (`claimed`).
 *
 * PURE — no react-native: the timers, the idle wait, the foreground wait and
 * the build itself are handed in (CourtStage's prewarmStageCourts), so the
 * order and the skips are unit-tested under node.
 */
import type { CourtScene, CourtSceneKind, CourtView } from '@touch/court3d/scene';
import type { CourtQuality } from './quality';

/** What a court is built as: everything Court3D fixes at build. */
export interface CourtBuildSpec {
  scene: CourtSceneKind;
  view: CourtView;
  quality: CourtQuality;
  /** Court3D's `lean` (Android). */
  lean: boolean;
}

/**
 * After the Book tab's last heavy job is handed off, how long before the first
 * background build: its booking sheet's mount and first queries land in here.
 */
export const SETTLE_MS = 3000;
/** Between two background builds: one court per slot, never back to back. */
export const GAP_MS = 2000;

/**
 * A scene's identity. `instancing` is the renderer's answer (scene.ts), which
 * only a context can give, so it is part of the key rather than a guess: a
 * scene built for the wrong answer is never handed out.
 */
export const courtKey = (spec: CourtBuildSpec, instancing: boolean): string =>
  `${spec.scene}|${spec.view}|${spec.quality}|${spec.lean ? 'lean' : 'plain'}|${instancing ? 'inst' : 'flat'}`;

const prebuilt = new Map<string, CourtScene>();
/** Keys a Court3D has already built or taken: the background never builds them. */
const claimed = new Set<string>();
/** The first renderer's instancing answer (Court3D, noteInstancing); null = no context yet. */
let instancingSeen: boolean | null = null;
let started = false;

/** Court3D, on its first context: what this device's renderer can draw. */
export function noteInstancing(value: boolean): void {
  instancingSeen ??= value;
}

/**
 * Court3D, building a scene: the background's scene for this key if there is
 * one (handed over once, then gone), else null and the caller builds its own.
 * Either way the key is claimed, so the background does not build it later.
 */
export function takePrebuiltCourt(key: string): CourtScene | null {
  claimed.add(key);
  const scene = prebuilt.get(key) ?? null;
  prebuilt.delete(key);
  return scene;
}

export interface PrewarmDeps {
  build(spec: CourtBuildSpec, instancing: boolean): CourtScene;
  sleep(ms: number): Promise<void>;
  /** Resolves when the JS thread is idle (requestIdleCallback). */
  idle(): Promise<void>;
  /** Resolves at once in the foreground, else when the app is back in it. */
  foreground(): Promise<void>;
  onError?(error: unknown): void;
}

/** The background builds, in order. Returns once every spec is built or skipped. */
export async function runCourtPrewarm(
  specs: readonly CourtBuildSpec[],
  deps: PrewarmDeps,
): Promise<void> {
  await deps.sleep(SETTLE_MS);
  for (const [i, spec] of specs.entries()) {
    if (i > 0) await deps.sleep(GAP_MS);
    await deps.foreground();
    await deps.idle();
    // No court has had a context: GL is not working here, so there is
    // nothing worth building.
    if (instancingSeen === null) return;
    const key = courtKey(spec, instancingSeen);
    if (claimed.has(key) || prebuilt.has(key)) continue;
    try {
      prebuilt.set(key, deps.build(spec, instancingSeen));
    } catch (error) {
      // The tab builds its own on the way in, exactly as before.
      deps.onError?.(error);
      return;
    }
  }
}

/** Once per process: later calls (a remounted Book tab) do nothing. */
export function startCourtPrewarm(specs: readonly CourtBuildSpec[], deps: PrewarmDeps): void {
  if (started) return;
  started = true;
  void runCourtPrewarm(specs, deps);
}

/** Tests only: forget everything. */
export function resetCourtPrewarm(): void {
  for (const scene of prebuilt.values()) scene.dispose();
  prebuilt.clear();
  claimed.clear();
  instancingSeen = null;
  started = false;
}
