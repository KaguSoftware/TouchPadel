/**
 * Every receipt and slip the operator prints (F-30): the till's bill, the shop
 * desk's receipt, the court desk's receipt.
 *
 * Before this, a missing or failed receipt printer quietly opened the system
 * print dialog: no message, no log, and a cashier who did not know the
 * station had no printer stood there with a dialog asking which one. Now:
 *
 *   - Electron: the job goes to the station's receipt printer (operator-shell
 *     print-receipt.ts, which already retries once). A refusal comes back as
 *     an outcome the screen says in words (components/PrintStatus.tsx), with
 *     "Print again" and, as an explicit choice, "Use another printer" (the
 *     system dialog). Every failure is reported to the dev monitoring panel
 *     (kind 'print_failed'): what was being printed and why, never the bill.
 *   - Browser (dev, e2e): there is no station printer, so the browser's own
 *     print dialog IS the printer; asked for by the same press.
 *
 * Kitchen tickets ('kitchen' in the IPC validator) are not printed anywhere:
 * the kitchen works from its screen (KDS), and a paper copy is not part of
 * this build.
 */
import type { MessageKey } from '@touch/i18n';
import { touch } from '../ipc/bridge';
import { isElectron } from './mutate';
import { reportEvent } from './monitoring';

/** What is being printed: the monitoring report says this, never the content. */
export type PrintWhat = 'till_bill' | 'shop_receipt' | 'court_receipt';

export type PrintFailure = 'no-printer' | 'failed';

export type PrintOutcome =
  | { ok: true; via: 'printer' | 'dialog' }
  | { ok: false; reason: PrintFailure; detail: string | null };

/** The shell's answer (PrintResult, or a validator refusal), or what it threw, as an outcome. Pure. */
export function printOutcomeOf(answer: unknown, thrown?: unknown): PrintOutcome {
  if (thrown !== undefined) return { ok: false, reason: 'failed', detail: shortDetail(thrown) };
  const a = answer as { ok?: unknown; error?: unknown } | null | undefined;
  if (a && a.ok === true) return { ok: true, via: 'printer' };
  const error = typeof a?.error === 'string' ? a.error : null;
  // 'no-printer': none configured on this station, or an unidentified station.
  if (error === 'no-printer') return { ok: false, reason: 'no-printer', detail: null };
  return { ok: false, reason: 'failed', detail: error ? shortDetail(error) : null };
}

/**
 * The printer's own error text (a port, an address, a driver message) is
 * kept short; it names hardware, not people.
 */
function shortDetail(e: unknown): string {
  const text = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return text.slice(0, 200);
}

/** The sentence for a failed outcome; null when there is nothing to say. Pure. */
export function printMessageKey(outcome: PrintOutcome | null): MessageKey | null {
  if (!outcome || outcome.ok) return null;
  return outcome.reason === 'no-printer' ? 'ws.kit.print.noPrinter' : 'ws.kit.print.failed';
}

/** Send one receipt to the printer. Never throws; a failure is reported and returned. */
export async function printReceipt(job: {
  html: string;
  what: PrintWhat;
  again?: boolean;
  /**
   * Browser mode only: 'page' prints the screen (the till's bill is a modal
   * the print stylesheet isolates); 'document' prints this receipt alone.
   */
  browser?: 'page' | 'document';
}): Promise<PrintOutcome> {
  if (!isElectron()) {
    if (job.browser === 'document') printWithSystemDialog(job.html);
    else window.print();
    return { ok: true, via: 'dialog' };
  }
  let outcome: PrintOutcome;
  try {
    outcome = printOutcomeOf(await touch.print({ kind: job.again ? 'reprint' : 'receipt', data: { html: job.html } }));
  } catch (error) {
    outcome = printOutcomeOf(undefined, error);
  }
  if (!outcome.ok) {
    reportEvent({
      level: 'error',
      kind: 'print_failed',
      message: `${job.what}: ${outcome.reason}`,
      detail: { what: job.what, reason: outcome.reason, again: job.again === true, error: outcome.detail },
    });
  }
  return outcome;
}

/**
 * "Use another printer": the system print dialog, only ever on the person's
 * own press. The receipt document alone goes into a hidden frame and that
 * frame is printed, so the dialog shows the receipt, not the whole till
 * screen behind it. Without a document (or outside a browser), the page.
 */
export function printWithSystemDialog(html?: string | null): void {
  if (!html || typeof document === 'undefined') {
    window.print();
    return;
  }
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('data-print-frame', '');
  frame.tabIndex = -1;
  frame.style.position = 'fixed';
  frame.style.inlineSize = '0';
  frame.style.blockSize = '0';
  frame.style.border = '0';
  frame.style.opacity = '0';
  frame.addEventListener('load', () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.print();
    } finally {
      // The dialog is modal to the frame's window; give it time before the frame goes.
      setTimeout(() => frame.remove(), 60_000);
    }
  });
  frame.srcdoc = html;
  document.body.appendChild(frame);
}
