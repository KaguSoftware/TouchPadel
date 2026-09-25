/**
 * The Daily checklists sheet, opened from the card on /protocols
 * (build-contracts-2026-09-23 §5.4, §5.5; plan §7.1).
 *
 *  - Today, for the manager and the owner: every list with its lines, who
 *    ticked each one and when (app.checklist_board). A list nobody opened
 *    today shows its lines untouched. Nothing is ticked here: the staff tick
 *    their lists on the phone, and the operator only reads. A line that needs
 *    a photo says so, and a ticked line's photo shows as a thumbnail that
 *    opens larger in place (checklist_photos, §2.24.8, §5.5).
 *  - Edit the lists, for the owner (editChecklists): one list per role and
 *    slot, chosen on the left, written on the right (ChecklistEditor).
 *
 * No per-person history and nothing that ranks people (SOW:265, :480): the
 * read is one business day.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatNumber, formatTime, isolate, makeT } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { pickName, useLocale } from '../../lib/i18n';
import type { StaffRole } from '../../lib/auth';
import { Modal, Tabs } from '../../components/ui';
import { AsyncStateWrapper, EmptyState, StatusBadge, asyncStatus } from '../../components/kit';
import { Icon } from '../../components/icons';
import { MARK, MARK_FG } from '../ops/OpsVisuals';
import { ChecklistEditor, newLine, type EditorState } from './ChecklistEditor';
import { StaffPhoto, StaffPhotoThumb } from './StaffPhoto';
import {
  CHECKLIST_ROLES,
  CHECKLIST_SLOTS,
  CK,
  dayLines,
  draftChanged,
  findTemplate,
  readBoard,
  sortTemplates,
  type Board,
  type BoardTemplate,
  type ChecklistDraft,
  type ChecklistSlot,
} from './checklistLogic';

export type SheetTab = 'today' | 'edit';
export const listKey = (role: StaffRole, slot: ChecklistSlot) => `${role}:${slot}`;

const en = makeT('en');
const ar = makeT('ar');

/** A list as the editor starts it: the saved one, or a new one named after its role and slot in both languages. */
export function initialEditorState(board: Board, role: StaffRole, slot: ChecklistSlot): EditorState {
  const t = findTemplate(board, role, slot);
  const draft: ChecklistDraft = t
    ? {
        name_en: t.name_en,
        name_ar: t.name_ar,
        lines: t.items.map((i) => ({ key: crypto.randomUUID(), text_en: i.text_en, text_ar: i.text_ar, photo_required: i.photo_required })),
      }
    : {
        name_en: en('ws.supplies.checklists.editor.defaultName', { role: en(`op.roles.${role}`), slot: en(`work.checklist.slot.${slot}`) }),
        name_ar: ar('ws.supplies.checklists.editor.defaultName', { role: ar(`op.roles.${role}`), slot: ar(`work.checklist.slot.${slot}`) }),
        lines: [newLine()],
      };
  // A new list's baseline has no lines: typing its first line is the change.
  return { draft, base: t ? draft : { ...draft, lines: [] }, baseVersion: t?.version ?? 0 };
}

export function ChecklistsSheet({
  date,
  tab,
  onTab,
  canEdit,
  selected,
  onSelect,
  editors,
  onEditor,
  onClose,
}: {
  date: string;
  tab: SheetTab;
  onTab: (tab: SheetTab) => void;
  canEdit: boolean;
  selected: { role: StaffRole; slot: ChecklistSlot };
  onSelect: (role: StaffRole, slot: ChecklistSlot) => void;
  /** Every list's editing state, held by the card so closing the sheet loses nothing. */
  editors: Record<string, EditorState>;
  onEditor: (key: string, state: EditorState | null) => void;
  onClose: () => void;
}) {
  const { tr } = useLocale();
  const q = useQuery({
    queryKey: CK.board(date),
    queryFn: () => appRpc<unknown>('checklist_board', { p_business_date: date }),
    refetchInterval: 60_000,
  });
  const board = useMemo(() => readBoard(q.data), [q.data]);
  const status = asyncStatus(q, () => false);

  return (
    <Modal title={tr('ws.supplies.checklists.title')} onClose={onClose} size="xl">
      {canEdit && (
        <Tabs<SheetTab>
          value={tab}
          onChange={onTab}
          items={[
            { id: 'today', label: tr('ws.supplies.checklists.tabToday') },
            { id: 'edit', label: tr('ws.supplies.checklists.tabEdit') },
          ]}
          style={{ marginBlockEnd: 'var(--tp-sp-3)' }}
        />
      )}
      <AsyncStateWrapper status={status} error={q.error} onRetry={() => void q.refetch()}>
        {tab === 'edit' && canEdit ? (
          <EditLists
            board={board}
            selected={selected}
            onSelect={onSelect}
            editors={editors}
            onEditor={onEditor}
            // Someone saved the list meanwhile (TEMPLATE_CHANGED): read the
            // board again, then start the draft over from what it holds.
            onReload={(key) => void q.refetch().then(() => onEditor(key, null))}
          />
        ) : (
          <TodayLists board={board} />
        )}
      </AsyncStateWrapper>
    </Modal>
  );
}

