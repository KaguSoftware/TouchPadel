/**
 * THE COURT'S FRAME LOOP MUST LEAVE THE JS SCHEDULER A WINDOW.
 *
 * Why this is a test and not just a comment: the rule is one statement's
 * ORDER inside Court3D's `startLoop`, it reads like a tidy-up either way, and
 * getting it wrong costs five seconds of a dead UI on any phone that cannot
 * draw the court inside a display frame — the exact report this came from
 * (owner's colleague, 2026-09-12: a weaker Android phone could not change the
 * date in the booking sheet for about five seconds after opening it).
 *
 * The mechanism, from React Native's own source:
 *
 *   · `requestAnimationFrame` in bridgeless RN is `setTimeout(0)`
 *     (ReactCommon/react/runtime/TimerManager.cpp says exactly that).
 *   · An expired timer is collected by a Choreographer callback on the UI
 *     thread (ReactAndroid JavaTimerManager.TimerFrameCallback) and handed to
 *     the JS thread as a RuntimeScheduler task at ImmediatePriority.
 *   · React's non-event work — transitions, passive effects, and every setState
 *     from a promise, which is every react-query result landing — is a task at
 *     NormalPriority.
 *   · The queue is a min-heap on expiry: Immediate expires now, Normal in FIVE
 *     SECONDS (ReactCommon/.../SchedulerPriorityUtils.h). So while an Immediate
 *     task is always already waiting, React's work waits out the whole five.
 *
 * Asking for the next frame BEFORE drawing this one is what kept one always
 * waiting: the timer is created first, so a Choreographer tick landing during
 * the draw queues the next frame while the current one is still running. Asking
 * AFTER the draw means no timer exists while the draw runs, so the instant it
 * ends the queue holds whatever React had pending. The frame rate is unchanged
 * on a phone with frames to spare — the tick that carries the next frame falls
 * in the gap after the draw either way.
 *
 * Court3D cannot be mounted under plain node (expo-gl, three), so the check is
 * on the source, as staleCover.test.ts's call-site check is.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const court3d = readFileSync(join(here, '../../../components/Court3D.tsx'), 'utf8');
const bookTab = readFileSync(join(here, '../../../../app/(tabs)/index.tsx'), 'utf8');

/** The body of `startLoop`, from its declaration to the closing of its callback. */
function startLoopBody(): string {
  const start = court3d.indexOf('const startLoop = useCallback(');
  expect(start).toBeGreaterThan(-1);
  const end = court3d.indexOf('const requestOnce = useCallback(', start);
  expect(end).toBeGreaterThan(start);
  return court3d.slice(start, end);
}

describe("the court's frame loop", () => {
  it('draws the frame before asking for the next one', () => {
    const body = startLoopBody();
    const draw = body.indexOf('renderFrame();');
    const schedule = body.indexOf('requestAnimationFrame(step)');
    expect(draw).toBeGreaterThan(-1);
    expect(schedule).toBeGreaterThan(-1);
    // The whole fix. Reversed, the next frame's timer exists while this frame
    // is still drawing and React's queue never reaches the head of its own.
    expect(draw).toBeLessThan(schedule);
  });

  it('only reschedules while the loop it belongs to is still the live one', () => {
    const body = startLoopBody();
    // `renderFrame` can stop the loop from inside itself (a lost GL surface),
    // and the lifecycle can stop it between frames. Rescheduling after the draw
    // means the reschedule has to ask, or a stopped loop restarts itself.
    expect(body).toContain('const generation = loopGeneration.current;');
    expect(body).toContain('if (loopGeneration.current === generation && running.current) {');
    // And the reschedule survives an unexpected throw, which asking for the
    // frame first used to give for free.
    expect(body).toMatch(/try \{\s*renderFrame\(\);\s*\} finally \{/);
  });

  it('retires the generation on every stop', () => {
    const stop = court3d.indexOf('const stopLoop = useCallback(');
    expect(stop).toBeGreaterThan(-1);
    const body = court3d.slice(stop, stop + 800);
    expect(body).toContain('loopGeneration.current += 1;');
  });
});

describe('the Book tab asks for nothing at transition priority', () => {
  // Same mechanism from the other side: a transition on this tab is a
  // NormalPriority task competing with the loop above, so it lands whole at the
  // five-second expiry rather than time-sliced. The sheet prewarm used one and
  // therefore arrived after the tap it was meant to precede.
  it('prewarms the booking sheet without startTransition', () => {
    expect(bookTab).toContain('runAfterInteractions(() => setSheetPrewarmed(true))');
    expect(bookTab).not.toContain('startTransition');
  });
});
