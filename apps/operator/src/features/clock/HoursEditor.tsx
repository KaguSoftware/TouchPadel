/**
 * Set hours (0442): one person's week, day by day. Any number of shifts a day, each naming one of
 * the person's jobs (main job by default). Touching shifts are one block: the line between them
 * says the job switches with no scan. A gap is time off and never counts against anyone. An end
 * at or before the start runs into the next day. The whole week is saved at once
 * (app.set_staff_shifts replaces it), checked first with the server's own rules (`weekProblem`).
 *
 * Used on the owner's Staff page (beside the person) and on Attendance › Set hours (managers,
 * whose Staff page is closed to them). `can_edit` false (a manager's own hours) is read-only.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WeekShift } from '@touch/core/staff/clock';
import { formatNumber, formatWeekdayLong, isolate, type MessageKey } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { useVenue } from '../../lib/venue';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Select, Skeleton, inputStyle } from '../../components/ui';
import { MessagePresenter } from '../../components/kit';
import { refusalCode, refusalHint } from '../protocols/errors';
import { CK, fetchShifts, saveShifts } from './api';
import {
  MAX_SHIFTS,
  WEEKDAYS,
  between,
  copyDay,
  crossesMidnight,
  dayShifts,
  newShift,
  readShifts,
  sameWeek,
  shiftsForSave,
  shiftsRefusal,
  weekIssue,
  weekMinutes,
  type WeekIssue,
} from './hoursLogic';

const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;
const timeInput = { ...inputStyle, inlineSize: '7.5rem', fontVariantNumeric: 'tabular-nums' } as const;

export function useWeekdayName() {
  const { locale } = useLocale();
  // 1 January 2024 was a Monday: ISO weekday n is 2024-01-0n.
  return (day: number) => formatWeekdayLong(new Date(Date.UTC(2024, 0, day, 12)), locale, 'UTC');
}

export function useDuration() {
  const { tr, locale } = useLocale();
  return (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return tr('ws.clock.hours.duration.m', { m: formatNumber(m, locale) });
    if (m === 0) return tr('ws.clock.hours.duration.h', { h: formatNumber(h, locale) });
    return tr('ws.clock.hours.duration.hm', { h: formatNumber(h, locale), m: formatNumber(m, locale) });
  };
}

export function HoursEditor({ staffId, compact = false }: { staffId: string; compact?: boolean }) {
  const { tr } = useLocale();
  const { branchId } = useVenue();
  const q = useQuery({ queryKey: CK.shifts(branchId, staffId), enabled: Boolean(branchId), queryFn: () => fetchShifts(staffId) });

  if (q.error) {
    const code = refusalCode(q.error);
    if (code === 'REF_NOT_FOUND') return <p style={muted}>{tr('ws.clock.hours.notHere')}</p>;
    return (
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
        <ErrorText error={q.error} style={{ marginBlock: 0 }} />
        <Button size="sm" icon="refresh" onClick={() => void q.refetch()}>
          {tr('common.retry')}
        </Button>
      </div>
    );
  }
  if (!q.data) return <Skeleton lines={5} />;
  const data = readShifts(q.data);
  return <WeekForm key={q.dataUpdatedAt} staffId={staffId} roles={data.roles} canEdit={data.canEdit} saved={data.shifts} compact={compact} />;
}

function WeekForm({ staffId, roles, canEdit, saved, compact }: { staffId: string; roles: string[]; canEdit: boolean; saved: WeekShift[]; compact: boolean }) {
  const { tr } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const duration = useDuration();
  const mainRole = roles[0] ?? null;
  const [draft, setDraft] = useState<WeekShift[]>(saved);
  const [tried, setTried] = useState(false);
  const [copyFrom, setCopyFrom] = useState<number | null>(null);

  const dirty = !sameWeek(draft, saved, mainRole);
  const issue = weekIssue(draft);
  const save = useMutation({
    mutationFn: () => saveShifts(staffId, shiftsForSave(draft, mainRole)),
    onSuccess: () => {
      toast.ok(tr('ws.clock.hours.saved'));
      setTried(false);
      void qc.invalidateQueries({ queryKey: CK.all });
    },
  });
  const refusal = shiftsRefusal(refusalCode(save.error), refusalHint(save.error));

  const edit = (next: WeekShift[]) => {
    setDraft(next);
    if (save.isError) save.reset();
  };
  const patch = (index: number, p: Partial<WeekShift>) => edit(draft.map((s, i) => (i === index ? { ...s, ...p } : s)));
  const remove = (index: number) => edit(draft.filter((_, i) => i !== index));
  const add = (day: number) => edit([...draft, newShift(draft, day)]);

  const roleOptions = useMemo(
    () =>
      roles.map((r, i) => ({
        value: r,
        label: i === 0 ? tr('ws.clock.hours.mainJob', { job: tr(`op.roles.${r}` as MessageKey) }) : tr(`op.roles.${r}` as MessageKey),
      })),
    [roles, tr],
  );
  const shownIssue: WeekIssue | null = tried ? issue : null;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (issue === null && dirty && !save.isPending) save.mutate();
      }}
      style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}
      data-testid="hours-editor"
    >
      {!canEdit && <MessagePresenter tone="info" icon="lock" message={tr('ws.clock.hours.readOnly')} />}
      <p style={muted}>{tr('ws.clock.hours.lead')}</p>

      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
        {WEEKDAYS.map((day) => (
          <DayRows
            key={day}
            day={day}
            week={draft}
            canEdit={canEdit}
            busy={save.isPending}
            roleOptions={roleOptions}
            mainRole={mainRole}
            issue={shownIssue}
            compact={compact}
            full={draft.length >= MAX_SHIFTS}
            copying={copyFrom === day}
            onPatch={patch}
            onRemove={remove}
            onAdd={() => add(day)}
            onCopyStart={() => setCopyFrom(day)}
            onCopyCancel={() => setCopyFrom(null)}
            onCopy={(to) => {
              edit(copyDay(draft, day, to));
              setCopyFrom(null);
            }}
          />
        ))}
      </ol>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--tp-sp-3)', flexWrap: 'wrap' }}>
        <p style={{ margin: 0, fontWeight: 600 }} data-testid="hours-total">
          {draft.length === 0 ? tr('ws.clock.hours.noHours') : tr('ws.clock.hours.weekTotal', { hours: duration(weekMinutes(draft)) })}
        </p>
        {canEdit && (dirty || save.isPending) && (
          <div style={{ display: 'flex', gap: 'var(--tp-sp-2)' }}>
            <Button kind="ghost" disabled={save.isPending} onClick={() => edit(saved)}>
              {tr('ws.kit.actions.discard')}
            </Button>
            <Button kind="primary" type="submit" icon="check" busy={save.isPending} data-testid="hours-save">
              {tr('ws.clock.hours.save')}
            </Button>
          </div>
        )}
      </div>
      {shownIssue && <p role="alert" style={{ margin: 0, color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.clock.hours.fixFirst')}</p>}
      {refusal ? <MessagePresenter tone="refused" message={tr(`ws.clock.hours.refused.${refusal}`)} /> : save.isError && <ErrorText error={save.error} />}
    </form>
  );
}

function DayRows({
  day,
  week,
  canEdit,
  busy,
  roleOptions,
  mainRole,
  issue,
  compact,
  full,
  copying,
  onPatch,
  onRemove,
  onAdd,
  onCopyStart,
  onCopyCancel,
  onCopy,
}: {
  day: number;
  week: WeekShift[];
  canEdit: boolean;
  busy: boolean;
  roleOptions: { value: string; label: string }[];
  mainRole: string | null;
  issue: WeekIssue | null;
  compact: boolean;
  full: boolean;
  copying: boolean;
  onPatch: (index: number, p: Partial<WeekShift>) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
  onCopyStart: () => void;
  onCopyCancel: () => void;
  onCopy: (to: number[]) => void;
}) {
  const { tr } = useLocale();
  const weekday = useWeekdayName();
  const duration = useDuration();
  const shifts = dayShifts(week, day);
  const name = weekday(day);
  const roleName = (r: string | null) => tr(`op.roles.${r ?? mainRole ?? 'waiter'}` as MessageKey);
  const multiJob = roleOptions.length > 1;

  return (
    <li
      style={{ display: 'grid', gap: 'var(--tp-sp-2)', paddingBlock: 'var(--tp-sp-3)', borderBlockStart: day > 1 ? '1px solid var(--tp-border)' : undefined }}
      data-testid={`hours-day-${day}`}
      aria-label={name}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 'var(--tp-sp-2)' }}>
          <h4 style={{ fontSize: 'var(--tp-fs-md)', fontWeight: 700, minInlineSize: compact ? undefined : '8rem' }}>{name}</h4>
          {/* An empty day is one line: its name and "Day off". */}
          {shifts.length === 0 && <span style={muted}>{tr('ws.clock.hours.dayOff')}</span>}
        </span>
        {canEdit && (
          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)' }}>
            {shifts.length > 0 && (
              <Button size="sm" kind="ghost" icon="layers" disabled={busy} onClick={onCopyStart} data-testid={`hours-copy-${day}`}>
                {tr('ws.clock.hours.copy')}
              </Button>
            )}
            <Button size="sm" kind="ghost" icon="plus" disabled={busy || full} disabledReason={full ? tr('ws.clock.hours.full') : undefined} onClick={onAdd} data-testid={`hours-add-${day}`}>
              {tr('ws.clock.hours.add')}
            </Button>
          </span>
        )}
      </div>

      {shifts.map(({ shift, index }, i) => {
        const prev = i > 0 ? shifts[i - 1]!.shift : null;
        const link = prev ? between(prev, shift) : null;
        const bad = issue && issue.index === index ? issue.reason : null;
        return (
          <div key={index} style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
            {link?.kind === 'switch' && (
              <p style={{ ...muted, color: 'var(--tp-success-fg)' }}>
                {link.roleChanges
                  ? tr('ws.clock.hours.switch', { job: roleName(shift.role), time: isolate(link.at) })
                  : tr('ws.clock.hours.joined', { time: isolate(link.at) })}
              </p>
            )}
            {link?.kind === 'gap' && (
              <p style={muted}>{tr('ws.clock.hours.gap', { from: isolate(link.from), to: isolate(link.to), length: duration(link.minutes) })}</p>
            )}
            {canEdit ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
                <input
                  type="time"
                  dir="ltr"
                  style={timeInput}
                  value={shift.starts_at}
                  disabled={busy}
                  aria-label={tr('ws.clock.hours.startsAria', { day: name })}
                  aria-invalid={bad ? true : undefined}
                  onChange={(e) => e.target.value && onPatch(index, { starts_at: e.target.value.slice(0, 5) })}
                  data-testid={`hours-start-${day}-${i}`}
                />
                <span style={muted}>{tr('ws.clock.hours.to')}</span>
                <input
                  type="time"
                  dir="ltr"
                  style={timeInput}
                  value={shift.ends_at}
                  disabled={busy}
                  aria-label={tr('ws.clock.hours.endsAria', { day: name })}
                  aria-invalid={bad ? true : undefined}
                  onChange={(e) => e.target.value && onPatch(index, { ends_at: e.target.value.slice(0, 5) })}
                  data-testid={`hours-end-${day}-${i}`}
                />
                {multiJob && (
                  <Select<string>
                    value={shift.role ?? mainRole ?? ''}
                    options={roleOptions}
                    disabled={busy}
                    aria-label={tr('ws.clock.hours.jobAria', { day: name })}
                    onChange={(v) => onPatch(index, { role: v === mainRole ? null : v })}
                    style={{ minInlineSize: '9rem', flex: compact ? '1 1 9rem' : '0 1 12rem' }}
                  />
                )}
                <Button size="sm" kind="ghost" icon="x" disabled={busy} aria-label={tr('ws.clock.hours.removeAria', { day: name })} onClick={() => onRemove(index)} data-testid={`hours-remove-${day}-${i}`} />
              </div>
            ) : (
              <p style={{ margin: 0 }}>
                <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {shift.starts_at}–{shift.ends_at}
                </span>
                {multiJob && <span style={muted}> · {roleName(shift.role)}</span>}
              </p>
            )}
            {crossesMidnight(shift) && !bad && <p style={{ ...muted, fontSize: 'var(--tp-fs-xs)' }}>{tr('ws.clock.hours.nextDay')}</p>}
            {bad && (
              <p role="alert" style={{ margin: 0, color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }} data-testid={`hours-issue-${day}-${i}`}>
                {tr(`ws.clock.hours.issue.${bad}`)}
              </p>
            )}
          </div>
        );
      })}

      {copying && <CopyPicker from={day} busy={busy} onCancel={onCopyCancel} onCopy={onCopy} />}
    </li>
  );
}

