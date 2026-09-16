/**
 * Rates editor (spec 06.25) — court rate rules by weekday, time window and
 * court. List + form over `app.upsert_rate_rule` (0013): p_prices is
 * {"<duration_min>": <price_iqd>} and replaces the rule's prices wholesale.
 *
 * Non-destructive by design (0007 "price provenance"): every booking stores
 * the rule that priced it, so editing a rule never changes a historical
 * price. That is said ONCE, beside Save, where it answers the worry a manager
 * has at that moment; it used to be the page lead, a banner on the form and
 * the hint beside Save, three times.
 *
 * WARNINGS ARE FOR TIES ONLY. `app.price_slot` settles overlaps by court
 * specificity, then priority, so a peak rule over a base rule is the rate card
 * working as designed. The old screen listed every such overlap — a muted
 * wall of "X — Overlaps Y (Sun)" lines above the rules on any real rate card —
 * which hid the one case that needs a person: two rules that tie
 * (rateRuleLogic.rulesTie). The rule for how overlaps resolve is one sentence
 * under the table instead.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatIQD, formatNumber } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import { QK, fetchActiveCourts, type CourtRow } from '../../lib/queries';
import { useLocale, pickName } from '../../lib/i18n';
import { usePermissions, requiredRoleFor } from '../../lib/auth';
import { Button, ErrorText, Field, inputStyle } from '../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  MessagePresenter,
  PageHeader,
  Panel,
  PermissionRefusedNotice,
  StatusBadge,
  TableSkeleton,
  asyncStatus,
  type Column,
} from '../../components/kit';
import { Icon } from '../../components/icons';
import { MoneyInput } from '../../components/inputs';
import { Switch } from '../../components/Switch';
import { useToast } from '../../components/toast';
import { MARK_FG, MARK_SOFT } from '../ops/OpsVisuals';
import { DAY_KEYS, coversEveryDay, findTies, tiesFor, type Overlap, type RateRuleLike } from './rateRuleLogic';

interface RuleRow extends RateRuleLike {
  rate_rule_prices: { duration_min: number; price_iqd: number }[];
}

const RATE_RULES_KEY = ['rateRules'] as const;
const NO_RULES: RuleRow[] = [];
const NO_COURTS: CourtRow[] = [];

export function RateRuleEditor() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const can = usePermissions();
  const [selected, setSelected] = useState<RuleRow | 'new' | null>(null);
  const [showOff, setShowOff] = useState(false);

  const rulesQ = useQuery({
    queryKey: RATE_RULES_KEY,
    queryFn: async (): Promise<RuleRow[]> => {
      const { data, error } = await supabase
        .from('rate_rules')
        .select('*, rate_rule_prices(duration_min, price_iqd)')
        .order('priority', { ascending: false });
      if (error) throw error;
      return data as unknown as RuleRow[];
    },
  });

  // Shared fetcher — this selected one column fewer than the desk calendar
  // under the same key, so the grid could lose the field it orders by.
  const courtsQ = useQuery({ queryKey: QK.courts, queryFn: fetchActiveCourts });
  const courts = courtsQ.data ?? NO_COURTS;
  const courtName = (id: string | null) => (id ? pickName(locale, courts.find((c) => c.id === id)) || id.slice(0, 8) : tr('ws.manager.rates.allCourts'));

  const durations = useMemo(() => {
    const set = new Set<number>([60, 90, 120]);
    for (const c of courts) for (const d of c.duration_options) set.add(d);
    return [...set].sort((a, b) => a - b);
  }, [courts]);

  const rules = rulesQ.data ?? NO_RULES;
  const ties = useMemo(() => findTies(rules), [rules]);
  const tiedIds = useMemo(() => new Set(ties.flatMap((t) => [t.ruleId, t.otherId])), [ties]);
  // Switched-off rules price nothing; they are kept for history and folded
  // away so the table is the rate card that is actually in force.
  const offCount = rules.filter((r) => !r.is_active).length;
  const shown = showOff ? rules : rules.filter((r) => r.is_active);
  const status = asyncStatus(rulesQ, (rows) => rows.length === 0);
  const dayName = (d: number) => tr(`op.days.${DAY_KEYS[d] ?? 'sun'}`);

  const columns: Column<RuleRow>[] = [
    {
      key: 'name',
      header: tr('ws.manager.rates.rule'),
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', fontWeight: 600, color: r.is_active ? undefined : 'var(--tp-muted-fg)' }}>
          <bdi>{r.name}</bdi>
          {!r.is_active && <StatusBadge size="sm" tone="neutral" dot={false} label={tr('ws.manager.rates.off')} />}
          {tiedIds.has(r.id) && <StatusBadge size="sm" tone="warn" icon="alert" label={tr('ws.manager.rates.tieBadge')} />}
        </span>
      ),
    },
    { key: 'court', header: tr('ws.manager.rates.court'), render: (r) => <bdi>{courtName(r.court_id)}</bdi> },
    {
      key: 'days',
      header: tr('ws.manager.rates.days'),
      render: (r) => (coversEveryDay(r.days_of_week) ? tr('ws.manager.rates.everyDay') : r.days_of_week.map(dayName).join(' ')),
    },
    { key: 'window', header: tr('ws.manager.rates.window'), render: (r) => <span dir="ltr">{r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)}</span> },
    {
      key: 'prices',
      header: tr('ws.manager.rates.prices'),
      render: (r) => (
        <span style={{ display: 'grid', fontVariantNumeric: 'tabular-nums', fontSize: 'var(--tp-fs-sm)' }}>
          {[...r.rate_rule_prices]
            .sort((a, b) => a.duration_min - b.duration_min)
            .map((p) => (
              <bdi key={p.duration_min}>{tr('ws.manager.rates.priceLine', { minutes: formatNumber(p.duration_min, locale), price: formatIQD(p.price_iqd, locale) })}</bdi>
            ))}
        </span>
      ),
    },
    { key: 'priority', header: tr('ws.manager.rates.priority'), numeric: true, render: (r) => formatNumber(r.priority, locale) },
  ];

  return (
    <div>
      <PageHeader
        title={tr('ws.manager.rates.title')}
        subtitle={tr('ws.manager.rates.lead')}
        actions={
          <Button kind="primary" icon="plus" disabled={!can.editRates} onClick={() => setSelected('new')}>
            {tr('ws.manager.rates.newRule')}
          </Button>
        }
      >
        {!can.editRates && <PermissionRefusedNotice action={tr('ws.manager.rates.newRule')} requiredRole={requiredRoleFor('editRates')} />}
      </PageHeader>

      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', gridTemplateColumns: selected ? 'minmax(0, 1.4fr) minmax(22rem, 1fr)' : '1fr', alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', minInlineSize: 0 }}>
          {ties.length > 0 && <TieList ties={ties} rules={rules} dayName={dayName} onOpen={(r) => setSelected(r)} />}
          <AsyncStateWrapper
            status={status}
            error={rulesQ.error}
            onRetry={() => void rulesQ.refetch()}
            skeleton={<TableSkeleton columns={columns} />}
            emptyContent={
              <EmptyState
                icon="court"
                title={tr('ws.manager.rates.empty')}
                body={tr('ws.manager.rates.emptyBody')}
                action={
                  <Button kind="primary" icon="plus" disabled={!can.editRates} onClick={() => setSelected('new')}>
                    {tr('ws.manager.rates.newRule')}
                  </Button>
                }
              />
            }
          >
            <DataTable
              columns={columns}
              rows={shown}
              rowKey={(r) => r.id}
              selectedKey={selected && selected !== 'new' ? selected.id : null}
              onRowClick={(r) => setSelected(r)}
              aria-label={tr('ws.manager.rates.title')}
            />
            <div style={{ display: 'flex', gap: 'var(--tp-sp-3)', alignItems: 'center', flexWrap: 'wrap', marginBlockStart: 'var(--tp-sp-2)' }}>
              <p style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0 }}>
                <Icon name="info" size={14} />
                {tr('ws.manager.rates.howChosen')}
              </p>
              {offCount > 0 && (
                <Button size="sm" kind="ghost" style={{ marginInlineStart: 'auto' }} onClick={() => setShowOff((v) => !v)}>
                  {showOff ? tr('ws.manager.rates.hideOff') : tr('ws.manager.rates.showOff', { count: formatNumber(offCount, locale) })}
                </Button>
              )}
            </div>
          </AsyncStateWrapper>
        </div>

        {selected && (
          <RuleForm
            key={selected === 'new' ? 'new' : selected.id}
            rule={selected === 'new' ? null : selected}
            courts={courts}
            durations={durations}
            ties={selected === 'new' ? [] : tiesFor(ties, rules, selected.id)}
            dayName={dayName}
            readOnly={!can.editRates}
            onSaved={() => {
              setSelected(null);
              void queryClient.invalidateQueries({ queryKey: RATE_RULES_KEY });
            }}
            onCancel={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}

/** Route alias for the spec name. */
export const RatesEditorScreen = RateRuleEditor;

