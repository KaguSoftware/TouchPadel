/**
 * "Customer discount" at the close of a bill (0342): the till's tab, the shop
 * sale, the desk's booking bill. Names the customer on the bill, opens on what
 * the bill carries (else their standing discount), and with "Keep for <name>
 * on every bill" (on by default) saves it to their record and brings the bill
 * in line; without it, the discount is this bill's only. No manager PIN.
 *
 * The parts shown follow the bill: café and shop goods when there is a tab,
 * the court fee when the booking takes one (a plain booking still owing;
 * never an open match). A part the bill cannot show keeps whatever the
 * customer already had. The calls are discountLogic.billSteps.
 *
 * A bill with no customer says so and points at the member block on the
 * same bill, rather than failing on NO_CUSTOMER.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isolate } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { useStationReach } from '../../lib/stationReach';
import { errorCodeToMessageKey } from '../../lib/errors';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Modal } from '../../components/ui';
import { MessagePresenter } from '../../components/kit';
import { billPrefill, billSections, billSteps, checkDraft, type BillAction, type BillDiscountState } from './discountLogic';
import { invalidateDiscount, runBillSteps } from './useCustomerDiscount';
import { useDiscountWords } from './useDiscountWords';
import { DiscountEditor } from './DiscountEditor';

export function BillDiscountDialog({
  tabId,
  reservationId,
  state,
  onClose,
}: {
  tabId: string | null;
  reservationId: string | null;
  state: BillDiscountState;
  onClose: () => void;
}) {
  const { tr } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { staff } = useAuth();
  const { reachable } = useStationReach();
  const words = useDiscountWords();
  const ids = { tabId, reservationId };
  const sections = billSections(state, ids);
  const [draft, setDraft] = useState(() => billPrefill(state));
  const [keep, setKeep] = useState(true);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState<'apply' | 'remove' | null>(null);
  const [error, setError] = useState<unknown>(null);

  const customer = state.customer;
  const name = customer?.name ?? tr('ws.discounts.card.someone');
  const self = Boolean(customer && staff?.id && staff.id === customer.id);
  const courtClosed = Boolean(reservationId && state.court?.closed);
  const editable = Boolean(customer) && !self && (sections.cafe || sections.court);
  const check = checkDraft(draft, sections);
  const onBill = Boolean((tabId && state.cafe) || (reservationId && state.court && !state.court.closed));
  const offline = tr('ws.discounts.offline');

  async function run(action: BillAction, done: string) {
    setBusy(action.kind === 'remove' ? 'remove' : 'apply');
    setError(null);
    try {
      const out = await runBillSteps(billSteps(state, ids, action), ids);
      toast.ok(done);
      if (out.refused) toast.info(tr(errorCodeToMessageKey(out.refused)));
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      // Whatever went through is on the bill now, even when a later call refused.
      invalidateDiscount(qc, { customerId: customer?.id, tabId, reservationId });
      setBusy(null);
    }
  }

  function apply() {
    setShowErrors(true);
    if (!check.ok || !draft.reason) return;
    if (keep) void run({ kind: 'keep', check, reason: draft.reason, note: draft.note }, tr('ws.discounts.bill.savedKeep', { name: isolate(name) }));
    else void run({ kind: 'once', check, reason: draft.reason }, tr('ws.discounts.bill.savedOnce'));
  }

  return (
    <Modal
      title={tr('ws.discounts.action')}
      subtitle={customer ? <bdi>{name}</bdi> : undefined}
      dismissible={busy === null}
      onClose={onClose}
      footer={(close) =>
        editable ? (
          <>
            {onBill && (
              <Button
                kind="ghost"
                icon="x"
                style={{ marginInlineEnd: 'auto' }}
                busy={busy === 'remove'}
                disabled={busy !== null || !reachable}
                disabledReason={!reachable ? offline : undefined}
                onClick={() => void run({ kind: 'remove' }, tr('ws.discounts.bill.removed'))}
              >
                {tr('ws.discounts.bill.remove')}
              </Button>
            )}
            <Button onClick={close} disabled={busy !== null}>
              {tr('common.cancel')}
            </Button>
            <Button kind="primary" busy={busy === 'apply'} disabled={busy !== null || !reachable} disabledReason={!reachable ? offline : undefined} onClick={apply}>
              {tr('ws.discounts.bill.apply')}
            </Button>
          </>
        ) : (
          <Button onClick={close}>{tr('common.close')}</Button>
        )
      }
    >
      {!customer ? (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }} data-testid="discount-no-customer">
          <MessagePresenter tone="info" icon="userPlus" message={tr('ws.discounts.bill.noCustomer')} />
          <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>{tr('ws.discounts.bill.noCustomerLead')}</p>
        </div>
      ) : self ? (
        <MessagePresenter tone="refused" icon="lock" message={tr('ws.discounts.bill.self')} />
      ) : (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
          {state.standing && (
            <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }} data-testid="discount-standing">
              {tr('ws.discounts.bill.standing', { parts: `${words.reason(state.standing.reason)} · ${words.parts(state.standing)}` })}
            </p>
          )}
          {courtClosed && <MessagePresenter tone="info" icon="lock" message={tr('ws.discounts.bill.courtClosed')} />}
          {sections.cafe || sections.court ? (
            <>
              <DiscountEditor draft={draft} onChange={setDraft} sections={sections} check={check} showErrors={showErrors} disabled={busy !== null} showNote={keep} />
              <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', paddingBlockStart: 'var(--tp-sp-3)', borderBlockStart: '1px solid var(--tp-border)' }}>
                <label style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', alignItems: 'center', cursor: 'pointer', fontWeight: 600 }}>
                  <input type="checkbox" checked={keep} disabled={busy !== null} onChange={(e) => setKeep(e.target.checked)} />
                  <span>{tr('ws.discounts.bill.keep', { name: isolate(name) })}</span>
                </label>
                <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', paddingInlineStart: 'var(--tp-sp-6)' }}>
                  {tr(keep ? 'ws.discounts.bill.keepHint' : 'ws.discounts.bill.onceHint')}
                </span>
              </div>
            </>
          ) : (
            !courtClosed && <MessagePresenter tone="info" message={tr('ws.discounts.bill.nothing')} />
          )}
        </div>
      )}
      <ErrorText error={error} />
    </Modal>
  );
}