function CopyPicker({ from, busy, onCancel, onCopy }: { from: number; busy: boolean; onCancel: () => void; onCopy: (to: number[]) => void }) {
  const { tr } = useLocale();
  const weekday = useWeekdayName();
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const others = WEEKDAYS.filter((d) => d !== from);
  return (
    <fieldset
      style={{ border: '1px solid var(--tp-border)', borderRadius: 'var(--tp-radius-ctl)', paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)', margin: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}
      data-testid="hours-copy-picker"
    >
      <legend style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600, paddingInline: 'var(--tp-sp-1)' }}>{tr('ws.clock.hours.copyTo', { day: weekday(from) })}</legend>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-1) var(--tp-sp-3)' }}>
        {others.map((d) => (
          <label key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)' }}>
            <input
              type="checkbox"
              checked={picked.has(d)}
              onChange={(e) => {
                const next = new Set(picked);
                if (e.target.checked) next.add(d);
                else next.delete(d);
                setPicked(next);
              }}
            />
            {weekday(d)}
          </label>
        ))}
      </div>
      <p style={{ ...muted, fontSize: 'var(--tp-fs-xs)' }}>{tr('ws.clock.hours.copyNote', { day: weekday(from) })}</p>
      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <Button size="sm" kind="ghost" onClick={() => setPicked(new Set(others))}>
          {tr('ws.clock.hours.copyAll')}
        </Button>
        <Button size="sm" kind="ghost" onClick={onCancel}>
          {tr('common.cancel')}
        </Button>
        <Button size="sm" kind="primary" disabled={busy || picked.size === 0} onClick={() => onCopy([...picked])} data-testid="hours-copy-apply">
          {tr('ws.clock.hours.copyApply')}
        </Button>
      </div>
    </fieldset>
  );
}
