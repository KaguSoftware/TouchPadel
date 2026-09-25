/**
 * Recipe changes (role spec #71): the sixth card on /protocols, and the sheet
 * each request opens (build-contracts-2026-09-23 §5.4).
 *
 * A head barista or head chef asks, on the phone, to change a drink's,
 * dessert's or prepared item's recipe; they cannot read its quantities (#72),
 * so they send what should change. Here management sees the recipe as it is
 * and as it would be, with quantities, because this page is MGMT only. The
 * owner approves (the server writes it through app.set_recipe) or declines
 * with a reason the head reads; the manager reads and cannot decide
 * (decideRecipeChanges). Nobody decides their own request, and the server is
 * the wall on all of it.
 *
 * "Changed since it was sent" marks a request whose recipe was edited after it
 * was asked (a manager in Stock ▸ Recipes, or another request applied first):
 * approving it is refused with RECIPE_CHANGED, so the sheet says so before
 * the owner presses anything.
 *
 * The card reads QK.recipeChangesWaiting; the sheet's Decided and All tabs keep
 * their own keys under the same ['recipeChanges'] root, and a decision
 * refreshes both and ['protocols'].
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatNumber, isolate } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { QK } from '../../lib/queryKeys';
import { can, useAuth } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { AsyncStateWrapper, EmptyState, MessagePresenter, Panel, SegmentedControl, StatusBadge, asyncStatus } from '../../components/kit';
import { CardTitle, MARK_FG } from '../ops/OpsVisuals';
import { useStockFormat } from '../stock/stockUi';
import { RK } from './keys';
import { fetchRecipeChangesWaiting } from './api';
import {
  bilingual,
  readRecipeChangesPage,
  recipeDiff,
  type RecipeChangeFilter,
  type RecipeChangeRow,
  type RecipeChangeStatus,
} from './roleExtrasLogic';

/** Rows on the card before "+N more": the list sheet has the rest. */
const ROWS_SHOWN = 4;
const REASON_MAX = 1000;

const STATUS_TONE: Record<RecipeChangeStatus, 'warn' | 'success' | 'danger' | 'neutral'> = {
  waiting: 'warn',
  approved: 'success',
  declined: 'danger',
  withdrawn: 'neutral',
};

function useTargetName() {
  const { locale } = useLocale();
  return (r: RecipeChangeRow) => {
    const item = bilingual(locale, r.itemNameEn, r.itemNameAr);
    const size = bilingual(locale, r.sizeNameEn, r.sizeNameAr);
    return size ? `${item} · ${size}` : item;
  };
}

/**
 * The card. `openId` opens one request's sheet (the /protocols
 * `?recipeChange=` link); `onOpenChange` hears when it opens or closes, so
 * the page can keep the link in step. Both are optional: without them the
 * card keeps its own state.
 */
