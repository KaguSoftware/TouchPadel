/**
 * Desk lesson money waiting to go back (docs/design/coaching/operator.md
 * §5.10.10, §5.17; R36, R62, R75): the warn panel "Refunds due at the desk" on
 * the lesson screen, and the row actions the Ops panel (LessonRefundsDuePanel)
 * reuses. Only for `permissionsFor().refund` (manager, owner); the caller
 * gates it and feeds it `lesson_refunds_due` items (refundsForLesson on the
 * lesson screen).
 *
 * **Refund** opens the till's RefundDialog on that payment with `dueIqd` =
 * `refund_due_desk_iqd`: capped at what is due back, with the reason
 * `lesson_refund`; the goodwill switch lifts the cap to the payment's
 * remainder with `lesson_goodwill`. It rides the till's queued `payment.refund`
 * under the manager PIN, so it stays enabled offline; a refusal answered
 * online (`REFUND_EXCEEDS_DUE`) shows in the dialog and re-reads the list.
 *
 * **Record the handback** (R75) is for a share owed back on an online payment
 * that already had its one Qi refund (`online_blocked_iqd`): the manager
 * hands it back another way and records it (BlockedRefundDialog).
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatIQD, isolate } from '@touch/i18n';
import { AppRpcError } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { QK } from '../../lib/queryKeys';
import { useToast } from '../../components/toast';
import { Button } from '../../components/ui';
import { Panel, ViewMore, useListCap } from '../../components/kit';
import { Icon } from '../../components/icons';
import { RefundDialog } from '../till/ManagerActions';
import { BlockedRefundDialog } from './BlockedRefundDialog';
import type { Tr } from './lessonLogic';
import type { RefundDueItem, RefundDuePayment } from './lessonPayloads';
import {
  deskDueOf,
  isCourseLeave,
  methodWord,
  onlineBlockedOf,
  refundDialogPayment,
  refundLabel,
  refundablePayments,
} from './lessonScreenLogic';

/**
 * The money line of the lesson screen's panel (§5.10.10):
 * "{label} · paid {amount} by {method} · {refunded} refunded · {due} due".
 */
export function refundRowText(
  item: RefundDueItem,
  payment: RefundDuePayment,
  tr: Tr,
  locale: 'en' | 'ar',
): string {
  const iqd = (n: number | null) => (n === null ? '—' : formatIQD(n, locale));
  return tr('ws.coaching.refunds.row', {
    label: isolate(refundLabel(item, tr)),
    amount: iqd(payment.amount_iqd),
    method: methodWord(payment.method, tr),
    refunded: iqd(payment.refunded_iqd ?? 0),
    due: iqd(item.refund_due_desk_iqd),
  });
}

/** Re-read every coaching read (the lists, the lesson's roster money) after a refund. */
function useRefreshLessonMoney() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: [...QK.coaching.all] });
    void qc.invalidateQueries({ queryKey: [...QK.day] });
  };
}

/** Refund on one payment of a refunds-due item: the till's RefundDialog, capped at the due (R36). */
export function RefundDueButton({
  item,
  payment,
}: {
  item: RefundDueItem;
  payment: RefundDuePayment;
}) {
  const { tr } = useLocale();
  const toast = useToast();
  const refresh = useRefreshLessonMoney();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" kind="danger" icon="undo" onClick={() => setOpen(true)}>
        {tr('ws.coaching.refunds.refund')}
      </Button>
      {open && (
        <RefundDialog
          payments={[refundDialogPayment(payment)]}
          lines={[]}
          canRefund
          dueIqd={deskDueOf(item)}
          onClose={() => setOpen(false)}
          onDone={(outcome) => {
            toast.ok(
              tr(outcome.queued ? 'ws.coaching.refunds.queued' : 'ws.coaching.refunds.done'),
            );
            refresh();
            setOpen(false);
          }}
          onRefused={(e) => {
            // The due moved under the desk (another refund, a recount): read the list again.
            if (e instanceof AppRpcError && e.code === 'REFUND_EXCEEDS_DUE') refresh();
          }}
        />
      )}
    </>
  );
}

/** Record the handback of a share Qi could not refund (R75). */
export function HandbackButton({ item }: { item: RefundDueItem }) {
  const { tr } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" icon="note" onClick={() => setOpen(true)}>
        {tr('ws.coaching.refunds.recordHandback')}
      </Button>
      {open && <BlockedRefundDialog item={item} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * "Online refunds": the online refunds panel. On Ops it sits above the lesson
 * refunds when a row waits there, so the link scrolls to it; elsewhere (or
 * with no row in it) it opens Ops.
 */
export function OnlineRefundsLink() {
  const { tr } = useLocale();
  const navigate = useNavigate();
  return (
    <Button
      size="sm"
      kind="ghost"
      iconEnd="arrowUpRight"
      onClick={() => {
        const panel = document.querySelector('[data-testid="deposit-attention"]');
        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else void navigate({ to: '/ops' });
      }}
    >
      {tr('ws.coaching.refunds.onlineRefunds')}
    </Button>
  );
}

/** The R75 line and its record: shown when an item has money blocked online. */
export function OnlineBlockedLine({ item }: { item: RefundDueItem }) {
  const { tr, locale } = useLocale();
  const blocked = onlineBlockedOf(item);
  if (blocked <= 0) return null;
  return (
    <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ color: 'var(--tp-warn-fg)', fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>
        {tr('ws.coaching.refunds.onlineBlocked', { amount: formatIQD(blocked, locale) })}
      </span>
      <OnlineRefundsLink />
      <HandbackButton item={item} />
    </div>
  );
}

/** The lesson screen's warn panel (§5.10.10): one row per item and payment. */
export function LessonRefundsDue({ items }: { items: readonly RefundDueItem[] }) {
  const { tr, locale } = useLocale();
  const cap = useListCap(items);
  if (items.length === 0) return null;
  return (
    <Panel
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
          <Icon name="undo" size={16} style={{ color: 'var(--tp-warn)' }} />
          {tr('ws.coaching.refunds.title')}
        </span>
      }
      style={{ borderColor: 'var(--tp-warn)', background: 'var(--tp-warn-soft)' }}
      data-testid="lesson-refunds-due"
    >
      <ul
        style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-3)' }}
      >
        {cap.shown.map((item) => {
          const payments = refundablePayments(item);
          const due = deskDueOf(item);
          return (
            <li key={item.enrolment_id} style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
              {payments.map((p) => (
                <div
                  key={p.payment_id}
                  style={{
                    display: 'flex',
                    gap: 'var(--tp-sp-2)',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ flex: '1 1 16rem', fontSize: 'var(--tp-fs-sm)' }}>
                    {refundRowText(item, p, tr, locale)}
                  </span>
                  {due > 0 && <RefundDueButton item={item} payment={p} />}
                </div>
              ))}
              {payments.length === 0 && due > 0 && (
                <span style={{ fontSize: 'var(--tp-fs-sm)' }}>
                  {isolate(refundLabel(item, tr))} ·{' '}
                  {tr('ws.coaching.lessonRefunds.due', { amount: formatIQD(due, locale) })}
                </span>
              )}
              {isCourseLeave(item) && (
                <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                  {tr('ws.coaching.refunds.courseLeave')}
                </span>
              )}
              <OnlineBlockedLine item={item} />
            </li>
          );
        })}
      </ul>
      <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} />
    </Panel>
  );
}
