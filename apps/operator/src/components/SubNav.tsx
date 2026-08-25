/**
 * Vertical grouped sub-navigation (admin sections). Items are router Links so
 * the URL and the highlight never disagree; groups with no visible items
 * (role-filtered upstream) are skipped. Hidden when printing.
 */
import { Link } from '@tanstack/react-router';
import type { CSSProperties } from 'react';

export interface SubNavItem {
  to: string;
  label: string;
}

export interface SubNavGroup {
  label: string;
  items: readonly SubNavItem[];
}

export function SubNav({
  title,
  groups,
  style,
}: {
  title?: string;
  groups: readonly SubNavGroup[];
  style?: CSSProperties;
}) {
  return (
    <nav
      data-no-print
      aria-label={title}
      style={{
        inlineSize: '11rem',
        flexShrink: 0,
        borderInlineEnd: '1px solid var(--tp-border)',
        paddingInlineEnd: '0.8rem',
        alignSelf: 'flex-start',
        position: 'sticky',
        insetBlockStart: '1rem',
        ...style,
      }}
    >
      {title && (
        <p style={{ margin: 0, marginBlockEnd: '0.6rem', fontSize: '1.2rem', fontWeight: 700 }}>
          {title}
        </p>
      )}
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <section key={group.label} style={{ marginBlockEnd: '0.9rem' }}>
            <p
              style={{
                margin: 0,
                marginBlockEnd: '0.2rem',
                fontSize: '0.7rem',
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--tp-muted-fg)',
              }}
            >
              {group.label}
            </p>
            {group.items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                style={{
                  display: 'block',
                  paddingBlock: '0.35rem',
                  paddingInline: '0.5rem',
                  borderRadius: '0.35rem',
                  color: 'var(--tp-accent)',
                  textDecoration: 'none',
                  fontSize: '0.95rem',
                }}
                activeProps={{
                  style: {
                    fontWeight: 700,
                    color: 'var(--tp-fg)',
                    background: 'var(--tp-surface)',
                  },
                }}
              >
                {item.label}
              </Link>
            ))}
          </section>
        ))}
    </nav>
  );
}
