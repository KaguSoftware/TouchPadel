/**
 * Secondary navigation for a section that has more screens than the rail
 * shows (stock: daily / setup / review). Two shapes from one data model:
 * a vertical column (`variant="column"`, default) or a horizontal strip
 * (`variant="strip"`) for a family of two to four siblings. Items are router
 * Links so the URL and the highlight never disagree; groups with no visible
 * items (role-filtered upstream) are skipped. Hidden when printing.
 */
import { Link, useRouterState } from '@tanstack/react-router';
import type { CSSProperties } from 'react';
import type { IconName } from './icons';
import { Icon } from './icons';

export interface SubNavItem {
  to: string;
  label: string;
  icon?: IconName;
  /** Exact match only (index routes such as /stock). */
  exact?: boolean;
}

export interface SubNavGroup {
  label: string;
  items: readonly SubNavItem[];
}

function isActive(item: SubNavItem, path: string): boolean {
  const bare = path.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/';
  if (item.exact) return bare === item.to;
  return bare === item.to || bare.startsWith(`${item.to}/`);
}

export function SubNav({
  title,
  groups,
  variant = 'column',
  style,
}: {
  title?: string;
  groups: readonly SubNavGroup[];
  variant?: 'column' | 'strip';
  style?: CSSProperties;
}) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const visible = groups.filter((group) => group.items.length > 0);

  if (variant === 'strip') {
    return (
      <nav
        data-no-print
        aria-label={title}
        style={{
          display: 'flex',
          gap: '0.25rem',
          borderBlockEnd: '1px solid var(--tp-border)',
          marginBlockEnd: '1rem',
          overflowX: 'auto',
          ...style,
        }}
      >
        {visible.flatMap((group) => group.items).map((item) => {
          const active = isActive(item, path);
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? 'page' : undefined}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                paddingBlock: '0.55rem',
                paddingInline: '0.85rem',
                borderBlockEnd: active ? '2px solid var(--tp-accent)' : '2px solid transparent',
                marginBlockEnd: '-1px',
                color: active ? 'var(--tp-fg)' : 'var(--tp-muted-fg)',
                fontWeight: active ? 700 : 500,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                transition: 'color var(--tp-dur-fast) var(--tp-ease-out)',
              }}
            >
              {item.icon && <Icon name={item.icon} size={14} />}
              {item.label}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav
      data-no-print
      aria-label={title}
      style={{
        inlineSize: '11.5rem',
        flexShrink: 0,
        alignSelf: 'flex-start',
        position: 'sticky',
        insetBlockStart: 0,
        paddingInlineEnd: '1rem',
        borderInlineEnd: '1px solid var(--tp-border)',
        ...style,
      }}
    >
      {title && (
        <p style={{ marginBlockEnd: '0.75rem', fontSize: 'var(--tp-fs-xl)', fontWeight: 700 }}>{title}</p>
      )}
      {visible.map((group) => (
        <section key={group.label} style={{ marginBlockEnd: '0.9rem' }}>
          <p
            style={{
              marginBlockEnd: '0.25rem',
              paddingInline: '0.5rem',
              fontSize: 'var(--tp-fs-xs)',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--tp-muted-fg)',
            }}
          >
            {group.label}
          </p>
          {group.items.map((item) => {
            const active = isActive(item, path);
            return (
              <Link
                key={item.to}
                to={item.to}
                className="tp-row"
                data-clickable="true"
                data-selected={active ? 'true' : undefined}
                aria-current={active ? 'page' : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  paddingBlock: '0.4rem',
                  paddingInline: '0.5rem',
                  borderRadius: 'var(--tp-radius-ctl)',
                  color: active ? 'var(--tp-accent-soft-fg)' : 'var(--tp-fg)',
                  fontWeight: active ? 700 : 500,
                  textDecoration: 'none',
                  fontSize: 'var(--tp-fs-md)',
                }}
              >
                {item.icon && <Icon name={item.icon} size={14} />}
                {item.label}
              </Link>
            );
          })}
        </section>
      ))}
    </nav>
  );
}
