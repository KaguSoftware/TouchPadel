/**
 * F-32: nothing in the basket is lost unless the cashier says so. Cash or Card
 * pressed while the basket still holds lines not sent to this tab used to open
 * the payment as if they did not exist: the guest paid a bill short by them,
 * and the lines sat in the basket of a tab that was now closed. The copy for
 * it (ws.cashier.payment.unsentWarning) was written and never shown.
 *
 * Now the payment waits behind this question: go back and send them, or take
 * the payment without them — which takes a tick that says the cashier knows
 * they are not on the bill. The basket itself is not touched either way.
 */
import { useState } from 'react';
import { formatNumber } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Button, Modal } from '../../components/ui';
import { MessagePresenter } from '../../components/kit';

export { needsUnsentConfirm } from './payGuards';

export function UnsentLinesGuard({ count, onProceed, onCancel }: { count: number; onProceed: () => void; onCancel: () => void }) {
  const { tr, locale } = useLocale();
  const [ack, setAck] = useState(false);
  return (
    <Modal
      title={tr('ws.cashier.offlinePay.unsentTitle')}
      subtitle={tr('ws.cashier.till.basket.lines', { count: formatNumber(count, locale) })}
      onClose={onCancel}
      requireChoice
      size="sm"
      footer={
        <>
          <Button onClick={onCancel} data-testid="unsent-go-back">
            {tr('ws.cashier.offlinePay.unsentGoBack')}
          </Button>
          <Button kind="primary" disabled={!ack} disabledReason={ack ? undefined : tr('ws.cashier.offlinePay.unsentAck')} onClick={onProceed} data-testid="unsent-pay-anyway">
            {tr('ws.cashier.offlinePay.unsentPayAnyway')}
          </Button>
        </>
      }
    >
      <MessagePresenter tone="refused" icon="alert" message={tr('ws.cashier.payment.unsentWarning')} style={{ marginBlockEnd: 'var(--tp-sp-3)' }} />
      <label style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', minBlockSize: 'var(--tp-touch)', cursor: 'pointer' }}>
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="unsent-ack" />
        <span>{tr('ws.cashier.offlinePay.unsentAck')}</span>
      </label>
    </Modal>
  );
}