export function RecipeChangesCard({
  openId,
  onOpenChange,
}: {
  openId?: string | null;
  onOpenChange?: (id: string | null) => void;
}) {
  const { tr, locale } = useLocale();
  const targetName = useTargetName();
  const q = useQuery({ queryKey: QK.recipeChangesWaiting, queryFn: fetchRecipeChangesWaiting, refetchInterval: 60_000 });
  const data = readRecipeChangesPage(q.data);
  const [ownOpen, setOwnOpen] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const opened = openId !== undefined ? openId : ownOpen;
  const open = (id: string | null) => {
    setOwnOpen(id);
    onOpenChange?.(id);
  };

  return (
    <Panel
      title={<CardTitle icon="layers">{tr('ws.rolePages.recipeChanges.title')}</CardTitle>}
      actions={data.waitingCount > 0 ? <StatusBadge size="sm" tone="warn" label={tr('ws.rolePages.recipeChanges.waitingBadge', { count: formatNumber(data.waitingCount, locale) })} /> : undefined}
      data-testid="recipe-changes-card"
    >
      {q.isError ? (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
          <ErrorText error={q.error} style={{ marginBlock: 0 }} />
          <Button size="sm" icon="refresh" onClick={() => void q.refetch()}>
            {tr('ws.kit.async.retry')}
          </Button>
        </div>
      ) : q.isPending ? (
        <p style={{ color: 'var(--tp-muted-fg)', margin: 0 }}>{tr('common.loading')}</p>
      ) : data.rows.length === 0 ? (
        <p style={{ margin: 0, color: MARK_FG.success, fontWeight: 600 }}>{tr('ws.rolePages.recipeChanges.none')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
          {data.rows.slice(0, ROWS_SHOWN).map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="tp-row" data-clickable="true"
                onClick={() => open(r.id)}
                data-testid={`recipe-change-${r.id}`}
                style={rowButton}
              >
                <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0, textAlign: 'start' }}>
                  <span style={{ fontWeight: 600 }}>
                    <bdi>{targetName(r)}</bdi>
                  </span>
                  <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                    {tr('ws.rolePages.recipeChanges.askedBy', { name: isolate(r.requestedByName ?? '—'), time: r.requestedAt ? formatDateTime(new Date(r.requestedAt), locale) : '' })}
                  </span>
                </span>
                {r.stale && <StatusBadge size="sm" tone="danger" label={tr('ws.rolePages.recipeChanges.stale')} />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {data.rows.length > ROWS_SHOWN && (
        <p style={{ marginBlock: 'var(--tp-sp-2) 0', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          {tr('ws.rolePages.recipeChanges.more', { count: formatNumber(data.rows.length - ROWS_SHOWN, locale) })}
        </p>
      )}
      <div style={{ marginBlockStart: 'var(--tp-sp-3)' }}>
        <Button size="sm" iconEnd="arrowUpRight" onClick={() => setListOpen(true)}>
          {tr('ws.rolePages.recipeChanges.seeAll')}
        </Button>
      </div>

      {listOpen && <RecipeChangesList onClose={() => setListOpen(false)} onOpen={(id) => open(id)} />}
      {opened && <RecipeChangeSheet id={opened} fallback={data.rows.find((r) => r.id === opened) ?? null} onClose={() => open(null)} />}
    </Panel>
  );
}

const rowButton = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--tp-sp-2)',
  inlineSize: '100%',
  paddingBlock: 'var(--tp-sp-2)',
  paddingInline: 'var(--tp-sp-2)',
  border: '1px solid var(--tp-border)',
  borderRadius: 'var(--tp-radius-ctl)',
  background: 'var(--tp-surface)',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
} as const;

/** Every request, by status: the card shows only the waiting ones. */
function RecipeChangesList({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const { tr, locale } = useLocale();
  const targetName = useTargetName();
  const [filter, setFilter] = useState<RecipeChangeFilter>('waiting');
  const waitingQ = useQuery({ queryKey: QK.recipeChangesWaiting, queryFn: fetchRecipeChangesWaiting });
  const otherQ = useQuery({
    queryKey: RK.recipeChanges(filter, 0),
    queryFn: () => appRpc<unknown>('recipe_changes_page', { p_filter: filter, p_limit: 100, p_offset: 0 }),
    enabled: filter !== 'waiting',
  });
  const q = filter === 'waiting' ? waitingQ : otherQ;
  const data = readRecipeChangesPage(q.data);

  return (
    <Modal title={tr('ws.rolePages.recipeChanges.title')} onClose={onClose} size="lg">
      <div style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>
        <SegmentedControl<RecipeChangeFilter>
          aria-label={tr('ws.rolePages.recipeChanges.filterLabel')}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'waiting', label: tr('ws.rolePages.recipeChanges.filter.waiting') },
            { value: 'decided', label: tr('ws.rolePages.recipeChanges.filter.decided') },
            { value: 'all', label: tr('ws.rolePages.recipeChanges.filter.all') },
          ]}
        />
      </div>
      <AsyncStateWrapper
        status={asyncStatus(q, () => data.rows.length === 0)}
        error={q.error}
        onRetry={() => void q.refetch()}
        emptyContent={<EmptyState compact kind="nothingToDo" title={tr(`ws.rolePages.recipeChanges.empty.${filter}`)} />}
      >
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
          {data.rows.map((r) => (
            <li key={r.id}>
              <button type="button" className="tp-row" data-clickable="true" onClick={() => onOpen(r.id)} style={rowButton}>
                <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0, textAlign: 'start' }}>
                  <span style={{ fontWeight: 600 }}>
                    <bdi>{targetName(r)}</bdi>
                  </span>
                  <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                    {tr('ws.rolePages.recipeChanges.askedBy', { name: isolate(r.requestedByName ?? '—'), time: r.requestedAt ? formatDateTime(new Date(r.requestedAt), locale) : '' })}
                  </span>
                </span>
                <StatusBadge size="sm" tone={STATUS_TONE[r.status]} label={tr(`work.recipeChange.status.${r.status}`)} />
              </button>
            </li>
          ))}
        </ul>
      </AsyncStateWrapper>
    </Modal>
  );
}

