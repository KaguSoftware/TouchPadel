/**
 * "Report crash" states (F-15), shared by the crash screen. Pure.
 */
import type { ReportOutcome } from '@touch/core/monitoring';

export type ReportState = 'idle' | 'sending' | ReportOutcome;

/** The line under the button for each state. */
export const REPORT_LINE = {
  idle: 'crashReport.hint',
  sending: 'crashReport.sending',
  sent: 'crashReport.sent',
  queued: 'crashReport.queued',
  failed: 'crashReport.failed',
} as const satisfies Record<ReportState, string>;

/** Sent, or kept to send: the button has done its job and stays off. */
export function reportDone(state: ReportState): boolean {
  return state === 'sent' || state === 'queued';
}
