/**
 * Gender hours (0353, Majed 2026-10-19): courts kept for women or men at set
 * times, and hours when every court is. The rate card's sibling, built the
 * same way (RateRuleEditor): a table of rules and a form beside it over
 * `app.upsert_court_gender_rule`. No prices and no priority: a rule keeps a
 * court or it does not.
 *
 * "Every court" (court_id null) is the whole-club case ("Friday mornings are
 * women only"), so the court field says what it means under the choice.
 *
 * CLASHES, NOT OVERLAPS. Two women's rules over the same time are harmless; a
 * women's rule and a men's rule over the same court and time mean nobody can
 * book it (the server answers "both"). Those pairs are listed above the table,
 * as the rates page lists ties (findGenderClashes in @touch/core).
 *
 * A manager or the owner saves (`editGenderRules`): this is not a price, so no
 * protocol. Rules are switched off, never deleted.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { findGenderClashes, type GenderRuleClash } from '@touch/core';
import { formatNumber } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { QK, fetchActiveCourts, fetchGenderRules, type CourtRow, type GenderRuleRow } from '../../../lib/queries';
import { useLocale, pickName } from '../../../lib/i18n';
import { usePermissions, requiredRoleFor } from '../../../lib/auth';
import { Button, ErrorText, Field, inputStyle, Select } from '../../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  MessagePresenter,
  PageHeader,
  Panel,
  PermissionRefusedNotice,
  SegmentedControl,
  StatusBadge,
  TableSkeleton,
  asyncStatus,
  type Column,
} from '../../../components/kit';
import { Icon } from '../../../components/icons';
import { Switch } from '../../../components/Switch';
import { useToast } from '../../../components/toast';
import { MARK_FG, MARK_SOFT } from '../../ops/OpsVisuals';
import { DAY_KEYS, coversEveryDay, dayRuns } from '../rateRuleLogic';
import { clashesFor, saveBlock, windowParts, type ClashFromSide, type GenderChoice } from './genderHoursLogic';

const NO_RULES: GenderRuleRow[] = [];
const NO_COURTS: CourtRow[] = [];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export function GenderHoursEditor() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const can = usePermissions();
  const [selected, setSelected] = useState<GenderRuleRow | 'new' | null>(null);
  const [showOff, setShowOff] = useState(false);

  const rulesQ = useQuery({ queryKey: QK.genderRules, queryFn: fetchGenderRules });
  const courtsQ = useQuery({ queryKey: QK.courts, queryFn: fetchActiveCourts });
  const courts = courtsQ.data ?? NO_COURTS;
  const courtName = (id: string | null) =>
    id ? pickName(locale, courts.find((c) => c.id === id)) || id.slice(0, 8) : tr('ws.genderHours.page.everyCourt');

  const rules = rulesQ.data ?? NO_RULES;
  const clashes = useMemo(() => findGenderClashes(rules), [rules]);
  const clashIds = useMemo(() => new Set(clashes.flatMap((c) => [c.ruleId, c.otherId])), [clashes]);
  // Switched-off rules keep nothing; folded away like the rate card's.
  const offCount = rules.filter((r) => !r.is_active).length;
  const shown = showOff ? rules : rules.filter((r) => r.is_active);
  const status = asyncStatus(rulesQ, (rows) => rows.length === 0);
  const dayName = (d: number) => tr(`op.days.${DAY_KEYS[d] ?? 'sun'}`);

  const columns: Column<GenderRuleRow>[] = [
    {
      key: 'name',
      header: tr('ws.genderHours.page.rule'),
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', fontWeight: 600, color: r.is_active ? undefined : 'var(--tp-muted-fg)' }}>
          <bdi>{r.name}</bdi>
          {!r.is_active && <StatusBadge size="sm" tone="neutral" dot={false} label={tr('ws.genderHours.page.off')} />}
          {clashIds.has(r.id) && <StatusBadge size="sm" tone="warn" icon="alert" label={tr('ws.genderHours.page.clashBadge')} />}
        </span>
      ),
    },
    {
      key: 'who',
      header: tr('ws.genderHours.page.who'),
      render: (r) => (
        <span style={{ whiteSpace: 'nowrap' }}>{tr(r.gender === 'female' ? 'ws.genderHours.page.womenOnly' : 'ws.genderHours.page.menOnly')}</span>
      ),
    },
    {
      key: 'court',
      header: tr('ws.genderHours.page.court'),
      // Every court is the whole club: said in weight, so it is not read as one more court name.
      render: (r) => (r.court_id ? <bdi>{courtName(r.court_id)}</bdi> : <strong>{courtName(null)}</strong>),
    },
    {
      key: 'days',
      header: tr('ws.genderHours.page.days'),
      render: (r) =>
        coversEveryDay(r.days_of_week) ? (
          <span style={{ whiteSpace: 'nowrap' }}>{tr('ws.genderHours.page.everyDay')}</span>
        ) : (
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', columnGap: 'var(--tp-sp-1-5)' }}>
            {dayRuns(r.days_of_week).map((run) =>
              'day' in run ? (
                <span key={run.day}>{dayName(run.day)}</span>
              ) : (
                <span key={run.from} style={{ whiteSpace: 'nowrap' }}>
                  {dayName(run.from)}–{dayName(run.to)}
                </span>
              ),
            )}
          </span>
        ),
    },
    {
      key: 'window',
      header: tr('ws.genderHours.page.window'),
      render: (r) => {
        const w = windowParts(r);
        return (
          <span style={{ whiteSpace: 'nowrap' }}>
            <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {w.from}–{w.to}
            </span>
            {w.overnight && (
              <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', marginInlineStart: 'var(--tp-sp-1)' }}>
                ({tr('ws.genderHours.page.nextDay')})
              </span>
            )}
          </span>
        );
      },
    },
  ];

  const newRuleButton = (
    <Button kind="primary" icon="plus" disabled={!can.editGenderRules} onClick={() => setSelected('new')} data-testid="gender-hours-new">
      {tr('ws.genderHours.page.newRule')}
    </Button>
  );

  return (
    <div>
      <PageHeader title={tr('ws.genderHours.page.title')} subtitle={tr('ws.genderHours.page.lead')} actions={newRuleButton}>
        {!can.editGenderRules && (
          <PermissionRefusedNotice action={tr('ws.genderHours.page.newRule')} requiredRole={requiredRoleFor('editGenderRules')} />
        )}
      </PageHeader>

      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', gridTemplateColumns: selected ? 'minmax(0, 1.4fr) minmax(22rem, 1fr)' : '1fr', alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', minInlineSize: 0 }}>
          {clashes.length > 0 && <ClashList clashes={clashes} rules={rules} dayName={dayName} onOpen={(r) => setSelected(r)} />}
          <AsyncStateWrapper
            status={status}
            error={rulesQ.error}
            onRetry={() => void rulesQ.refetch()}
            skeleton={<TableSkeleton columns={columns} />}
            emptyContent={
              <EmptyState
                icon="court"
                title={tr('ws.genderHours.page.empty')}
                body={tr('ws.genderHours.page.emptyBody')}
                action={newRuleButton}
              />
            }
          >
            <DataTable
              columns={columns}
              rows={shown}
              rowKey={(r) => r.id}
              selectedKey={selected && selected !== 'new' ? selected.id : null}
              onRowClick={(r) => setSelected(r)}
              aria-label={tr('ws.genderHours.page.title')}
            />
            <div style={{ display: 'flex', gap: 'var(--tp-sp-3)', alignItems: 'center', flexWrap: 'wrap', marginBlockStart: 'var(--tp-sp-2)' }}>
              <p style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0, maxInlineSize: '70ch' }}>
                <Icon name="info" size={14} style={{ flexShrink: 0 }} />
                {tr('ws.genderHours.page.howApplied')}
              </p>
              {offCount > 0 && (
                <Button size="sm" kind="ghost" style={{ marginInlineStart: 'auto' }} onClick={() => setShowOff((v) => !v)}>
                  {showOff ? tr('ws.genderHours.page.hideOff') : tr('ws.genderHours.page.showOff', { count: formatNumber(offCount, locale) })}
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
            clashes={selected === 'new' ? [] : clashesFor(clashes, rules, selected.id)}
            dayName={dayName}
            readOnly={!can.editGenderRules}
            onSaved={() => {
              setSelected(null);
              void queryClient.invalidateQueries({ queryKey: QK.genderRules });
            }}
            onCancel={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}

const CLASHES_SHOWN = 5;

/** The pairs that clash, each name a way into that rule. */
function ClashList({
  clashes,
  rules,
  dayName,
  onOpen,
}: {
  clashes: readonly GenderRuleClash[];
  rules: readonly GenderRuleRow[];
  dayName: (d: number) => string;
  onOpen: (r: GenderRuleRow) => void;
}) {
  const { tr, locale } = useLocale();
  const [all, setAll] = useState(false);
  const listed = all ? clashes : clashes.slice(0, CLASHES_SHOWN);
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
            {formatNumber(clashes.length, locale)}
          </span>
          {tr('ws.genderHours.page.clashTitle')}
        </span>
      }
    >
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.genderHours.page.clashLead')}</p>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-sm)' }}>
        {listed.map((c) => (
          <li key={`${c.ruleId}|${c.otherId}`} style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', alignItems: 'baseline' }}>
            {ruleLink(c.ruleId)}
            <Icon name="split" size={13} style={{ color: 'var(--tp-muted-fg)' }} />
            {ruleLink(c.otherId)}
            <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.genderHours.page.clashFrom', { day: dayName(c.weekday) })}</span>
          </li>
        ))}
      </ul>
      {clashes.length > CLASHES_SHOWN && (
        <Button size="sm" kind="ghost" style={{ marginBlockStart: 'var(--tp-sp-2)' }} onClick={() => setAll((v) => !v)}>
          {all ? tr('ws.genderHours.page.clashesFewer') : tr('ws.genderHours.page.clashesAll', { count: formatNumber(clashes.length, locale) })}
        </Button>
      )}
    </Panel>
  );
}

