/**
 * TableAdminScreen (spec 06.48): tables, their signed tokens, and the printed
 * QR artwork. Cards come from `app.table_qr_tokens()` (audited per call);
 * per-table waiter-bell switch; owner-only token rotation; table CRUD; A6
 * print of every card or one card.
 *
 * WHAT CHANGED, AND WHY
 *
 * The screen used to BE the print sheet: every table's full A6 card, four to
 * a row, with the bell switch, a "v1" chip and three buttons under each. To
 * switch one table's bell the owner scrolled past cards the size of a hand
 * looking for a number; on a venue with forty tables that is ten screens. It
 * also opened with a permanent orange warning about rotating codes and a red
 * "Rotate all codes" button beside "Add table" — the most destructive action
 * on the page was the second-most prominent, on every visit.
 *
 * Now the page answers "which tables are there and how is each set up" as a
 * list (searchable, bell switch in the row), and one table's card opens beside
 * it with the things you do to ONE card: print it, edit the table, replace its
 * code. The print sheet still exists — it is mounted only while printing, and
 * the A6 print CSS lays it out exactly as before.
 *
 * "Rotate" became "Replace the QR code", said in terms of the card on the
 * table: what stops working, and what to do next. The whole-venue version
 * sits at the foot of the page under the circumstance it is for, not in the
 * header. The token version ("v1") is gone from view: nothing a person does
 * depends on it.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatNumber } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { supabase } from '../../../lib/supabase';
import { useAuth, can } from '../../../lib/auth';
import { useLocale } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Switch } from '../../../components/Switch';
import { printWithMode } from '../../../components/GlobalStyles';
import { Button, ErrorText } from '../../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  PageHeader,
  Panel,
  SearchField,
  StatusBadge,
  TableSkeleton,
  asyncStatus,
  type Column,
} from '../../../components/kit';
import { QrCard } from './QrCard';
import { guestTableUrl, resolveGuestSiteUrl } from './qrCardGeometry';
import { NEW_TABLE, TableForm, type TableDraft } from './TableForm';
import { TABLE_QR_QUERY_KEY, TABLES_QUERY_KEY, type TableTokenRow } from './queries';

interface CafeTableRow {
  id: string;
  table_number: string;
  zone: string | null;
  capacity: number | null;
  is_active: boolean;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Table numbers sort as people read them: T2 before T10. */
const byNumber = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Case-insensitive match on the table number or its zone. */
export function matchesTable(row: { table_number: string; zone: string | null }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return row.table_number.toLowerCase().includes(q) || (row.zone ?? '').toLowerCase().includes(q);
}

