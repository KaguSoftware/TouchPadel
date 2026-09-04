/**
 * TableAdminScreen (spec 06.48): tables, their signed tokens, and the printed
 * QR artwork. Cards come from `app.table_qr_tokens()` (audited per call);
 * per-table waiter-bell switch; owner-only token rotation — which retires the
 * printed card in the room, and the screen says so before and after; table
 * CRUD; A6 print of every card or one card.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appRpc } from '../../../lib/appRpc';
import { supabase } from '../../../lib/supabase';
import { useAuth, can } from '../../../lib/auth';
import { useLocale } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Switch } from '../../../components/Switch';
import { printWithMode } from '../../../components/GlobalStyles';
import { Button, ErrorText, card } from '../../../components/ui';
import { AsyncStateWrapper, EmptyState, MessagePresenter, PageHeader, PermissionRefusedNotice, StatusBadge, Toolbar, asyncStatus } from '../../../components/kit';
import { QrCard } from './QrCard';
import { guestTableUrl } from './qrCardGeometry';
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

export function QrPage() {
  const { tr } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { staff } = useAuth();
  // Capability matrix, not an inline role comparison — see lib/auth.tsx.
  const canRotate = can(staff?.role, 'rotateTableToken');
  const siteUrl = import.meta.env.VITE_GUEST_SITE_URL;
  const [editing, setEditing] = useState<TableDraft | null>(null);
  const [rotating, setRotating] = useState<{ done: number; total: number } | null>(null);
  /** While set, only this table's card is printed. */
  const [printTarget, setPrintTarget] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

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

  /** Table number for a message the operator has to act on; the id is no use to them. */
  function tableNumberOf(tableId: string): string {
    return (tokensQ.data ?? []).find((r) => r.table_id === tableId)?.table_number ?? tableId.slice(0, 8);
  }

  async function rotate(ids: string[]) {
    const ok = await confirm({
      title: tr('op.confirm.rotateTokens'),
      body: tr('op.confirm.rotateTokensBody'),
      kind: 'danger',
      confirmLabel: ids.length > 1 ? tr('op.qr.rotateAll') : tr('op.qr.rotate'),
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
      if (failed.length === 0) toast.ok(tr('op.toast.rotated'));
      else toast.err(tr('op.qr.rotatedPartial', { done, total: ids.length, tables: failed.join(', ') }));
    } finally {
      setRotating(null);
      await refetchAll();
    }
  }

  async function print(only: string | null) {
    setPrinting(true);
    setPrintTarget(only);
    try {
      // Let React commit the data-no-print marks before the print CSS reads them.
      await nextFrame();
      await nextFrame();
      await printWithMode('a6');
    } finally {
      setPrintTarget(null);
      setPrinting(false);
    }
  }

  const rows = tokensQ.data ?? [];
  const canPrint = !!siteUrl && rows.length > 0 && !printing;
  const rotateBusy = rotating !== null;

  return (
    <div>
      <div data-no-print>
        <PageHeader
          title={tr('op.qr.title')}
          subtitle={tr('ws.owner.tables.lead')}
          eyebrow={tr('op.qr.subtitle', { count: rows.length })}
          actions={
            <>
              <Button icon="plus" onClick={() => setEditing(NEW_TABLE)}>
                {tr('op.qr.addTable')}
              </Button>
              <Button kind="danger" icon="repeat" disabled={!canRotate || rows.length === 0} busy={rotateBusy} onClick={() => void rotate(rows.map((r) => r.table_id))}>
                {rotating ? tr('op.qr.rotating', { done: rotating.done, total: rotating.total }) : tr('op.qr.rotateAll')}
              </Button>
              <Button kind="primary" icon="printer" disabled={!canPrint} busy={printing && printTarget === null} onClick={() => void print(null)}>
                {tr('op.qr.print')}
              </Button>
            </>
          }
        />
        {!canRotate && <PermissionRefusedNotice action={tr('ws.owner.tables.refusedRotate')} requiredRole="owner" style={{ marginBlockEnd: '0.75rem' }} />}
        <Toolbar style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}>
          <MessagePresenter tone="refused" icon="alert" message={tr('ws.owner.tables.rotateNote')} />
          {!siteUrl && <MessagePresenter tone="error" message={tr('op.qr.noSiteUrl')} />}
          <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('op.qr.printHint')}</p>
        </Toolbar>
        <ErrorText error={bell.error} />
      </div>

      <AsyncStateWrapper
        status={asyncStatus(tokensQ, (d) => d.length === 0)}
        error={tokensQ.error}
        onRetry={() => void tokensQ.refetch()}
        emptyContent={<EmptyState icon="qr" title={tr('ws.owner.tables.emptyTitle')} body={tr('ws.owner.tables.emptyBody')} action={<Button kind="primary" onClick={() => setEditing(NEW_TABLE)}>{tr('op.qr.addTable')}</Button>} />}
      >
        <section aria-label={tr('ws.owner.tables.artworkTitle')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))', gap: '0.8rem' }}>
          {rows.map((row) => {
            const url = guestTableUrl(siteUrl, row.token);
            const hidden = printTarget !== null && printTarget !== row.table_id;
            return (
              <div key={row.table_id} data-print-page data-no-print={hidden ? 'true' : undefined} style={{ ...card, paddingBlock: '0.5rem', paddingInline: '0.5rem' }}>
                {url ? (
                  <QrCard tableNumber={row.table_number} url={url} />
                ) : (
                  <div style={{ aspectRatio: '420 / 592', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem', fontWeight: 800, color: 'var(--tp-muted-fg)', background: 'var(--tp-bg)', borderRadius: '0.4rem' }}>
                    {row.table_number}
                  </div>
                )}
                <div data-no-print style={{ display: 'grid', gap: '0.45rem', marginBlockStart: '0.5rem', fontSize: 'var(--tp-fs-sm)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem' }}>
                    <Switch checked={row.bell_enabled} label={row.bell_enabled ? tr('op.qr.bellOn') : tr('op.qr.bellOff')} onChange={(next) => bell.mutateAsync({ id: row.table_id, enabled: next }).then(() => undefined)} />
                    <StatusBadge tone="neutral" size="sm" dot={false} label={tr('op.qr.version', { v: row.token_version })} title={tr('ws.owner.tables.columns.version')} />
                  </div>
                  <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ color: 'var(--tp-muted-fg)', marginInlineEnd: 'auto' }}>
                      <bdi>{row.zone ?? ''}</bdi>
                      {row.capacity ? <span dir="ltr"> · {row.capacity}</span> : null}
                    </span>
                    <Button kind="ghost" size="sm" icon="note" onClick={() => setEditing({ id: row.table_id, table_number: row.table_number, zone: row.zone ?? '', capacity: row.capacity, is_active: row.is_active })}>
                      {tr('op.common.edit')}
                    </Button>
                    <Button kind="ghost" size="sm" icon="printer" disabled={!canPrint} onClick={() => void print(row.table_id)} title={tr('ws.owner.tables.printOne')} aria-label={tr('ws.owner.tables.printOne')} />
                    <Button kind="ghost" size="sm" icon="repeat" disabled={!canRotate || rotateBusy} onClick={() => void rotate([row.table_id])} title={tr('ws.owner.tables.rotateNote')}>
                      {tr('op.qr.rotate')}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      </AsyncStateWrapper>

      {(inactiveQ.data?.length ?? 0) > 0 && (
        <section data-no-print style={{ marginBlockStart: '1.2rem' }}>
          <h2 style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBlockEnd: '0.4rem' }}>{tr('op.qr.inactive')}</h2>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {inactiveQ.data!.map((t) => (
              <Button key={t.id} kind="ghost" size="sm" style={{ textDecoration: 'line-through', color: 'var(--tp-muted-fg)' }} onClick={() => setEditing({ id: t.id, table_number: t.table_number, zone: t.zone ?? '', capacity: t.capacity, is_active: t.is_active })}>
                {t.table_number}
              </Button>
            ))}
          </div>
        </section>
      )}

      {editing && <TableForm initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