function RuleForm({
  rule,
  courts,
  clashes,
  dayName,
  readOnly,
  onSaved,
  onCancel,
}: {
  rule: GenderRuleRow | null;
  courts: readonly CourtRow[];
  clashes: ClashFromSide[];
  dayName: (d: number) => string;
  readOnly: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const [name, setName] = useState(rule?.name ?? '');
  // No default for a new rule: who the time is kept for is the one choice
  // that must never be taken by accident.
  const [gender, setGender] = useState<GenderChoice>(rule?.gender ?? '');
  const [courtId, setCourtId] = useState(rule?.court_id ?? '');
  const [days, setDays] = useState<Set<number>>(new Set(rule?.days_of_week ?? ALL_DAYS));
  const [startTime, setStartTime] = useState(rule?.start_time?.slice(0, 5) ?? '09:00');
  const [endTime, setEndTime] = useState(rule?.end_time?.slice(0, 5) ?? '12:00');
  const [validFrom, setValidFrom] = useState(rule?.valid_from ?? '');
  const [validTo, setValidTo] = useState(rule?.valid_to ?? '');
  const [isActive, setIsActive] = useState(rule?.is_active ?? true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const block = saveBlock({ name, gender, days, startTime, endTime });
  const overnight = block !== 'sameTime' && startTime && endTime ? windowParts({ start_time: startTime, end_time: endTime }).overnight : false;

  async function save() {
    if (block !== null || gender === '') return;
    setBusy(true);
    setError(null);
    try {
      await appRpc('upsert_court_gender_rule', {
        p_id: rule?.id ?? null,
        p_name: name.trim(),
        p_gender: gender,
        p_court_id: courtId || null,
        p_days_of_week: [...days].sort((a, b) => a - b),
        p_start_time: startTime,
        p_end_time: endTime,
        p_valid_from: validFrom || null,
        p_valid_to: validTo || null,
        p_is_active: isActive,
      });
      toast.ok(tr('ws.genderHours.page.saved'));
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title={rule ? tr('ws.genderHours.page.editRule') : tr('ws.genderHours.page.newRule')}
      actions={rule && !rule.is_active ? <StatusBadge size="sm" tone="neutral" dot={false} label={tr('ws.genderHours.page.off')} /> : undefined}
      data-testid="gender-rule-form"
    >
      {clashes.map((c) => (
        <MessagePresenter
          key={c.otherId}
          tone="refused"
          icon="alert"
          style={{ marginBlockEnd: 'var(--tp-sp-3)' }}
          message={tr('ws.genderHours.page.clashInForm', { name: c.otherName, day: dayName(c.weekday) })}
        />
      ))}

      <Field label={tr('ws.genderHours.form.name')} required>
        <input style={inputStyle} value={name} disabled={readOnly} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={tr('ws.genderHours.form.who')} required group>
        <SegmentedControl<GenderChoice>
          value={gender}
          onChange={setGender}
          options={[
            { value: 'female', label: tr('ws.genderHours.form.women'), disabled: readOnly, testId: 'gender-rule-female' },
            { value: 'male', label: tr('ws.genderHours.form.men'), disabled: readOnly, testId: 'gender-rule-male' },
          ]}
        />
      </Field>
      <Field
        label={tr('ws.genderHours.form.court')}
        hint={courtId ? tr('ws.genderHours.form.oneCourtHint') : tr('ws.genderHours.form.everyCourtHint')}
      >
        <Select
          value={courtId}
          disabled={readOnly}
          onChange={setCourtId}
          options={[
            { value: '', label: tr('ws.genderHours.form.everyCourt') },
            ...courts.map((c) => ({ value: c.id, label: pickName(locale, c) })),
          ]}
        />
      </Field>
      <Field label={tr('ws.genderHours.form.days')} group>
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--tp-sp-2-5)' }}>
        <Field label={tr('ws.genderHours.form.start')}>
          <input style={inputStyle} dir="ltr" type="time" value={startTime} disabled={readOnly} onChange={(e) => setStartTime(e.target.value)} />
        </Field>
        <Field
          label={tr('ws.genderHours.form.end')}
          error={block === 'sameTime' && startTime && endTime ? tr('ws.genderHours.form.disabled.sameTime') : undefined}
        >
          <input style={inputStyle} dir="ltr" type="time" value={endTime} disabled={readOnly} onChange={(e) => setEndTime(e.target.value)} />
        </Field>
      </div>
      {/* Said always, and drawn as a note once the window does run past midnight. */}
      <p
        style={{
          display: 'flex',
          gap: 'var(--tp-sp-1-5)',
          alignItems: 'baseline',
          margin: 0,
          marginBlockEnd: 'var(--tp-sp-3)',
          fontSize: 'var(--tp-fs-xs)',
          color: overnight ? 'var(--tp-fg)' : 'var(--tp-muted-fg)',
        }}
      >
        {overnight && <Icon name="info" size={13} style={{ flexShrink: 0, alignSelf: 'center' }} />}
        {tr('ws.genderHours.form.overnightHint')}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--tp-sp-2-5)' }}>
        <Field label={tr('ws.genderHours.form.validFrom')}>
          <input style={inputStyle} dir="ltr" type="date" value={validFrom} disabled={readOnly} onChange={(e) => setValidFrom(e.target.value)} />
        </Field>
        <Field label={tr('ws.genderHours.form.validTo')} hint={tr('ws.genderHours.form.validityHint')}>
          <input style={inputStyle} dir="ltr" type="date" value={validTo} disabled={readOnly} onChange={(e) => setValidTo(e.target.value)} />
        </Field>
      </div>

      <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', marginBlockEnd: 'var(--tp-sp-3)' }}>
        <Switch checked={isActive} disabled={readOnly} onChange={setIsActive} label={tr('ws.genderHours.form.active')} />
        <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.genderHours.form.activeHint')}</span>
      </div>
      <ErrorText error={error} />
      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', justifyContent: 'flex-end', alignItems: 'center' }}>
        <Button onClick={onCancel} disabled={busy}>
          {tr('common.cancel')}
        </Button>
        <Button
          kind="primary"
          icon="check"
          busy={busy}
          disabled={readOnly || block !== null}
          disabledReason={block ? tr(`ws.genderHours.form.disabled.${block}`) : undefined}
          onClick={() => void save()}
          data-testid="gender-rule-save"
        >
          {tr('common.save')}
        </Button>
      </div>
    </Panel>
  );
}
