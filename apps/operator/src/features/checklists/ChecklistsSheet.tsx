/**
 * The Checklists sheet, opened from the card on /protocols
 * (scheduled-checklists-2026-10-08 §4; first built for
 * build-contracts-2026-09-23 §5.4, §5.5).
 *
 *  - Today, for the manager and the owner: every list with its current
 *    copies (app.checklist_board): the shared copy, or one per person, each
 *    with when it is due, whether it is overdue, and who ticked each line and
 *    when. Nothing is ticked here: staff tick their lists on the phone, and
 *    the operator only reads. A line that needs a photo says so, and a ticked
 *    line's photo shows as a thumbnail that opens larger in place.
 *  - Edit the lists, for the owner (editChecklists): the lists on the left
 *    (name, who, repeats) with "New list", the editor on the right.
 *
 * No per-person history and nothing that ranks people (SOW:265, :480): the
 * read is the current copy of each list, and a missed one simply ends.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatNumber, formatTime, isolate } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { pickName, useLocale } from '../../lib/i18n';
import { Button, Modal, Tabs } from '../../components/ui';
import { AsyncStateWrapper, EmptyState, StatusBadge, asyncStatus } from '../../components/kit';
import { Icon } from '../../components/icons';
import { MARK, MARK_FG } from '../ops/OpsVisuals';
import { ChecklistEditor, newLine, type EditorState } from './ChecklistEditor';
import { StaffPhoto, StaffPhotoThumb } from './StaffPhoto';
import {
  CK,
  blankDraft,
  draftChanged,
  draftFromTemplate,
  dueLabel,
  findTemplate,
  planSummary,
  readBoard,
  readStaffOptions,
  repeatSummary,
  sortTemplates,
  templateLines,
  whoSummary,
  type Board,
  type BoardItem,
  type BoardRun,
  type BoardTemplate,
  type Person,
} from './checklistLogic';

export type SheetTab = 'today' | 'edit';
/** The editor's key for a list not saved yet. */
export const NEW_LIST = 'new';

/** A list as the editor starts it: the saved one, or a blank one. */
export function initialEditorState(board: Board, key: string): EditorState {
  const t = key === NEW_LIST ? null : findTemplate(board, key);
  const lineKey = () => newLine().key;
  const draft = t ? draftFromTemplate(t, lineKey) : blankDraft(lineKey);
  return { draft, base: draft, baseVersion: t?.version ?? 0 };
}

const peopleOf = (t: BoardTemplate) => t.assignees.map((p) => p.display_name);

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
  /** The list open in the editor: a template id, NEW_LIST, or null for the first one. */
  selected: string | null;
  onSelect: (key: string | null) => void;
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
  const now = new Date();
  return (
    <section
      data-list={t.template_id}
      style={{ border: '1px solid var(--tp-border)', borderRadius: 'var(--tp-radius-panel)', paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)', display: 'grid', gap: 'var(--tp-sp-2)' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--tp-sp-2)' }}>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0 }}>
          <h3 style={{ fontSize: 'var(--tp-fs-md)', fontWeight: 700, overflowWrap: 'anywhere' }}>
            <bdi>{pickName(locale, t)}</bdi>
          </h3>
          <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{planSummary(t, peopleOf(t), tr, locale)}</span>
        </div>
        {t.runs.length === 0 && (
          <StatusBadge size="sm" tone="neutral" dot={false} label={tr('ws.supplies.checklists.editor.lineCount', { count: formatNumber(t.items.length, locale) })} />
        )}
      </div>
      {t.runs.length === 0 ? (
        <>
          <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0 }}>{tr('ws.supplies.checklists.notOpened')}</p>
          <Lines lines={templateLines(t)} live={false} />
        </>
      ) : (
        t.runs.map((r) => <TodayRun key={r.run_id} run={r} now={now} multiple={t.runs.length > 1 || r.assignee_name !== null} />)
      )}
    </section>
  );
}

