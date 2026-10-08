/**
 * Checklists: the fifth card on /protocols (build-contracts-2026-09-23 §5.4;
 * plan §7.1; scheduled-checklists-2026-10-08 §4). D2's page mounts it as
 * `<ChecklistsCard />`; it takes no props and reads everything itself.
 *
 * The card answers "are the current lists getting done?" from
 * app.checklist_day_state: one row per current copy (a shared list, or one
 * person's copy) with its name, who it is for, how it repeats and when it is
 * due. Overdue copies come first, tagged; then the least done; then the
 * finished. The repeat summary and a people list's names come from the same
 * app.checklist_board read the sheet opens with, and a row simply goes
 * without them until it answers. "See today" opens every list with who
 * ticked what (ChecklistsSheet); the owner also gets "Edit the lists"
 * (editChecklists). Staff tick their lists on the phone, never here.
 *
 * The card holds every list's unsaved draft, so closing the sheet to look at
 * something else on the page loses nothing typed; the card says when a draft
 * is waiting.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatNumber } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { QK } from '../../lib/queries';
import { can, useAuth } from '../../lib/auth';
import { pickName, useLocale } from '../../lib/i18n';
import { useBusinessToday } from '../../lib/settings';
import { Button, ErrorText, Skeleton } from '../../components/ui';
import { EmptyState, Panel, StatusBadge } from '../../components/kit';
import { CardTitle, MARK, MARK_FG } from '../ops/OpsVisuals';
import type { EditorState } from './ChecklistEditor';
import { ChecklistsSheet, type SheetTab } from './ChecklistsSheet';
import { CK, cardRows, dayListKey, daySummary, draftChanged, dueLabel, isOverdue, isUnfinished, readBoard, readDayState, repeatSummary, whoSummary } from './checklistLogic';

/** Rows on the card before "+N more": the sheet has the rest. */
const ROWS_SHOWN = 5;

