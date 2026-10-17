/**
 * The customer record's Discount (0342): a section card that says at a glance
 * what the customer pays (Café 20% · Court 5,000 IQD, the reason, the note,
 * who set it and when) and opens the editor in a dialog. Save is
 * app.set_customer_discount; Remove sends both parts empty. Open bills pick a
 * change up on their next refresh; bills already closed keep what they had.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDate, isolate } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Modal } from '../../components/ui';
import { MessagePresenter } from '../../components/kit';
import { Figure, SectionCard } from '../desk/customers/RecordCards';
import { checkDraft, clearDiscountArgs, draftOf, setDiscountArgs, type CustomerDiscount, type DiscountPart } from './discountLogic';
import { invalidateDiscount } from './useCustomerDiscount';
import { useDiscountWords } from './useDiscountWords';
import { DiscountEditor } from './DiscountEditor';

const BOTH = { cafe: true, court: true } as const;

export function CustomerDiscountCard({ discount, tz, onOpen }: { discount: CustomerDiscount | null; tz: string; onOpen: () => void }) {
  const { tr, locale } = useLocale();
  const words = useDiscountWords();
  if (!discount) {
    return (
      <SectionCard icon="tag" tone="discount" testId="card-discount" title={tr('ws.discounts.card.title')} openLabel={tr('ws.discounts.card.set')} onOpen={onOpen}>
        <Figure size="md" value={tr('ws.discounts.card.none')} />
        <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockStart: 'auto' }}>{tr('ws.discounts.card.noneLead')}</span>
      </SectionCard>
    );
  }
  const row = (label: string, part: DiscountPart | null) => (
    <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--tp-sp-2)' }}>
      <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{label}</span>
      {part ? (
        <span dir="ltr" style={{ fontFamily: 'var(--tp-font-numeric)', fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 'var(--tp-fs-xl)' }}>
          {words.part(part)}
        </span>
      ) : (
        <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.discounts.card.fullPrice')}</span>
      )}
    </span>
  );
  const who = discount.set_by?.name ?? tr('ws.discounts.card.someone');
  return (
    <SectionCard
      icon="tag"
      tone="discount"
      testId="card-discount"
      title={tr('ws.discounts.card.title')}
      sub={words.reason(discount.reason)}
      openLabel={tr('ws.discounts.card.change')}
      onOpen={onOpen}
    >
      <span style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
        {row(tr('ws.discounts.part.cafe'), discount.cafe)}
        {row(tr('ws.discounts.part.court'), discount.court)}
      </span>
      {discount.note && (
        <span style={{ fontSize: 'var(--tp-fs-sm)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <bdi>{discount.note}</bdi>
        </span>
      )}
      {discount.set_at && (
        <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockStart: 'auto' }}>
          {tr('ws.discounts.card.setBy', { name: isolate(who), date: formatDate(new Date(discount.set_at), locale, tz) })}
        </span>
      )}
    </SectionCard>
  );
}

/** The record's editor: both parts, the reason, the note; Save, and Remove when there is one. */
export function CustomerDiscountDialog({
  customerId,
  customerName,
  discount,
  self,
  onClose,
}: {
  customerId: string;
  customerName: string;
  discount: CustomerDiscount | null;
  /** The signed-in staff member's own record: the server refuses (SELF_DISCOUNT), so the form says so first. */
  self: boolean;
  onClose: () => void;
}) {
  const { tr } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { reachable } = useStationReach();
  const [draft, setDraft] = useState(() => draftOf(discount));
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const check = checkDraft(draft, BOTH);
  const offline = tr('ws.discounts.offline');
  const name = isolate(customerName);

  async function write(kind: 'save' | 'remove') {
    if (kind === 'save') {
      setShowErrors(true);
      if (!check.ok || !draft.reason) return;
    }
    setBusy(kind);
    setError(null);
    try {
      await appRpc('set_customer_discount', kind === 'save' ? setDiscountArgs(customerId, check.cafe, check.court, draft.reason, draft.note) : clearDiscountArgs(customerId));
      toast.ok(tr(kind === 'save' ? 'ws.discounts.record.saved' : 'ws.discounts.record.removed', { name }));
      invalidateDiscount(qc, { customerId });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      title={tr('ws.discounts.record.title')}
      subtitle={<bdi>{customerName}</bdi>}
      dismissible={busy === null}
      onClose={onClose}
      footer={(close) => (
        <>
          {discount && !self && (
            <Button
              kind="ghost"
              icon="trash"
              style={{ marginInlineEnd: 'auto' }}
              busy={busy === 'remove'}
              disabled={busy !== null || !reachable}
              disabledReason={!reachable ? offline : undefined}
              onClick={() => void write('remove')}
            >
              {tr('ws.discounts.record.remove')}
            </Button>
          )}
          <Button onClick={close} disabled={busy !== null}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            busy={busy === 'save'}
            disabled={busy !== null || self || !reachable}
            disabledReason={self ? tr('ws.discounts.record.self') : !reachable ? offline : undefined}
            onClick={() => void write('save')}
          >
            {tr('ws.discounts.record.save')}
          </Button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
        {self ? (
          <MessagePresenter tone="refused" icon="lock" message={tr('ws.discounts.record.self')} />
        ) : (
          <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>{tr('ws.discounts.record.lead')}</p>
        )}
        <DiscountEditor draft={draft} onChange={setDraft} sections={BOTH} check={check} showErrors={showErrors} disabled={busy !== null || self} />
      </div>
      <ErrorText error={error} />
    </Modal>
  );
}
