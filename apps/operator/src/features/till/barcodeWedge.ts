/**
 * USB barcode scanners are "keyboard wedges": they type the code, fast, and
 * press Enter. The till already routes stray keys (digits 1–9 switch the
 * category, letters start the filter), so a scan has to be told apart from a
 * person typing before those keys do anything.
 *
 * A scan is a burst of at least `minLength` code characters, each arriving at
 * most `maxGapMs` after the one before, ended by Enter. Gaps are measured from
 * `event.timeStamp` (when the key was PRESSED), never from when the handler
 * ran: a re-render between two keys must not stretch the gap and split the
 * burst.
 *
 * A LEADING DIGIT is held back (the caller prevents its default) while it may
 * be the start of a scan: typed alone it would switch the category, and
 * switching re-renders the grid mid-scan. If no second key follows within the
 * gap, `flush` hands it back and the caller replays it as the person meant it.
 * Once a held burst is running every key of it is swallowed. A burst that
 * starts with a letter is not held: the letter goes to the filter as before,
 * and the Enter that ends a qualifying burst is still recognised as a scan.
 */

export type WedgeMode = 'idle' | 'filter';

export type WedgeAction =
  /** Not a scan (yet): let the key do its normal job. */
  | { kind: 'pass' }
  /** Part of a held burst: prevent the default; `flush` may hand it back. */
  | { kind: 'swallow' }
  /** Enter closed a qualifying burst: look the code up. */
  | { kind: 'scan'; code: string };

const CODE_CHAR = /^[0-9A-Za-z-]$/;

export class BarcodeWedge {
  private buf = '';
  private last = Number.NEGATIVE_INFINITY;
  private holding = false;

  constructor(
    readonly minLength = 6,
    readonly maxGapMs = 50,
  ) {}

  /** Feed one keydown. `mode` is where the key would otherwise go. */
  feed(key: string, timeStamp: number, mode: WedgeMode): WedgeAction {
    if (key === 'Enter') {
      const code = this.buf;
      const qualifies = code.length >= this.minLength && timeStamp - this.last <= this.maxGapMs * 2;
      this.reset();
      return qualifies ? { kind: 'scan', code } : { kind: 'pass' };
    }
    if (!CODE_CHAR.test(key)) {
      this.reset();
      return { kind: 'pass' };
    }
    const continuing = this.buf.length > 0 && timeStamp - this.last <= this.maxGapMs;
    this.last = timeStamp;
    if (!continuing) {
      this.buf = key;
      this.holding = mode === 'idle' && /^[0-9]$/.test(key);
      return this.holding ? { kind: 'swallow' } : { kind: 'pass' };
    }
    this.buf += key;
    return this.holding ? { kind: 'swallow' } : { kind: 'pass' };
  }

  /**
   * Called by the caller's timer after a swallowed key. When the burst has gone
   * quiet it returns the held characters so the caller can replay them (one
   * digit: the category key it was; more: text for the filter), else null.
   */
  flush(now: number): string | null {
    if (!this.holding || now - this.last <= this.maxGapMs) return null;
    const held = this.buf;
    this.reset();
    return held;
  }

  reset(): void {
    this.buf = '';
    this.last = Number.NEGATIVE_INFINITY;
    this.holding = false;
  }
}