/** One current copy: whose it is (on a person's copy), when it is due, and its lines. */
function TodayRun({ run: r, now, multiple }: { run: BoardRun; now: Date; multiple: boolean }) {
  const { tr, locale } = useLocale();
  const finished = r.total > 0 && r.done >= r.total;
  const overdue = r.overdue && !finished;
  const due = dueLabel(r.due_at, now, tr, locale);
  return (
    <div
      data-run={r.run_id}
      style={{
        display: 'grid',
        gap: 'var(--tp-sp-1-5)',
        ...(multiple ? { paddingBlockStart: 'var(--tp-sp-2)', borderBlockStart: '1px solid var(--tp-border)' } : null),
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap', minInlineSize: 0, fontSize: 'var(--tp-fs-sm)' }}>
          {r.assignee_name && (
            <strong style={{ overflowWrap: 'anywhere' }}>
              <bdi>{r.assignee_name}</bdi>
            </strong>
          )}
          {due && <span style={{ color: overdue ? MARK_FG.danger : 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>{due}</span>}
        </span>
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)', alignItems: 'center' }}>
          {overdue && <StatusBadge size="sm" tone="danger" label={tr('ws.supplies.checklists.overdue')} />}
          <StatusBadge
            size="sm"
            tone={finished ? 'success' : overdue ? 'neutral' : 'warn'}
            label={finished ? tr('ws.supplies.checklists.finished') : tr('ws.supplies.checklists.progress', { done: formatNumber(r.done, locale), total: formatNumber(r.total, locale) })}
          />
        </span>
      </div>
      <Lines lines={r.items} live />
    </div>
  );
}

function Lines({ lines, live }: { lines: readonly BoardItem[]; live: boolean }) {
  const { tr, locale } = useLocale();
  // One photo open at a time, under its own line: the sheet is already a dialog.
  const [open, setOpen] = useState<number | null>(null);
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
      {lines.map((l, i) => {
        const done = l.done_at !== null;
        const text = locale === 'ar' ? l.text_ar : l.text_en;
        return (
          <li key={i} data-line={i + 1} style={{ display: 'grid', gap: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-sm)' }}>
            <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'flex-start' }}>
              <Icon name={done ? 'checkCircle' : 'minus'} size={16} style={{ flex: '0 0 auto', marginBlockStart: '0.1rem', color: done ? MARK.success : 'var(--tp-muted-fg)' }} />
              <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0, flex: '1 1 auto' }}>
                <bdi style={{ color: done ? undefined : live ? MARK_FG.warn : 'var(--tp-muted-fg)', overflowWrap: 'anywhere' }}>{text}</bdi>
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
  selected: string | null;
  onSelect: (key: string | null) => void;
  editors: Record<string, EditorState>;
  onEditor: (key: string, state: EditorState | null) => void;
  onReload: (key: string) => void;
}) {
  const { tr, locale } = useLocale();
  const templates = sortTemplates(board.templates);
  // A list just created stays open while the board catches up with it (the
  // save's refetch has not landed yet), instead of jumping to another list or
  // a blank form.
  const [created, setCreated] = useState<string | null>(null);
  // A list chosen earlier that is gone (archived elsewhere) falls back to the first.
  const key =
    selected === NEW_LIST || (selected && (findTemplate(board, selected) || (selected === created && editors[selected])))
      ? selected
      : (templates[0]?.template_id ?? NEW_LIST);
  const template = key === NEW_LIST ? null : findTemplate(board, key);
  // The id the editor saves to: the board's list, or the one just created.
  const editingId = template?.template_id ?? (key !== NEW_LIST && key === created ? created : null);

  const staffQ = useQuery({
    queryKey: CK.staff,
    queryFn: () => appRpc<unknown>('checklist_staff_options', {}),
    staleTime: 60_000,
  });
  // The branch's people, plus anyone a saved list names who is not among them
  // any more: marked away once the options have loaded, so the picker says who
  // and the editor stops a save the server would refuse (ASSIGNEE_NOT_AT_BRANCH).
  const loaded = staffQ.isSuccess;
  const people = useMemo<Person[]>(() => {
    const options = readStaffOptions(staffQ.data);
    const known = new Set(options.map((p) => p.id));
    const extra = board.templates
      .flatMap((t) => t.assignees)
      .filter((p) => !known.has(p.id) && known.add(p.id))
      .map((p) => (loaded ? { ...p, away: true } : p));
    return [...options, ...extra];
  }, [staffQ.data, board, loaded]);

  // Until the first keystroke the list has no stored state; its starting
  // point is kept per board read, so the line keys do not change under a
  // focused box on every render.
  const initial = useMemo(() => initialEditorState(board, key), [board, key]);
  const state = editors[key] ?? initial;
  const newDirty = editors[NEW_LIST] ? draftChanged(editors[NEW_LIST].draft, editors[NEW_LIST].base) : false;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(15rem, 19rem) minmax(0, 1fr)', gap: 'var(--tp-sp-4)', alignItems: 'start' }}>
      <nav aria-label={tr('ws.supplies.checklists.editor.pick')} style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', maxBlockSize: '65vh', overflowY: 'auto' }}>
        <Button icon="plus" kind={key === NEW_LIST ? 'primary' : 'default'} aria-pressed={key === NEW_LIST} onClick={() => onSelect(NEW_LIST)} data-testid="checklist-new">
          {newDirty ? `${tr('ws.supplies.checklists.editor.newList')} · ${tr('ws.kit.actions.unsaved')}` : tr('ws.supplies.checklists.editor.newList')}
        </Button>
        {templates.length === 0 && <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0 }}>{tr('ws.supplies.checklists.editor.noLists')}</p>}
        {templates.map((t) => {
          const edited = editors[t.template_id];
          const dirty = edited ? draftChanged(edited.draft, edited.base) : false;
          const isSelected = t.template_id === key;
          return (
            <button
              key={t.template_id}
              type="button"
              className="tp-row"
              data-clickable="true"
              data-selected={isSelected ? 'true' : undefined}
              aria-pressed={isSelected}
              data-testid={`checklist-list-${t.template_id}`}
              onClick={() => onSelect(t.template_id)}
              style={{
                display: 'grid',
                gap: 'var(--tp-sp-0)',
                textAlign: 'start',
                paddingBlock: 'var(--tp-sp-1-5)',
                paddingInline: 'var(--tp-sp-2)',
                borderRadius: 'var(--tp-radius-ctl)',
                border: `1px solid ${isSelected ? 'var(--tp-accent)' : 'var(--tp-border)'}`,
                background: isSelected ? 'var(--tp-accent-soft)' : 'var(--tp-surface)',
                color: 'inherit',
                font: 'inherit',
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: isSelected ? 700 : 600, overflowWrap: 'anywhere' }}>
                <bdi>{pickName(locale, t)}</bdi>
              </span>
              <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', overflowWrap: 'anywhere' }}>{whoSummary(t, peopleOf(t), tr, locale)}</span>
              <span style={{ fontSize: 'var(--tp-fs-xs)', color: dirty ? MARK_FG.warn : 'var(--tp-muted-fg)' }}>
                {dirty ? tr('ws.kit.actions.unsaved') : repeatSummary(t, tr, locale)}
              </span>
            </button>
          );
        })}
      </nav>
      <ChecklistEditor
        key={key}
        templateId={editingId}
        state={state}
        people={people}
        peopleError={staffQ.error}
        onChange={(next) => onEditor(key, next)}
        onSaved={(next, id) => {
          if (key === NEW_LIST) {
            setCreated(id);
            onEditor(NEW_LIST, null);
            onEditor(id, next);
            onSelect(id);
          } else onEditor(key, next);
        }}
        onReload={() => onReload(key)}
        onArchived={() => {
          onEditor(key, null);
          onSelect(null);
        }}
        openNow={(template?.runs.length ?? 0) > 0}
      />
    </div>
  );
}
