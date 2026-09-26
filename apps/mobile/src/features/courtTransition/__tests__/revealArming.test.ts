/**
 * THE STAGE IS UP EXACTLY WHILE THE COURT'S SURFACE HAS A PICTURE ON IT.
 *
 * Court3D's `reveal` carries the whole stage — both GL surfaces AND the caller's
 * on-net "check availability" button, which is a plain view. Break the rule in
 * either direction and the guest sees it:
 *
 *   · UP over a surface with no picture → the button sits alone on the page,
 *     over an empty court, until a replacement context has drawn;
 *   · DOWN over a court that has one → the page arrives without its court, or
 *     the court blinks out.
 *
 * Every one of those shipped. The stage used to go down on every blur, so each
 * tab return showed the page first and the court a frame-loop round trip later
 * — and on Android a whole new context later, because the tab navigator was
 * destroying the court's surface on every switch (owner, 2026-09-13: "for a
 * really short time the court isn't loaded and the rest of the page is loaded
 * already"). And a dead expo-gl context does not throw, so the frame drawn into
 * one lifted the stage anyway, with the button on it and nothing under it.
 * Before that, a remount landing on a court that had already drawn put the
 * button up for ~50 ms and took it away again (owner, 2026-09-12).
 *
 * So: leaving the tab does not touch the stage (the surface keeps its frame);
 * a surface is ASKED whether it is alive (surfaceLiveness.ts) — while hidden, on
 * the way back, and by every frame — and only a dead one takes the stage down,
 * while nobody is looking; nothing lifts it but a frame a live context took.
 *
 * Court3D cannot be mounted under plain node (expo-gl, three), so the checks are
 * on the source, as staleCover.test.ts's call-site check is.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const court3d = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../components/Court3D.tsx'),
  'utf8',
);

/** The source from `start` up to the first `end` after it. */
function between(start: string, end: string): string {
  const from = court3d.indexOf(start);
  expect(from, start).toBeGreaterThan(-1);
  const to = court3d.indexOf(end, from + start.length);
  expect(to, end).toBeGreaterThan(from);
  return court3d.slice(from, to);
}

/** The focus effect's cleanup: what runs when the guest leaves the tab. */
function blurCleanup(): string {
  const effect = between('useFocusEffect(', 'const sub = AppState.addEventListener(');
  const cleanup = effect.indexOf('return () => {');
  expect(cleanup).toBeGreaterThan(-1);
  return effect.slice(cleanup);
}

describe('a replacement surface is only asked for when there is none', () => {
  it('drops the request as soon as a surface attaches', () => {
    // Inside attach's success path, after the surface has been recorded — and
    // the grace-period remount goes with it: the platform answered first.
    const attach = between('const attach = useCallback(', 'const onCourtContext = useCallback(');
    const recorded = attach.indexOf(
      'surfaces.current[kind] = { gl, renderer, width: w, height: h };',
    );
    expect(recorded).toBeGreaterThan(-1);
    const dropped = attach.indexOf('needsSurface.current = false;', recorded);
    expect(dropped).toBeGreaterThan(recorded);
    expect(attach.indexOf('clearSurfaceTimer();', recorded)).toBeGreaterThan(recorded);
  });

  it('never remounts the GLViews over a live court surface', () => {
    // The one remount a lost surface can cause lives in requestSurface, and it
    // re-checks for a surface at the moment it would fire.
    const request = between(
      'const requestSurface = useCallback(',
      'const surfaceLost = useCallback(',
    );
    const guard = request.indexOf('if (!focusedRef.current || surfaces.current.court) return;');
    const bump = request.indexOf('setGlGeneration((n) => n + 1);');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(bump);
    // And the focus effect only asks when there is none.
    const effect = between('useFocusEffect(', 'return () => {');
    expect(effect).toMatch(
      /if \(surfaces\.current\.court\) needsSurface\.current = false;\s*else requestSurface\(\);/,
    );
  });

  it('gives the platform its chance to hand a surface back first', () => {
    // Android re-creates a destroyed TextureView surface by itself; a remount
    // on the spot throws that one away and can land on it as it attaches.
    const request = between(
      'const requestSurface = useCallback(',
      'const surfaceLost = useCallback(',
    );
    expect(request).toContain('SURFACE_GRACE_MS');
    expect(court3d).toMatch(/const SURFACE_GRACE_MS = \d+;/);
  });
});

