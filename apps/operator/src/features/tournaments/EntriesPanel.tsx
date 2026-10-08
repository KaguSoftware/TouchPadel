/**
 * The Entries tab of `/desk/tournaments/$id` (docs/design/tournaments/
 * build-contracts-2026-10-03.md §1.6 add / remove / no-show / settle; plan §5.1
 * "Entries"): each row's seed, player, status and what is paid or owed, and
 * its actions.
 *
 * - Add a walk-in goes through the customer picker
 *   (`/desk/customers?attach=tournament&tournament=<id>`); the customer handed
 *   back (`?customer=`) is added here (app.tournament_add_entry). A gendered
 *   category without the player's gender opens the record's GenderDialog and
 *   tries again.
 * - Take payment opens TakeTournamentPayment over the till's PaymentPane.
 * - Did not show, with a waitlisted substitute or none
 *   (app.tournament_mark_no_show); Remove while open or closed
 *   (app.tournament_remove_entry, a reason).
 *
 * Every write is a direct appRpc with its literal name, online only.
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatIQD, formatNumber, isolate } from '@touch/i18n';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Button, Modal } from '../../components/ui';
import {
  DataTable,
  MessagePresenter,
  ReasonCodePrompt,
  StatusBadge,
  ViewMore,
  useListCap,
  type Column,
} from '../../components/kit';
import { GenderDialog } from '../desk/customers/GenderDialog';
import { TakeTournamentPayment, type TournamentPayTarget } from './TakeTournamentPayment';
import {
  ENTRY_STATUS_TONE,
  entryActions,
  entryMoney,
  sortEntries,
  substitutes,
  tournamentErrorText,
} from './tournamentLogic';
import {
  readAddEntryAnswer,
  readPlayAnswer,
  readTournamentDetail,
  type TourEntry,
  type TournamentDetail,
} from './tournamentPayloads';
import { invalidateTournament, type TournamentCaps } from './useTournaments';

/** The reasons a desk removal offers (op.reasons; sent as `<code>` or `<code>: <note>`). */
const REMOVE_REASONS = ['customer_request', 'staff_error', 'duplicate', 'other'] as const;

