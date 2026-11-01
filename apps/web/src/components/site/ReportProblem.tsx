'use client';

import { useState } from 'react';
import { makeT, type Locale } from '@touch/i18n';
import { reportError } from '@/lib/monitoring';

/**
 * The "Report crash" button of the site's error screens (F-15, F-43): one press sends the
 * error to the team's monitoring page (`reportEvent`, `userReported: true`); the system
 * sends it, not the visitor's mail app. The error was already reported automatically when
 * the screen opened; this one is marked as sent by a person, which the monitoring page
 * shows first. It says what happened in a polite live region, and a failed send can be
 * tried again.
 *
 * Shared by app/[locale]/error.tsx and app/global-error.tsx, so it takes its classes from
 * the error screen's own sheet (`siteLostCss`) and nothing else.
 */
type Phase = 'idle' | 'sending' | 'sent' | 'failed';

export function ReportProblem({
  locale,
  error,
  where,
}: {
  locale: Locale;
  error: unknown;
  /** which boundary caught it: 'route' or 'global' */
  where: string;
}) {
  const tr = makeT(locale);
  const [phase, setPhase] = useState<Phase>('idle');

  const send = async () => {
    setPhase('sending');
    const outcome = await reportError('crash', error, {
      userReported: true,
      detail: { where, digest: digestOf(error) },
    });
    setPhase(outcome === 'failed' ? 'failed' : 'sent');
  };

  return (
    <>
      <button
        type="button"
        className="tp-lost__btn"
        disabled={phase === 'sending' || phase === 'sent'}
        onClick={() => void send()}
      >
        {phase === 'sending' ? tr('site.error.reporting') : tr('site.error.report')}
      </button>
      <p className="tp-lost__status" role="status" aria-live="polite">
        {phase === 'sent' ? tr('site.error.reported') : phase === 'failed' ? tr('site.error.reportFailed') : ''}
      </p>
    </>
  );
}

/** Next's server-error digest, when there is one: it matches the server log line. */
export function digestOf(error: unknown): string | null {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' ? digest.slice(0, 64) : null;
}
