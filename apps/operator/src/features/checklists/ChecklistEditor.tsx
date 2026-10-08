/**
 * The owner's editor for one checklist (scheduled-checklists-2026-10-08 §4;
 * first built for build-contracts-2026-09-23 §2.14). Top to bottom:
 *
 *  1. the name, in English and Arabic;
 *  2. who does it: a role (one shared list, or everyone their own copy) or
 *     named people, picked from app.checklist_staff_options;
 *  3. when it repeats: every day, chosen weekdays, once or twice a month;
 *  4. when it is due: before opening, before closing (the branch's opening
 *     hours) or by a set time;
 *  5. the lines: add, move, remove, at most 30, each in both languages, each
 *     with a "Needs a photo" switch (checklist_photos, §2.24.8);
 *  6. a plain-language summary of the plan;
 *  7. Save, Discard and Archive.
 *
 * Save sends the whole list through app.save_checklist. Every list is
 * mandatory: the phone pins it, staff get a push before it is due and when it
 * is late, and an overdue list is flagged here and at day close. Nothing is
 * ever blocked by one.
 *
 * The draft is not this component's: the card holds every list's draft, so
 * moving to another list or closing the sheet loses nothing typed. A save
 * sends the version the draft was started from; if someone saved in between
 * the server refuses (TEMPLATE_CHANGED) and "Load the latest" starts again
 * from what is saved. A copy already open keeps its lines (a copy is a
 * snapshot), which the editor says beside Save for a list that has one.
 */
import { useId, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatNumber } from '@touch/i18n';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Select, inputStyle } from '../../components/ui';
import { MessagePresenter, MultiPickList, SegmentedControl, StatusBadge } from '../../components/kit';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { SortButtons } from '../../components/inputs';
import { Switch } from '../../components/Switch';
import { Icon } from '../../components/icons';
import {
  CHECKLIST_ROLES,
  DAY_KEYS,
  DUE_KINDS,
  LAST_DAY,
  MAX_LINES,
  MAX_LINE_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PEOPLE,
  MONTH_DAY_CHOICES,
  REPEAT_PRESETS,
  WEEKDAYS,
  awayIds,
  draftChanged,
  draftIsValid,
  draftProblems,
  draftSummary,
  moveLine,
  photoLineCount,
  savePayloadItems,
  specFromDraft,
  toggleWeekday,
  withPreset,
  type ChecklistDraft,
  type DraftLine,
  type DueKind,
  type Person,
  type RepeatPreset,
  type TextProblem,
} from './checklistLogic';

/** One list's editing state, held by the card. */
export interface EditorState {
  draft: ChecklistDraft;
  /** What is saved, as a draft: the dirty check compares against it. */
  base: ChecklistDraft;
  /** The version the draft was started from; 0 for a list not written yet. */
  baseVersion: number;
}

export const newLine = (): DraftLine => ({ key: crypto.randomUUID(), text_en: '', text_ar: '', photo_required: false });

const PRESET_LABEL: Record<RepeatPreset, 'repeatDaily' | 'repeatWeekdays' | 'repeatMonthly' | 'repeatTwice'> = {
  daily: 'repeatDaily',
  weekdays: 'repeatWeekdays',
  monthly: 'repeatMonthly',
  twiceMonthly: 'repeatTwice',
};
const DUE_LABEL: Record<DueKind, 'dueOpen' | 'dueClose' | 'dueTime'> = { open: 'dueOpen', close: 'dueClose', time: 'dueTime' };

