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
import { ErrorText } from '../../components/ui';
import { BilingualFields } from '../../components/inputs';
import { ReviewList, StepWizard, WizardChoice, WizardChoices, type WizardStep } from '../../components/StepWizard';
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

  const taxRow = taxQ.data?.find((t) => t.id === taxGroup);
  const nameNote = (locale === 'ar' ? nameAr : nameEn).trim() || null;

  // The stepped dialog (Sait, 2026-10-22): the name in both languages, then the tax group.
  const steps: WizardStep[] = [
    {
      key: 'name',
      label: tr('ws.shop.sections.stepName'),
      note: nameNote,
      problems: nameEn.trim() && nameAr.trim() ? [] : [tr('ws.manager.disabled.namesRequired')],
      content: (
        <BilingualFields
          labelEn={tr('ws.shop.sections.nameEn')}
          labelAr={tr('ws.shop.sections.nameAr')}
          en={nameEn}
          ar={nameAr}
          onEn={setNameEn}
          onAr={setNameAr}
          maxLength={80}
        />
      ),
    },
    {
      key: 'tax',
      label: tr('ws.shop.sections.taxGroup'),
      note: taxRow ? pickName(locale, taxRow) : null,
      problems: taxGroup ? [] : [tr('ws.shop.sections.pickTax')],
      content: (
        <>
          <WizardChoices label={tr('ws.shop.sections.taxGroup')}>
            {(taxQ.data ?? []).map((t) => (
              <WizardChoice key={t.id} on={taxGroup === t.id} title={pickName(locale, t)} onPick={() => setTaxGroupId(t.id)} />
            ))}
          </WizardChoices>
          <ErrorText error={taxQ.error} />
        </>
      ),
    },
  ];

  return (
    <StepWizard
      title={tr('ws.shop.sections.newTitle')}
      lead={tr('ws.shop.sections.newLead')}
      steps={steps}
      review={(goTo) => (
        <ReviewList
          goTo={goTo}
          busy={busy}
          rows={[
            {
              label: tr('ws.shop.sections.name'),
              value: (
                <>
                  <bdi dir="ltr">{nameEn.trim()}</bdi> · <bdi dir="rtl">{nameAr.trim()}</bdi>
                </>
              ),
              step: 'name',
            },
            { label: tr('ws.shop.sections.taxGroup'), value: taxRow ? pickName(locale, taxRow) : '—', step: 'tax' },
          ]}
        />
      )}
      submitLabel={tr('ws.shop.sections.save')}
      onSubmit={() => void save()}
      busy={busy}
      notice={error ? <ErrorText error={error} /> : undefined}
      onClose={onClose}
      testId="shop-section"
    />
  );
}