/**
 * One request: the recipe now and after the change, the head's note, and the
 * owner's decision. It reads the row from the card's list; a request opened by
 * link that is not waiting any more is looked up in All.
 */
export function RecipeChangeSheet({ id, fallback, onClose }: { id: string; fallback: RecipeChangeRow | null; onClose: () => void }) {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const targetName = useTargetName();
  const fmt = useStockFormat();
  const canDecide = can(staff?.role, 'decideRecipeChanges');
  const allQ = useQuery({
    queryKey: RK.recipeChanges('all', 0),
    queryFn: () => appRpc<unknown>('recipe_changes_page', { p_filter: 'all', p_limit: 100, p_offset: 0 }),
    enabled: fallback === null,
  });
  const row = fallback ?? readRecipeChangesPage(allQ.data).rows.find((r) => r.id === id) ?? null;
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');

  const decide = useMutation({
    mutationFn: (v: { approve: boolean; reason?: string }) =>
      appRpc('decide_recipe_change', { p_id: id, p_approve: v.approve, p_reason: v.approve ? null : (v.reason ?? '').trim() }),
    onSuccess: (_d, v) => {
      toast.ok(tr(v.approve ? 'ws.rolePages.recipeChanges.approved' : 'ws.rolePages.recipeChanges.declined'));
      void qc.invalidateQueries({ queryKey: ['recipeChanges'] });
      void qc.invalidateQueries({ queryKey: ['protocols'] });
      onClose();
    },
  });

  const qty = (n: number | null, unit: string | null) => (n === null ? '—' : unit ? fmt.qty(n, unit) : fmt.num(n));
  const diff = row ? recipeDiff(row.before, row.after) : [];

  return (
    <Modal
      title={row ? targetName(row) : tr('ws.rolePages.recipeChanges.title')}
      titleAfter={row ? <StatusBadge size="sm" tone={STATUS_TONE[row.status]} label={tr(`work.recipeChange.status.${row.status}`)} /> : undefined}
      onClose={onClose}
      dismissible={!decide.isPending}
      size="lg"
      footer={
        row && row.status === 'waiting' && canDecide
          ? (close) =>
              declining ? (
                <>
                  <Button onClick={() => setDeclining(false)} disabled={decide.isPending}>
                    {tr('ws.rolePages.recipeChanges.back')}
                  </Button>
                  <Button
                    kind="danger"
                    busy={decide.isPending}
                    disabled={reason.trim() === ''}
                    onClick={() => decide.mutate({ approve: false, reason })}
                  >
                    {tr('ws.rolePages.recipeChanges.declineConfirm')}
                  </Button>
                </>
              ) : (
                <>
                  <Button onClick={close} disabled={decide.isPending}>
                    {tr('ws.rolePages.recipeChanges.close')}
                  </Button>
                  <Button kind="danger" onClick={() => setDeclining(true)} disabled={decide.isPending}>
                    {tr('ws.rolePages.recipeChanges.decline')}
                  </Button>
                  <Button kind="primary" icon="check" busy={decide.isPending} disabled={row.stale} onClick={() => decide.mutate({ approve: true })}>
                    {tr('ws.rolePages.recipeChanges.approve')}
                  </Button>
                </>
              )
          : undefined
      }
    >
      {!row ? (
        allQ.isError ? <ErrorText error={allQ.error} /> : <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('common.loading')}</p>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
          <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
            {tr('ws.rolePages.recipeChanges.askedBy', { name: isolate(row.requestedByName ?? '—'), time: row.requestedAt ? formatDateTime(new Date(row.requestedAt), locale) : '' })}
            {' · '}
            {tr(row.target === 'output' ? 'ws.rolePages.recipeChanges.targetOutput' : 'ws.rolePages.recipeChanges.targetVariant')}
          </p>
          {row.stale && <MessagePresenter tone="refused" message={tr('ws.rolePages.recipeChanges.staleBody')} />}
          {row.note && (
            <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
              <strong style={{ fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.rolePages.recipeChanges.note')}</strong>
              <p dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.note}</p>
            </div>
          )}
          <table style={{ inlineSize: '100%', borderCollapse: 'collapse', fontSize: 'var(--tp-fs-sm)' }}>
            <thead>
              <tr style={{ color: 'var(--tp-muted-fg)', textAlign: 'start' }}>
                <th style={cellHead}>{tr('ws.rolePages.recipeChanges.colIngredient')}</th>
                <th style={{ ...cellHead, textAlign: 'end' }}>{tr('ws.rolePages.recipeChanges.colNow')}</th>
                <th style={{ ...cellHead, textAlign: 'end' }}>{tr('ws.rolePages.recipeChanges.colAfter')}</th>
              </tr>
            </thead>
            <tbody>
              {diff.map((d) => (
                <tr key={d.ingredientId} data-change={d.change} style={{ borderBlockStart: '1px solid var(--tp-border)' }}>
                  <td style={cell}>
                    <bdi style={{ fontWeight: d.change === 'same' ? 400 : 600 }}>{bilingual(locale, d.nameEn, d.nameAr)}</bdi>
                    {d.change !== 'same' && (
                      <span style={{ marginInlineStart: 'var(--tp-sp-1-5)' }}>
                        <StatusBadge size="sm" tone={d.change === 'removed' ? 'danger' : d.change === 'added' ? 'success' : 'warn'} label={tr(`ws.rolePages.recipeChanges.change.${d.change}`)} />
                      </span>
                    )}
                  </td>
                  <td style={{ ...cell, textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}>{qty(d.before, d.unit)}</td>
                  <td style={{ ...cell, textAlign: 'end', fontVariantNumeric: 'tabular-nums', fontWeight: d.change === 'same' ? 400 : 700 }}>{qty(d.after, d.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {row.status !== 'waiting' && row.decidedAt && (
            <p style={{ fontSize: 'var(--tp-fs-sm)' }}>
              {tr('ws.rolePages.recipeChanges.decidedBy', {
                status: tr(`work.recipeChange.status.${row.status}`),
                name: isolate(row.decidedByName ?? '—'),
                time: formatDateTime(new Date(row.decidedAt), locale),
              })}
            </p>
          )}
          {row.declineReason && (
            <p dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--tp-muted-fg)' }}>
              {row.declineReason}
            </p>
          )}
          {row.status === 'waiting' && !canDecide && (
            <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.rolePages.recipeChanges.ownerDecides')}</p>
          )}
          {declining && (
            <Field label={tr('ws.rolePages.recipeChanges.reason')} hint={tr('ws.rolePages.recipeChanges.reasonHint')} required>
              <textarea
                autoFocus
                value={reason}
                maxLength={REASON_MAX}
                onChange={(e) => setReason(e.target.value)}
                dir="auto"
                style={{ ...inputStyle, minBlockSize: '5rem', resize: 'vertical', fontFamily: 'inherit' }}
              />
            </Field>
          )}
          <ErrorText error={decide.error} />
        </div>
      )}
    </Modal>
  );
}

const cellHead = { paddingBlock: 'var(--tp-sp-1)', paddingInline: 'var(--tp-sp-1)', fontWeight: 600, textAlign: 'start' } as const;
const cell = { paddingBlock: 'var(--tp-sp-1-5)', paddingInline: 'var(--tp-sp-1)' } as const;
