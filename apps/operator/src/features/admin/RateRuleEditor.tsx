/**
 * Admin rate-rule editor — list + form calling app.upsert_rate_rule (0013).
 * p_prices is {"<duration_min>": <price_iqd>} and replaces the rule's prices
 * wholesale.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatIQD } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, ErrorText, Field, card, inputStyle } from '../../components/ui';

interface RuleRow {
  id: string;
  name: string;
  court_id: string | null;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  priority: number;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
  rate_rule_prices: { duration_min: number; price_iqd: number }[];
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export function RateRuleEditor() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<RuleRow | 'new' | null>(null);

  const rulesQ = useQuery({
    queryKey: ['rateRules'],
    queryFn: async (): Promise<RuleRow[]> => {
      const { data, error } = await supabase
        .from('rate_rules')
        .select('*, rate_rule_prices(duration_min, price_iqd)')
        .order('priority', { ascending: false });
      if (error) throw error;
      return data as unknown as RuleRow[];
    },
  });

  const courtsQ = useQuery({
    queryKey: ['courts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('courts')
        .select('id, name_en, name_ar, duration_options')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return data as unknown as { id: string; name_en: string; name_ar: string; duration_options: number[] }[];
    },
  });

  const durations = useMemo(() => {
    const set = new Set<number>([60, 90, 120]);
    for (const c of courtsQ.data ?? []) for (const d of c.duration_options) set.add(d);
    return [...set].sort((a, b) => a - b);
  }, [courtsQ.data]);

  return (
    <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ inlineSize: '18rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>{tr('op.rates.rules')}</h3>
          <Button onClick={() => setSelected('new')}>{tr('op.rates.newRule')}</Button>
        </div>
        {(rulesQ.data ?? []).map((r) => (
          <Button
            key={r.id}
            kind={selected !== 'new' && selected?.id === r.id ? 'primary' : 'default'}
            style={{
              display: 'block',
              inlineSize: '100%',
              textAlign: 'start',
              marginBlockStart: '0.3rem',
              opacity: r.is_active ? 1 : 0.5,
            }}
            onClick={() => setSelected(r)}
          >
            {r.name}
            <span style={{ display: 'block', fontSize: '0.75rem', color: 'inherit', opacity: 0.8 }}>
              {r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)} ·{' '}
              {r.rate_rule_prices.map((p) => `${p.duration_min}′ ${formatIQD(p.price_iqd, locale)}`).join(' / ')}
            </span>
          </Button>
        ))}
      </div>
      {selected && (
        <RuleForm
          key={selected === 'new' ? 'new' : selected.id}
          rule={selected === 'new' ? null : selected}
          courts={courtsQ.data ?? []}
          durations={durations}
          onSaved={() => {
            setSelected(null);
            void queryClient.invalidateQueries({ queryKey: ['rateRules'] });
          }}
          onCancel={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function RuleForm({
  rule,
  courts,
  durations,
  onSaved,
  onCancel,
}: {
  rule: RuleRow | null;
  courts: { id: string; name_en: string; name_ar: string }[];
  durations: number[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { tr, locale } = useLocale();
  const [name, setName] = useState(rule?.name ?? '');
  const [courtId, setCourtId] = useState(rule?.court_id ?? '');
  const [days, setDays] = useState<Set<number>>(new Set(rule?.days_of_week ?? [0, 1, 2, 3, 4, 5, 6]));
  const [startTime, setStartTime] = useState(rule?.start_time?.slice(0, 5) ?? '09:00');
  const [endTime, setEndTime] = useState(rule?.end_time?.slice(0, 5) ?? '23:00');
  const [priority, setPriority] = useState(rule?.priority ?? 0);
  const [validFrom, setValidFrom] = useState(rule?.valid_from ?? '');
  const [validTo, setValidTo] = useState(rule?.valid_to ?? '');
  const [isActive, setIsActive] = useState(rule?.is_active ?? true);
  const [prices, setPrices] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = {};
    for (const p of rule?.rate_rule_prices ?? []) init[p.duration_min] = p.price_iqd;
    return init;
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const priceObj: Record<string, number> = {};
      for (const [dur, price] of Object.entries(prices)) {
        if (price > 0) priceObj[dur] = price;
      }
      await appRpc('upsert_rate_rule', {
        p_id: rule?.id ?? null,
        p_name: name,
        p_court_id: courtId || null,
        p_days_of_week: [...days].sort((a, b) => a - b),
        p_start_time: startTime,
        p_end_time: endTime,
        p_prices: priceObj,
        p_priority: priority,
        p_valid_from: validFrom || null,
        p_valid_to: validTo || null,
        p_is_active: isActive,
      });
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ ...card, flex: 1, minInlineSize: '22rem' }}>
      <h3 style={{ marginBlockStart: 0 }}>{rule ? rule.name : tr('op.rates.newRule')}</h3>
      <Field label={tr('op.rates.ruleName')}>
        <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={tr('op.rates.court')}>
        <select style={inputStyle} value={courtId} onChange={(e) => setCourtId(e.target.value)}>
          <option value="">{tr('op.rates.allCourts')}</option>
          {courts.map((c) => (
            <option key={c.id} value={c.id}>
              {pickName(locale, c)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={tr('op.rates.daysLabel')}>
        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
          {DAY_KEYS.map((key, i) => (
            <Button
              key={key}
              kind={days.has(i) ? 'primary' : 'default'}
              onClick={() =>
                setDays((prev) => {
                  const next = new Set(prev);
                  if (next.has(i)) next.delete(i);
                  else next.add(i);
                  return next;
                })
              }
            >
              {tr(`op.days.${key}`)}
            </Button>
          ))}
        </div>
      </Field>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <Field label={tr('op.rates.startTime')}>
          <input style={inputStyle} dir="ltr" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </Field>
        <Field label={tr('op.rates.endTime')}>
          <input style={inputStyle} dir="ltr" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </Field>
        <Field label={tr('op.rates.priority')}>
          <input
            style={{ ...inputStyle, inlineSize: '5rem' }}
            dir="ltr"
            type="number"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value) || 0)}
          />
        </Field>
      </div>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <Field label={tr('op.rates.validFrom')}>
          <input style={inputStyle} dir="ltr" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </Field>
        <Field label={tr('op.rates.validTo')}>
          <input style={inputStyle} dir="ltr" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
        </Field>
      </div>
      <h4 style={{ marginBlockEnd: '0.3rem' }}>{tr('op.rates.prices')}</h4>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        {durations.map((d) => (
          <Field key={d} label={tr('op.rates.priceFor', { minutes: d })}>
            <input
              style={{ ...inputStyle, inlineSize: '8rem' }}
              dir="ltr"
              type="number"
              min={0}
              value={prices[d] ?? 0}
              onChange={(e) =>
                setPrices((prev) => ({ ...prev, [d]: Math.max(0, Number(e.target.value) || 0) }))
              }
            />
          </Field>
        ))}
      </div>
      <label style={{ display: 'flex', gap: '0.4rem', marginBlockEnd: '0.5rem' }}>
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        {tr('op.rates.isActive')}
      </label>
      <ErrorText error={error} />
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <Button onClick={onCancel}>{tr('common.cancel')}</Button>
        <Button
          kind="primary"
          disabled={busy || !name || days.size === 0 || Object.values(prices).every((p) => !p)}
          onClick={() => void save()}
        >
          {tr('common.save')}
        </Button>
      </div>
    </div>
  );
}
