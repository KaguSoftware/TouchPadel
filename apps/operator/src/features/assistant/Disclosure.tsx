/**
 * A section the owner can fold away (owner call 2026-09-21: the scope
 * checkboxes, the model switch, a message's meter and the chat list all
 * collapsible). One header row: a chevron, the title, and — when closed — a
 * one-line summary so the folded section still says what it holds ("14 on ·
 * ≈ 1.2k tokens", "3.5k tokens · <$0.01"). The open/closed choice is a
 * station preference kept in localStorage under `key`, like the workspace and
 * the locale, and never affects what is sent to the server.
 */
import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { useLocale } from '../../lib/i18n';
import { Icon } from '../../components/icons';

const PREFIX = 'touch-assistant-open:';

export function loadOpen(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

export function saveOpen(key: string, open: boolean): void {
  try {
    localStorage.setItem(PREFIX + key, open ? '1' : '0');
  } catch {
    /* private mode: the choice lasts the session */
  }
}

export function Disclosure({
  storageKey,
  title,
  summary,
  defaultOpen = true,
  children,
  actions,
  style,
}: {
  /** Where the open/closed choice is remembered; also the test id. */
  storageKey: string;
  title: string;
  /** Shown beside the title while closed (and, muted, while open when `alwaysSummary`). */
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  /** Controls that stay reachable while closed (e.g. "New chat"). */
  actions?: ReactNode;
  style?: CSSProperties;
}) {
  const { tr } = useLocale();
  const [open, setOpen] = useState(() => loadOpen(storageKey, defaultOpen));
  const panelId = useId();
  const toggle = () => {
    setOpen((o) => {
      saveOpen(storageKey, !o);
      return !o;
    });
  };
  return (
    <section data-disclosure={storageKey} data-open={open ? '1' : '0'} style={{ display: 'grid', gap: 'var(--tp-sp-2)', minInlineSize: 0, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', minInlineSize: 0 }}>
        <button
          type="button"
          className="tp-row"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={panelId}
          title={tr(open ? 'ws.owner.assistant.fold.hide' : 'ws.owner.assistant.fold.show')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--tp-sp-1-5)',
            flex: 1,
            minInlineSize: 0,
            background: 'none',
            border: 0,
            padding: 0,
            color: 'inherit',
            font: 'inherit',
            cursor: 'pointer',
            textAlign: 'start',
          }}
        >
          <Icon name={open ? 'chevronDown' : 'chevronEnd'} size={14} />
          <span style={{ fontWeight: 600, fontSize: 'var(--tp-fs-sm)' }}>{title}</span>
          {!open && summary && (
            <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minInlineSize: 0 }}>{summary}</span>
          )}
        </button>
        {actions}
      </div>
      {open && <div id={panelId}>{children}</div>}
    </section>
  );
}
