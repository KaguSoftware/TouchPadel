/**
 * Day open/close screen — open-day banner, close form (counted cash pad, card
 * batch), blocked states (DAY_OPEN_TABS with the blocking tabs listed,
 * DAY_UNSYNCED) via app.open_day (0015) / app.close_day (0020).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatIQD, formatTime } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { appRpc, AppRpcError } from '../../lib/appRpc';
import { deviceId } from '../../lib/idem';
import { useLocale } from '../../lib/i18n';
import { AmountPad, Button, ErrorText, Field, card, inputStyle } from '../../components/ui';

interface DayRow {
  id: string;
  status: string;
  business_date: string;
  opened_at: string;
  opening_float_iqd: number;
}
interface CloseSummary {
  day_session_id: string;
  business_date: string;
  cash_expected_iqd: number;
  cash_counted_iqd: number;
  cash_variance_iqd: number;
  card_expected_iqd: number;
  card_terminal_batch_iqd: number | null;
}
/** v_day_close_summary (0020) — audit sums with authorizer names. */
interface DayCloseSummaryRow {
  discounts_iqd: number;
  adjustment_count: number;
  authorizer_names: string[] | null;
  voided_lines_iqd: number;
  voided_line_count: number;
  refunds_iqd: number;
  refund_count: number;
  waste_cost_iqd: number;
}

