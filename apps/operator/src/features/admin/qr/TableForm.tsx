/**
 * Add / edit one cafe table through `app.upsert_cafe_table` (0031). Token
 * version is never touched here — rotation is a separate owner action.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { appRpc } from '../../../lib/appRpc';
import { useLocale } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { Switch } from '../../../components/Switch';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../../components/ui';
import { TABLE_QR_QUERY_KEY, TABLES_QUERY_KEY } from './queries';

export interface TableDraft {
  id: string | null;
  table_number: string;
  zone: string;
  capacity: number | null;
  is_active: boolean;
}

export const NEW_TABLE: TableDraft = {
  id: null,
  table_number: '',
  zone: '',
  capacity: null,
  is_active: true,
};

export function TableForm({ initial, onClose }: { initial: TableDraft; onClose: () => void }) {
  const { tr } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<TableDraft>(initial);

  const save = useMutation({
    mutationFn: async () =>
      appRpc<string>('upsert_cafe_table', {
        p_id: draft.id,
        p_table_number: draft.table_number.trim(),
        p_zone: draft.zone.trim() || null,
        p_capacity: draft.capacity,
        p_is_active: draft.is_active,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: TABLE_QR_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: TABLES_QUERY_KEY }),
      ]);
      toast.ok(tr('op.toast.saved'));
      onClose();
    },
  });

  const title = initial.id ? tr('op.qr.editTable') : tr('op.qr.addTable');

  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.table_number.trim()) save.mutate();
        }}
      >
        <Field label={tr('op.qr.tableNumber')}>
          <input
            style={inputStyle}
            dir="ltr"
            autoFocus
            maxLength={16}
            value={draft.table_number}
            onChange={(e) => setDraft({ ...draft, table_number: e.target.value })}
          />
        </Field>
        <Field label={`${tr('op.qr.zone')} (${tr('op.common.optional')})`}>
          <input
            style={inputStyle}
            maxLength={40}
            value={draft.zone}
            onChange={(e) => setDraft({ ...draft, zone: e.target.value })}
          />
        </Field>
        <Field label={`${tr('op.qr.capacity')} (${tr('op.common.optional')})`}>
          <input
            style={{ ...inputStyle, inlineSize: '6rem' }}
            dir="ltr"
            type="number"
            min={1}
            max={99}
            value={draft.capacity ?? ''}
            onChange={(e) =>
              setDraft({ ...draft, capacity: e.target.value === '' ? null : Number(e.target.value) })
            }
          />
        </Field>
        <div style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>
          <Switch
            checked={draft.is_active}
            onChange={(next) => setDraft((d) => ({ ...d, is_active: next }))}
            label={tr('op.qr.activeTable')}
          />
        </div>
        <ErrorText error={save.error} />
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', justifyContent: 'flex-end' }}>
          <Button onClick={onClose} disabled={save.isPending}>
            {tr('common.cancel')}
          </Button>
          <Button type="submit" kind="primary" disabled={save.isPending || !draft.table_number.trim()}>
            {tr('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