const TIES_SHOWN = 5;

/** The pairs that tie, each name a way into that rule. */
function TieList({
  ties,
  rules,
  dayName,
  onOpen,
}: {
  ties: readonly Overlap[];
  rules: readonly RuleRow[];
  dayName: (d: number) => string;
  onOpen: (r: RuleRow) => void;
}) {
  const { tr, locale } = useLocale();
  const [all, setAll] = useState(false);
  // The first few pairs are enough to act on; the rest fold so a long list
  // never pushes the rate card itself below the fold.
  const listed = all ? ties : ties.slice(0, TIES_SHOWN);
  const ruleLink = (id: string) => {
    const r = rules.find((x) => x.id === id);
    if (!r) return <bdi>{id}</bdi>;
    return (
      <button type="button" className="tp-link" onClick={() => onOpen(r)} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 600, color: 'var(--tp-accent)', cursor: 'pointer' }}>
        <bdi>{r.name}</bdi>
      </button>
    );
  };
  return (
    <Panel
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
          <span style={{ minInlineSize: '1.75rem', textAlign: 'center', paddingInline: 'var(--tp-sp-1)', borderRadius: 'var(--tp-radius-ctl)', background: MARK_SOFT.warn, color: MARK_FG.warn }}>
            {formatNumber(ties.length, locale)}
          </span>
          {tr('ws.manager.rates.tieTitle')}
        </span>
      }
    >
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.manager.rates.tieLead')}</p>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-sm)' }}>
        {listed.map((t) => (
          <li key={`${t.ruleId}|${t.otherId}`} style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', alignItems: 'baseline' }}>
            {ruleLink(t.ruleId)}
            <Icon name="split" size={13} style={{ color: 'var(--tp-muted-fg)' }} />
            {ruleLink(t.otherId)}
            <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.rates.tieFrom', { day: dayName(t.weekday) })}</span>
          </li>
        ))}
      </ul>
      {ties.length > TIES_SHOWN && (
        <Button size="sm" kind="ghost" style={{ marginBlockStart: 'var(--tp-sp-2)' }} onClick={() => setAll((v) => !v)}>
          {all ? tr('ws.manager.rates.tiesFewer') : tr('ws.manager.rates.tiesAll', { count: formatNumber(ties.length, locale) })}
        </Button>
      )}
    </Panel>
  );
}

