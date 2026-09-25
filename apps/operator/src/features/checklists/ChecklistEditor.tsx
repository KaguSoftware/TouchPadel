/**
 * The owner's editor for one daily list: one role, opening or closing, EN and
 * AR (build-contracts-2026-09-23 §2.14; plan §7.1 "Daily checklists card").
 * A capped, ordered list in the SuggestedEditor style: add, move, remove, at
 * most 30 lines, every line in both languages. Save replaces the list whole
 * through app.save_checklist_template.
 *
 * Each line has a "Needs a photo" switch (checklist_photos, §2.24.8, plan
 * #69): the phone then ticks that line only with a photo, which the manager
 * sees under Today. Photos are never taken or ticked on the desktop.
 *
 * The draft is not this component's: the card holds every list's draft, so
 * moving to another list or closing the sheet loses nothing typed. A save
 * sends the version the draft was started from; if someone saved in between
 * the server refuses (TEMPLATE_CHANGED) and "Load the latest" starts again
 * from what is saved. A list someone already opened today keeps its lines
 * (the day's run is a snapshot), which the editor says beside Save.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatNumber } from '@touch/i18n';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, inputStyle } from '../../components/ui';
import { MessagePresenter, StatusBadge } from '../../components/kit';
import { SortButtons } from '../../components/inputs';
import { Switch } from '../../components/Switch';
import type { StaffRole } from '../../lib/auth';
import {
  MAX_LINES,
  MAX_LINE_LENGTH,
  MAX_NAME_LENGTH,
  draftChanged,
  draftProblems,
  moveLine,
  photoLineCount,
  savePayloadItems,
  type ChecklistDraft,
  type DraftLine,
  type ChecklistSlot,
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

export function ChecklistEditor({
  role,
  slot,
  state,
  onChange,
  onSaved,
  onReload,
}: {
  role: StaffRole;
  slot: ChecklistSlot;
  state: EditorState;
  onChange: (next: EditorState) => void;
  onSaved: (next: EditorState) => void;
  /** Start again from what is saved now (after TEMPLATE_CHANGED). */
  onReload: () => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const { draft } = state;
  const problems = draftProblems(draft);
  const dirty = draftChanged(draft, state.base);
  const filled = savePayloadItems(draft).length;
  const photos = photoLineCount(draft);
  const full = draft.lines.length >= MAX_LINES;
  const invalid = problems.name !== null || problems.lines.size > 0 || problems.tooMany;
  const stale = error instanceof AppRpcError && error.code === 'TEMPLATE_CHANGED';

  const set = (part: Partial<ChecklistDraft>) => onChange({ ...state, draft: { ...draft, ...part } });
  const setLine = (key: string, part: Partial<Omit<DraftLine, 'key'>>) =>
    set({ lines: draft.lines.map((l) => (l.key === key ? { ...l, ...part } : l)) });

  const problemText = (p: TextProblem, max: number) =>
    !tried || p === null ? undefined : p === 'both' ? tr('ws.supplies.checklists.editor.both') : tr('ws.supplies.checklists.editor.tooLong', { max: formatNumber(max, locale) });

  async function save() {
    setTried(true);
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      const res = await appRpc<{ template_id: string; version: number }>('save_checklist_template', {
        p_venue_id: null,
        p_role: role,
        p_slot: slot,
        p_expected_version: state.baseVersion,
        p_name_en: draft.name_en.trim(),
        p_name_ar: draft.name_ar.trim(),
        p_items: savePayloadItems(draft),
      });
      // What was saved is the new baseline; blank lines were dropped by the save.
      const saved: ChecklistDraft = {
        name_en: draft.name_en.trim(),
        name_ar: draft.name_ar.trim(),
        lines: draft.lines.filter((l) => l.text_en.trim() !== '' || l.text_ar.trim() !== ''),
      };
      onSaved({ draft: saved, base: saved, baseVersion: res.version });
      setTried(false);
      toast.ok(tr('ws.supplies.checklists.editor.saved'));
      void queryClient.invalidateQueries({ queryKey: ['checklists'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', minInlineSize: 0 }} data-testid="checklist-editor">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: 'var(--tp-fs-lg)', fontWeight: 700 }}>
          {tr('ws.supplies.checklists.editor.heading', { role: tr(`op.roles.${role}`), slot: tr(`work.checklist.slot.${slot}`) })}
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

      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0 }}>{tr('ws.supplies.checklists.editor.keepsToday')}</p>
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
      <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
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
    </div>
  );
}
