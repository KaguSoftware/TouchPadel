/**
 * One player picked from the customer book, for a seat on a result or for points adjusted by
 * hand. The search is the desk's own (app.customer_search through useCustomerSearch), so a
 * guest is found the same way here as when they are booked. The list shows name and phone so
 * two guests with one name can be told apart; only the id and the name are kept.
 */
import { useState } from 'react';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText, Spinner } from '../../components/ui';
import { SearchField } from '../../components/kit';
import { Icon } from '../../components/icons';
import { useCustomerSearch } from '../desk/customers/CustomerPicker';
import type { SeatPlayer } from './ranksLogic';

const K = 'ws.ranks.record';

export function PlayerPicker({
  label,
  hint,
  value,
  onChange,
  disabled,
  invalid,
  testId,
}: {
  label: string;
  hint?: string;
  value: SeatPlayer | null;
  onChange: (next: SeatPlayer | null) => void;
  disabled?: boolean;
  /** Draw the empty box as the field the form is missing. */
  invalid?: boolean;
  testId: string;
}) {
  const { tr } = useLocale();
  const [query, setQuery] = useState('');
  const search = useCustomerSearch(value ? '' : query, 6);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--tp-sp-1)', minInlineSize: 0 }} data-testid={testId}>
      <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>{label}</span>
      {value ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--tp-sp-2)',
            minBlockSize: '2.25rem',
            paddingInlineStart: 'var(--tp-sp-2-5)',
            paddingInlineEnd: 'var(--tp-sp-1)',
            border: '1px solid var(--tp-border)',
            borderRadius: 'var(--tp-radius-ctl)',
            background: 'var(--tp-surface-2)',
          }}
        >
          <Icon name="user" size={14} style={{ color: 'var(--tp-muted-fg)', flex: 'none' }} />
          <span
            style={{
              fontWeight: 600,
              flex: 1,
              minInlineSize: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            data-testid={`${testId}-name`}
          >
            <bdi>{value.name}</bdi>
          </span>
          <Button
            kind="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              setQuery('');
              onChange(null);
            }}
            data-testid={`${testId}-change`}
          >
            {tr(`${K}.change`)}
          </Button>
        </div>
      ) : (
        <>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={tr(`${K}.search`)}
            aria-label={label}
            busy={search.isFetching}
            style={invalid ? { outline: '1px solid var(--tp-danger-mark)', borderRadius: 'var(--tp-radius-ctl)' } : undefined}
          />
          {search.enabled && (
            <div
              role="listbox"
              aria-label={label}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr)',
                gap: '2px',
                padding: 'var(--tp-sp-1)',
                border: '1px solid var(--tp-border)',
                borderRadius: 'var(--tp-radius-ctl)',
                background: 'var(--tp-surface)',
              }}
            >
              {search.isPending && !search.data && (
                <span
                  style={{
                    display: 'flex',
                    gap: 'var(--tp-sp-2)',
                    alignItems: 'center',
                    padding: 'var(--tp-sp-1-5)',
                    color: 'var(--tp-muted-fg)',
                    fontSize: 'var(--tp-fs-sm)',
                  }}
                >
                  <Spinner size="xs" /> {tr(`${K}.searching`)}
                </span>
              )}
              {search.isError && <ErrorText error={search.error} style={{ marginBlock: 0 }} />}
              {(search.data ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="tp-row"
                  data-clickable="true"
                  disabled={disabled}
                  onClick={() => onChange({ id: c.id, name: c.full_name })}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 'var(--tp-sp-2)',
                    inlineSize: '100%',
                    textAlign: 'start',
                    border: 'none',
                    background: 'transparent',
                    font: 'inherit',
                    color: 'inherit',
                    paddingBlock: 'var(--tp-sp-1-5)',
                    paddingInline: 'var(--tp-sp-2)',
                    borderRadius: 'var(--tp-radius-ctl)',
                    cursor: 'pointer',
                  }}
                >
                  <span
                    style={{
                      fontWeight: 600,
                      flex: '0 1 auto',
                      minInlineSize: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <bdi>{c.full_name}</bdi>
                  </span>
                  {c.phone && (
                    <span
                      dir="ltr"
                      style={{
                        color: 'var(--tp-muted-fg)',
                        fontSize: 'var(--tp-fs-sm)',
                        fontVariantNumeric: 'tabular-nums',
                        flex: 'none',
                      }}
                    >
                      {c.phone}
                    </span>
                  )}
                </button>
              ))}
              {search.isSuccess && (search.data ?? []).length === 0 && (
                <span style={{ padding: 'var(--tp-sp-1-5)', color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
                  {tr(`${K}.noMatches`)}
                </span>
              )}
            </div>
          )}
        </>
      )}
      {hint && !value && (
        <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{hint}</span>
      )}
    </div>
  );
}