export function EntriesPanel({
  detail,
  caps,
  addCustomer,
  onCustomerHandled,
  onRefetch,
}: {
  detail: TournamentDetail;
  caps: TournamentCaps;
  /** A customer handed back from the picker (`?customer=`): added once. */
  addCustomer?: string;
  onCustomerHandled?: () => void;
  onRefetch: () => void;
}) {
  const { tr, locale } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { reachable } = useStationReach();
  const [pay, setPay] = useState<TournamentPayTarget | null>(null);
  const [removing, setRemoving] = useState<TourEntry | null>(null);
  const [noShow, setNoShow] = useState<TourEntry | null>(null);
  const [gender, setGender] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const rows = sortEntries(detail.entries);
  // Owner's rule (2026-10-08): three entries, then "View more"; the sort is kept.
  const cap = useListCap(rows);
  const money = (n: number) => formatIQD(n, locale);
  const nameOf = (e: TourEntry) =>
    e.full_name || tr('tournaments.common.player', { no: String(e.seed_no ?? '?') });
  const seedOf = (id: string | null) =>
    detail.entries.find((x) => x.entry_id === id)?.seed_no ?? null;

  async function add(guestId: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const out = readAddEntryAnswer(
        await appRpc('tournament_add_entry', { p_tournament_id: detail.id, p_guest_id: guestId }),
      );
      const fresh = await refetch();
      const e = fresh?.entries.find((x) => x.entry_id === out.entry_id);
      const name = isolate(e?.full_name ?? '');
      toast.ok(
        tr(
          out.duplicate
            ? 'ws.tournaments.entries.duplicate'
            : out.status === 'waitlisted'
              ? 'ws.tournaments.entries.addedWaitlist'
              : 'ws.tournaments.entries.added',
          { name },
        ),
      );
    } catch (e) {
      if (e instanceof AppRpcError && e.code === 'GENDER_REQUIRED') setGender(guestId);
      else setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function refetch(): Promise<TournamentDetail | null> {
    invalidateTournament(qc);
    try {
      return readTournamentDetail(
        await appRpc('desk_tournament_detail', { p_tournament_id: detail.id }),
      );
    } catch {
      return null;
    }
  }

  // `?customer=<id>`: once, when the detail is here.
  const handled = useRef(false);
  useEffect(() => {
    if (!addCustomer || handled.current) return;
    handled.current = true;
    onCustomerHandled?.();
    void add(addCustomer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addCustomer]);

  async function remove(code: string, note: string) {
    if (!removing) return;
    setBusy(true);
    setError(null);
    try {
      await appRpc('tournament_remove_entry', {
        p_entry_id: removing.entry_id,
        p_reason: note ? `${code}: ${note}` : code,
      });
      toast.ok(tr('ws.tournaments.entries.removed'));
      setRemoving(null);
      invalidateTournament(qc);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function markNoShow(substituteEntryId: string | null) {
    if (!noShow) return;
    setBusy(true);
    setError(null);
    try {
      const out = readPlayAnswer(
        await appRpc('tournament_mark_no_show', {
          p_entry_id: noShow.entry_id,
          p_substitute_entry_id: substituteEntryId,
          p_substitute_guest_id: null,
        }),
      );
      toast.ok(tr('ws.tournaments.entries.noShowDone', { name: isolate(nameOf(noShow)) }));
      if (out.removed_from_round !== null) {
        setNotice(
          tr('ws.tournaments.entries.roundsRemoved', {
            round: formatNumber(out.removed_from_round, locale),
          }),
        );
      }
      setNoShow(null);
      invalidateTournament(qc);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<TourEntry>[] = [
    {
      key: 'seed',
      header: tr('ws.tournaments.entries.columns.seed'),
      width: '4rem',
      render: (e) =>
        e.seed_no !== null
          ? tr('ws.tournaments.entries.seed', { no: formatNumber(e.seed_no, locale) })
          : '—',
    },
    {
      key: 'player',
      header: tr('ws.tournaments.entries.columns.player'),
      truncateTitle: (e) => nameOf(e),
      render: (e) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
          <bdi style={{ fontWeight: 600 }}>{nameOf(e)}</bdi>
          <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
            {[
              e.phone ? isolate(e.phone) : null,
              e.added_by_kind === 'staff' ? tr('ws.tournaments.entries.byDesk') : null,
              e.substitute_for
                ? tr('ws.tournaments.entries.substituteFor', {
                    no: formatNumber(seedOf(e.substitute_for) ?? 0, locale),
                  })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      header: tr('ws.tournaments.entries.columns.status'),
      render: (e) => (
        <span
          style={{
            display: 'inline-flex',
            gap: 'var(--tp-sp-1)',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <StatusBadge
            size="sm"
            tone={ENTRY_STATUS_TONE[e.status]}
            label={tr(`tournaments.common.entryStatus.${e.status}`)}
          />
          {e.status === 'waitlisted' && e.waitlist_position !== null && (
            <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
              {tr('ws.tournaments.entries.waitlistPosition', {
                n: formatNumber(e.waitlist_position, locale),
              })}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'money',
      header: tr('ws.tournaments.entries.columns.money'),
      render: (e) => {
        const m = entryMoney(e, detail.entry_fee_iqd);
        if (m.kind === 'owed')
          return (
            <StatusBadge
              size="sm"
              tone="warn"
              label={tr('ws.tournaments.entries.owed', { amount: money(m.amount) })}
            />
          );
        if (m.kind === 'refund')
          return (
            <StatusBadge
              size="sm"
              tone="danger"
              label={tr('ws.tournaments.entries.refundDue', { amount: money(m.amount) })}
            />
          );
        if (m.kind === 'paid')
          return <StatusBadge size="sm" tone="success" label={tr('ws.tournaments.entries.paid')} />;
        return (
          <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.tournaments.entries.noFee')}</span>
        );
      },
    },
    {
      key: 'actions',
      header: tr('ws.tournaments.entries.columns.actions'),
      align: 'end',
      render: (e) => {
        const a = entryActions(e, detail, {
          run: caps.runTournaments,
          pay: caps.takeTournamentPayment,
        });
        return (
          <span
            style={{
              display: 'inline-flex',
              gap: 'var(--tp-sp-1-5)',
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
            }}
          >
            {a.pay && (
              <Button
                size="sm"
                kind="primary"
                icon="banknote"
                disabled={!reachable}
                onClick={() => setPay({ entryId: e.entry_id, name: nameOf(e), dueIqd: e.owed_iqd })}
              >
                {tr('ws.tournaments.entries.takePayment')}
              </Button>
            )}
            {a.promote && e.guest_id && (
              <Button
                size="sm"
                icon="userPlus"
                busy={busy}
                disabled={!reachable}
                onClick={() => void add(e.guest_id!)}
              >
                {tr('ws.tournaments.entries.promote')}
              </Button>
            )}
            {a.noShow && (
              <Button
                size="sm"
                icon="eyeOff"
                disabled={!reachable || busy}
                onClick={() => setNoShow(e)}
              >
                {tr('ws.tournaments.entries.noShow')}
              </Button>
            )}
            {a.remove && (
              <Button
                size="sm"
                kind="ghost"
                icon="trash"
                disabled={!reachable || busy}
                onClick={() => setRemoving(e)}
              >
                {tr('ws.tournaments.entries.remove')}
              </Button>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }} data-testid="entries-panel">
      {caps.runTournaments && detail.can.add && (
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center' }}>
          <Button
            icon="userPlus"
            busy={busy}
            disabled={!reachable}
            onClick={() =>
              void navigate({
                to: '/desk/customers',
                search: { attach: 'tournament', tournament: detail.id } as never,
              })
            }
          >
            {tr('ws.tournaments.entries.add')}
          </Button>
          <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
            {tr('ws.tournaments.list.entries', {
              registered: formatNumber(
                detail.entries.filter((e) => e.status === 'registered').length,
                locale,
              ),
              max: formatNumber(detail.max_entries, locale),
            })}
          </span>
        </div>
      )}
      {notice && <MessagePresenter tone="info" message={notice} />}
      {error != null && !removing && !noShow && (
        <p
          role="alert"
          style={{ margin: 0, color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}
        >
          {tournamentErrorText(error, tr)}
        </p>
      )}
      <div>
        <DataTable
          columns={columns}
          rows={cap.shown}
          rowKey={(e) => e.entry_id}
          dense
          aria-label={tr('ws.tournaments.entries.title')}
          emptyContent={
            <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.tournaments.entries.empty')}</span>
          }
        />
        <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} />
      </div>

      {pay && (
        <TakeTournamentPayment
          target={pay}
          method="cash"
          onClose={() => setPay(null)}
          onNotice={setNotice}
          refetchDue={async () => {
            const fresh = await refetch();
            onRefetch();
            return fresh?.entries.find((x) => x.entry_id === pay.entryId)?.owed_iqd ?? null;
          }}
        />
      )}

      {removing && (
        <ReasonCodePrompt
          action={tr('ws.tournaments.entries.removeAction')}
          reasonCodes={REMOVE_REASONS}
          noteMode="optional"
          busy={busy}
          error={error}
          onCancel={() => {
            setRemoving(null);
            setError(null);
          }}
          onSubmit={(code, note) => void remove(code, note)}
        >
          <p style={{ marginBlockStart: 0 }}>
            <bdi>{nameOf(removing)}</bdi>
          </p>
        </ReasonCodePrompt>
      )}

      {noShow && (
        <NoShowDialog
          entry={noShow}
          name={nameOf(noShow)}
          options={substitutes(detail)}
          busy={busy}
          error={error}
          onClose={() => {
            setNoShow(null);
            setError(null);
          }}
          onConfirm={(sub) => void markNoShow(sub)}
        />
      )}

      {gender && (
        <GenderDialog
          customerId={gender}
          current={null}
          onClose={() => setGender(null)}
          onSaved={() => {
            const id = gender;
            setGender(null);
            void add(id);
          }}
        />
      )}
    </div>
  );
}

function NoShowDialog({
  name,
  options,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  entry: TourEntry;
  name: string;
  options: TourEntry[];
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (substituteEntryId: string | null) => void;
}) {
  const { tr } = useLocale();
  const [pick, setPick] = useState<string>('');
  return (
    <Modal
      title={tr('ws.tournaments.entries.noShowTitle', { name: isolate(name) })}
      subtitle={tr('ws.tournaments.entries.noShowLead')}
      onClose={onClose}
      dismissible={!busy}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button kind="danger" busy={busy} onClick={() => onConfirm(pick || null)}>
            {tr('ws.tournaments.entries.noShowConfirm')}
          </Button>
        </>
      }
    >
      <div
        role="radiogroup"
        aria-label={tr('ws.tournaments.entries.substitute')}
        style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}
      >
        <label className="tp-choice" data-selected={pick === '' ? 'true' : undefined}>
          <input
            className="tp-sr-only"
            type="radio"
            name="tour-sub"
            checked={pick === ''}
            disabled={busy}
            onChange={() => setPick('')}
          />
          <span style={{ flex: 1 }}>{tr('ws.tournaments.entries.noShowWithout')}</span>
        </label>
        {options.map((o) => (
          <label
            key={o.entry_id}
            className="tp-choice"
            data-selected={pick === o.entry_id ? 'true' : undefined}
          >
            <input
              className="tp-sr-only"
              type="radio"
              name="tour-sub"
              checked={pick === o.entry_id}
              disabled={busy}
              onChange={() => setPick(o.entry_id)}
            />
            <span style={{ flex: 1 }}>
              <bdi>{o.full_name}</bdi>
            </span>
          </label>
        ))}
      </div>
      {error != null && (
        <p
          role="alert"
          style={{
            margin: 0,
            marginBlockStart: 'var(--tp-sp-2)',
            color: 'var(--tp-danger-fg)',
            fontSize: 'var(--tp-fs-sm)',
          }}
        >
          {tournamentErrorText(error, tr)}
        </p>
      )}
    </Modal>
  );
}