function TodayLists({ board }: { board: Board }) {
  const { tr } = useLocale();
  const templates = sortTemplates(board.templates);
  if (templates.length === 0) return <EmptyState compact icon="checkCircle" title={tr('ws.supplies.checklists.noTemplates')} />;
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0 }}>{tr('ws.supplies.checklists.todayLead')}</p>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', gridTemplateColumns: 'repeat(auto-fill, minmax(20rem, 1fr))', alignItems: 'start' }}>
        {templates.map((t) => (
          <TodayList key={t.template_id} template={t} />
        ))}
      </div>
    </div>
  );
}

function TodayList({ template: t }: { template: BoardTemplate }) {
  const { tr, locale } = useLocale();
  const today = t.today;
  const finished = today !== null && today.total > 0 && today.done >= today.total;
  const lines = dayLines(t);
  // One photo open at a time, under its own line: the sheet is already a dialog.
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section
      data-list={`${t.role}:${t.slot}`}
      style={{ border: '1px solid var(--tp-border)', borderRadius: 'var(--tp-radius-panel)', paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)', display: 'grid', gap: 'var(--tp-sp-2)' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--tp-sp-2)' }}>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0 }}>
          <h3 style={{ fontSize: 'var(--tp-fs-md)', fontWeight: 700, overflowWrap: 'anywhere' }}>
            <bdi>{pickName(locale, t)}</bdi>
          </h3>
          <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
            {tr('ws.supplies.checklists.row', { role: tr(`op.roles.${t.role}`), slot: tr(`work.checklist.slot.${t.slot}`) })}
          </span>
        </div>
        {today === null ? (
          <StatusBadge size="sm" tone="neutral" dot={false} label={tr('ws.supplies.checklists.editor.lineCount', { count: formatNumber(t.items.length, locale) })} />
        ) : (
          <StatusBadge
            size="sm"
            tone={finished ? 'success' : 'warn'}
            label={finished ? tr('ws.supplies.checklists.finished') : tr('ws.supplies.checklists.progress', { done: formatNumber(today.done, locale), total: formatNumber(today.total, locale) })}
          />
        )}
      </div>
      {today === null && <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0 }}>{tr('ws.supplies.checklists.notOpened')}</p>}
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
        {lines.map((l, i) => {
          const done = l.done_at !== null;
          const text = locale === 'ar' ? l.text_ar : l.text_en;
          return (
            <li key={i} data-line={i + 1} style={{ display: 'grid', gap: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-sm)' }}>
              <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'flex-start' }}>
                <Icon
                  name={done ? 'checkCircle' : 'minus'}
                  size={16}
                  style={{ flex: '0 0 auto', marginBlockStart: '0.1rem', color: done ? MARK.success : 'var(--tp-muted-fg)' }}
                />
                <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0, flex: '1 1 auto' }}>
                  <bdi style={{ color: done ? undefined : today ? MARK_FG.warn : 'var(--tp-muted-fg)', overflowWrap: 'anywhere' }}>{text}</bdi>
                  {done && (
                    <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)' }}>
                      {tr('ws.supplies.checklists.ticked', { name: isolate(l.done_by_name ?? '—'), time: formatTime(new Date(l.done_at as string), locale) })}
                    </span>
                  )}
                  {l.photo_required && !l.photo_path && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)' }}>
                      <Icon name="frame" size={12} />
                      {tr('ws.supplies.checklists.photoNeeded')}
                    </span>
                  )}
                  {l.note && (
                    <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)', fontStyle: 'italic', overflowWrap: 'anywhere' }}>
                      <bdi>{l.note}</bdi>
                    </span>
                  )}
                </span>
                {l.photo_path && (
                  <StaffPhotoThumb
                    path={l.photo_path}
                    label={tr(open === i ? 'ws.supplies.checklists.hidePhoto' : 'ws.supplies.checklists.seePhoto', { line: text })}
                    expanded={open === i}
                    onClick={() => setOpen(open === i ? null : i)}
                  />
                )}
              </div>
              {l.photo_path && open === i && (
                <StaffPhoto path={l.photo_path} alt={tr('ws.supplies.checklists.photoAlt', { line: text })} style={{ marginInlineStart: 'calc(16px + var(--tp-sp-2))' }} />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function EditLists({
  board,
  selected,
  onSelect,
  editors,
  onEditor,
  onReload,
}: {
  board: Board;
  selected: { role: StaffRole; slot: ChecklistSlot };
  onSelect: (role: StaffRole, slot: ChecklistSlot) => void;
  editors: Record<string, EditorState>;
  onEditor: (key: string, state: EditorState | null) => void;
  onReload: (key: string) => void;
}) {
  const { tr, locale } = useLocale();
  const key = listKey(selected.role, selected.slot);
  // Until the first keystroke the list has no stored state; its starting
  // point is kept per board read, so the line keys do not change under a
  // focused box on every render.
  const initial = useMemo(() => initialEditorState(board, selected.role, selected.slot), [board, selected.role, selected.slot]);
  const state = editors[key] ?? initial;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(15rem, 19rem) minmax(0, 1fr)', gap: 'var(--tp-sp-4)', alignItems: 'start' }}>
      <nav aria-label={tr('ws.supplies.checklists.editor.pick')} style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', maxBlockSize: '60vh', overflowY: 'auto' }}>
        {CHECKLIST_ROLES.map((role) => (
          <div key={role} style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
            <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>{tr(`op.roles.${role}`)}</span>
            <div style={{ display: 'flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
              {CHECKLIST_SLOTS.map((slot) => {
                const t = findTemplate(board, role, slot);
                const edited = editors[listKey(role, slot)];
                const dirty = edited ? draftChanged(edited.draft, edited.base) : false;
                const isSelected = role === selected.role && slot === selected.slot;
                const lines = t ? t.items.length : 0;
                return (
                  <button
                    key={slot}
                    type="button"
                    className="tp-row"
                    data-clickable="true"
                    data-selected={isSelected ? 'true' : undefined}
                    aria-pressed={isSelected}
                    data-pick={listKey(role, slot)}
                    onClick={() => onSelect(role, slot)}
                    style={{
                      flex: '1 1 7rem',
                      display: 'grid',
                      gap: 'var(--tp-sp-0)',
                      textAlign: 'start',
                      paddingBlock: 'var(--tp-sp-1)',
                      paddingInline: 'var(--tp-sp-2)',
                      borderRadius: 'var(--tp-radius-ctl)',
                      border: `1px solid ${isSelected ? 'var(--tp-accent)' : 'var(--tp-border)'}`,
                      background: isSelected ? 'var(--tp-accent-soft)' : 'var(--tp-surface)',
                      color: 'inherit',
                      font: 'inherit',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: isSelected ? 700 : 600 }}>{tr(`work.checklist.slot.${slot}`)}</span>
                    <span style={{ fontSize: 'var(--tp-fs-xs)', color: dirty ? MARK_FG.warn : 'var(--tp-muted-fg)' }}>
                      {dirty
                        ? tr('ws.kit.actions.unsaved')
                        : t
                          ? tr('ws.supplies.checklists.editor.lineCount', { count: formatNumber(lines, locale) })
                          : tr('ws.supplies.checklists.editor.noList')}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <ChecklistEditor
        key={key}
        role={selected.role}
        slot={selected.slot}
        state={state}
        onChange={(next) => onEditor(key, next)}
        onSaved={(next) => onEditor(key, next)}
        onReload={() => onReload(key)}
        openedToday={findTemplate(board, selected.role, selected.slot)?.today != null}
      />
    </div>
  );
}
