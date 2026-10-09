/**
 * Late and early (/attendance), a manager or the owner (0270–0271; Parsa
 * 2026-10-01).
 *
 *  - **The rule.** A work day costs Y IQD when its minutes late plus minutes
 *    left early are more than X (attendance_grace_minutes and
 *    attendance_penalty_iqd, the branch's settings; Y = 0 is off). Each day
 *    keeps the rule in force when it was recorded, so changing it never
 *    rewrites history.
 *  - **Record a day.** Inline under the header, like a deduction's proposal:
 *    a person, a day within the last 60, the minutes, a note, and a live
 *    verdict under the rule. Recording a day already recorded replaces it,
 *    and the form says so first.
 *  - **The month.** Per person, the days recorded in it, with what each costs
 *    and the wage it comes off; Edit and Clear, except on a day whose wage is
 *    paid (locked).
 *
 * Every figure is the server's: the verdict compares minutes, and the cost it
 * names is the rule's own amount. A manager never sees a day about
 * themselves; the owner reads the same days on the Wages page.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatIQD, formatNumber, isolate } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useBusinessToday, useCafeSettings, useSetCafeSettings } from '../../lib/settings';
import { useToast } from '../../components/toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { Button, ErrorText, Field, Select, Skeleton, inputStyle } from '../../components/ui';
import { CountInput, DateField, MoneyInput } from '../../components/inputs';
import { DataTable, EmptyState, MessagePresenter, Money, PageHeader, Panel, StatusBadge, ViewMore, useListCap, type Column } from '../../components/kit';
import { ChevronBack, ChevronForward } from '../../components/icons';
import { CardTitle } from '../ops/OpsVisuals';
import { refusalCode, refusalHint } from '../protocols/errors';
import { dayLabel, monthLabel, shiftMonth } from '../deductions/venueDate';
import { AK, fetchAttendanceMonth } from './api';
import {
  GRACE_MAX,
  MINUTES_MAX,
  NOTE_MAX,
  PENALTY_MAX,
  WINDOW_DAYS,
  attendanceRefusalField,
  attendanceWindow,
  canStepAttendanceForward,
  isAttendanceStale,
  paidInLaterMonth,
  readAttendanceMonth,
  recordedDay,
  ruleVerdict,
  validateAttendance,
  validateRule,
  type AttendanceDay,
  type AttendanceDraft,
  type AttendanceField,
  type AttendanceIssueCode,
  type AttendanceMonth,
  type AttendancePerson,
} from './attendanceLogic';

const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;

export function AttendancePageScreen() {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const today = useBusinessToday();

  // null is "this month": the server answers which month that is.
  const [month, setMonth] = useState<string | null>(null);
  const currentQ = useQuery({ queryKey: AK.month(null), queryFn: () => fetchAttendanceMonth(null), refetchInterval: 60_000 });
  const pickedQ = useQuery({ queryKey: AK.month(month), queryFn: () => fetchAttendanceMonth(month), enabled: month !== null });
  const q = month === null ? currentQ : pickedQ;
  const currentData = readAttendanceMonth(currentQ.data);
  const current = currentData.currentMonth;
  const data = readAttendanceMonth(q.data);
  const shown = month ?? data.month ?? current;
  // Owner's rule (2026-10-08): three people, then "View more". The month's totals read everyone.
  const peopleCap = useListCap(data.people);
  const isCurrent = shown !== null && shown === current;

  /** The open form: a fresh day, or a recorded one to change. `n` remounts it on each open. */
  const [form, setForm] = useState<{ n: number; draft: AttendanceDraft; editing: boolean } | null>(null);
  const openForm = (draft: AttendanceDraft, editing: boolean) => setForm((f) => ({ n: (f?.n ?? 0) + 1, draft, editing }));

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: AK.all });
    void qc.invalidateQueries({ queryKey: ['wages'] });
  };

  const clear = useMutation({
    mutationFn: (id: string) => appRpc('clear_attendance', { p_id: id }),
    onSuccess: () => {
      toast.ok(tr('ws.wages.attendance.clear.done'));
      refresh();
    },
    onError: (e) => isAttendanceStale(refusalCode(e)) && refresh(),
  });
  async function askClear(person: AttendancePerson, day: AttendanceDay) {
    const yes = await confirm({
      kind: 'danger',
      title: tr('ws.wages.attendance.clear.title'),
      body: tr('ws.wages.attendance.clear.body', { name: isolate(person.displayName), date: dayLabel(day.workDate, locale) }),
      confirmLabel: tr('ws.wages.attendance.clear.confirm'),
      cancelLabel: tr('ws.wages.attendance.clear.keep'),
    });
    if (yes) clear.mutate(day.id);
  }

  // The form reads the month it falls in when that is the one loaded; the
  // current month otherwise, which is where a fresh day usually lands.
  const formMonth: AttendanceMonth = q.data !== undefined ? data : currentData;

  return (
    <div style={{ maxInlineSize: '84rem' }}>
      <PageHeader
        title={tr('ws.wages.attendance.title')}
        subtitle={tr('ws.wages.attendance.lead')}
        actions={
          form === null ? (
            <Button kind="primary" icon="plus" onClick={() => openForm({ staffId: '', date: today, late: 0, early: 0, note: '' }, false)} data-testid="attendance.record.open">
              {tr('ws.wages.attendance.record.open')}
            </Button>
          ) : undefined
        }
      />

      <RulePanel />

      {form && (
        <RecordForm
          key={form.n}
          initial={form.draft}
          editing={form.editing}
          month={formMonth}
          today={today}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            refresh();
          }}
        />
      )}

      <section aria-labelledby="attendance-month-title">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', marginBlockEnd: 'var(--tp-sp-3)' }}>
          <Button aria-label={tr('ws.kit.calendar.prevMonth')} disabled={shown === null} onClick={() => shown && setMonth(shiftMonth(shown, -1))} data-testid="attendance.month.prev">
            <ChevronBack size={16} />
          </Button>
          <h2 id="attendance-month-title" style={{ fontSize: 'var(--tp-fs-lg)', fontWeight: 700, minInlineSize: '11rem', textAlign: 'center' }}>
            {shown ? monthLabel(shown, locale) : tr('common.loading')}
          </h2>
          <Button
            aria-label={tr('ws.kit.calendar.nextMonth')}
            disabled={!canStepAttendanceForward(shown, current)}
            onClick={() => shown && setMonth(shiftMonth(shown, 1) === current ? null : shiftMonth(shown, 1))}
            data-testid="attendance.month.next"
          >
            <ChevronForward size={16} />
          </Button>
          {!isCurrent && current && (
            <Button kind="ghost" size="sm" onClick={() => setMonth(null)}>
              {tr('ws.wages.attendance.month.thisMonth')}
            </Button>
          )}
        </div>

        <ErrorText error={clear.error} />

        {q.isError && q.data === undefined ? (
          <div role="alert" style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
            <ErrorText error={q.error} style={{ marginBlock: 0 }} />
            <Button size="sm" icon="refresh" onClick={() => void q.refetch()}>
              {tr('common.retry')}
            </Button>
          </div>
        ) : q.data === undefined ? (
          <Skeleton lines={4} />
        ) : (
          <>
            <MonthTotals data={data} />
            {data.people.length === 0 ? (
              <EmptyState
                kind="nothingToDo"
                icon="clock"
                title={tr('ws.wages.attendance.month.empty', { month: shown ? monthLabel(shown, locale) : '' })}
                body={tr('ws.wages.attendance.month.emptyBody')}
              />
            ) : (
              <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
                {peopleCap.shown.map((p) => (
                  <PersonDays
                    key={p.staffId}
                    person={p}
                    busy={clear.isPending}
                    onEdit={(d) => openForm({ staffId: p.staffId, date: d.workDate, late: d.lateMinutes, early: d.earlyLeaveMinutes, note: d.note ?? '' }, true)}
                    onClear={(d) => void askClear(p, d)}
                  />
                ))}
                <ViewMore hidden={peopleCap.hidden} open={peopleCap.open} onToggle={peopleCap.toggle} style={{ marginBlockStart: 0 }} />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** X and Y, saved together, with what they mean in a sentence. */
function RulePanel() {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { settings, isSuccess } = useCafeSettings();
  const [grace, setGrace] = useState<number | null>(null);
  const [penalty, setPenalty] = useState<number | null | undefined>(undefined);
  const graceValue = grace ?? settings.attendance_grace_minutes;
  const penaltyValue = penalty === undefined ? settings.attendance_penalty_iqd : penalty;
  const dirty = (grace !== null && grace !== settings.attendance_grace_minutes) || (penalty !== undefined && penalty !== settings.attendance_penalty_iqd);
  const invalid = validateRule({ graceMinutes: graceValue, penaltyIqd: penaltyValue });
  const [tried, setTried] = useState(false);

  const setSettings = useSetCafeSettings();
  const save = useMutation({
    mutationFn: () =>
      setSettings.mutateAsync([
        { key: 'attendance_grace_minutes', value: graceValue },
        { key: 'attendance_penalty_iqd', value: penaltyValue ?? 0 },
      ]),
    onSuccess: () => {
      toast.ok(tr('ws.wages.attendance.rule.saved'));
      setGrace(null);
      setPenalty(undefined);
      setTried(false);
      // The month's rule, and the live verdict that reads it.
      void qc.invalidateQueries({ queryKey: AK.all });
    },
  });

  const summary =
    (penaltyValue ?? 0) > 0
      ? tr('ws.wages.attendance.rule.summary', { amount: isolate(formatIQD(penaltyValue ?? 0, locale)), minutes: formatNumber(graceValue, locale) })
      : tr('ws.wages.attendance.rule.off');

  return (
    <Panel title={<CardTitle icon="sliders">{tr('ws.wages.attendance.rule.title')}</CardTitle>} data-testid="attendance.rule" style={{ marginBlockEnd: 'var(--tp-sp-4)', maxInlineSize: '52rem' }}>
      <p style={{ fontWeight: 600, marginBlockEnd: 'var(--tp-sp-3)' }} data-testid="attendance.rule.summary">
        {summary}
      </p>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (invalid === null && !save.isPending) save.mutate();
        }}
      >
        <div style={{ display: 'flex', gap: 'var(--tp-sp-4)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Field label={tr('ws.wages.attendance.rule.grace')} hint={tr('ws.wages.attendance.rule.graceHint')} style={{ flex: '1 1 12rem' }}>
            <CountInput id="attendance-grace" value={graceValue} min={0} max={GRACE_MAX} disabled={save.isPending || !isSuccess} onChange={setGrace} />
          </Field>
          <Field
            label={tr('ws.wages.attendance.rule.penalty')}
            hint={tr('ws.wages.attendance.rule.penaltyHint')}
            error={tried && invalid !== null ? tr('ws.wages.attendance.rule.invalid', { max: formatIQD(PENALTY_MAX, locale) }) : undefined}
            style={{ flex: '1 1 16rem' }}
          >
            <MoneyInput value={penaltyValue} allowEmpty max={PENALTY_MAX} disabled={save.isPending || !isSuccess} onChange={setPenalty} />
          </Field>
        </div>
        <p style={{ ...muted, marginBlockEnd: 'var(--tp-sp-1)' }}>{tr('ws.wages.attendance.rule.kept')}</p>
        <p style={{ ...muted, marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.wages.attendance.rule.ownerSees')}</p>
        <ErrorText error={save.error} />
        {(dirty || save.isPending) && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button kind="primary" type="submit" icon="check" busy={save.isPending} data-testid="attendance.rule.save">
              {tr('ws.wages.attendance.rule.save')}
            </Button>
          </div>
        )}
      </form>
    </Panel>
  );
}

/** Record a day, or change one already recorded (the server replaces it). */
function RecordForm({
  initial,
  editing,
  month,
  today,
  onClose,
  onSaved,
}: {
  initial: AttendanceDraft;
  editing: boolean;
  month: AttendanceMonth;
  today: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const [draft, setDraft] = useState<AttendanceDraft>(initial);
  const [tried, setTried] = useState(false);
  const bounds = attendanceWindow(today);

  const send = useMutation({
    mutationFn: () =>
      appRpc('record_attendance', {
        p_staff_id: draft.staffId,
        p_date: draft.date,
        p_late_minutes: draft.late,
        p_early_leave_minutes: draft.early,
        p_note: draft.note.trim() === '' ? null : draft.note.trim(),
      }),
    onSuccess: () => {
      toast.ok(tr('ws.wages.attendance.record.saved'));
      onSaved();
    },
  });

  const issues = validateAttendance(draft, today);
  const serverField = attendanceRefusalField(refusalCode(send.error), refusalHint(send.error));
  const days = formatNumber(WINDOW_DAYS, locale);
  const issueText = (code: AttendanceIssueCode) =>
    tr(ISSUE_KEY[code], { days, limit: formatNumber(NOTE_MAX, locale) });
  const issueOf = (field: AttendanceField): string | undefined => {
    const i = tried ? issues.find((x) => x.field === field) : undefined;
    if (i) return issueText(field === 'date' && i.code === 'required' ? 'dateRange' : i.code);
    if (serverField === field) {
      if (field === 'staffId') return tr('ws.wages.attendance.record.personRefused');
      if (field === 'date') return issueText('dateRange');
      if (field === 'late' || field === 'early') return issueText('minutesRange');
      if (field === 'minutes') return issueText('bothZero');
      if (field === 'note') return issueText('tooLong');
    }
    return undefined;
  };
  const set = (patch: Partial<AttendanceDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    if (send.isError) send.reset();
  };

  const verdict = ruleVerdict(month.rule, draft.late, draft.early);
  const existing = editing ? null : recordedDay(month, draft.staffId, draft.date);
  const personName = month.staff.find((s) => s.id === draft.staffId)?.displayName ?? month.people.find((p) => p.staffId === draft.staffId)?.displayName ?? '';
  const options = month.staff.map((s) => ({ value: s.id, label: s.role ? `${s.displayName} · ${tr(`op.roles.${s.role}`)}` : s.displayName }));
  if (draft.staffId !== '' && !options.some((o) => o.value === draft.staffId)) options.push({ value: draft.staffId, label: personName });
  const minutesError = issueOf('minutes');

  return (
    <Panel
      title={<CardTitle icon="clock">{tr(editing ? 'ws.wages.attendance.record.editTitle' : 'ws.wages.attendance.record.title')}</CardTitle>}
      data-testid="attendance.record-form"
      style={{ marginBlockEnd: 'var(--tp-sp-4)', maxInlineSize: '52rem' }}
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (issues.length === 0 && !send.isPending) send.mutate();
        }}
      >
        <div style={{ display: 'flex', gap: 'var(--tp-sp-4)', flexWrap: 'wrap' }}>
          <Field
            label={tr('ws.wages.attendance.record.person')}
            required
            error={issueOf('staffId')}
            hint={month.staff.length === 0 && month.today !== null ? tr('ws.wages.attendance.record.nobody') : undefined}
            style={{ flex: '2 1 16rem' }}
          >
            <Select<string>
              value={draft.staffId}
              placeholder={tr('ws.wages.attendance.record.choosePerson')}
              disabled={send.isPending || editing || options.length === 0}
              options={options}
              onChange={(v) => set({ staffId: v })}
            />
          </Field>
          <Field
            label={tr('ws.wages.attendance.record.date')}
            required
            hint={tr('ws.wages.attendance.record.dateHint', { days })}
            error={issueOf('date')}
            style={{ flex: '1 1 12rem' }}
          >
            <DateField value={draft.date} min={bounds.min} max={bounds.max} disabled={send.isPending || editing} onChange={(v) => set({ date: v })} />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 'var(--tp-sp-4)', flexWrap: 'wrap' }}>
          <Field label={tr('ws.wages.attendance.record.late')} error={issueOf('late')}>
            <CountInput id="attendance-late" value={draft.late} min={0} max={MINUTES_MAX} disabled={send.isPending} onChange={(v) => set({ late: v })} />
          </Field>
          <Field label={tr('ws.wages.attendance.record.early')} error={issueOf('early')}>
            <CountInput id="attendance-early" value={draft.early} min={0} max={MINUTES_MAX} disabled={send.isPending} onChange={(v) => set({ early: v })} />
          </Field>
          <div style={{ alignSelf: 'center' }} data-testid="attendance.record.verdict">
            <MessagePresenter
              tone={verdict === 'over' ? 'refused' : 'info'}
              message={
                verdict === 'over'
                  ? tr('ws.wages.attendance.record.verdict.over', { amount: isolate(formatIQD(month.rule.penaltyIqd, locale)) })
                  : tr(verdict === 'within' ? 'ws.wages.attendance.record.verdict.within' : 'ws.wages.attendance.record.verdict.off')
              }
            />
          </div>
        </div>
        {minutesError && <p role="alert" style={{ color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)', marginBlockEnd: 'var(--tp-sp-2)' }}>{minutesError}</p>}
        <Field label={tr('ws.wages.attendance.record.note')} optional error={issueOf('note')}>
          <textarea
            value={draft.note}
            rows={2}
            maxLength={NOTE_MAX}
            dir="auto"
            disabled={send.isPending}
            onChange={(e) => set({ note: e.target.value })}
            style={{ ...inputStyle, minBlockSize: '3rem', resize: 'vertical', fontFamily: 'inherit' }}
            data-testid="attendance.record.note"
          />
        </Field>
        {existing && (
          <MessagePresenter
            tone="info"
            style={{ marginBlockEnd: 'var(--tp-sp-2)' }}
            message={tr('ws.wages.attendance.record.replaces', { date: dayLabel(existing.workDate, locale), name: isolate(personName) })}
          />
        )}
        {send.isError && serverField === null && <ErrorText error={send.error} />}
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button kind="ghost" onClick={onClose} disabled={send.isPending}>
            {tr('common.cancel')}
          </Button>
          <Button kind="primary" type="submit" icon="check" busy={send.isPending} data-testid="attendance.record.submit">
            {tr('ws.wages.attendance.record.submit')}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

const ISSUE_KEY: Record<
  AttendanceIssueCode,
  | 'ws.wages.attendance.record.issue.required'
  | 'ws.wages.attendance.record.issue.dateRange'
  | 'ws.wages.attendance.record.issue.minutesRange'
  | 'ws.wages.attendance.record.issue.bothZero'
  | 'ws.wages.attendance.record.issue.tooLong'
> = {
  required: 'ws.wages.attendance.record.issue.required',
  dateRange: 'ws.wages.attendance.record.issue.dateRange',
  minutesRange: 'ws.wages.attendance.record.issue.minutesRange',
  bothZero: 'ws.wages.attendance.record.issue.bothZero',
  tooLong: 'ws.wages.attendance.record.issue.tooLong',
};

/** The month's three figures, each the server's. */
function MonthTotals({ data }: { data: AttendanceMonth }) {
  const { tr, locale } = useLocale();
  const t = data.totals;
  return (
    <dl style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-2) var(--tp-sp-6)', margin: 0, marginBlockEnd: 'var(--tp-sp-3)' }}>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
        <dt style={muted}>{tr('ws.wages.attendance.month.days')}</dt>
        <dd style={{ margin: 0, fontSize: 'var(--tp-fs-lg)', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(t.days, locale)}</dd>
      </div>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
        <dt style={muted}>{tr('ws.wages.attendance.month.penaltyDays')}</dt>
        <dd style={{ margin: 0, fontSize: 'var(--tp-fs-lg)', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(t.penaltyDays, locale)}</dd>
      </div>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
        <dt style={muted}>{tr('ws.wages.attendance.month.penalties')}</dt>
        <dd style={{ margin: 0, fontSize: 'var(--tp-fs-lg)' }}>
          <Money amount={t.penaltiesIqd} strong />
        </dd>
      </div>
    </dl>
  );
}

/** One person's days in the month, with what each costs and the wage it comes off. */
function PersonDays({
  person: p,
  busy,
  onEdit,
  onClear,
}: {
  person: AttendancePerson;
  busy: boolean;
  onEdit: (d: AttendanceDay) => void;
  onClear: (d: AttendanceDay) => void;
}) {
  const { tr, locale } = useLocale();
  // Three days per person, then "View more"; the penalty total in the title is the server's, for every day.
  const daysCap = useListCap(p.days);
  const minutes = (n: number) => (n > 0 ? tr('ws.wages.attendance.day.minutes', { minutes: formatNumber(n, locale) }) : '—');
  const columns: Column<AttendanceDay>[] = [
    {
      key: 'date',
      header: tr('ws.wages.attendance.cols.date'),
      render: (d) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
          <span style={{ whiteSpace: 'nowrap' }}>{dayLabel(d.workDate, locale)}</span>
          {d.note && (
            <span dir="auto" style={{ ...muted, overflowWrap: 'anywhere' }}>
              {d.note}
            </span>
          )}
          {d.recordedByName && <span style={{ ...muted, fontSize: 'var(--tp-fs-xs)' }}>{tr('ws.wages.attendance.day.recordedBy', { name: isolate(d.recordedByName) })}</span>}
        </span>
      ),
      truncateTitle: (d) => d.workDate,
    },
    { key: 'late', header: tr('ws.wages.attendance.cols.late'), numeric: true, render: (d) => minutes(d.lateMinutes), truncateTitle: (d) => String(d.lateMinutes) },
    { key: 'early', header: tr('ws.wages.attendance.cols.early'), numeric: true, render: (d) => minutes(d.earlyLeaveMinutes), truncateTitle: (d) => String(d.earlyLeaveMinutes) },
    {
      key: 'penalty',
      header: tr('ws.wages.attendance.cols.penalty'),
      numeric: true,
      render: (d) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', justifyItems: 'end' }}>
          {d.penaltyIqd > 0 ? <Money amount={d.penaltyIqd} strong style={{ whiteSpace: 'nowrap' }} /> : <span style={muted}>{tr('ws.wages.attendance.day.noPenalty')}</span>}
          {paidInLaterMonth(d) && d.payMonth && (
            <span style={{ ...muted, color: 'var(--tp-warn-fg)', fontSize: 'var(--tp-fs-xs)' }}>{tr('ws.wages.attendance.day.comesOff', { month: monthLabel(d.payMonth, locale) })}</span>
          )}
        </span>
      ),
      truncateTitle: (d) => String(d.penaltyIqd),
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (d) =>
        d.locked ? (
          <StatusBadge size="sm" tone="success" icon="lock" label={tr('ws.wages.attendance.day.locked')} title={tr('ws.wages.attendance.day.lockedHint')} />
        ) : (
          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)', justifyContent: 'flex-end' }}>
            <Button size="sm" kind="ghost" icon="note" disabled={busy} onClick={() => onEdit(d)} data-testid={`attendance.edit.${d.id}`}>
              {tr('ws.wages.attendance.day.edit')}
            </Button>
            <Button size="sm" kind="ghost" icon="trash" disabled={busy} onClick={() => onClear(d)} data-testid={`attendance.clear.${d.id}`}>
              {tr('ws.wages.attendance.day.clear')}
            </Button>
          </span>
        ),
      truncateTitle: () => '',
    },
  ];
  return (
    <Panel
      padded={false}
      data-testid={`attendance.person.${p.staffId}`}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
          <bdi>{p.displayName}</bdi>
          {p.role && <span style={{ ...muted, fontWeight: 400 }}>{tr(`op.roles.${p.role}`)}</span>}
        </span>
      }
      actions={<Money amount={p.penaltiesIqd} strong />}
    >
      <DataTable columns={columns} rows={daysCap.shown} rowKey={(d) => d.id} dense aria-label={p.displayName} />
      <ViewMore hidden={daysCap.hidden} open={daysCap.open} onToggle={daysCap.toggle} style={UNPADDED_MORE} />
    </Panel>
  );
}

/** ViewMore inside an unpadded (table) panel: the panel body's own padding. */
const UNPADDED_MORE = { marginBlockStart: 0, paddingBlock: '0.6rem', paddingInline: '0.85rem' } as const;
