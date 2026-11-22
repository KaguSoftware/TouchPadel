/**
 * One rate rule in the stepped dialog every "add new" form uses (StepWizard):
 * Rule, When it applies, Prices, then Review. Adding and editing are the same
 * wizard; an edit starts from the saved rule. Nothing is written until
 * Review's Save (`app.upsert_rate_rule`). A manager, who cannot save a rule,
 * keeps the read-only side panel and "Propose a new rate".
 */
import { useState } from 'react';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, ErrorText, Field, inputStyle, Select } from '../../components/ui';
import { MoneyInput, digitsOnly } from '../../components/inputs';
import { useToast } from '../../components/toast';
import { formatIQD, formatNumber } from '@touch/i18n';
import { MessagePresenter } from '../../components/kit';
import { ReviewList, StepWizard, WizardToggle } from '../../components/StepWizard';
import { DAY_KEYS, type Overlap, type RateRuleLike } from './rateRuleLogic';

/** The saved rule an edit starts from. */
export interface EditableRule extends RateRuleLike {
  name: string;
  court_id: string | null;
  start_time: string;
  end_time: string;
  priority: number;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
  rate_rule_prices: { duration_min: number; price_iqd: number }[];
}

export function RuleWizard({
  rule,
  courts,
  durations,
  ties,
  dayName,
  onSaved,
  onClose,
}: {
  rule: EditableRule | null;
  courts: { id: string; name_en: string; name_ar: string }[];
  durations: number[];
  ties: Overlap[];
  dayName: (d: number) => string;
  onSaved: () => void;
  onClose: () => void;
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

  const anyPrice = Object.values(prices).some((p) => p !== null && p > 0);
  const court = courts.find((c) => c.id === courtId);
  const dayList = DAY_KEYS.map((k, i) => (days.has(i) ? tr(`op.days.${k}`) : null)).filter(Boolean).join(' · ');

  async function submit() {
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

  return (
    <StepWizard
      title={rule ? tr('ws.manager.rates.editRule') : tr('ws.manager.rates.newRule')}
      lead={tr('ws.manager.rates.wizardLead')}
      testId="rate-rule-form"
      onClose={onClose}
      busy={busy}
      submitLabel={tr('common.save')}
      onSubmit={() => void submit()}
      notice={error ? <ErrorText error={error} /> : undefined}
      steps={[
        {
          key: 'rule',
          label: tr('ws.manager.rates.stepRule'),
          note: name.trim() || null,
          problems: name.trim() ? [] : [tr('ws.manager.disabled.namesRequired')],
          content: (
            <>
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
                <input style={inputStyle} value={name} autoFocus onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label={tr('op.rates.court')}>
                <Select
                  value={courtId}
                  onChange={setCourtId}
                  options={[{ value: '', label: tr('op.rates.allCourts') }, ...courts.map((c) => ({ value: c.id, label: pickName(locale, c) }))]}
                />
              </Field>
            </>
          ),
        },
        {
          key: 'when',
          label: tr('ws.manager.rates.stepWhen'),
          note: dayList || null,
          problems: days.size === 0 ? [tr('ws.manager.disabled.daysRequired')] : [],
          content: (
            <>
              <Field label={tr('op.rates.daysLabel')}>
                <div style={{ display: 'flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
                  {DAY_KEYS.map((key, i) => (
                    <Button
                      key={key}
                      size="sm"
                      kind={days.has(i) ? 'primary' : 'default'}
                      aria-pressed={days.has(i)}
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--tp-sp-2-5)' }}>
                <Field label={tr('op.rates.startTime')}>
                  <input style={inputStyle} dir="ltr" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </Field>
                <Field label={tr('op.rates.endTime')}>
                  <input style={inputStyle} dir="ltr" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--tp-sp-2-5)' }}>
                <Field label={tr('op.rates.validFrom')}>
                  <input style={inputStyle} dir="ltr" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
                </Field>
                <Field label={tr('op.rates.validTo')} info={tr('ws.manager.rates.validityHint')}>
                  <input style={inputStyle} dir="ltr" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
                </Field>
              </div>
              <Field label={tr('op.rates.priority')} info={tr('ws.manager.rates.priorityHint')}>
                <input style={{ ...inputStyle, inlineSize: '7rem' }} dir="ltr" inputMode="numeric" value={priority} onChange={(e) => setPriority(Number(digitsOnly(e.target.value)) || 0)} />
              </Field>
            </>
          ),
        },
        {
          key: 'prices',
          label: tr('ws.manager.rates.stepPrices'),
          problems: anyPrice ? [] : [tr('ws.manager.disabled.priceRequired')],
          content: (
            <>
              <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.manager.rates.pricesHint')}</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: 'var(--tp-sp-2-5)', marginBlockEnd: 'var(--tp-sp-3)' }}>
                {durations.map((d) => (
                  <Field key={d} label={tr('op.rates.priceFor', { minutes: d })} style={{ marginBlockEnd: 0 }}>
                    <MoneyInput value={prices[d] ?? null} allowEmpty onChange={(v) => setPrices((prev) => ({ ...prev, [d]: v }))} />
                  </Field>
                ))}
              </div>
              <WizardToggle checked={isActive} onChange={setIsActive} label={tr('op.rates.isActive')} hint={tr('ws.manager.rates.nonDestructive')} />
            </>
          ),
        },
      ]}
      review={(goTo) => (
        <ReviewList
          goTo={goTo}
          busy={busy}
          rows={[
            { label: tr('op.rates.ruleName'), value: <bdi>{name}</bdi>, step: 'rule' },
            { label: tr('op.rates.court'), value: court ? <bdi>{pickName(locale, court)}</bdi> : tr('op.rates.allCourts'), step: 'rule' },
            { label: tr('op.rates.daysLabel'), value: dayList, step: 'when' },
            { label: `${tr('op.rates.startTime')} – ${tr('op.rates.endTime')}`, value: <bdi>{`${startTime} – ${endTime}`}</bdi>, step: 'when' },
            { label: tr('op.rates.priority'), value: formatNumber(priority, locale), step: 'when' },
            {
              label: tr('op.rates.prices'),
              value: (
                <span style={{ display: 'grid' }}>
                  {durations
                    .filter((d) => (prices[d] ?? 0) > 0)
                    .map((d) => (
                      <bdi key={d}>{tr('ws.manager.rates.priceLine', { minutes: formatNumber(d, locale), price: formatIQD(prices[d]!, locale) })}</bdi>
                    ))}
                </span>
              ),
              step: 'prices',
            },
            { label: tr('op.rates.isActive'), value: isActive ? tr('common.yes') : tr('common.no'), step: 'prices' },
          ]}
        />
      )}
    />
  );
}
