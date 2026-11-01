/**
 * F-30: what happened to a print, said where it was pressed, with "Print
 * again" every time (lib/print.ts). A failure says why in words and offers
 * "Use another printer" (the system dialog) as the person's own choice;
 * nothing opens a dialog on its own any more.
 *
 *   const printer = usePrint('till_bill', () => receiptHtml());
 *   <Button onClick={() => void printer.print()}>Print</Button>
 *   <PrintStatus printer={printer} />
 */
import { useCallback, useRef, useState } from 'react';
import { useLocale } from '../lib/i18n';
import { printMessageKey, printReceipt, printWithSystemDialog, type PrintOutcome, type PrintWhat } from '../lib/print';
import { MessagePresenter } from './kit';
import { Button } from './ui';

export type PrintState = 'idle' | 'printing' | PrintOutcome;

export interface Printer {
  state: PrintState;
  /** Print (again, after the first time). Resolves with the outcome; never throws. */
  print: () => Promise<PrintOutcome | null>;
  /** The system dialog, for the receipt alone. */
  printElsewhere: () => void;
}

/** One printable document: `getHtml` builds the receipt at the moment of printing (null = nothing to print). */
export function usePrint(what: PrintWhat, getHtml: () => string | null, browser: 'page' | 'document' = 'page'): Printer {
  const [state, setState] = useState<PrintState>('idle');
  const count = useRef(0);
  const html = useRef(getHtml);
  html.current = getHtml;
  const print = useCallback(async () => {
    const doc = html.current();
    if (!doc) return null;
    setState('printing');
    const outcome = await printReceipt({ html: doc, what, again: count.current > 0, browser });
    count.current += 1;
    setState(outcome);
    return outcome;
  }, [what, browser]);
  const printElsewhere = useCallback(() => printWithSystemDialog(html.current()), []);
  return { state, print, printElsewhere };
}

export function PrintStatus({ printer }: { printer: Printer }) {
  const { tr } = useLocale();
  const { state } = printer;
  if (state === 'idle') return null;
  if (state === 'printing') {
    return (
      <p data-no-print role="status" data-testid="print-status" data-state="printing" style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
        {tr('ws.kit.print.printing')}
      </p>
    );
  }
  const failed = printMessageKey(state);
  return (
    <div data-no-print data-testid="print-status" data-state={state.ok ? 'printed' : state.reason} style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
      {failed ? (
        <MessagePresenter tone="error" icon="printer" message={tr(failed)} />
      ) : state.ok && state.via === 'printer' ? (
        <MessagePresenter tone="success" icon="printer" message={tr('ws.kit.print.printed')} />
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-2)' }}>
        <Button size="sm" icon="printer" data-testid="print-again" onClick={() => void printer.print()}>
          {tr('ws.kit.print.again')}
        </Button>
        {failed && (
          <Button size="sm" kind="ghost" data-testid="print-elsewhere" onClick={printer.printElsewhere}>
            {tr('ws.kit.print.otherPrinter')}
          </Button>
        )}
      </div>
    </div>
  );
}