function RuleForm({
  rule,
  courts,
  durations,
  ties,
  dayName,
  readOnly,
  onSaved,
  onCancel,
}: {
  rule: RuleRow | null;
  courts: { id: string; name_en: string; name_ar: string }[];
  durations: number[];
  ties: Overlap[];
  dayName: (d: number) => string;
  readOnly: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const [name, setName] = useState(rule?.name ?? '');
  const [courtId, setCourtId] = useState(rule?.court_id ?? '');
  const [days, setDays] = useState<Set<number>>(new Set(rule?.days_of_week ?? [0, 1, 2, 3, 4, 5, 6]));
  const [startTime, setStartTime] = useState(rule?.start_time?.slice(0, 5) ?? '09:00');
  const [endTime, setEndTime] = useState(rule?.end_time?.slice(0, 5) ?? '23:00');
  const [priority, setPriority] = useState(rule?.priority ?? 0);
  const [validFrom, setValidFrom] = useState(rule?.valid_from ?? '');
  const [validTo, setValidTo] = useState(rule?.valid_to ?? '');
  const [isActive, setIsActive] = useState(rule?.is_active ?? true);
  const [prices, setPrices] = useState<Record<number, number | null>>(() => {
    const init: Record<number, number | null> = {};
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
        if (price !== null && price > 0) priceObj[dur] = price;
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
      toast.ok(tr('ws.manager.rates.saved'));
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const anyPrice = Object.values(prices).some((p) => p !== null && p > 0);

  return (
    <Panel
      title={rule ? tr('ws.manager.rates.editRule') : tr('ws.manager.rates.newRule')}
      actions={rule && !rule.is_active ? <StatusBadge size="sm" tone="neutral" dot={false} label={tr('ws.manager.rates.off')} /> : undefined}
    >
      {ties.map((t) => (
        <MessagePresenter
          key={t.otherId}
          tone="refused"
          icon="alert"
          style={{ marginBlockEnd: 'var(--tp-sp-3)' }}
          message={tr('ws.manager.rates.tieInForm', { name: t.otherName, day: dayName(t.weekday) })}
        />
      ))}

      <Field label={tr('op.rates.ruleName')} required>
        <input style={inputStyle} value={name} disabled={readOnly} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={tr('op.rates.court')}>
        <select style={inputStyle} value={courtId} disabled={readOnly} onChange={(e) => setCourtId(e.target.value)}>
          <option value="">{tr('op.rates.allCourts')}</option>
          {courts.map((c) => (
            <option key={c.id} value={c.id}>
              {pickName(locale, c)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={tr('op.rates.daysLabel')}>
        <div style={{ display: 'flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
          {DAY_KEYS.map((key, i) => (
            <Button
              key={key}
              size="sm"
              kind={days.has(i) ? 'primary' : 'default'}
              aria-pressed={days.has(i)}
              disabled={readOnly}
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 5rem', gap: 'var(--tp-sp-2-5)' }}>
        <Field label={tr('op.rates.startTime')}>
          <input style={inputStyle} dir="ltr" type="time" value={startTime} disabled={readOnly} onChange={(e) => setStartTime(e.target.value)} />
        </Field>
        <Field label={tr('op.rates.endTime')}>
          <input style={inputStyle} dir="ltr" type="time" value={endTime} disabled={readOnly} onChange={(e) => setEndTime(e.target.value)} />
        </Field>
        <Field label={tr('op.rates.priority')} hint={tr('ws.manager.rates.priorityHint')}>
          <input style={inputStyle} dir="ltr" type="number" value={priority} disabled={readOnly} onChange={(e) => setPriority(Number(e.target.value) || 0)} />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--tp-sp-2-5)' }}>
        <Field label={tr('op.rates.validFrom')}>
          <input style={inputStyle} dir="ltr" type="date" value={validFrom} disabled={readOnly} onChange={(e) => setValidFrom(e.target.value)} />
        </Field>
        <Field label={tr('op.rates.validTo')} hint={tr('ws.manager.rates.validityHint')}>
          <input style={inputStyle} dir="ltr" type="date" value={validTo} disabled={readOnly} onChange={(e) => setValidTo(e.target.value)} />
        </Field>
      </div>

      <fieldset style={{ border: 'none', padding: 0, margin: 0, marginBlockEnd: 'var(--tp-sp-3)' }}>
        <legend style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600, marginBlockEnd: 'var(--tp-sp-1)' }}>{tr('op.rates.prices')}</legend>
        <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.manager.rates.pricesHint')}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: 'var(--tp-sp-2-5)' }}>
          {durations.map((d) => (
            <Field key={d} label={tr('op.rates.priceFor', { minutes: d })} style={{ marginBlockEnd: 0 }}>
              <MoneyInput value={prices[d] ?? null} allowEmpty disabled={readOnly} onChange={(v) => setPrices((prev) => ({ ...prev, [d]: v }))} />
            </Field>
          ))}
        </div>
      </fieldset>

      <div style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>
        <Switch checked={isActive} disabled={readOnly} onChange={setIsActive} label={tr('op.rates.isActive')} />
      </div>
      <ErrorText error={error} />
      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', justifyContent: 'flex-end', alignItems: 'center' }}>
        <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginInlineEnd: 'auto' }}>{tr('ws.manager.rates.nonDestructive')}</span>
        <Button onClick={onCancel} disabled={busy}>
          {tr('common.cancel')}
        </Button>
        <Button
          kind="primary"
          icon="check"
          busy={busy}
          disabled={readOnly || !name || days.size === 0 || !anyPrice}
          disabledReason={
            !name
              ? tr('ws.manager.disabled.namesRequired')
              : days.size === 0
                ? tr('ws.manager.disabled.daysRequired')
                : !anyPrice
                  ? tr('ws.manager.disabled.priceRequired')
                  : undefined
          }
          onClick={() => void save()}
        >
          {tr('common.save')}
        </Button>
      </div>
    </Panel>
  );
}
