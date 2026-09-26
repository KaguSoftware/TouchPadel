/**
 * Suppliers (0144/0145): who the venue buys from. Picked on goods-in and on a
 * shop size, and matched by the receipt scanner. Writes go through
 * app.upsert_supplier, which refuses a second live supplier with the same
 * spelling ("Al-Rafidain" = "al rafidain").
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { appRpc } from '../../../lib/appRpc';
import { useLocale } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  PageHeader,
  ResultCount,
  SearchField,
  StatusBadge,
  TableSkeleton,
  Toolbar,
  asyncStatus,
  type Column,
} from '../../../components/kit';
import { Switch } from '../../../components/Switch';
import { SK, fetchSuppliers, type SupplierRow } from '../stockKeys';

export function SuppliersAdmin() {
  const { tr } = useLocale();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<SupplierRow | 'new' | null>(null);
  const suppliersQ = useQuery({ queryKey: SK.suppliers, queryFn: fetchSuppliers });

  const all = suppliersQ.data ?? [];
  const q = search.trim().toLowerCase();
  const rows = all.filter((s) => !q || s.name.toLowerCase().includes(q) || (s.phone ?? '').includes(q));
  const status = asyncStatus(suppliersQ, (d) => d.length === 0);

  const columns: Column<SupplierRow>[] = [
    {
      key: 'name',
      header: tr('ws.manager.stock.suppliers.name'),
      render: (s) => (
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center' }}>
          <strong>
            <bdi>{s.name}</bdi>
          </strong>
          {!s.is_active && <StatusBadge size="sm" tone="neutral" label={tr('ws.manager.stock.ingredients.inactive')} />}
        </span>
      ),
    },
    { key: 'phone', header: tr('ws.manager.stock.suppliers.phone'), render: (s) => (s.phone ? <bdi dir="ltr">{s.phone}</bdi> : '—') },
    { key: 'notes', header: tr('ws.manager.stock.suppliers.notes'), truncate: true, truncateTitle: (s) => s.notes ?? '', render: (s) => (s.notes ? <bdi>{s.notes}</bdi> : '—') },
    {
      key: 'edit',
      header: '',
      align: 'end',
      render: (s) => (
        <Button size="sm" kind="ghost" icon="note" onClick={() => setEditing(s)}>
          {tr('op.common.edit')}
        </Button>
      ),
    },
  ];

  const addButton = (
    <Button kind="primary" icon="plus" onClick={() => setEditing('new')}>
      {tr('ws.manager.stock.suppliers.add')}
    </Button>
  );

  return (
    <div>
      <PageHeader title={tr('op.stockNav.suppliers')} subtitle={tr('ws.manager.stock.suppliers.lead')} actions={addButton} />
      <AsyncStateWrapper
        status={status}
        error={suppliersQ.error}
        onRetry={() => void suppliersQ.refetch()}
        skeleton={<TableSkeleton columns={columns} />}
        emptyContent={<EmptyState icon="users" title={tr('ws.manager.stock.suppliers.empty')} body={tr('ws.manager.stock.suppliers.emptyBody')} action={addButton} />}
      >
        <Toolbar end={<ResultCount shown={rows.length} total={all.length} />}>
          <span style={{ inlineSize: '16rem', maxInlineSize: '100%' }}>
            <SearchField value={search} onChange={setSearch} placeholder={tr('ws.manager.stock.suppliers.search')} />
          </span>
        </Toolbar>
        {rows.length === 0 ? (
          <EmptyState kind="filtered" onClearFilters={() => setSearch('')} />
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(s) => s.id} onRowClick={(s) => setEditing(s)} aria-label={tr('op.stockNav.suppliers')} />
        )}
      </AsyncStateWrapper>
      {editing && (
        <SupplierForm
          key={editing === 'new' ? 'new' : editing.id}
          row={editing === 'new' ? null : editing}
          onDone={() => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ['stock'] });
          }}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function SupplierForm({ row, onDone, onCancel }: { row: SupplierRow | null; onDone: () => void; onCancel: () => void }) {
  const { tr } = useLocale();
  const toast = useToast();
  const [name, setName] = useState(row?.name ?? '');
  const [phone, setPhone] = useState(row?.phone ?? '');
  const [notes, setNotes] = useState(row?.notes ?? '');
  const [active, setActive] = useState(row?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await appRpc('upsert_supplier', {
        p_id: row?.id ?? null,
        p_name: name.trim(),
        p_phone: phone.trim() || null,
        p_notes: notes.trim() || null,
        p_is_active: active,
      });
      toast.ok(tr('op.toast.saved'));
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={row ? tr('ws.manager.stock.suppliers.editTitle') : tr('ws.manager.stock.suppliers.add')}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button kind="primary" icon="check" busy={busy} disabled={!name.trim()} disabledReason={tr('ws.manager.stock.suppliers.nameRequired')} onClick={() => void save()}>
            {tr('ws.kit.actions.save')}
          </Button>
        </>
      }
    >
      <Field label={tr('ws.manager.stock.suppliers.name')}>
        <input style={inputStyle} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label={tr('ws.manager.stock.suppliers.phone')} optional>
        <input style={inputStyle} dir="ltr" inputMode="tel" value={phone} maxLength={32} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Field label={tr('ws.manager.stock.suppliers.notes')} optional>
        <input style={inputStyle} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <Switch checked={active} onChange={setActive} label={tr('ws.manager.stock.suppliers.active')} />
      <ErrorText error={error} />
    </Modal>
  );
}
