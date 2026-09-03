/**
 * 06.9 CustomerRecordScreen — the history behind a customer and the staff
 * notes on them (customer_record). Flags are editable (set_customer_flags)
 * and surface wherever the customer appears. Notes are STAFF-VISIBLE ONLY:
 * nothing here is passed to any printable or guest-facing surface, and each
 * note shows its author, time and whether it was edited.
 * States: loading · ready · error.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { formatDate, formatDateTime, formatNumber, formatTimeRange, VENUE_TZ } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { QK, fetchActiveCourts, fetchVenueSettings } from '../../../lib/queries';
import { useToast } from '../../../components/toast';
import { useLocale, pickName } from '../../../lib/i18n';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../../components/ui';
import { AsyncStateWrapper, BookingStatusIndicator, CustomerFlagBadge, DescriptionList, EmptyState, MessagePresenter, Money, PageHeader, Panel, TabStatusIndicator, type CustomerFlagType } from '../../../components/kit';
import { Icon } from '../../../components/icons';
import type { CustomerFlag, CustomerNote, CustomerRecord, CustomerReservationRow } from '../deskTypes';
import type { CustomerSearchParams } from './CustomerSearch';

const FLAG_TYPES: readonly CustomerFlagType[] = ['vip', 'birthday', 'payment_note', 'special_request'];

export function CustomerRecordScreen() {
  const { tr, locale } = useLocale();
  const { id } = useParams({ strict: false }) as { id: string };
  const params = useSearch({ strict: false }) as CustomerSearchParams;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });
  const courtsQ = useQuery({ queryKey: QK.courts, queryFn: fetchActiveCourts });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;
  const courtName = (cid: string) => pickName(locale, courtsQ.data?.find((c) => c.id === cid)) || cid;

  const recordQ = useQuery({
    queryKey: ['customer', id],
    queryFn: () => appRpc<CustomerRecord | null>('customer_record', { p_customer_id: id }),
    retry: false,
  });
  const rec = recordQ.data ?? null;
  const [flagsOpen, setFlagsOpen] = useState(false);

  const status = recordQ.isError && !recordQ.data ? 'error' : recordQ.data === undefined ? 'loading' : recordQ.data === null ? 'empty' : 'ready';

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['customer', id] });
    void queryClient.invalidateQueries({ queryKey: ['customerSearch'] });
  }

  function attach() {
    if (params.attach === 'booking' && params.reservation) {
      void navigate({ to: '/desk/bookings/$id', params: { id: params.reservation }, search: { customer: id } as never });
    } else if (params.attach === 'tab') {
      void navigate({ to: '/till', search: { tab: params.tab, customer: id } as never });
    }
  }

  const counts = rec?.counts ?? { bookings: 0, cancellations: 0, noShows: 0, cafeOrders: 0 };

  return (
    <div>
      <PageHeader
        eyebrow={tr('ws.courtDesk.record.eyebrow')}
        title={rec?.customer.full_name ?? tr('ws.courtDesk.customers.title')}
        subtitle={
          rec ? (
            <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {rec.flags.length === 0 ? <span>{tr('ws.courtDesk.record.noFlags')}</span> : rec.flags.map((f, i) => <CustomerFlagBadge key={`${f.type}-${i}`} flag={f} size="md" />)}
              <Button size="sm" kind="ghost" icon="tag" onClick={() => setFlagsOpen(true)}>
                {tr('ws.courtDesk.record.editFlags')}
              </Button>
            </span>
          ) : undefined
        }
        actions={
          <>
            <Link to="/desk/customers" className="tp-btn" data-kind="ghost" data-size="md">
              {tr('ws.courtDesk.common.back')}
            </Link>
            {params.attach && (
              <Button kind="primary" icon="userPlus" onClick={attach}>
                {params.attach === 'booking' ? tr('ws.courtDesk.customers.attachBooking') : tr('ws.courtDesk.customers.attachTab')}
              </Button>
            )}
            <Link to="/desk" className="tp-btn" data-kind="default" data-size="md">
              <Icon name="plus" size={16} /> {tr('ws.courtDesk.record.newBooking')}
            </Link>
          </>
        }
      />
      <AsyncStateWrapper status={status} error={recordQ.error} onRetry={() => void recordQ.refetch()} emptyContent={<EmptyState icon="users" title={tr('ws.courtDesk.record.notFound')} />}>
        {rec && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(20rem, 2fr)', gap: '1rem', alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: '1rem' }}>
              <Panel>
                <DescriptionList
                  columns={3}
                  items={[
                    { label: tr('ws.courtDesk.record.phone'), value: rec.customer.phone ? <bdi dir="ltr">{rec.customer.phone}</bdi> : '—' },
                    { label: tr('ws.courtDesk.record.email'), value: rec.customer.email ? <bdi dir="ltr">{rec.customer.email}</bdi> : '—' },
                    { label: tr('ws.courtDesk.record.language'), value: rec.customer.preferred_lang === 'ar' ? tr('ws.courtDesk.customers.lang.ar') : rec.customer.preferred_lang === 'en' ? tr('ws.courtDesk.customers.lang.en') : '—' },
                    { label: tr('ws.courtDesk.record.bookings'), value: formatNumber(counts.bookings, locale), numeric: true },
                    { label: tr('ws.courtDesk.record.cancellations'), value: formatNumber(counts.cancellations, locale), numeric: true },
                    { label: tr('ws.courtDesk.record.noShows'), value: formatNumber(counts.noShows, locale), numeric: true },
                    { label: tr('ws.courtDesk.record.cafeOrders'), value: formatNumber(counts.cafeOrders ?? rec.cafeOrders.length, locale), numeric: true },
                    ...(rec.customer.created_at ? [{ label: tr('ws.courtDesk.record.since'), value: <bdi>{formatDate(new Date(rec.customer.created_at), locale, tz)}</bdi> }] : []),
                  ]}
                />
              </Panel>
              <BookingsPanel title={tr('ws.courtDesk.record.upcoming')} empty={tr('ws.courtDesk.record.upcomingEmpty')} rows={rec.upcoming} tz={tz} courtName={courtName} />
              <BookingsPanel title={tr('ws.courtDesk.record.history')} empty={tr('ws.courtDesk.record.historyEmpty')} rows={rec.history} tz={tz} courtName={courtName} />
              <Panel title={tr('ws.courtDesk.record.cafe')} padded={rec.cafeOrders.length === 0}>
                {rec.cafeOrders.length === 0 ? (
                  <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.courtDesk.record.cafeEmpty')}</p>
                ) : (
                  <table className="tp-table" data-dense="true">
                    <thead>
                      <tr>
                        <th>{tr('ws.courtDesk.record.orderDate')}</th>
                        <th>{tr('ws.courtDesk.common.status')}</th>
                        <th data-align="end">{tr('ws.courtDesk.record.orderTotal')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rec.cafeOrders.map((o) => (
                        <tr key={o.id}>
                          <td>
                            <bdi>{formatDateTime(new Date(o.opened_at), locale, tz)}</bdi>
                          </td>
                          <td>
                            <TabStatusIndicator status={o.status} size="sm" />
                          </td>
                          <td data-align="end">
                            <Money amount={o.total_iqd} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Panel>
              <Panel title={tr('ws.courtDesk.record.series')}>
                {rec.series.length === 0 ? (
                  <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.courtDesk.record.seriesEmpty')}</p>
                ) : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.35rem' }}>
                    {rec.series.map((s) => (
                      <li key={s.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <Icon name="repeat" size={14} style={{ color: 'var(--tp-muted-fg)' }} />
                        <bdi>{courtName(s.court_id)}</bdi>
                        <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
                          <bdi>
                            {formatDate(new Date(`${s.starts_on}T12:00:00Z`), locale, 'UTC')} – {formatDate(new Date(`${s.ends_on}T12:00:00Z`), locale, 'UTC')}
                          </bdi>
                          {s.occurrences !== undefined && <> · {tr('ws.courtDesk.record.occurrences', { count: formatNumber(s.occurrences, locale) })}</>}
                        </span>
                        <Link to="/desk/series/$id" params={{ id: s.id }} style={{ color: 'var(--tp-accent)', fontWeight: 600, fontSize: 'var(--tp-fs-sm)' }}>
                          {tr('ws.courtDesk.common.open')}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
            <NoteList customerId={id} notes={rec.notes} tz={tz} onChanged={invalidate} />
          </div>
        )}
      </AsyncStateWrapper>

      {flagsOpen && rec && (
        <FlagsEditor
          customerId={id}
          flags={rec.flags}
          onClose={() => setFlagsOpen(false)}
          onSaved={() => {
            setFlagsOpen(false);
            toast.ok(tr('ws.kit.actions.save'));
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function BookingsPanel({ title, empty, rows, tz, courtName }: { title: string; empty: string; rows: readonly CustomerReservationRow[]; tz: string; courtName: (id: string) => string }) {
  const { locale } = useLocale();
  // The RPC carries the court's names with each row; the courts query is only the fallback.
  const nameOf = (r: CustomerReservationRow) => (r.court_name_en && r.court_name_ar ? pickName(locale, { name_en: r.court_name_en, name_ar: r.court_name_ar }) : courtName(r.court_id));
  const navigate = useNavigate();
  return (
    <Panel title={title} padded={rows.length === 0}>
      {rows.length === 0 ? (
        <p style={{ color: 'var(--tp-muted-fg)' }}>{empty}</p>
      ) : (
        <table className="tp-table" data-dense="true" aria-label={title}>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                data-clickable="true"
                tabIndex={0}
                onClick={() => void navigate({ to: '/desk/bookings/$id', params: { id: r.id } })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void navigate({ to: '/desk/bookings/$id', params: { id: r.id } });
                }}
              >
                <td style={{ whiteSpace: 'nowrap' }}>
                  <bdi>{formatDate(new Date(r.start_at), locale, tz)}</bdi>
                </td>
                <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  <bdi>{formatTimeRange(new Date(r.start_at), new Date(r.end_at), locale, tz)}</bdi>
                </td>
                <td>
                  <bdi>{nameOf(r)}</bdi>
                </td>
                <td>
                  <BookingStatusIndicator status={r.status} size="sm" />
                </td>
                <td data-align="end">
                  <Money amount={r.price_iqd} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// NoteList / NoteEntry (spec §07 Customers). Staff-visible only.
// ---------------------------------------------------------------------------
export function NoteList({ customerId, notes, tz, onChanged }: { customerId: string; notes: readonly CustomerNote[]; tz: string; onChanged: () => void }) {
  const { tr } = useLocale();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function add() {
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await appRpc('add_customer_note', { p_customer_id: customerId, p_body: draft.trim() });
      setDraft('');
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={tr('ws.courtDesk.record.notes')} data-testid="customer-notes">
      <MessagePresenter tone="info" icon="lock" message={tr('ws.courtDesk.record.notesLead')} style={{ marginBlockEnd: '0.75rem' }} />
      {notes.length === 0 ? (
        <p style={{ color: 'var(--tp-muted-fg)', marginBlockEnd: '0.75rem' }}>{tr('ws.courtDesk.record.noNotes')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.5rem', marginBlockEnd: '0.75rem' }}>
          {notes.map((n) => (
            <NoteEntry key={n.id} note={n} tz={tz} onChanged={onChanged} />
          ))}
        </ul>
      )}
      <Field label={tr('ws.courtDesk.record.addNote')}>
        <textarea style={{ ...inputStyle, minBlockSize: '4.5rem', resize: 'vertical' }} value={draft} disabled={busy} maxLength={2000} placeholder={tr('ws.courtDesk.record.notePlaceholder')} onChange={(e) => setDraft(e.target.value)} />
      </Field>
      <ErrorText error={error} />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button kind="primary" icon="note" busy={busy} disabled={!draft.trim()} onClick={() => void add()}>
          {tr('ws.courtDesk.record.saveNote')}
        </Button>
      </div>
    </Panel>
  );
}

export function NoteEntry({ note, tz, onChanged }: { note: CustomerNote; tz: string; onChanged: () => void }) {
  const { tr, locale } = useLocale();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save() {
    if (!body.trim() || body.trim() === note.body) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await appRpc('edit_customer_note', { p_note_id: note.id, p_body: body.trim() });
      setEditing(false);
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const author = note.author_name ?? note.author_id ?? tr('ws.courtDesk.common.unknown');
  return (
    <li style={{ background: 'var(--tp-surface-2)', borderRadius: 'var(--tp-radius-ctl)', paddingBlock: '0.5rem', paddingInline: '0.65rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockEnd: '0.25rem' }}>
        <strong style={{ color: 'var(--tp-fg)' }}>
          <bdi>{author}</bdi>
        </strong>
        <bdi>{formatDateTime(new Date(note.created_at), locale, tz)}</bdi>
        {note.edited_at && (
          <span title={formatDateTime(new Date(note.edited_at), locale, tz)}>
            · {tr('ws.courtDesk.record.edited')}
            {note.edited_by_name ? ` (${tr('ws.courtDesk.record.by', { name: note.edited_by_name })})` : ''}
          </span>
        )}
        {!editing && (
          <Button size="sm" kind="ghost" style={{ marginInlineStart: 'auto' }} onClick={() => setEditing(true)}>
            {tr('ws.courtDesk.record.editNote')}
          </Button>
        )}
      </div>
      {editing ? (
        <div>
          <textarea style={{ ...inputStyle, minBlockSize: '4rem', resize: 'vertical' }} value={body} disabled={busy} maxLength={2000} onChange={(e) => setBody(e.target.value)} autoFocus />
          <ErrorText error={error} />
          <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', marginBlockStart: '0.35rem' }}>
            <Button size="sm" disabled={busy} onClick={() => { setEditing(false); setBody(note.body); }}>
              {tr('ws.courtDesk.record.cancelEdit')}
            </Button>
            <Button size="sm" kind="primary" busy={busy} onClick={() => void save()}>
              {tr('ws.courtDesk.common.save')}
            </Button>
          </div>
        </div>
      ) : (
        <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{note.body}</p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Flags editor: type + optional label per flag (set_customer_flags).
// ---------------------------------------------------------------------------
function FlagsEditor({ customerId, flags, onClose, onSaved }: { customerId: string; flags: readonly CustomerFlag[]; onClose: () => void; onSaved: () => void }) {
  const { tr } = useLocale();
  const [state, setState] = useState<Record<CustomerFlagType, { on: boolean; label: string }>>(() => {
    const init = {} as Record<CustomerFlagType, { on: boolean; label: string }>;
    for (const t of FLAG_TYPES) {
      const existing = flags.find((f) => f.type === t);
      init[t] = { on: Boolean(existing), label: existing?.label ?? '' };
    }
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const p_flags = FLAG_TYPES.filter((t) => state[t].on).map((t) => ({ type: t, label: state[t].label.trim() || null }));
      await appRpc('set_customer_flags', { p_customer_id: customerId, p_flags });
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={tr('ws.courtDesk.record.flagsTitle')}
      subtitle={tr('ws.courtDesk.record.flagsLead')}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button kind="primary" busy={busy} onClick={() => void save()}>
            {tr('ws.courtDesk.record.saveFlags')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: '0.6rem' }}>
        {FLAG_TYPES.map((t) => (
          <div key={t} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.5rem 0.75rem', alignItems: 'center' }}>
            <label style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={state[t].on} disabled={busy} onChange={(e) => setState({ ...state, [t]: { ...state[t], on: e.target.checked } })} />
              <CustomerFlagBadge flag={{ type: t }} size="md" />
            </label>
            <input
              style={inputStyle}
              aria-label={`${tr(`ws.kit.flags.${t}`)} · ${tr('ws.courtDesk.record.flagLabel')}`}
              placeholder={tr('ws.courtDesk.record.flagLabel')}
              value={state[t].label}
              disabled={busy || !state[t].on}
              maxLength={80}
              onChange={(e) => setState({ ...state, [t]: { ...state[t], label: e.target.value } })}
            />
          </div>
        ))}
      </div>
      <ErrorText error={error} />
    </Modal>
  );
}
