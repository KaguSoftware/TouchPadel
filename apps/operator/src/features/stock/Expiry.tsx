/**
 * Batch expiry (SOW L532-540) — LAST in contract priority: "batch expiry gives
 * way first" (L929). v_expiring_soon (venue-configurable window) + v_expired;
 * write-off is PIN-gated with its own reason (app.write_off_expired), and the
 * ledger keeps the movement forever.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatIQD } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, PinReasonModal, card } from '../../components/ui';
import { SK } from './stockKeys';

interface BatchRow {
  batch_id: string;
  ingredient_id: string;
  name_en: string;
  name_ar: string;
  unit: string;
  qty_remaining: number;
  unit_cost_iqd: number;
  expiry_date: string;
  days_left?: number;
  days_expired?: number;
}

export function Expiry() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [writeOff, setWriteOff] = useState<BatchRow | null>(null);
  const [busy, setBusy] = useState(false);

  const expiringQ = useQuery({
    queryKey: SK.expiring,
    queryFn: async (): Promise<BatchRow[]> => {
      const { data, error } = await supabase.from('v_expiring_soon').select('*').order('expiry_date');
      if (error) throw error;
      return data as BatchRow[];
    },
  });
  const expiredQ = useQuery({
    queryKey: SK.expired,
    queryFn: async (): Promise<BatchRow[]> => {
      const { data, error } = await supabase.from('v_expired').select('*').order('expiry_date');
      if (error) throw error;
      return data as BatchRow[];
    },
  });

  async function submitWriteOff(pin: string, reasonCode: string) {
    if (!writeOff) return;
    setBusy(true);
    try {
      await appRpc('write_off_expired', {
        p_batch_id: writeOff.batch_id,
        p_pin: pin,
        p_reason_code: reasonCode,
      });
      toast.ok(tr('op.toast.saved'));
      setWriteOff(null);
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
    } catch (e) {
      toast.err(e);
    } finally {
      setBusy(false);
    }
  }

  function BatchTable({ rows, tone }: { rows: BatchRow[]; tone: 'warn' | 'danger' }) {
    return (
      <div style={{ ...card, marginBlockEnd: '0.7rem' }}>
        {rows.map((b) => (
          <div
            key={b.batch_id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              paddingBlock: '0.3rem',
              borderBlockStart: '1px solid var(--tp-border)',
            }}
          >
            <div style={{ flex: 1, minInlineSize: 0 }}>
              <strong>{pickName(locale, b)}</strong>{' '}
              <span style={{ color: 'var(--tp-muted-fg)', fontSize: '0.85rem' }}>
                {b.qty_remaining} {b.unit} · {formatIQD(b.unit_cost_iqd, locale)}/{b.unit}
              </span>
              <div
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  color: tone === 'danger' ? 'var(--tp-danger)' : 'var(--tp-accent-2)',
                }}
              >
                {tone === 'danger'
                  ? tr('op.stock.daysExpired', { days: b.days_expired ?? 0 })
                  : tr('op.stock.daysLeft', { days: b.days_left ?? 0 })}{' '}
                · {b.expiry_date}
              </div>
            </div>
            {tone === 'danger' && (
              <Button kind="danger" disabled={busy} onClick={() => setWriteOff(b)}>
                {tr('op.stock.writeOff')}
              </Button>
            )}
          </div>
        ))}
        {rows.length === 0 && <p style={{ color: 'var(--tp-muted-fg)', margin: 0 }}>{tr('op.common.none')}</p>}
      </div>
    );
  }

  return (
    <div style={{ maxInlineSize: '36rem' }}>
      <h2 style={{ marginBlock: '0.4rem' }}>{tr('op.stock.expiredTitle')}</h2>
      <BatchTable rows={expiredQ.data ?? []} tone="danger" />
      <h2 style={{ marginBlock: '0.4rem' }}>{tr('op.stock.expiringTitle')}</h2>
      <BatchTable rows={expiringQ.data ?? []} tone="warn" />

      {writeOff && (
        <PinReasonModal
          title={tr('op.stock.writeOff')}
          reasons={['expired']}
          busy={busy}
          onSubmit={(pin, reason) => void submitWriteOff(pin, reason)}
          onClose={() => setWriteOff(null)}
        />
      )}
    </div>
  );
}
