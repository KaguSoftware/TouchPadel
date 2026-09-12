/**
 * THE STAGE IS NEVER UP OVER A SURFACE THAT MAY BE EMPTY.
 *
 * Court3D's `reveal` carries the whole stage — both GL surfaces AND the caller's
 * on-net "check availability" button, which is a plain view. So the rule is one
 * rule: the stage goes down when we leave, and comes up when a frame has been
 * drawn. Break it in either direction and the guest sees it:
 *
 *   · left UP over a surface the platform quietly took away → the button sits
 *     alone on the page for as long as it takes a new context to arrive, and is
 *     then taken away again by that context's own arm;
 *   · pulled DOWN over a court that is already drawing → the court blinks out.
 *
 * The second one shipped: `needsSurface` asks the focus effect to remount both
 * GLViews, and Android answers a tab return with a fresh surface BY ITSELF,
 * often before the focus event reaches JS. The remount then landed on top of a
 * court that had already drawn and been revealed — so the button appeared for
 * ~50 ms on the way into the tab and vanished (owner, 2026-09-12, Android, in
 * the store build as well as in Expo Go).
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

describe('a replacement surface is only asked for when there is none', () => {
  it('drops the request as soon as a surface attaches', () => {
    const at = court3d.indexOf('needsSurface.current = false;');
    expect(at).toBeGreaterThan(-1);
    // Inside attach's success path, after the surface has been recorded.
    const recorded = court3d.indexOf(
      'surfaces.current[kind] = { gl, renderer, width: w, height: h };',
    );
    expect(recorded).toBeGreaterThan(-1);
    expect(recorded).toBeLessThan(at);
  });

  it('never remounts the GLViews over a live court surface', () => {
    const bump = court3d.indexOf('setGlGeneration((n) => n + 1);\n      }');
    expect(bump).toBeGreaterThan(-1);
    // The focus effect's bump is guarded on the court surface being gone.
    expect(court3d.slice(bump - 400, bump)).toContain('if (!surfaces.current.court)');
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

  it('goes down on the way out, unconditionally', () => {
    // A conditional arm ("keep it up if the surface is alive") is what put the
    // button on screen over a destroyed Android surface. iOS-only truths do not
    // get to decide this.
    const blur = court3d.indexOf('armReveal();\n      };');
    expect(blur).toBeGreaterThan(-1);
    expect(court3d.slice(blur - 80, blur)).not.toContain('if (');
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