export function ChecklistEditor({
  templateId,
  state,
  people,
  peopleError,
  onChange,
  onSaved,
  onReload,
  onArchived,
  openNow = false,
}: {
  /** The list being edited; null for a new one. */
  templateId: string | null;
  state: EditorState;
  /** Who a list can be for (checklist_staff_options), plus the list's own people. */
  people: readonly Person[];
  peopleError?: unknown;
  onChange: (next: EditorState) => void;
  /** Saved: the new baseline, and the list's id (new for a new list). */
  onSaved: (next: EditorState, templateId: string) => void;
  /** Start again from what is saved now (after TEMPLATE_CHANGED). */
  onReload: () => void;
  onArchived: () => void;
  /** The list has a copy open now, so that copy will not take the change. */
  openNow?: boolean;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const ids = useId();
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const { draft } = state;
  // People named on the saved list who no longer work at the branch: the
  // server would refuse the save (ASSIGNEE_NOT_AT_BRANCH), so say who first.
  const away = awayIds(people);
  const awayChosen = draft.staff_ids.filter((id) => away.has(id));
  const problems = draftProblems(draft, away);
  const dirty = draftChanged(draft, state.base);
  const filled = savePayloadItems(draft).length;
  const photos = photoLineCount(draft);
  const full = draft.lines.length >= MAX_LINES;
  const invalid = !draftIsValid(draft, away);
  const stale = error instanceof AppRpcError && error.code === 'TEMPLATE_CHANGED';
  const name = (locale === 'ar' ? draft.name_ar : draft.name_en).trim() || (locale === 'ar' ? draft.name_en : draft.name_ar).trim();

  const set = (part: Partial<ChecklistDraft>) => onChange({ ...state, draft: { ...draft, ...part } });
  const setLine = (key: string, part: Partial<Omit<DraftLine, 'key'>>) =>
    set({ lines: draft.lines.map((l) => (l.key === key ? { ...l, ...part } : l)) });

  const problemText = (p: TextProblem, max: number) =>
    !tried || p === null ? undefined : p === 'both' ? tr('ws.supplies.checklists.editor.both') : tr('ws.supplies.checklists.editor.tooLong', { max: formatNumber(max, locale) });
  const shown = (message: string | null): string | undefined => (tried && message ? message : undefined);

  async function save() {
    setTried(true);
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      const res = await appRpc<{ template_id: string; version: number }>('save_checklist', {
        p_venue_id: null,
        p_template_id: templateId,
        p_expected_version: templateId ? state.baseVersion : 0,
        p_spec: specFromDraft(draft),
      });
      // What was saved is the new baseline; blank lines were dropped by the save.
      const saved: ChecklistDraft = {
        ...draft,
        name_en: draft.name_en.trim(),
        name_ar: draft.name_ar.trim(),
        lines: draft.lines.filter((l) => l.text_en.trim() !== '' || l.text_ar.trim() !== ''),
      };
      onSaved({ draft: saved, base: saved, baseVersion: res.version }, res.template_id);
      setTried(false);
      toast.ok(tr('ws.supplies.checklists.editor.saved'));
      void queryClient.invalidateQueries({ queryKey: ['checklists'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!templateId) return;
    setBusy(true);
    setError(null);
    try {
      await appRpc('archive_checklist', { p_template_id: templateId, p_expected_version: state.baseVersion });
      setConfirmArchive(false);
      toast.ok(tr('ws.supplies.checklists.editor.archived'));
      onArchived();
      void queryClient.invalidateQueries({ queryKey: ['checklists'] });
    } catch (e) {
      setConfirmArchive(false);
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const peopleById = new Map(people.map((p) => [p.id, p]));
  // A chosen person missing from the options (moved branch, left) stays listed, so the owner can take them off.
  const pickOptions = [
    ...people.map((p) => ({
      id: p.id,
      label: p.display_name,
      hint: p.away ? tr('ws.supplies.checklists.editor.personAway') : p.role ? tr(`op.roles.${p.role}`) : undefined,
    })),
    ...draft.staff_ids.filter((id) => !peopleById.has(id)).map((id) => ({ id, label: id })),
  ];

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', minInlineSize: 0 }} data-testid="checklist-editor">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: 'var(--tp-fs-lg)', fontWeight: 700, overflowWrap: 'anywhere' }}>
          <bdi>{templateId && name ? name : tr('ws.supplies.checklists.editor.newHeading')}</bdi>
        </h3>
        {dirty && <StatusBadge tone="warn" label={tr('ws.kit.actions.unsaved')} />}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', columnGap: 'var(--tp-sp-2-5)' }}>
        <Field label={tr('ws.supplies.checklists.editor.nameEn')} required error={draft.name_en.trim() === '' || draft.name_en.trim().length > MAX_NAME_LENGTH ? problemText(problems.name, MAX_NAME_LENGTH) : undefined}>
          <input style={inputStyle} dir="ltr" value={draft.name_en} maxLength={MAX_NAME_LENGTH + 20} disabled={busy} onChange={(e) => set({ name_en: e.target.value })} />
        </Field>
        <Field label={tr('ws.supplies.checklists.editor.nameAr')} required error={draft.name_ar.trim() === '' || draft.name_ar.trim().length > MAX_NAME_LENGTH ? problemText(problems.name, MAX_NAME_LENGTH) : undefined}>
          <input style={inputStyle} dir="rtl" value={draft.name_ar} maxLength={MAX_NAME_LENGTH + 20} disabled={busy} onChange={(e) => set({ name_ar: e.target.value })} />
        </Field>
      </div>

      {/* The plan: a label column and a control column, the settings-form shape. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(6.5rem, max-content) minmax(0, 1fr)', columnGap: 'var(--tp-sp-4)', rowGap: 'var(--tp-sp-3)', alignItems: 'start' }}>
        <PlanRow id={`${ids}-who`} label={tr('ws.supplies.checklists.editor.who')}>
          <SegmentedControl
            aria-labelledby={`${ids}-who`}
            value={draft.audience}
            onChange={(audience) => set({ audience })}
            options={[
              { value: 'role', label: tr('ws.supplies.checklists.editor.whoRole'), testId: 'checklist-who-role', disabled: busy },
              { value: 'people', label: tr('ws.supplies.checklists.editor.whoPeople'), testId: 'checklist-who-people', disabled: busy },
            ]}
          />
          {draft.audience === 'role' ? (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--tp-sp-3)', flexWrap: 'wrap' }}>
              <Field
                label={tr('ws.supplies.checklists.editor.role')}
                error={shown(problems.who === 'role' ? tr('ws.supplies.checklists.editor.roleNeeded') : null)}
                style={{ marginBlockEnd: 0, minInlineSize: '12rem' }}
              >
                <Select
                  value={draft.role}
                  disabled={busy}
                  placeholder={tr('ws.supplies.checklists.editor.rolePick')}
                  onChange={(role) => set({ role })}
                  options={CHECKLIST_ROLES.map((r) => ({ value: r, label: tr(`op.roles.${r}`) }))}
                />
              </Field>
              <div style={{ display: 'grid', gap: 'var(--tp-sp-0)', paddingBlockStart: 'var(--tp-sp-5)', maxInlineSize: '22rem' }}>
                <Switch checked={draft.copy_mode === 'each'} disabled={busy} onChange={(on) => set({ copy_mode: on ? 'each' : 'shared' })} label={tr('ws.supplies.checklists.editor.eachCopy')} />
                {draft.copy_mode === 'shared' && <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.supplies.checklists.editor.eachCopyHint')}</span>}
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', inlineSize: '100%', maxInlineSize: '28rem' }}>
              <MultiPickList
                label={tr('ws.supplies.checklists.editor.people')}
                options={pickOptions}
                value={draft.staff_ids}
                onChange={(staff_ids) => set({ staff_ids })}
                searchPlaceholder={tr('ws.supplies.checklists.editor.peopleSearch')}
                emptyText={tr('ws.supplies.checklists.editor.peopleNone')}
                footer={tr('ws.supplies.checklists.editor.peopleChosen', { count: formatNumber(draft.staff_ids.length, locale) })}
                disabled={busy}
                invalid={tried && problems.who !== null}
                optionTestId={(id) => `checklist-person-${id}`}
              />
              {peopleError != null && <ErrorText error={peopleError} style={{ marginBlock: 0 }} />}
              {tried && problems.who === 'people' && <FieldError>{tr('ws.supplies.checklists.editor.peopleNeeded')}</FieldError>}
              {tried && problems.who === 'tooManyPeople' && <FieldError>{tr('ws.supplies.checklists.editor.peopleTooMany', { max: formatNumber(MAX_PEOPLE, locale) })}</FieldError>}
              {awayChosen.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }} data-testid="checklist-people-away">
                  <span style={{ fontSize: 'var(--tp-fs-xs)', color: tried ? 'var(--tp-danger-fg)' : 'var(--tp-muted-fg)', overflowWrap: 'anywhere' }}>
                    {tr('ws.supplies.checklists.editor.peopleAway', {
                      names: awayChosen.map((id) => peopleById.get(id)?.display_name ?? id).join(locale === 'ar' ? '، ' : ', '),
                    })}
                  </span>
                  <Button size="sm" disabled={busy} onClick={() => set({ staff_ids: draft.staff_ids.filter((id) => !away.has(id)) })} data-testid="checklist-people-away-remove">
                    {tr('ws.supplies.checklists.editor.peopleAwayRemove')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </PlanRow>

        <PlanRow id={`${ids}-repeat`} label={tr('ws.supplies.checklists.editor.repeats')}>
          <SegmentedControl
            aria-labelledby={`${ids}-repeat`}
            value={draft.repeat}
            onChange={(preset) => onChange({ ...state, draft: withPreset(draft, preset) })}
            options={REPEAT_PRESETS.map((p) => ({ value: p, label: tr(`ws.supplies.checklists.editor.${PRESET_LABEL[p]}`), testId: `checklist-repeat-${p}`, disabled: busy }))}
          />
          {draft.repeat === 'weekdays' && (
            <div role="group" aria-labelledby={`${ids}-repeat`} style={{ display: 'flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
              {WEEKDAYS.map((d) => {
                const on = draft.weekdays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    disabled={busy}
                    data-testid={`checklist-weekday-${d}`}
                    onClick={() => set({ weekdays: toggleWeekday(draft.weekdays, d) })}
                    style={{
                      minBlockSize: 'var(--tp-row-h-dense)',
                      paddingInline: 'var(--tp-sp-2-5)',
                      borderRadius: 'var(--tp-radius-pill)',
                      border: `1px solid ${on ? 'var(--tp-accent)' : 'var(--tp-border-input)'}`,
                      background: on ? 'var(--tp-accent-soft)' : 'var(--tp-surface)',
                      color: on ? 'var(--tp-accent-soft-fg)' : 'var(--tp-fg)',
                      font: 'inherit',
                      fontSize: 'var(--tp-fs-sm)',
                      fontWeight: on ? 700 : 600,
                      cursor: busy ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {tr(`ws.supplies.checklists.weekday.${DAY_KEYS[d]!}`)}
                  </button>
                );
              })}
            </div>
          )}
          {(draft.repeat === 'monthly' || draft.repeat === 'twiceMonthly') && (
            <div style={{ display: 'flex', gap: 'var(--tp-sp-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {draft.month_days.slice(0, draft.repeat === 'monthly' ? 1 : Math.max(2, draft.month_days.length)).map((day, i, shownDays) => (
                <Field
                  key={i}
                  label={shownDays.length === 1 ? tr('ws.supplies.checklists.editor.monthDay') : tr('ws.supplies.checklists.editor.monthDayN', { n: formatNumber(i + 1, locale) })}
                  style={{ marginBlockEnd: 0, minInlineSize: '9rem' }}
                >
                  <Select
                    value={String(day)}
                    disabled={busy}
                    onChange={(v) => set({ month_days: draft.month_days.map((x, j) => (j === i ? Number(v) : x)) })}
                    options={[...new Set([...MONTH_DAY_CHOICES, day])]
                      .sort((a, b) => a - b)
                      .map((d) => ({ value: String(d), label: d >= LAST_DAY ? tr('ws.supplies.checklists.editor.lastDay') : formatNumber(d, locale) }))}
                  />
                </Field>
              ))}
            </div>
          )}
          {(draft.repeat === 'monthly' || draft.repeat === 'twiceMonthly') && (
            <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.supplies.checklists.editor.monthHint')}</span>
          )}
          {tried && problems.repeat === 'weekdays' && <FieldError>{tr('ws.supplies.checklists.editor.weekdaysNeeded')}</FieldError>}
          {tried && problems.repeat === 'sameDate' && <FieldError>{tr('ws.supplies.checklists.editor.sameDate')}</FieldError>}
        </PlanRow>

        <PlanRow id={`${ids}-due`} label={tr('ws.supplies.checklists.editor.due')}>
          <SegmentedControl
            aria-labelledby={`${ids}-due`}
            value={draft.due}
            onChange={(due) => set({ due })}
            options={DUE_KINDS.map((k) => ({ value: k, label: tr(`ws.supplies.checklists.editor.${DUE_LABEL[k]}`), testId: `checklist-due-${k}`, disabled: busy }))}
          />
          {draft.due === 'time' && (
            <Field label={tr('ws.supplies.checklists.editor.time')} error={shown(problems.due ? tr('ws.supplies.checklists.editor.timeNeeded') : null)} style={{ marginBlockEnd: 0, maxInlineSize: '10rem' }}>
              <input type="time" style={inputStyle} dir="ltr" value={draft.due_time} disabled={busy} onChange={(e) => set({ due_time: e.target.value })} data-testid="checklist-due-clock" />
            </Field>
          )}
          <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.supplies.checklists.editor.dueHint')}</span>
        </PlanRow>
      </div>

      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--tp-sp-2)' }}>
          <strong>{tr('ws.supplies.checklists.editor.lines')}</strong>
          <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>
            {tr('ws.supplies.checklists.editor.count', { count: formatNumber(filled, locale), max: formatNumber(MAX_LINES, locale) })}
            {photos > 0 && ` · ${tr('ws.supplies.checklists.editor.photoCount', { count: formatNumber(photos, locale) })}`}
          </span>
        </div>
        <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0 }}>{tr('ws.supplies.checklists.editor.photoLead')}</p>
        {draft.lines.length === 0 ? (
          <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', margin: 0 }}>{tr('ws.supplies.checklists.editor.emptyList')}</p>
        ) : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
            {draft.lines.map((l, index) => {
              const n = formatNumber(index + 1, locale);
              const p = problems.lines.get(l.key) ?? null;
              const message = problemText(p, MAX_LINE_LENGTH);
              return (
                <li key={l.key} style={{ display: 'grid', gap: 'var(--tp-sp-0)', paddingBlockEnd: 'var(--tp-sp-1-5)', borderBlockEnd: '1px solid var(--tp-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
                    <span style={{ inlineSize: '1.5rem', color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                    <input
                      style={{ ...inputStyle, flex: '1 1 12rem', minInlineSize: 0 }}
                      dir="ltr"
                      aria-label={tr('ws.supplies.checklists.editor.lineEn', { n })}
                      aria-invalid={message ? true : undefined}
                      placeholder={tr('ws.supplies.checklists.editor.lineEn', { n })}
                      value={l.text_en}
                      maxLength={MAX_LINE_LENGTH + 20}
                      disabled={busy}
                      onChange={(e) => setLine(l.key, { text_en: e.target.value })}
                    />
                    <input
                      style={{ ...inputStyle, flex: '1 1 12rem', minInlineSize: 0 }}
                      dir="rtl"
                      aria-label={tr('ws.supplies.checklists.editor.lineAr', { n })}
                      aria-invalid={message ? true : undefined}
                      placeholder={tr('ws.supplies.checklists.editor.lineAr', { n })}
                      value={l.text_ar}
                      maxLength={MAX_LINE_LENGTH + 20}
                      disabled={busy}
                      onChange={(e) => setLine(l.key, { text_ar: e.target.value })}
                    />
                    <Switch
                      checked={l.photo_required}
                      disabled={busy}
                      onChange={(next) => setLine(l.key, { photo_required: next })}
                      label={tr('ws.supplies.checklists.editor.photo')}
                      style={{ fontSize: 'var(--tp-fs-sm)', whiteSpace: 'nowrap' }}
                    />
                    <SortButtons
                      onUp={() => set({ lines: moveLine(draft.lines, index, 'up') })}
                      onDown={() => set({ lines: moveLine(draft.lines, index, 'down') })}
                      disabledUp={busy || index === 0}
                      disabledDown={busy || index === draft.lines.length - 1}
                    />
                    <Button
                      kind="ghost"
                      size="sm"
                      icon="x"
                      disabled={busy}
                      aria-label={tr('ws.supplies.checklists.editor.removeLine', { n })}
                      title={tr('ws.supplies.checklists.editor.removeLine', { n })}
                      onClick={() => set({ lines: draft.lines.filter((x) => x.key !== l.key) })}
                    />
                  </div>
                  {message && <span style={{ color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)', paddingInlineStart: 'calc(1.5rem + var(--tp-sp-2))' }}>{message}</span>}
                </li>
              );
            })}
          </ol>
        )}
        {full ? (
          <MessagePresenter tone="info" message={tr('ws.supplies.checklists.editor.full', { max: formatNumber(MAX_LINES, locale) })} />
        ) : (
          <div>
            <Button size="sm" icon="plus" disabled={busy} onClick={() => set({ lines: [...draft.lines, newLine()] })}>
              {tr('ws.supplies.checklists.editor.addLine')}
            </Button>
          </div>
        )}
      </div>

      {/* The plan in one sentence, as the saved list will read on the card. */}
      <p data-testid="checklist-summary" style={{ margin: 0, display: 'flex', gap: 'var(--tp-sp-1-5)', alignItems: 'baseline', fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>
        <Icon name="repeat" size={14} style={{ flex: '0 0 auto', color: 'var(--tp-muted-fg)', alignSelf: 'center' }} />
        <bdi style={{ overflowWrap: 'anywhere' }}>{draftSummary(draft, people, tr, locale)}</bdi>
      </p>

      {/* Said only for a list with a copy open now: for any other, a save
          reaches its next copy anyway, and the sentence was a rule about nothing. */}
      {openNow && <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0 }}>{tr('ws.supplies.checklists.editor.keepsToday')}</p>}
      {stale ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
          <ErrorText error={error} style={{ marginBlock: 0 }} />
          <Button
            size="sm"
            icon="refresh"
            onClick={() => {
              setError(null);
              setTried(false);
              onReload();
            }}
          >
            {tr('ws.supplies.checklists.editor.reload')}
          </Button>
        </div>
      ) : (
        <ErrorText error={error} />
      )}
      <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', flexWrap: 'wrap' }}>
        {templateId && (
          <Button kind="ghost" disabled={busy} onClick={() => setConfirmArchive(true)} data-testid="checklist-archive">
            {tr('ws.supplies.checklists.editor.archive')}
          </Button>
        )}
        <span style={{ flex: '1 1 auto' }} />
        <Button
          kind="ghost"
          disabled={!dirty || busy}
          onClick={() => {
            setTried(false);
            setError(null);
            onChange({ ...state, draft: state.base });
          }}
        >
          {tr('ws.supplies.checklists.editor.discard')}
        </Button>
        <Button
          kind="primary"
          icon="check"
          busy={busy}
          disabled={!dirty}
          disabledReason={!dirty ? tr('ws.manager.disabled.noChanges') : undefined}
          onClick={() => void save()}
        >
          {tr('ws.supplies.checklists.editor.save')}
        </Button>
      </div>
      {tried && invalid && <p style={{ color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)', margin: 0, textAlign: 'end' }}>{tr('ws.supplies.checklists.editor.invalid')}</p>}

      <ConfirmDialog
        open={confirmArchive}
        kind="danger"
        title={tr('ws.supplies.checklists.editor.archiveTitle', { name })}
        body={tr('ws.supplies.checklists.editor.archiveBody')}
        confirmLabel={tr('ws.supplies.checklists.editor.archive')}
        busy={busy}
        onConfirm={() => void archive()}
        onCancel={() => setConfirmArchive(false)}
      />
    </div>
  );
}

/** One row of the plan: its label, and its controls stacked beside it. */
function PlanRow({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <>
      <span id={id} style={{ fontWeight: 600, fontSize: 'var(--tp-fs-sm)', paddingBlockStart: 'var(--tp-sp-1-5)' }}>
        {label}
      </span>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start', minInlineSize: 0 }}>{children}</div>
    </>
  );
}

function FieldError({ children }: { children: ReactNode }) {
  return <span style={{ color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}>{children}</span>;
}