describe('the stage', () => {
  it('is never lowered while the tab is in front of someone', () => {
    // THE choke point. Every route to the flash — a second attach, a remount
    // after a lost surface, attach's own retry when the BALL failed, the
    // backstop lifting the stage before the first frame — can only be seen
    // because an arm landed on a stage that was already up. One guard covers
    // them all, and each of the routes was fixed in turn without it and kept
    // coming back.
    const arm = court3d.indexOf('const armReveal = useCallback(');
    expect(arm).toBeGreaterThan(-1);
    const body = court3d.slice(arm, arm + 600);
    expect(body).toContain('if (revealed.current && focusedRef.current) return;');
    // And the guard comes FIRST: anything before it would run on a no-op arm.
    expect(body.indexOf('if (revealed.current && focusedRef.current) return;')).toBeLessThan(
      body.indexOf('reveal.setValue(0)'),
    );
  });

  it('stays up on the way out of the tab', () => {
    // THE REPORTED BUG. An arm here put the stage down on every blur, and the
    // tab is on screen again before JS hears it is focused — so every return
    // showed the page without its court until the loop had drawn again.
    const cleanup = blurCleanup();
    expect(cleanup).not.toContain('armReveal(');
    // What it does instead: take the backstop down (a first build's entrance
    // must not be spent off screen) and start watching the surface.
    expect(cleanup).toContain('clearRevealTimer();');
    expect(cleanup).toContain('startSurfaceProbe();');
  });

  it('goes down for a surface found dead while the tab is hidden', () => {
    // The other half of staying up: what can still take the surface while the
    // guest is away (a push onto the root stack) must take the stage down
    // BEFORE they are back, where the guard above is off.
    const probe = between(
      'const startSurfaceProbe = useCallback(',
      'const renderFrame = useCallback(',
    );
    expect(probe).toContain('setInterval(');
    expect(probe).toContain("else if (!contextAlive(main.gl)) surfaceLost('hidden');");
    const lost = between(
      'const surfaceLost = useCallback(',
      'const startSurfaceProbe = useCallback(',
    );
    expect(lost).toContain('armReveal();');
    // And the focus effect stops the watch: someone is looking again.
    expect(between('useFocusEffect(', 'return () => {')).toContain('stopSurfaceProbe();');
  });

  it('lifts only for a frame a live context took', () => {
    // A dead expo-gl context answers every call with `undefined` instead of
    // throwing, so a frame drawn into one used to lift the stage — the button
    // over an empty court. The present is checked before anything believes it.
    const frame = between('const renderFrame = useCallback(', 'const startLoop = useCallback(');
    const present = frame.indexOf('if (!presentFrame(main.gl)) {');
    expect(present).toBeGreaterThan(-1);
    expect(frame.slice(present, present + 120)).toMatch(/surfaceLost\('frame'\);\s*return;/);
    for (const believer of ['showStage();', 'firstFrameCb.current?.();', 'frameRepaints(']) {
      expect(frame.indexOf(believer), believer).toBeGreaterThan(present);
    }
    // No bare present left anywhere in the loop.
    expect(frame).not.toMatch(/\.gl\.endFrameEXP\(\);/);
  });

  it('keeps the scene when only the surface is lost', () => {
    // The scene never belonged to the context; `attach` reuses it. Rebuilding it
    // for a lost surface would turn a cut into a few hundred ms and a fade.
    const lost = between(
      'const surfaceLost = useCallback(',
      'const startSurfaceProbe = useCallback(',
    );
    expect(lost).not.toContain('teardown(');
    expect(lost).not.toContain('court.current = null');
    expect(lost).toContain("detach('court');");
    expect(lost).toContain("detach('ball');");
  });

  it('cuts back in on a return and fades only on a first build', () => {
    expect(court3d).toContain('warmArm.current = court.current !== null;');
    const show = court3d.indexOf('const showStage = useCallback(');
    const cut = court3d.indexOf('if (warmArm.current) {', show);
    const fade = court3d.indexOf('duration: REVEAL_MS,', show);
    expect(cut).toBeGreaterThan(show);
    // The cut returns before the cross-fade, so a built scene never dissolves.
    expect(cut).toBeLessThan(fade);
  });
});
