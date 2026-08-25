/**
 * Owner-only exclusion list (`cafe_settings.analytics_excluded_item_ids`).
 * Excluded items disappear from every item-level calculation on the page — the
 * SQL RPCs apply the same list server-side, so the two never disagree.
 */
import { useMemo, useState } from 'react';
import { pickLocale } from '@touch/core';
import { Button, ErrorText, Modal, inputStyle } from '../../components/ui';
import { useToast } from '../../components/toast';
import { useLocale } from '../../lib/i18n';
import { useSetCafeSetting } from '../../lib/settings';
import type { MenuSnapshotRow } from './shape';

export function ExcludedItemsModal({
  menu,
  excludedIds,
  onClose,
}: {
  menu: readonly MenuSnapshotRow[];
  excludedIds: readonly string[];
  onClose: () => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const setSetting = useSetCafeSetting();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(excludedIds));
  const [filter, setFilter] = useState('');

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return menu
      .map((m) => ({ id: m.id, name: pickLocale({ en: m.nameEn, ar: m.nameAr }, locale) || m.nameEn }))
      .filter((m) => needle === '' || m.name.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [menu, filter, locale]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    try {
      await setSetting.mutateAsync({ key: 'analytics_excluded_item_ids', value: [...selected] });
      toast.ok(tr('common.save'));
      onClose();
    } catch {
      /* error surfaces through <ErrorText/> below */
    }
  }

  return (
    <Modal title={tr('analytics.deck.excluded')} onClose={onClose} wide>
      <input
        style={{ ...inputStyle, marginBlockEnd: '0.6rem' }}
        placeholder={tr('analytics.conversion.searchItems')}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div style={{ maxBlockSize: '50vh', overflowY: 'auto', display: 'grid', gap: '0.15rem' }}>
        {rows.map((row) => (
          <label key={row.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.9rem' }}>
            <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
            <span>{row.name}</span>
          </label>
        ))}
        {rows.length === 0 && <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('analytics.empty.generic')}</p>}
      </div>
      <ErrorText error={setSetting.error} />
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginBlockStart: '0.8rem' }}>
        <Button onClick={onClose}>{tr('common.cancel')}</Button>
        <Button kind="primary" disabled={setSetting.isPending} onClick={() => void save()}>
          {tr('common.save')}
        </Button>
      </div>
    </Modal>
  );
}