export function ChecklistsCard() {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const canEdit = can(staff?.role, 'editChecklists');
  const today = useBusinessToday();
  // The RPC's payload as returned: day close shares this key family.
  const q = useQuery({
    queryKey: QK.checklistDayState.date(today),
    queryFn: () => appRpc<unknown>('checklist_day_state', { p_business_date: today }),
    refetchInterval: 60_000,
  });
  const state = useMemo(() => readDayState(q.data), [q.data]);
  const summary = daySummary(state);
  const rows = cardRows(state);

  const [sheet, setSheet] = useState<SheetTab | null>(null);
  // The board, for each list's repeat summary and a people list's names; the sheet opens on the same read.
  const boardQ = useQuery({
    queryKey: CK.board(today),
    queryFn: () => appRpc<unknown>('checklist_board', { p_business_date: today }),
    refetchInterval: 60_000,
  });
  const templates = useMemo(() => new Map(readBoard(boardQ.data).templates.map((t) => [t.template_id, t])), [boardQ.data]);
  const now = new Date();

  const [selected, setSelected] = useState<string | null>(null);
  const [editors, setEditors] = useState<Record<string, EditorState>>({});
  const unsaved = Object.values(editors).some((e) => draftChanged(e.draft, e.base));

  function setEditor(key: string, next: EditorState | null) {
    setEditors((all) => {
      const copy = { ...all };
      if (next) copy[key] = next;
      else delete copy[key];
      return copy;
    });
  }

  // With nothing due today the owner's way in is the empty state's own button.
  const empty = q.isSuccess && summary.total === 0;
  const actions = (
    <span style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
      {unsaved && <StatusBadge size="sm" tone="warn" label={tr('ws.kit.actions.unsaved')} />}
      {canEdit && !(empty && !unsaved) && (
        <Button size="sm" kind="ghost" icon="settings" onClick={() => setSheet('edit')}>
          {tr('ws.supplies.checklists.edit')}
        </Button>
      )}
      {/* Opens the sheet over this page, so no "leaves the page" arrow. */}
      <Button size="sm" onClick={() => setSheet('today')}>
        {tr('ws.supplies.checklists.open')}
      </Button>
    </span>
  );

  return (
    <Panel title={<CardTitle icon="checkCircle">{tr('ws.supplies.checklists.title')}</CardTitle>} data-testid="checklists-card">
      {q.isError ? (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
          <ErrorText error={q.error} style={{ marginBlock: 0 }} />
          <Button size="sm" icon="refresh" onClick={() => void q.refetch()}>
            {tr('ws.kit.async.retry')}
          </Button>
        </div>
      ) : q.isPending ? (
        <Skeleton lines={3} />
      ) : summary.total === 0 ? (
        <EmptyState
          compact
          icon="checkCircle"
          title={tr('ws.supplies.checklists.noneTitle')}
          body={tr(canEdit ? 'ws.supplies.checklists.noneOwner' : 'ws.supplies.checklists.noneManager')}
          action={
            canEdit ? (
              <Button size="sm" kind="primary" icon="plus" onClick={() => setSheet('edit')}>
                {tr('ws.supplies.checklists.write')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
          <p style={{ margin: 0, fontWeight: 600, color: summary.finished === summary.total ? MARK_FG.success : undefined }}>
            {summary.finished === summary.total
              ? tr('ws.supplies.checklists.allDone')
              : tr('ws.supplies.checklists.summary', { done: formatNumber(summary.finished, locale), total: formatNumber(summary.total, locale) })}
          </p>
          {/* An unfinished list is not yet a problem: a closing list is 0 of 5 all
              afternoon. So progress is neutral and only Finished takes a colour,
              until the list is past its due time: then it is Overdue, in danger,
              and the server put it first. Nothing is blocked by it. */}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
            {rows.slice(0, ROWS_SHOWN).map((l) => {
              const open = isUnfinished(l);
              const late = isOverdue(l);
              const pct = l.total === 0 ? 100 : Math.round((l.done / l.total) * 100);
              const t = l.template_id ? templates.get(l.template_id) : undefined;
              // Who: the person this copy is for, else the role, else (a people list nobody has a copy of yet) its people.
              const who =
                l.assignee_name ?? (l.role ? tr(`op.roles.${l.role}`) : t ? whoSummary(t, t.assignees.map((p) => p.display_name), tr, locale) : '');
              const due = dueLabel(l.due_at, now, tr, locale);
              const meta = [who, t ? repeatSummary(t, tr, locale) : '', due ?? ''].filter((x) => x !== '');
              return (
                <li key={dayListKey(l)} data-list={dayListKey(l)} data-overdue={late ? 'true' : undefined} style={{ display: 'grid', gap: 'var(--tp-sp-0)', fontSize: 'var(--tp-fs-sm)' }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--tp-sp-2)' }}>
                    <span style={{ fontWeight: 600, minInlineSize: 0, overflowWrap: 'anywhere' }}>
                      <bdi>{pickName(locale, l) || tr(`work.checklist.slot.${l.slot}`)}</bdi>
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', flex: '0 0 auto' }}>
                      {late && <StatusBadge size="sm" tone="danger" label={tr('ws.supplies.checklists.overdue')} />}
                      <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: open ? MARK_FG.neutral : MARK_FG.success }}>
                        {open
                          ? tr('ws.supplies.checklists.progress', { done: formatNumber(l.done, locale), total: formatNumber(l.total, locale) })
                          : tr('ws.supplies.checklists.finished')}
                      </span>
                    </span>
                  </span>
                  {meta.length > 0 && (
                    <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)', overflowWrap: 'anywhere' }}>
                      {meta.map((m, i) => (
                        <span key={i}>
                          {i > 0 && <span aria-hidden="true"> · </span>}
                          <bdi>{m}</bdi>
                        </span>
                      ))}
                    </span>
                  )}
                  <span aria-hidden="true" style={{ blockSize: 'var(--tp-sp-1)', borderRadius: 'var(--tp-radius-pill)', background: 'var(--tp-surface-2)', overflow: 'hidden' }}>
                    <span style={{ display: 'block', blockSize: '100%', inlineSize: `${pct}%`, background: open ? (late ? MARK.danger : MARK.neutral) : MARK.success }} />
                  </span>
                </li>
              );
            })}
          </ul>
          {rows.length > ROWS_SHOWN && (
            <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
              {tr('ws.supplies.checklists.moreLists', { count: formatNumber(rows.length - ROWS_SHOWN, locale) })}
            </span>
          )}
        </div>
      )}
      <div style={{ marginBlockStart: 'var(--tp-sp-3)' }}>{actions}</div>

      {sheet && (
        <ChecklistsSheet
          date={today}
          tab={sheet}
          onTab={setSheet}
          canEdit={canEdit}
          selected={selected}
          onSelect={setSelected}
          editors={editors}
          onEditor={setEditor}
          onClose={() => setSheet(null)}
        />
      )}
    </Panel>
  );
}
