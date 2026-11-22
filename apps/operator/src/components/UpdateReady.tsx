import type { CSSProperties } from 'react';
import { useLocale } from '../lib/i18n';
import { Icon } from './icons';
import { railLabelStyle } from './railStyles';

/**
 * "Update ready — restart" (design-arch §2.5). The shell downloads updates
 * silently and waits for a human; this is the human's control, a rail row. It
 * never auto-fires: a restart mid-order is the operator's call, and Quit to
 * desktop installs it anyway.
 */
export function UpdateReadyControl({
  version,
  onInstall,
  style,
}: {
  version: string;
  onInstall: () => void;
  /** The nav-button style the rail hands every control. */
  style?: CSSProperties;
}) {
  const { tr } = useLocale();
  const title = tr('ws.shell.nav.restartToUpdate', { version });
  return (
    <button
      type="button"
      className="tp-nav-item"
      onClick={onInstall}
      title={title}
      style={{ ...style, color: 'var(--tp-rail-green)', fontWeight: 600 }}
    >
      <Icon name="refresh" size={16} />
      <span style={railLabelStyle}>
        {tr('ws.shell.nav.updateReady')} <span dir="ltr">{version}</span>
      </span>
    </button>
  );
}
