/**
 * A new Touch Shop section (Rackets, Balls, Accessories…), made from the shop
 * side through app.upsert_shop_category (0246): always kind 'shop', never a
 * café category, so nobody opens the café's menu editor for the shop.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, Select, inputStyle } from '../../components/ui';
import { SK } from '../stock/stockKeys';

interface TaxGroupRow {
  id: string;
  name_en: string;
  name_ar: string;
}

export function ShopSectionDialog({ onClose, onSaved }: { onClose: () => void; onSaved?: (id: string) => void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const taxQ = useQuery({
    queryKey: ['taxGroups'] as const,
    queryFn: async (): Promise<TaxGroupRow[]> => {
      const { data, error } = await supabase.from('tax_groups').select('id, name_en, name_ar').order('name_en');
      if (error) throw error;
      return (data ?? []) as TaxGroupRow[];
    },
  });
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [taxGroupId, setTaxGroupId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const taxGroup = taxGroupId || taxQ.data?.[0]?.id || '';
  const ready = nameEn.trim() !== '' && nameAr.trim() !== '' && taxGroup !== '';

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const id = await appRpc<string>('upsert_shop_category', {
        p_name_en: nameEn.trim(),
        p_name_ar: nameAr.trim(),
        p_tax_group_id: taxGroup,
      });
      toast.ok(tr('ws.shop.sections.saved'));
      void queryClient.invalidateQueries({ queryKey: SK.products });
      void queryClient.invalidateQueries({ queryKey: ['menu'] });
      onSaved?.(id);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={tr('ws.shop.sections.add')}
      subtitle={tr('ws.shop.sections.lead')}
      onClose={onClose}
      footer={(close) => (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--tp-sp-2)' }}>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button kind="primary" busy={busy} disabled={!ready} onClick={() => void save()} data-testid="shop-section-save">
            {tr('ws.shop.sections.save')}
          </Button>
        </div>
      )}
    >
      <Field label={tr('ws.shop.sections.nameEn')} required>
        <input style={inputStyle} dir="ltr" value={nameEn} maxLength={80} onChange={(e) => setNameEn(e.target.value)} autoFocus data-testid="shop-section-name-en" />
      </Field>
      <Field label={tr('ws.shop.sections.nameAr')} required>
        <input style={inputStyle} dir="rtl" value={nameAr} maxLength={80} onChange={(e) => setNameAr(e.target.value)} data-testid="shop-section-name-ar" />
      </Field>
      <Field label={tr('ws.shop.sections.taxGroup')} required>
        <Select
          value={taxGroup}
          onChange={setTaxGroupId}
          options={(taxQ.data ?? []).map((t) => ({ value: t.id, label: pickName(locale, t) }))}
        />
      </Field>
      <ErrorText error={error ?? taxQ.error} />
    </Modal>
  );
}