export function QrPage() {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { staff } = useAuth();
  // Capability matrix, not an inline role comparison — see lib/auth.tsx.
  const canRotate = can(staff?.role, 'rotateTableToken');
  // Never a localhost card in a release build — see resolveGuestSiteUrl.
  const siteUrl = resolveGuestSiteUrl(import.meta.env.VITE_GUEST_SITE_URL, import.meta.env.PROD);
  const [editing, setEditing] = useState<TableDraft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [rotating, setRotating] = useState<{ done: number; total: number } | null>(null);
  /** While set, the print sheet is mounted: every card, or only this table's. */
  const [printing, setPrinting] = useState<{ only: string | null } | null>(null);

  const tokensQ = useQuery({
    queryKey: TABLE_QR_QUERY_KEY,
    queryFn: () => appRpc<TableTokenRow[]>('table_qr_tokens'),
    // Every call is audited server-side — do not refetch on focus.
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });
  const inactiveQ = useQuery({
    queryKey: TABLES_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from('cafe_tables').select('id, table_number, zone, capacity, is_active').eq('is_active', false).order('table_number');
      if (error) throw error;
      return (data ?? []) as CafeTableRow[];
    },
  });

  const refetchAll = () => Promise.all([queryClient.invalidateQueries({ queryKey: TABLE_QR_QUERY_KEY }), queryClient.invalidateQueries({ queryKey: TABLES_QUERY_KEY })]);

  const bell = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => appRpc('set_table_bell', { p_table_id: id, p_enabled: enabled }),
    onMutate: async ({ id, enabled }) => {
      await queryClient.cancelQueries({ queryKey: TABLE_QR_QUERY_KEY });
      queryClient.setQueryData<TableTokenRow[]>(TABLE_QR_QUERY_KEY, (rows) => rows?.map((r) => (r.table_id === id ? { ...r, bell_enabled: enabled } : r)));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: TABLE_QR_QUERY_KEY }),
  });

  const rows = useMemo(() => [...(tokensQ.data ?? [])].sort((a, b) => byNumber.compare(a.table_number, b.table_number)), [tokensQ.data]);
  const inactive = useMemo(() => [...(inactiveQ.data ?? [])].sort((a, b) => byNumber.compare(a.table_number, b.table_number)), [inactiveQ.data]);
  const listed = rows.filter((r) => matchesTable(r, query));
  const selected = selectedId ? (rows.find((r) => r.table_id === selectedId) ?? null) : null;

  /** Table number for a message the operator has to act on; the id is no use to them. */
  function tableNumberOf(tableId: string): string {
    return rows.find((r) => r.table_id === tableId)?.table_number ?? tableId.slice(0, 8);
  }

  async function rotate(ids: string[]) {
    const one = ids.length === 1 ? tableNumberOf(ids[0]!) : null;
    const ok = await confirm({
      title: one ? tr('ws.owner.tables.replaceConfirm', { table: one }) : tr('ws.owner.tables.replaceAllConfirm', { count: formatNumber(ids.length, locale) }),
      body: one ? tr('ws.owner.tables.replaceConfirmBody', { table: one }) : tr('ws.owner.tables.replaceAllConfirmBody'),
      kind: 'danger',
      confirmLabel: one ? tr('ws.owner.tables.replace') : tr('ws.owner.tables.replaceAll'),
    });
    if (!ok) return;
    setRotating({ done: 0, total: ids.length });
    // Rotation is per-table and irreversible: it kills the PRINTED card for that
    // table. Aborting the loop on the first failure used to leave, say, seven
    // cards dead and thirteen live with nothing on screen saying which. So it
    // runs every table and then reports exactly what happened — the operator
    // needs that list to know which cards to reprint.
    const failed: string[] = [];
    let done = 0;
    try {
      for (const id of ids) {
        try {
          await appRpc('rotate_table_token', { p_table_id: id });
          done += 1;
        } catch {
          failed.push(tableNumberOf(id));
        }
        setRotating({ done: done + failed.length, total: ids.length });
      }
      if (failed.length === 0) toast.ok(one ? tr('ws.owner.tables.replaced', { table: one }) : tr('op.toast.rotated'));
      else toast.err(tr('op.qr.rotatedPartial', { done, total: ids.length, tables: failed.join(', ') }));
    } finally {
      setRotating(null);
      await refetchAll();
    }
  }

  async function print(only: string | null) {
    setPrinting({ only });
    try {
      // Let React mount the sheet and the QR paths before the print CSS reads them.
      await nextFrame();
      await nextFrame();
      await printWithMode('a6');
    } finally {
      setPrinting(null);
    }
  }

  const canPrint = rows.length > 0 && printing === null;
  const rotateBusy = rotating !== null;
  const printRows = printing ? rows.filter((r) => printing.only === null || r.table_id === printing.only) : [];

  const columns: Column<TableTokenRow>[] = [
    {
      key: 'table',
      header: tr('ws.owner.tables.columns.table'),
      render: (r) => <bdi style={{ fontWeight: 700 }}>{r.table_number}</bdi>,
    },
    {
      key: 'zone',
      header: tr('ws.owner.tables.columns.zone'),
      render: (r) => (r.zone ? <bdi>{r.zone}</bdi> : <span style={{ color: 'var(--tp-muted-fg)' }}>—</span>),
    },
    {
      key: 'seats',
      header: tr('ws.owner.tables.columns.seats'),
      numeric: true,
      render: (r) => (r.capacity ? formatNumber(r.capacity, locale) : <span style={{ color: 'var(--tp-muted-fg)' }}>—</span>),
    },
    {
      key: 'bell',
      header: tr('ws.owner.tables.columns.bell'),
      width: '8rem',
      render: (r) => (
        // The switch's own position says on or off; "Bell on" printed down 40
        // rows said it again under a column already headed "Waiter bell".
        <Switch
          checked={r.bell_enabled}
          hideLabel
          label={tr('ws.owner.tables.bellFor', { table: r.table_number })}
          onChange={(next) => bell.mutateAsync({ id: r.table_id, enabled: next }).then(() => undefined)}
        />
      ),
    },
    {
      key: 'open',
      header: <span className="tp-sr-only">{tr('ws.owner.tables.columns.actions')}</span>,
      align: 'end',
      width: '7rem',
      render: (r) => (
        <Button size="sm" onClick={() => setSelectedId(r.table_id)}>
          {tr('ws.owner.tables.seeCard')}
        </Button>
      ),
    },
  ];

  return (
    <div>
      {/* The page tells @media print to show the sheet below and nothing
          else; on screen the sheet does not exist until Print is pressed. */}
      <style>{'@media screen { [data-qr-print-sheet] { display: none !important; } }'}</style>
      <div data-no-print>
        <PageHeader
          title={tr('op.qr.title')}
          subtitle={tr('ws.owner.tables.lead')}
          actions={
            <>
              <Button icon="plus" onClick={() => setEditing(NEW_TABLE)}>
                {tr('op.qr.addTable')}
              </Button>
              <Button kind="primary" icon="printer" disabled={!canPrint} busy={printing?.only === null} onClick={() => void print(null)}>
                {tr('ws.owner.tables.printAllCount', { count: formatNumber(rows.length, locale) })}
              </Button>
            </>
          }
        />
        <ErrorText error={bell.error} />

        <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', gridTemplateColumns: 'minmax(0, 1fr) minmax(18rem, 22rem)', alignItems: 'start' }}>
          <div style={{ minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
            <SearchField value={query} onChange={setQuery} placeholder={tr('ws.owner.tables.search')} style={{ maxInlineSize: '22rem' }} />
            <AsyncStateWrapper
              status={asyncStatus(tokensQ, (d) => d.length === 0)}
              error={tokensQ.error}
              onRetry={() => void tokensQ.refetch()}
              skeleton={<TableSkeleton columns={columns} />}
              emptyContent={
                <EmptyState
                  icon="qr"
                  title={tr('ws.owner.tables.emptyTitle')}
                  body={tr('ws.owner.tables.emptyBody')}
                  action={
                    <Button kind="primary" icon="plus" onClick={() => setEditing(NEW_TABLE)}>
                      {tr('op.qr.addTable')}
                    </Button>
                  }
                />
              }
            >
              {listed.length === 0 ? (
                <EmptyState compact kind="filtered" icon="search" title={tr('ws.owner.tables.noMatch', { query: query.trim() })} action={<Button size="sm" onClick={() => setQuery('')}>{tr('ws.owner.tables.clearSearch')}</Button>} />
              ) : (
                <DataTable
                  columns={columns}
                  rows={listed}
                  rowKey={(r) => r.table_id}
                  selectedKey={selectedId}
                  onRowClick={(r) => setSelectedId(r.table_id)}
                  dense
                  aria-label={tr('ws.owner.tables.tablesTitle')}
                />
              )}
            </AsyncStateWrapper>

            {inactive.length > 0 && (
              <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', justifyItems: 'start' }}>
                <Button size="sm" kind="ghost" onClick={() => setShowInactive((v) => !v)}>
                  {showInactive ? tr('ws.owner.tables.hideInactive') : tr('ws.owner.tables.showInactive', { count: formatNumber(inactive.length, locale) })}
                </Button>
                {showInactive && (
                  <>
                    <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.tables.inactiveLead')}</p>
                    <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
                      {inactive.map((t) => (
                        <Button key={t.id} size="sm" icon="note" onClick={() => setEditing({ id: t.id, table_number: t.table_number, zone: t.zone ?? '', capacity: t.capacity, is_active: t.is_active })}>
                          <bdi>{t.table_number}</bdi>
                        </Button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {canRotate && rows.length > 0 && (
              <Panel title={tr('ws.owner.tables.replaceAllTitle')} muted style={{ marginBlockStart: 'var(--tp-sp-4)' }}>
                <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.owner.tables.replaceAllLead')}</p>
                <Button kind="danger" size="sm" icon="repeat" busy={rotateBusy && (rotating?.total ?? 0) > 1} disabled={rotateBusy} onClick={() => void rotate(rows.map((r) => r.table_id))}>
                  {rotating && rotating.total > 1 ? tr('op.qr.rotating', { done: rotating.done, total: rotating.total }) : tr('ws.owner.tables.replaceAll')}
                </Button>
              </Panel>
            )}
          </div>

          <div style={{ position: 'sticky', insetBlockStart: 'var(--tp-sp-2)', minInlineSize: 0 }}>
            {selected ? (
              <Panel
                title={tr('ws.owner.tables.cardTitle', { table: selected.table_number })}
                actions={<Button kind="ghost" size="sm" icon="x" aria-label={tr('ws.owner.tables.closeCard')} onClick={() => setSelectedId(null)} />}
              >
                <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
                  <CardArt row={selected} siteUrl={siteUrl} />
                  <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                    {tr('ws.owner.tables.destination')} <bdi dir="ltr" data-testid="qr-destination" style={{ fontWeight: 600, color: 'var(--tp-fg)' }}>{siteUrl}</bdi>
                    <br />
                    {tr('op.qr.printHint')}
                  </p>
                  <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
                    <Button kind="primary" size="sm" icon="printer" disabled={!canPrint} busy={printing?.only === selected.table_id} onClick={() => void print(selected.table_id)}>
                      {tr('ws.owner.tables.printOne')}
                    </Button>
                    <Button
                      size="sm"
                      icon="note"
                      onClick={() => setEditing({ id: selected.table_id, table_number: selected.table_number, zone: selected.zone ?? '', capacity: selected.capacity, is_active: selected.is_active })}
                    >
                      {tr('op.qr.editTable')}
                    </Button>
                  </div>
                  <div style={{ borderBlockStart: '1px solid var(--tp-border)', paddingBlockStart: 'var(--tp-sp-3)', display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
                    <strong style={{ fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.owner.tables.replaceTitle')}</strong>
                    <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.tables.replaceLead')}</p>
                    {canRotate ? (
                      <Button size="sm" icon="repeat" busy={rotateBusy && rotating?.total === 1} disabled={rotateBusy} onClick={() => void rotate([selected.table_id])}>
                        {tr('ws.owner.tables.replace')}
                      </Button>
                    ) : (
                      <StatusBadge tone="neutral" size="sm" icon="lock" label={tr('ws.owner.tables.replaceOwnerOnly')} style={{ whiteSpace: 'normal' }} />
                    )}
                  </div>
                </div>
              </Panel>
            ) : (
              <Panel title={tr('ws.owner.tables.cardPanel')}>
                <EmptyState compact icon="qr" title={tr('ws.owner.tables.pickTable')} body={tr('ws.owner.tables.pickTableBody')} />
              </Panel>
            )}
          </div>
        </div>
      </div>

      {printing && (
        <div data-qr-print-sheet>
          {printRows.map((row) => {
            const url = guestTableUrl(siteUrl, row.token);
            return url ? (
              <div key={row.table_id} data-print-page>
                <QrCard tableNumber={row.table_number} url={url} />
              </div>
            ) : null;
          })}
        </div>
      )}

      {editing && (
        <TableForm
          initial={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** The card as it will print, or the table number on a blank card when no site address is set. */
function CardArt({ row, siteUrl }: { row: TableTokenRow; siteUrl: string }) {
  const url = guestTableUrl(siteUrl, row.token);
  return url ? (
    <div style={{ borderRadius: 'var(--tp-radius-ctl)', overflow: 'hidden', border: '1px solid var(--tp-border)' }}>
      <QrCard tableNumber={row.table_number} url={url} />
    </div>
  ) : (
    <div style={{ aspectRatio: '420 / 592', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--tp-fs-3xl)', fontWeight: 800, color: 'var(--tp-muted-fg)', background: 'var(--tp-bg)', borderRadius: 'var(--tp-radius-ctl)' }}>
      {row.table_number}
    </div>
  );
}
