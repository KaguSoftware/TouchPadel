/**
 * Search-and-attach a customer (0065 `customer_search`) inside a form: the
 * booking dialog and the series builder both need it. Flags surface on every
 * result (spec 06.9: wherever the customer appears).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { appRpc } from '../../../lib/appRpc';
import { useLocale } from '../../../lib/i18n';
import { Button, ErrorText, Field, Spinner, card } from '../../../components/ui';
import { CustomerFlagBadge, SearchField } from '../../../components/kit';
import { Icon } from '../../../components/icons';
import { useDebounced } from '../useDebounced';
import type { CustomerSearchRow } from '../deskTypes';

export interface PickedCustomer {
  id: string;
  name: string;
  phone: string | null;
  flags: CustomerSearchRow['flags'];
}

export const CUSTOMER_SEARCH_MIN = 2;
export const CUSTOMER_SEARCH_DEBOUNCE_MS = 200;

export function useCustomerSearch(query: string, limit = 8) {
  const q = useDebounced(query.trim(), CUSTOMER_SEARCH_DEBOUNCE_MS);
  const enabled = q.length >= CUSTOMER_SEARCH_MIN;
  const result = useQuery({
    queryKey: ['customerSearch', q, limit],
    enabled,
    queryFn: () => appRpc<CustomerSearchRow[]>('customer_search', { p_query: q, p_limit: limit }),
    staleTime: 10_000,
    retry: false,
  });
  return { ...result, debouncedQuery: q, enabled };
}

export function CustomerPicker({
  value,
  onChange,
  label,
  disabled,
  showCreateLink = true,
}: {
  value: PickedCustomer | null;
  onChange: (next: PickedCustomer | null) => void;
  label?: string;
  disabled?: boolean;
  showCreateLink?: boolean;
}) {
  const { tr } = useLocale();
  const [query, setQuery] = useState('');
  const search = useCustomerSearch(query);

  if (value) {
    return (
      <Field label={label ?? tr('ws.courtDesk.create.customer')}>
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', paddingBlock: '0.5rem' }}>
          <Icon name="user" size={16} style={{ color: 'var(--tp-accent)' }} />
          <span style={{ fontWeight: 600 }}>{tr('ws.courtDesk.create.linked', { name: value.name })}</span>
          {value.phone && (
            <span dir="ltr" style={{ color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>
              {value.phone}
            </span>
          )}
          {value.flags.map((f, i) => (
            <CustomerFlagBadge key={`${f.type}-${i}`} flag={f} />
          ))}
          <Button kind="ghost" size="sm" icon="x" disabled={disabled} onClick={() => onChange(null)} style={{ marginInlineStart: 'auto' }}>
            {tr('ws.courtDesk.create.unlink')}
          </Button>
        </div>
      </Field>
    );
  }

  return (
    <div style={{ marginBlockEnd: '0.85rem' }}>
      <span style={{ display: 'flex', gap: '0.3rem', alignItems: 'baseline', fontSize: 'var(--tp-fs-sm)', fontWeight: 600, marginBlockEnd: '0.3rem' }}>
        {label ?? tr('ws.courtDesk.create.customer')}
        <span style={{ color: 'var(--tp-muted-fg)', fontWeight: 400 }}>({tr('ws.courtDesk.common.optional')})</span>
      </span>
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder={tr('ws.courtDesk.create.searchPlaceholder')}
        aria-label={tr('ws.courtDesk.create.customer')}
        busy={search.isFetching}
      />
      {search.enabled && (
        <div style={{ ...card, marginBlockStart: '0.4rem', paddingBlock: '0.3rem', paddingInline: '0.3rem', display: 'grid', gap: '2px' }}>
          {search.isPending && !search.data && (
            <div style={{ paddingBlock: '0.4rem', paddingInline: '0.5rem', color: 'var(--tp-muted-fg)', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <Spinner size="xs" /> {tr('ws.courtDesk.customers.searching')}
            </div>
          )}
          {search.isError && <ErrorText error={search.error} style={{ marginBlock: 0 }} />}
          {(search.data ?? []).map((c) => (
            <button
              key={c.id}
              type="button"
              className="tp-row"
              data-clickable="true"
              disabled={disabled}
              onClick={() => onChange({ id: c.id, name: c.full_name, phone: c.phone, flags: c.flags ?? [] })}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                flexWrap: 'wrap',
                inlineSize: '100%',
                textAlign: 'start',
                border: 'none',
                background: 'transparent',
                font: 'inherit',
                color: 'inherit',
                paddingBlock: '0.4rem',
                paddingInline: '0.5rem',
                borderRadius: 'var(--tp-radius-ctl)',
                cursor: 'pointer',
              }}
            >
              <span style={{ fontWeight: 600 }}>{c.full_name}</span>
              {c.phone && (
                <span dir="ltr" style={{ color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>
                  {c.phone}
                </span>
              )}
              {(c.flags ?? []).map((f, i) => (
                <CustomerFlagBadge key={`${f.type}-${i}`} flag={f} />
              ))}
            </button>
          ))}
          {search.isSuccess && (search.data ?? []).length === 0 && (
            <p style={{ margin: 0, paddingBlock: '0.4rem', paddingInline: '0.5rem', color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
              {tr('ws.courtDesk.create.noMatches')}
            </p>
          )}
        </div>
      )}
      {showCreateLink && (
        <p style={{ marginBlockStart: '0.35rem', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
          <Link to="/desk/customers/new" style={{ color: 'var(--tp-accent)', fontWeight: 600 }}>
            {tr('ws.courtDesk.create.createCustomer')}
          </Link>
        </p>
      )}
    </div>
  );
}
