import type { CSSProperties } from 'react';
import { useLocale } from '../lib/i18n';
import { Button } from './ui';
import { Icon } from './icons';

/**
 * "Update ready — restart" (design-arch §2.5). The shell downloads updates
 * silently and waits for a human; this is the human's control. Two faces:
 * a rail row for workspaces with navigation, and a floating pill for the
 * kitchen screen, which has no rail. Neither auto-fires: a restart mid-ticket
 * is the operator's call, and the manager-PIN quit installs it anyway.
 */
export function UpdateReadyControl({
  version,
  onInstall,
  variant,
  style,
}: {
  version: string;
  onInstall: () => void;
  variant: 'rail' | 'pill';
  /** Rail variant: the nav-button style the rail hands every control. */
  style?: CSSProperties;
}) {
  const { tr } = useLocale();
  const title = tr('ws.shell.nav.restartToUpdate', { version });
  if (variant === 'pill') {
    return (
      <div
        role="status"
        style={{
          position: 'fixed',
          insetBlockEnd: 'var(--tp-sp-3)',
          insetInlineEnd: 'var(--tp-sp-3)',
          zIndex: 'var(--tp-z-banner)' as unknown as number,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--tp-sp-2)',
          paddingBlock: 'var(--tp-sp-1-5)',
          paddingInline: 'var(--tp-sp-2-5)',
          background: 'var(--tp-surface)',
          color: 'var(--tp-fg)',
          border: '1px solid var(--tp-border)',
          borderRadius: 'var(--tp-radius-panel)',
          boxShadow: 'var(--tp-shadow-popover)',
        }}
      >
        <span style={{ fontSize: 'var(--tp-fs-sm)' }}>
          {tr('ws.shell.nav.updateReady')} <span dir="ltr">{version}</span>
        </span>
        <Button kind="primary" size="sm" icon="refresh" onClick={onInstall} title={title}>
          {tr('ws.shell.nav.updateReady')}
        </Button>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="tp-nav-item"
      onClick={onInstall}
      title={title}
      style={{ ...style, color: 'var(--tp-rail-green)', fontWeight: 600 }}
    >
      <Icon name="refresh" size={16} />
      <span style={{ flex: 1, minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {tr('ws.shell.nav.updateReady')} <span dir="ltr">{version}</span>
      </span>
    </button>
  );
}
