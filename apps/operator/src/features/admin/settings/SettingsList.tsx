/**
 * The settings archetype (rulebook 2.5): a grouped LIST, not a table and not a
 * wall of fields.
 *
 * Every settings surface in this app had grown the same improvisation — a stack
 * of `card` sections, each holding one `Field` with a loose `<p>` of explanatory
 * copy floating underneath it. The copy was not tied to the control, so a
 * screen-reader user heard the label and nothing else, and the stack read as
 * five unrelated pages rather than one list of decisions.
 *
 * These two pieces put it back together: the group is the card and owns the
 * heading, the row is one decision, and the sentence saying what changes when
 * the setting changes travels WITH the control. Field's own `hint` slot carries
 * it wherever the control is a Field, because that slot is already wired to
 * aria-describedby; `description` here is for controls that have no such slot
 * (a Switch, a read-only value).
 */
import { Children, type CSSProperties, type ReactNode } from 'react';
import { Panel } from '../../../components/kit';

export function SettingsGroup({
  title,
  description,
  actions,
  children,
  level = 2,
  style,
}: {
  title: string;
  /** What this group of settings governs, in one line. */
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /**
   * Default 2: a settings group is a top-level section under the page's h1.
   * It was 3, which skipped h1 -> h3 on every settings tab while the sibling
   * tabs on the same screen emitted h2 — so heading navigation read one tab as
   * sections and the next as sub-sections of nothing.
   */
  level?: 2 | 3 | 4;
  style?: CSSProperties;
}) {
  // Separators are drawn here rather than by the row, because only the group
  // knows which row is last — and a hairline on the last row lands exactly on
  // the panel's own border and reads as a 2px rule.
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <Panel level={level} title={title} actions={actions} padded={false} style={style}>
      {description && (
        <p
          style={{
            color: 'var(--tp-muted-fg)',
            fontSize: 'var(--tp-fs-sm)',
            paddingBlock: 'var(--tp-sp-2-5)',
            paddingInline: 'var(--tp-sp-4)',
            borderBlockEnd: '1px solid var(--tp-border)',
            maxInlineSize: '70ch',
          }}
        >
          {description}
        </p>
      )}
      {rows.map((row, i) => (
        <div key={i} style={{ borderBlockStart: i > 0 ? '1px solid var(--tp-border)' : undefined }}>
          {row}
        </div>
      ))}
    </Panel>
  );
}

export function SettingsRow({
  children,
  description,
  end,
  style,
}: {
  /** The control, already carrying its own accessible name (a Field, a Switch). */
  children: ReactNode;
  /**
   * One line saying what changes. Only for controls with no `hint` slot of
   * their own — a Field's hint is tied to the control and is always better.
   */
  description?: ReactNode;
  /** Status or a secondary action. Always at the row end, never moving (6.3). */
  end?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 'var(--tp-sp-4)',
        paddingBlock: 'var(--tp-sp-3)',
        paddingInline: 'var(--tp-sp-4)',
        flexWrap: 'wrap',
        ...style,
      }}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', minInlineSize: 0, flex: '1 1 22rem' }}>
        {children}
        {description && (
          <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)', lineHeight: 1.4, maxInlineSize: '70ch' }}>
            {description}
          </p>
        )}
      </div>
      {end && <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>{end}</div>}
    </div>
  );
}

/** Field inside a settings row: the row owns the rhythm, so the field drops its own bottom margin. */
export const settingField: CSSProperties = { marginBlockEnd: 0 };
