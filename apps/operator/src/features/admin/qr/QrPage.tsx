/**
 * Table QR cards (operator-slice.md §3e): grid of A6 cards from
 * `app.table_qr_tokens()`, per-table waiter-bell switch, owner-only token
 * rotation, table CRUD, and an A6 print mode (one card per page).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { appRpc } from '../../../lib/appRpc';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../lib/auth';
import { useLocale } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Switch } from '../../../components/Switch';
import { printWithMode } from '../../../components/GlobalStyles';
import { Button, ErrorText, Skeleton, card } from '../../../components/ui';
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

export function QrPage() {
  const { tr } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { staff } = useAuth();
  const isOwner = staff?.role === 'owner';
  const siteUrl = import.meta.env.VITE_GUEST_SITE_URL;
  const [editing, setEditing] = useState<TableDraft | null>(null);
  const [rotating, setRotating] = useState<{ done: number; total: number } | null>(null);

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
      const { data, error } = await supabase
        .from('cafe_tables')
        .select('id, table_number, zone, capacity, is_active')
        .eq('is_active', false)
        .order('table_number');
      if (error) throw error;
      return (data ?? []) as CafeTableRow[];
    },
  });

  const refetchAll = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: TABLE_QR_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: TABLES_QUERY_KEY }),
    ]);

  const bell = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      appRpc('set_table_bell', { p_table_id: id, p_enabled: enabled }),
    onMutate: async ({ id, enabled }) => {
      await queryClient.cancelQueries({ queryKey: TABLE_QR_QUERY_KEY });
      queryClient.setQueryData<TableTokenRow[]>(TABLE_QR_QUERY_KEY, (rows) =>
        rows?.map((r) => (r.table_id === id ? { ...r, bell_enabled: enabled } : r)),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: TABLE_QR_QUERY_KEY }),
  });

  async function rotate(ids: string[]) {
    const ok = await confirm({
      title: tr('op.confirm.rotateTokens'),
      body: tr('op.confirm.rotateTokensBody'),
      kind: 'danger',
      confirmLabel: ids.length > 1 ? tr('op.qr.rotateAll') : tr('op.qr.rotate'),
    });
    if (!ok) return;
    setRotating({ done: 0, total: ids.length });
    try {
      for (let i = 0; i < ids.length; i++) {
        await appRpc('rotate_table_token', { p_table_id: ids[i] });
        setRotating({ done: i + 1, total: ids.length });
      }
      toast.ok(tr('op.toast.rotated'));
    } catch (e) {
      toast.err(e);
    } finally {
      setRotating(null);
      await refetchAll();
    }
  }

  const rows = tokensQ.data ?? [];
  const canPrint = !!siteUrl && rows.length > 0;

  return (
    <div>
      <div
        data-no-print
        style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginBlockEnd: '0.8rem' }}
      >
        <h2 style={{ margin: 0, marginInlineEnd: 'auto' }}>
          {tr('op.qr.title')}{' '}
          <span style={{ fontSize: '0.9rem', fontWeight: 400, color: 'var(--tp-muted-fg)' }}>
            {tr('op.qr.subtitle', { count: rows.length })}
          </span>
        </h2>
        <Button onClick={() => void navigate({ to: '/admin' })}>{tr('op.common.back')}</Button>
        <Button onClick={() => setEditing(NEW_TABLE)}>{tr('op.qr.addTable')}</Button>
        {isOwner && (
          <Button
            kind="danger"
            disabled={rows.length === 0 || rotating !== null}
            onClick={() => void rotate(rows.map((r) => r.table_id))}
          >
            {rotating
              ? tr('op.qr.rotating', { done: rotating.done, total: rotating.total })
              : tr('op.qr.rotateAll')}
          </Button>
        )}
        <Button kind="primary" disabled={!canPrint} onClick={() => void printWithMode('a6')}>
          {tr('op.qr.print')}
        </Button>
      </div>

      {!siteUrl && (
        <p
          role="alert"
          data-no-print
          style={{ ...card, borderColor: 'var(--tp-danger)', color: 'var(--tp-danger)', marginBlockEnd: '0.8rem' }}
        >
          {tr('op.qr.noSiteUrl')}
        </p>
      )}
      <p data-no-print style={{ fontSize: '0.85rem', color: 'var(--tp-muted-fg)', marginBlockStart: 0 }}>
        {tr('op.qr.printHint')}
      </p>
      <ErrorText error={tokensQ.error} />
      {tokensQ.isLoading && <Skeleton lines={4} />}
      {tokensQ.isSuccess && rows.length === 0 && (
        <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('op.qr.empty')}</p>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(14rem, 1fr))',
          gap: '0.8rem',
        }}
      >
        {rows.map((row) => {
          const url = guestTableUrl(siteUrl, row.token);
          return (
            <div key={row.table_id} data-print-page style={{ ...card, paddingBlock: '0.5rem', paddingInline: '0.5rem' }}>
              {url ? (
                <QrCard tableNumber={row.table_number} url={url} />
              ) : (
                <div
                  style={{
                    aspectRatio: '420 / 592',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '2rem',
                    fontWeight: 800,
                    color: 'var(--tp-muted-fg)',
                    background: 'var(--tp-bg)',
                    borderRadius: '0.4rem',
                  }}
                >
                  {row.table_number}
                </div>
              )}
              <div
                data-no-print
                style={{ display: 'grid', gap: '0.4rem', marginBlockStart: '0.5rem', fontSize: '0.85rem' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem' }}>
                  <Switch
                    checked={row.bell_enabled}
                    label={row.bell_enabled ? tr('op.qr.bellOn') : tr('op.qr.bellOff')}
                    onChange={(next) => bell.mutateAsync({ id: row.table_id, enabled: next }).then(() => undefined)}
                  />
                  <span dir="ltr" style={{ color: 'var(--tp-muted-fg)' }}>
                    {tr('op.qr.version', { v: row.token_version })}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ color: 'var(--tp-muted-fg)', marginInlineEnd: 'auto' }}>
                    {row.zone ?? ''}
                    {row.capacity ? ` · ${row.capacity}` : ''}
                  </span>
                  <Button
                    kind="ghost"
                    onClick={() =>
                      setEditing({
                        id: row.table_id,
                        table_number: row.table_number,
                        zone: row.zone ?? '',
                        capacity: row.capacity,
                        is_active: row.is_active,
                      })
                    }
                  >
                    {tr('op.common.edit')}
                  </Button>
                  {isOwner && (
                    <Button kind="ghost" disabled={rotating !== null} onClick={() => void rotate([row.table_id])}>
                      {tr('op.qr.rotate')}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {(inactiveQ.data?.length ?? 0) > 0 && (
        <section data-no-print style={{ marginBlockStart: '1.2rem' }}>
          <h3 style={{ fontSize: '0.9rem', color: 'var(--tp-muted-fg)' }}>{tr('op.qr.inactive')}</h3>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {inactiveQ.data!.map((t) => (
              <Button
                key={t.id}
                kind="ghost"
                style={{ textDecoration: 'line-through', color: 'var(--tp-muted-fg)' }}
                onClick={() =>
                  setEditing({
                    id: t.id,
                    table_number: t.table_number,
                    zone: t.zone ?? '',
                    capacity: t.capacity,
                    is_active: t.is_active,
                  })
                }
              >
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
