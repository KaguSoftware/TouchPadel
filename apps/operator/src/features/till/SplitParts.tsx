/** Pieces both split modes share: the head-count stepper and a share with its two ways to pay. */
import { formatNumber } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Button } from '../../components/ui';
import { Money } from '../../components/kit';
import type { PaymentMethod } from './PaymentPane';
import { kvRow, muted, touchTarget } from './tillStyles';

/** A −/number/+ control for a small count. */
export function CountStepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  const { locale } = useLocale();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      <span role="group" aria-label={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)' }}>
        <Button size="lg" icon="minus" aria-label="−1" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} style={touchTarget} />
        <output aria-live="polite" style={{ minInlineSize: '2.5rem', textAlign: 'center', fontSize: 'var(--tp-fs-xl)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {formatNumber(value, locale)}
        </output>
        <Button size="lg" icon="plus" aria-label="+1" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} style={touchTarget} />
      </span>
    </div>
  );
}

/** One share with the two ways to take it. */
export function ShareRow({
  index,
  amount,
  due,
  busy,
  taken = false,
  onSettle,
}: {
  index: number;
  amount: number;
  due: number;
  busy: boolean;
  /** This share has been taken in this dialog — said in words, and not offered twice. */
  taken?: boolean;
  onSettle: (method: PaymentMethod) => void;
}) {
  const { tr } = useLocale();
  const over = amount > due;
  const disabled = busy || due <= 0 || over;
  if (taken) {
    return (
      <div style={{ ...kvRow, alignItems: 'center', paddingBlock: 'var(--tp-sp-1-5)', borderBlockEnd: '1px solid var(--tp-border)', color: 'var(--tp-muted-fg)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 'var(--tp-sp-2)' }}>
          <span>{tr('ws.cashier.split.person', { index: index + 1 })}</span>
          <Money amount={amount} style={{ fontSize: 'var(--tp-fs-lg)' }} />
        </span>
        <span style={{ fontWeight: 600, color: 'var(--tp-success-fg)' }}>{tr('ws.cashier.split.taken')}</span>
      </div>
    );
  }
  return (
    <div style={{ ...kvRow, alignItems: 'center', paddingBlock: 'var(--tp-sp-1-5)', borderBlockEnd: '1px solid var(--tp-border)', flexWrap: 'wrap' }}>
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 'var(--tp-sp-2)' }}>
        <span style={muted}>{tr('ws.cashier.split.person', { index: index + 1 })}</span>
        <Money amount={amount} strong style={{ fontSize: 'var(--tp-fs-lg)' }} />
      </span>
      <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'flex-start' }}>
        <Button icon="banknote" disabled={disabled} disabledReason={!busy && over && due > 0 ? tr('ws.cashier.split.shareOverDue') : undefined} onClick={() => onSettle('cash')}>
          {tr('op.till.payCash')}
        </Button>
        <Button icon="card" disabled={disabled} onClick={() => onSettle('card')}>
          {tr('op.till.payCard')}
        </Button>
      </span>
    </div>
  );
}
