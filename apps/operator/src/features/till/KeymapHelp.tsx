/** Keyboard help popover — rendered from TILL_KEYMAP so it cannot drift from the handler. */
import type { MessageKey } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Button, Modal } from '../../components/ui';
import { Kbd } from '../../components/kit';
import { TILL_KEYMAP } from './keymap';
import { muted } from './tillStyles';

export function KeymapHelp({ onClose }: { onClose: () => void }) {
  const { tr } = useLocale();
  return (
    <Modal title={tr('ws.cashier.till.help.title')} onClose={onClose} size="sm" footer={<Button onClick={onClose}>{tr('common.close')}</Button>}>
      <p style={{ ...muted, marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.cashier.till.help.intro')}</p>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--tp-sp-2) var(--tp-sp-4)', margin: 0, alignItems: 'center' }}>
        {TILL_KEYMAP.map((row) => (
          <div key={row.labelKey} style={{ display: 'contents' }}>
            <dt style={{ display: 'inline-flex', gap: 'var(--tp-sp-0)', flexWrap: 'wrap' }} dir="ltr">
              {row.keys.map((k, i) => (
                <Kbd key={i}>{k}</Kbd>
              ))}
            </dt>
            <dd style={{ margin: 0 }}>{tr(`ws.cashier.till.help.${row.labelKey}` as MessageKey)}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
