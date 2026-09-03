import { describe, expect, it } from 'vitest';

/**
 * The unsaved-changes guard on profile-edit, as a state machine.
 *
 * Mirrors the screen: `beforeRemove` blocks a pop while the form is dirty and
 * the guard has not been released; the discard dialog releases it and replays
 * the blocked action. Two bugs have lived here, and both are pinned below:
 *
 *  - releasing through STATE alone (`leaving`) let the listener still see the
 *    previous value when the replay dispatched, so the pop was intercepted a
 *    second time and the screen could never be left without saving;
 *  - the iOS edge-swipe is committed by UIKit before `beforeRemove` runs, so
 *    it is disabled outright while the guard is armed rather than "blocked".
 */
function guard({ dirty }: { dirty: boolean }) {
  // The ref: set synchronously, unlike the `leaving` state it stands in for.
  let released = false;
  let dialogOpen = false;
  let pending: string | null = null;
  const departures: string[] = [];

  const armed = () => dirty && !released;

  const beforeRemove = (action: string): 'blocked' | 'left' => {
    if (armed()) {
      pending = action;
      dialogOpen = true;
      return 'blocked';
    }
    departures.push(action);
    return 'left';
  };

  return {
    beforeRemove,
    /** What the header's back item does: a JS dispatch the guard can cancel. */
    pressBack: () => beforeRemove('POP'),
    /** The dialog's destructive action. */
    confirmDiscard() {
      dialogOpen = false;
      released = true; // synchronous — the whole point
      return pending ? beforeRemove(pending) : 'left';
    },
    keepEditing() {
      dialogOpen = false;
      pending = null;
    },
    saveSucceeded() {
      released = true;
      return beforeRemove('POP');
    },
    /** `gestureEnabled` is the negation of the armed guard. */
    get swipeEnabled() {
      return !armed();
    },
    get dialogOpen() {
      return dialogOpen;
    },
    get departures() {
      return departures;
    },
  };
}

describe('profile-edit discard guard', () => {
  it('prompts instead of leaving when back is pressed with unsaved edits', () => {
    const g = guard({ dirty: true });
    expect(g.pressBack()).toBe('blocked');
    expect(g.dialogOpen).toBe(true);
    expect(g.departures).toEqual([]);
  });

  it('actually leaves once discard is confirmed', () => {
    const g = guard({ dirty: true });
    g.pressBack();
    expect(g.confirmDiscard()).toBe('left');
    // The regression: this was 'blocked', trapping the user on the screen.
    expect(g.departures).toEqual(['POP']);
    expect(g.dialogOpen).toBe(false);
  });

  it('stays on the screen when the user keeps editing', () => {
    const g = guard({ dirty: true });
    g.pressBack();
    g.keepEditing();
    expect(g.dialogOpen).toBe(false);
    expect(g.departures).toEqual([]);
  });

  it('never prompts when nothing was edited', () => {
    const g = guard({ dirty: false });
    expect(g.pressBack()).toBe('left');
    expect(g.dialogOpen).toBe(false);
  });

  it('does not offer to discard changes that were just saved', () => {
    const g = guard({ dirty: true });
    expect(g.saveSucceeded()).toBe('left');
    expect(g.dialogOpen).toBe(false);
  });

  it('disables the edge-swipe only while there are unsaved edits', () => {
    const dirtyForm = guard({ dirty: true });
    expect(dirtyForm.swipeEnabled).toBe(false);
    dirtyForm.pressBack();
    dirtyForm.confirmDiscard();
    expect(dirtyForm.swipeEnabled).toBe(true);

    expect(guard({ dirty: false }).swipeEnabled).toBe(true);
  });
});