export function DayClose() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const [openingFloat, setOpeningFloat] = useState(0);
  const [countedCash, setCountedCash] = useState(0);
  const [cardBatch, setCardBatch] = useState(0);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<CloseSummary | null>(null);

  const dayQ = useQuery({
    queryKey: ['day'],
    queryFn: async (): Promise<DayRow | null> => {
      const { data, error: err } = await supabase
        .from('day_sessions')
        .select('id, status, business_date, opened_at, opening_float_iqd')
        .in('status', ['open', 'closing'])
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (err) throw err;
      return data as DayRow | null;
    },
  });

  const day = dayQ.data ?? null;

  const openTabsQ = useQuery({
    queryKey: ['dayOpenTabs', day?.id],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('tabs')
        .select('id, status, label, table:cafe_tables(table_number), reservation:reservations(guest_name)')
        .eq('day_session_id', day?.id ?? '')
        .in('status', ['open', 'awaiting_payment']);
      if (err) throw err;
      return data as unknown as {
        id: string;
        status: string;
        label: string | null;
        table: { table_number: string } | null;
        reservation: { guest_name: string | null } | null;
      }[];
    },
    enabled: Boolean(day),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['day'] });
    void queryClient.invalidateQueries({ queryKey: ['dayOpenTabs'] });
    void queryClient.invalidateQueries({ queryKey: ['tabs'] });
  }

  async function openDay() {
    setBusy(true);
    setError(null);
    try {
      await appRpc('open_day', {
        p_opening_float_iqd: openingFloat,
        p_device_id: deviceId(),
      });
      refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function closeDay() {
    setBusy(true);
    setError(null);
    try {
      const res = await appRpc<CloseSummary>('close_day', {
        p_cash_counted_iqd: countedCash,
        p_card_batch_iqd: cardBatch > 0 ? cardBatch : null,
        p_notes: notes || null,
        p_device_id: deviceId(),
      });
      setSummary(res);
      refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const blockedByTabs =
    error instanceof AppRpcError && error.code === 'DAY_OPEN_TABS' ? openTabsQ.data ?? [] : [];

  // Day-close audit summary (v_day_close_summary, 0020): discounts / voids /
  // refunds / waste with authorizer names — rendered after a successful close.
  const auditQ = useQuery({
    queryKey: ['dayCloseSummary', summary?.day_session_id],
    enabled: Boolean(summary),
    queryFn: async (): Promise<DayCloseSummaryRow | null> => {
      const { data, error: err } = await supabase
        .from('v_day_close_summary')
        .select(
          'discounts_iqd, adjustment_count, authorizer_names, voided_lines_iqd, voided_line_count, refunds_iqd, refund_count, waste_cost_iqd',
        )
        .eq('day_session_id', summary?.day_session_id ?? '')
        .maybeSingle();
      if (err) throw err;
      return data as unknown as DayCloseSummaryRow | null;
    },
  });

  if (summary) {
    const audit = auditQ.data ?? null;
    return (
      <div style={{ ...card, maxInlineSize: '26rem' }}>
        <h3 style={{ marginBlockStart: 0 }}>{tr('op.dayClose.closedOk')}</h3>
        <SummaryRow label={tr('op.dayClose.cashExpected')} value={formatIQD(summary.cash_expected_iqd, locale)} />
        <SummaryRow label={tr('op.dayClose.cashCounted')} value={formatIQD(summary.cash_counted_iqd, locale)} />
        <SummaryRow
          label={tr('op.dayClose.variance')}
          value={`${summary.cash_variance_iqd < 0 ? '−' : ''}${formatIQD(Math.abs(summary.cash_variance_iqd), locale)}`}
        />
        <SummaryRow label={tr('op.dayClose.cardExpected')} value={formatIQD(summary.card_expected_iqd, locale)} />
        {summary.card_terminal_batch_iqd != null && (
          <SummaryRow label={tr('op.dayClose.cardBatch')} value={formatIQD(summary.card_terminal_batch_iqd, locale)} />
        )}
        {audit && (
          <>
            <hr style={{ border: 'none', borderBlockStart: '1px solid var(--tp-border)' }} />
            <h4 style={{ marginBlock: '0.3rem', fontSize: '0.95rem' }}>{tr('op.dayClose.summaryTitle')}</h4>
            <SummaryRow
              label={tr('op.dayClose.discounts', { count: audit.adjustment_count })}
              value={formatIQD(audit.discounts_iqd, locale)}
            />
            <SummaryRow
              label={tr('op.dayClose.voids', { count: audit.voided_line_count })}
              value={formatIQD(audit.voided_lines_iqd, locale)}
            />
            <SummaryRow
              label={tr('op.dayClose.refunds', { count: audit.refund_count })}
              value={formatIQD(audit.refunds_iqd, locale)}
            />
            <SummaryRow label={tr('op.dayClose.waste')} value={formatIQD(audit.waste_cost_iqd, locale)} />
            {(audit.authorizer_names ?? []).length > 0 && (
              <p style={{ marginBlock: '0.3rem', fontSize: '0.85rem', color: 'var(--tp-muted-fg)' }}>
                {tr('op.dayClose.authorizedBy', {
                  names: (audit.authorizer_names ?? []).join(locale === 'ar' ? '، ' : ', '),
                })}
              </p>
            )}
          </>
        )}
      </div>
    );
  }

  if (dayQ.isSuccess && !day) {
    return (
      <div style={{ ...card, maxInlineSize: '26rem' }}>
        <h3 style={{ marginBlockStart: 0 }}>{tr('op.dayClose.openDayTitle')}</h3>
        <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('op.dayClose.noOpenDay')}</p>
        <Field label={tr('op.dayClose.openingFloat')}>
          <input
            style={{ ...inputStyle, textAlign: 'end', fontSize: '1.2rem' }}
            dir="ltr"
            inputMode="numeric"
            value={openingFloat}
            onChange={(e) => setOpeningFloat(Number(e.target.value.replace(/\D/g, '')) || 0)}
          />
        </Field>
        <div style={{ display: 'flex', justifyContent: 'center', marginBlockEnd: '0.6rem' }}>
          <AmountPad value={openingFloat} onChange={setOpeningFloat} />
        </div>
        <ErrorText error={error} />
        <Button kind="primary" disabled={busy} onClick={() => void openDay()}>
          {tr('op.dayClose.openDayBtn')}
        </Button>
      </div>
    );
  }

  if (!day) return <p>{tr('common.loading')}</p>;

  return (
    <div style={{ maxInlineSize: '30rem' }}>
      <div
        style={{
          ...card,
          background: 'var(--tp-accent)',
          color: 'var(--tp-accent-contrast)',
          marginBlockEnd: '0.7rem',
        }}
      >
        {tr('op.dayClose.openBanner', {
          time: formatTime(new Date(day.opened_at), locale),
          float: formatIQD(day.opening_float_iqd, locale),
        })}
      </div>

      {(openTabsQ.data ?? []).length > 0 && (
        <div style={{ ...card, marginBlockEnd: '0.7rem' }}>
          <strong>{tr('op.dayClose.blockedTabs')}</strong>
          <ul style={{ marginBlock: '0.3rem', paddingInlineStart: '1.2rem' }}>
            {(openTabsQ.data ?? []).map((tb) => (
              <li key={tb.id}>
                {tb.table
                  ? `${tr('op.till.table')} ${tb.table.table_number}`
                  : (tb.reservation?.guest_name ?? tb.label ?? tb.id.slice(0, 8))}
                {tb.status === 'awaiting_payment' && ' ⏳'}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={card}>
        <h3 style={{ marginBlockStart: 0 }}>{tr('op.admin.dayCloseTab')}</h3>
        <Field label={tr('op.dayClose.countedCash')}>
          <input
            style={{ ...inputStyle, textAlign: 'end', fontSize: '1.2rem' }}
            dir="ltr"
            inputMode="numeric"
            value={countedCash}
            onChange={(e) => setCountedCash(Number(e.target.value.replace(/\D/g, '')) || 0)}
          />
        </Field>
        <div style={{ display: 'flex', justifyContent: 'center', marginBlockEnd: '0.6rem' }}>
          <AmountPad value={countedCash} onChange={setCountedCash} />
        </div>
        <Field label={tr('op.dayClose.cardBatch')}>
          <input
            style={{ ...inputStyle, textAlign: 'end' }}
            dir="ltr"
            inputMode="numeric"
            value={cardBatch}
            onChange={(e) => setCardBatch(Number(e.target.value.replace(/\D/g, '')) || 0)}
          />
        </Field>
        <Field label={tr('op.common.notes')}>
          <input style={inputStyle} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <ErrorText error={error} />
        {blockedByTabs.length > 0 && (
          <p style={{ color: 'var(--tp-danger)', fontSize: '0.85rem' }}>
            {tr('op.errors.DAY_OPEN_TABS')}
          </p>
        )}
        <Button kind="danger" disabled={busy} onClick={() => void closeDay()}>
          {tr('op.dayClose.closeBtn')}
        </Button>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBlockEnd: '0.2rem' }}>
      <span>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{value}</span>
    </div>
  );
}
