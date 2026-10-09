/**
 * The member on a bill (docs/design/loyalty/build-contracts-2026-10-05.md §1.3, plan §5.3): one
 * field that takes a scanned member QR, a typed token or the phone the guest says, then
 * app.loyalty_identify (this branch) and app.set_tab_customer. The attached member shows as a
 * chip with their tier and balance, and three actions while the tab is open:
 *
 *   Use points  app.loyalty_redeem with points; opens on the most that fit what is left to pay
 *               (the server caps it anyway and rounds the points down to fit).
 *   Rewards     app.loyalty_redeem with a reward. The list is management's read
 *               (loyalty_admin) or the tables where the policies let the till read them; a role
 *               that can read neither is told so and uses points.
 *   Undo        app.loyalty_unredeem on one of the tab's loyalty adjustments.
 *
 * Points and rewards are spent only with proof the member is here (0308, c2): the member token
 * scanned a moment ago (sent once as p_member_token), else a manager's PIN in the dialog
 * (verify_manager_pin, then the redemption spends its grant). A refused token asks for the PIN.
 * A member who works here is added to a bill only behind another manager's PIN: when
 * set_tab_customer answers PIN_GRANT_REQUIRED the PIN is asked for and the attach sent again.
 *
 * Every call is online only (L-6: no queued mutation type). A tab opened offline has no server
 * id yet, so the button is off with a hint until its open replays. After each write the tab,
 * the tab lists, a booking's bill and the member are re-read (invalidateTabLoyalty), so the
 * totals beside this block move with it.
 *
 * Hosts: the café TabDetailPanel, the shop till (MemberIdentifyDialog before the sale exists,
 * this block before payment) and the desk's booking bill. A host that wants scanner bursts
 * routed here passes `listenScans`; TillScreen's wedge dispatches MEMBER_SCAN_EVENT.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatIQD, formatNumber } from '@touch/i18n';
import type { IdentifiedMember, LoyaltyAdminReward } from '@touch/core/loyalty';
import { useLocale } from '../../lib/i18n';
import { can, useAuth } from '../../lib/auth';
import { useStationReach } from '../../lib/stationReach';
import { LOCAL_TAB_PREFIX } from '../../lib/offlineTabs';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { MessagePresenter, ViewMore, useListCap } from '../../components/kit';
import {
  defaultRedeemPoints,
  identifyCode,
  loyaltyAdjustments,
  parseWhole,
  redeemBlock,
  redeemWorth,
  type MemberView,
} from './loyaltyLogic';
import {
  forgetMemberToken,
  freshMemberToken,
  grantManagerPin,
  identifyMember,
  invalidateTabLoyalty,
  needsAttachPin,
  redeemKey,
  redeemPoints,
  redeemReward,
  setTabCustomer,
  unredeem,
  useLoyaltyTerms,
  useMemberView,
  useTabLoyalty,
  type StaffLoyaltyTerms,
} from './useLoyalty';

const K = 'ws.loyalty';

/** A refusal of the member's token: it is spent or stale, so a manager PIN is asked instead. */
const TOKEN_REFUSALS = new Set([
  'MEMBER_CODE_EXPIRED',
  'MEMBER_CODE_INVALID',
  'MEMBER_CODE_MISMATCH',
]);
function isTokenRefusal(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && TOKEN_REFUSALS.has(code);
}

/**
 * The proof a redemption needs (0308, c2): the member's card scanned a moment ago, else a
 * manager's PIN. Returns the token to send (null: the PIN path) and the PIN field when asked.
 */
function useRedeemProof(customerId: string) {
  const { tr } = useLocale();
  const [token, setToken] = useState<string | null>(() => freshMemberToken(customerId));
  const [pin, setPin] = useState('');
  const needPin = token === null;
  return {
    token,
    ready: !needPin || pin.length >= 4,
    /** Before the call: the PIN grant, when that is the proof. */
    async prove(): Promise<string | null> {
      if (needPin) await grantManagerPin(pin);
      return token;
    },
    /** After the call: a token proves once; a refused one falls back to the PIN. */
    settle(error: unknown | null) {
      if (token && (error === null || isTokenRefusal(error))) {
        forgetMemberToken(customerId);
        setToken(null);
      }
    },
    field: needPin ? (
      <Field label={tr(`${K}.redeem.pinLabel`)} hint={tr(`${K}.redeem.pinHint`)}>
        <input
          style={{ ...inputStyle, inlineSize: '10rem' }}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={pin}
          data-testid="redeem-pin"
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
      </Field>
    ) : null,
  };
}

/** A scanner burst the till's wedge recognised as a member card; detail is the code. */
export const MEMBER_SCAN_EVENT = 'till-member-scan';

export function dispatchMemberScan(code: string): void {
  window.dispatchEvent(new CustomEvent<string>(MEMBER_SCAN_EVENT, { detail: code }));
}

// ---------------------------------------------------------------------------
// The one field
// ---------------------------------------------------------------------------

/**
 * Identify a member from the field. `onIdentified` does what the host needs with them (attach to
 * a tab, hold for a sale) and may throw; its refusal shows here, under the field.
 */
export function MemberIdentifyDialog({
  initialCode = '',
  onClose,
  onIdentified,
}: {
  initialCode?: string;
  onClose: () => void;
  onIdentified: (member: IdentifiedMember) => Promise<void> | void;
}) {
  const { tr } = useLocale();
  const { reachable } = useStationReach();
  const [text, setText] = useState(initialCode);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const started = useRef(false);

  async function find(raw = text) {
    if (busy) return;
    setError(null);
    const code = identifyCode(raw);
    setInvalid(code === null);
    if (!code) return;
    setBusy(true);
    try {
      const member = await identifyMember(code.code);
      await onIdentified(member);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  // A scan that opened the dialog is looked up at once: the cashier already did the work.
  useEffect(() => {
    if (started.current || !initialCode) return;
    started.current = true;
    void find(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  return (
    <Modal
      title={tr(`${K}.member.title`)}
      subtitle={tr(`${K}.member.lead`)}
      size="sm"
      dismissible={!busy}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            icon="search"
            busy={busy}
            disabled={!reachable || text.trim() === ''}
            disabledReason={reachable ? undefined : tr(`${K}.member.noConnection`)}
            onClick={() => void find()}
            data-testid="member-find"
          >
            {tr(`${K}.member.find`)}
          </Button>
        </>
      )}
    >
      <Field
        label={tr(`${K}.member.field`)}
        error={invalid ? tr(`${K}.member.invalid`) : undefined}
        style={{ marginBlockEnd: 0 }}
      >
        <input
          style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums' }}
          dir="ltr"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={text}
          maxLength={40}
          disabled={busy}
          placeholder={tr(`${K}.member.placeholder`)}
          data-testid="member-code"
          onChange={(e) => {
            setText(e.target.value);
            setInvalid(false);
          }}
          onKeyDown={(e) => {
            // The scanner ends its burst with Enter, as a person does.
            if (e.key === 'Enter') {
              e.preventDefault();
              void find();
            }
          }}
        />
      </Field>
      <ErrorText error={error} />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// The chip
// ---------------------------------------------------------------------------

export function MemberChip({
  member,
  actions,
  note,
}: {
  member: MemberView;
  actions?: ReactNode;
  note?: ReactNode;
}) {
  const { tr, locale } = useLocale();
  const tier =
    locale === 'ar' ? (member.tierAr ?? member.tierEn) : (member.tierEn ?? member.tierAr);
  return (
    <div data-testid="member-chip" style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--tp-sp-2)',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0 }}>
          <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <bdi>{member.displayName ?? tr(`${K}.member.unknownName`)}</bdi>
          </strong>
          <span
            style={{
              fontSize: 'var(--tp-fs-xs)',
              color: 'var(--tp-muted-fg)',
              display: 'inline-flex',
              gap: 'var(--tp-sp-1)',
              flexWrap: 'wrap',
            }}
          >
            {tier && <span>{tr(`${K}.member.tier`, { tier })}</span>}
            {member.phoneMasked && <bdi dir="ltr">{member.phoneMasked}</bdi>}
          </span>
        </span>
        <strong data-testid="member-balance" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {tr(`${K}.member.balance`, { points: formatNumber(member.balance, locale) })}
        </strong>
      </div>
      {note}
      {actions && (
        <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>{actions}</div>
      )}
    </div>
  );
}

const box = {
  display: 'grid',
  gap: 'var(--tp-sp-2)',
  padding: 'var(--tp-sp-2-5)',
  borderRadius: 'var(--tp-radius-ctl)',
  background: 'var(--tp-surface-2)',
} as const;

// ---------------------------------------------------------------------------
// The block on a tab
// ---------------------------------------------------------------------------

type Dialog =
  | { kind: 'none' }
  | { kind: 'identify'; code: string }
  | { kind: 'staffPin'; member: IdentifiedMember }
  | { kind: 'redeem' }
  | { kind: 'rewards' };

export function MemberAttach({
  tabId,
  remainingIqd,
  listenScans = false,
}: {
  tabId: string;
  /** What is still to pay, as the host shows it; null while it is not known (a court fee loading). */
  remainingIqd: number | null;
  /** Open on MEMBER_SCAN_EVENT (the café till's wedge). */
  listenScans?: boolean;
}) {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const { reachable } = useStationReach();
  const qc = useQueryClient();
  const allowed = can(staff?.role, 'attachMember');
  const local = tabId.startsWith(LOCAL_TAB_PREFIX);
  const tabQ = useTabLoyalty(allowed && !local ? tabId : null);
  const customerId = tabQ.data?.customer_id ?? null;
  const memberQ = useMemberView(customerId);
  const termsQ = useLoyaltyTerms(customerId !== null);
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // A fresh tab starts clean.
  useEffect(() => {
    setDialog({ kind: 'none' });
    setError(null);
    setNotice(null);
  }, [tabId]);

  const scanGate = useRef(false);
  scanGate.current = allowed && !local;
  useEffect(() => {
    if (!listenScans) return;
    function onScan(e: Event) {
      if (!scanGate.current) return;
      setNotice(null);
      setError(null);
      setDialog({ kind: 'identify', code: (e as CustomEvent<string>).detail });
    }
    window.addEventListener(MEMBER_SCAN_EVENT, onScan);
    return () => window.removeEventListener(MEMBER_SCAN_EVENT, onScan);
  }, [listenScans]);

  const used = loyaltyAdjustments(tabQ.data?.tab_adjustments ?? []);
  const usedCap = useListCap(used);

  if (!allowed) return null;

  const refresh = (id: string | null = customerId) => invalidateTabLoyalty(qc, tabId, id);
  const open = tabQ.data?.status === 'open';
  const member = customerId ? (memberQ.data ?? null) : null;
  const terms: StaffLoyaltyTerms = termsQ.data ?? {
    enabled: null,
    pointValueIqd: null,
    minRedeemPoints: null,
    rewards: null,
  };
  const off = member?.enabled === false || terms.enabled === false;
  const offlineReason = !reachable ? tr(`${K}.member.noConnection`) : undefined;

  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function attach(m: IdentifiedMember) {
    try {
      await setTabCustomer(tabId, m.customer_id);
    } catch (e) {
      // 0308 (c2): a member who works here is added only behind another manager's PIN.
      if (needsAttachPin(e)) {
        setDialog({ kind: 'staffPin', member: m });
        return;
      }
      throw e;
    }
    setDialog({ kind: 'none' });
    refresh(m.customer_id);
  }

  if (local) {
    return (
      <div style={box}>
        <Button
          icon="userPlus"
          disabled
          disabledReason={tr(`${K}.member.offline`)}
          data-testid="member-button"
        >
          {tr(`${K}.member.button`)}
        </Button>
        <p style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
          {tr(`${K}.member.offline`)}
        </p>
      </div>
    );
  }

  return (
    <section aria-label={tr(`${K}.member.attached`)} style={box} data-testid="member-attach">
      {!customerId ? (
        <Button
          icon="userPlus"
          disabled={!open || busy || !reachable}
          disabledReason={offlineReason}
          onClick={() => {
            setNotice(null);
            setDialog({ kind: 'identify', code: '' });
          }}
          data-testid="member-button"
        >
          {tr(`${K}.member.button`)}
        </Button>
      ) : member ? (
        <MemberChip
          member={member}
          note={
            off ? (
              <MessagePresenter tone="info" icon="info" message={tr(`${K}.member.off`)} />
            ) : undefined
          }
          actions={
            open ? (
              <>
                <Button
                  size="sm"
                  kind="primary"
                  icon="star"
                  disabled={busy || off || !reachable || member.balance <= 0}
                  disabledReason={
                    offlineReason ?? (member.balance <= 0 ? tr(`${K}.redeem.noBalance`) : undefined)
                  }
                  onClick={() => setDialog({ kind: 'redeem' })}
                  data-testid="member-use-points"
                >
                  {tr(`${K}.redeem.button`)}
                </Button>
                <Button
                  size="sm"
                  icon="ticket"
                  disabled={busy || off || !reachable}
                  disabledReason={offlineReason}
                  onClick={() => setDialog({ kind: 'rewards' })}
                >
                  {tr(`${K}.rewards.button`)}
                </Button>
                <Button
                  size="sm"
                  kind="ghost"
                  icon="x"
                  busy={busy}
                  disabled={!reachable}
                  disabledReason={offlineReason}
                  onClick={() =>
                    void run(async () => {
                      await setTabCustomer(tabId, null);
                      refresh();
                      return null;
                    })
                  }
                  data-testid="member-remove"
                >
                  {tr(`${K}.member.remove`)}
                </Button>
              </>
            ) : undefined
          }
        />
      ) : memberQ.isError ? (
        <ErrorText error={memberQ.error} style={{ marginBlock: 0 }} />
      ) : (
        <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          {tr(`${K}.member.attached`)}…
        </span>
      )}

      {used.length > 0 && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
          <span
            style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 600, color: 'var(--tp-muted-fg)' }}
          >
            {tr(`${K}.redeem.usedTitle`)}
          </span>
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'grid',
              gap: 'var(--tp-sp-1)',
            }}
          >
            {usedCap.shown.map((a) => (
              <li
                key={a.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 'var(--tp-sp-2)',
                  fontSize: 'var(--tp-fs-sm)',
                }}
              >
                <span>
                  {a.reason_code === 'loyalty_reward'
                    ? tr(`${K}.redeem.rewardRow`, { amount: formatIQD(a.amount_iqd, locale) })
                    : tr(`${K}.redeem.usedRow`, {
                        points: formatNumber(Number(a.value ?? 0), locale),
                        amount: formatIQD(a.amount_iqd, locale),
                      })}
                </span>
                {open && (
                  <Button
                    size="sm"
                    kind="ghost"
                    icon="undo"
                    disabled={busy || !reachable}
                    disabledReason={offlineReason}
                    onClick={() =>
                      void run(async () => {
                        await unredeem(a.id);
                        refresh();
                        return tr(`${K}.redeem.undone`);
                      })
                    }
                    data-testid="member-undo"
                  >
                    {tr(`${K}.redeem.undo`)}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <ViewMore hidden={usedCap.hidden} open={usedCap.open} onToggle={usedCap.toggle} style={{ marginBlockStart: 0 }} />
        </div>
      )}

      {notice && <MessagePresenter tone="success" message={notice} />}
      <ErrorText error={error} style={{ marginBlock: 0 }} />

      {dialog.kind === 'identify' && (
        <MemberIdentifyDialog
          initialCode={dialog.code}
          onClose={() => setDialog({ kind: 'none' })}
          onIdentified={attach}
        />
      )}
      {dialog.kind === 'staffPin' && (
        <StaffPinDialog
          tabId={tabId}
          member={dialog.member}
          onClose={() => setDialog({ kind: 'none' })}
          onDone={() => {
            setDialog({ kind: 'none' });
            refresh(dialog.member.customer_id);
          }}
        />
      )}
      {dialog.kind === 'redeem' && member && (
        <RedeemDialog
          tabId={tabId}
          member={member}
          remainingIqd={remainingIqd}
          terms={terms}
          onClose={() => setDialog({ kind: 'none' })}
          onDone={(text) => {
            setDialog({ kind: 'none' });
            setNotice(text);
            refresh();
          }}
        />
      )}
      {dialog.kind === 'rewards' && member && (
        <RewardsDialog
          tabId={tabId}
          member={member}
          rewards={terms.rewards}
          loading={termsQ.isLoading}
          onClose={() => setDialog({ kind: 'none' })}
          onDone={(text) => {
            setDialog({ kind: 'none' });
            setNotice(text);
            refresh();
          }}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// A member who works here (0308, c2)
// ---------------------------------------------------------------------------

/**
 * set_tab_customer refuses an active staff member without a manager PIN grant (PIN_GRANT_REQUIRED),
 * and refuses the staff member's own PIN (FORBIDDEN self_dealing): another manager enters theirs
 * here (verify_manager_pin, the 0115 grant pattern), then the attach is sent again.
 */
function StaffPinDialog({
  tabId,
  member,
  onClose,
  onDone,
}: {
  tabId: string;
  member: IdentifiedMember;
  onClose: () => void;
  onDone: () => void;
}) {
  const { tr } = useLocale();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ready = pin.length >= 4;

  async function confirm() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await grantManagerPin(pin);
      await setTabCustomer(tabId, member.customer_id);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={tr(`${K}.member.staffTitle`)}
      subtitle={tr(`${K}.member.staffLead`, {
        name: member.display_name ?? tr(`${K}.member.unknownName`),
      })}
      size="sm"
      dismissible={!busy}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            icon="userPlus"
            busy={busy}
            disabled={!ready}
            onClick={() => void confirm()}
            data-testid="staff-attach-confirm"
          >
            {tr(`${K}.member.staffConfirm`)}
          </Button>
        </>
      )}
    >
      <Field label={tr(`${K}.redeem.pinLabel`)} style={{ marginBlockEnd: 0 }}>
        <input
          style={{ ...inputStyle, inlineSize: '10rem' }}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          maxLength={6}
          value={pin}
          disabled={busy}
          data-testid="staff-attach-pin"
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && void confirm()}
        />
      </Field>
      <ErrorText error={error} />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Use points
// ---------------------------------------------------------------------------

function RedeemDialog({
  tabId,
  member,
  remainingIqd,
  terms,
  onClose,
  onDone,
}: {
  tabId: string;
  member: MemberView;
  remainingIqd: number | null;
  terms: StaffLoyaltyTerms;
  onClose: () => void;
  onDone: (notice: string) => void;
}) {
  const { tr, locale } = useLocale();
  const [key] = useState(redeemKey);
  const proof = useRedeemProof(member.customerId);
  const fit = defaultRedeemPoints(member.balance, remainingIqd, terms);
  const [text, setText] = useState(String(fit));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const points = parseWhole(text);
  const block = redeemBlock(points, member.balance, remainingIqd, terms);
  const worth = points !== null ? redeemWorth(points, remainingIqd, terms) : null;
  const n = (v: number) => formatNumber(v, locale);
  const blockText =
    block === 'noBalance'
      ? tr(`${K}.redeem.noBalance`)
      : block === 'nothingDue'
        ? tr(`${K}.redeem.nothingDue`)
        : block === 'belowMin'
          ? tr(`${K}.redeem.belowMin`, { min: n(terms.minRedeemPoints ?? 0) })
          : block === 'overBalance'
            ? tr(`${K}.redeem.overBalance`, { points: n(member.balance) })
            : undefined;

  async function confirm() {
    if (block || points === null || !proof.ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await redeemPoints(tabId, points, key, await proof.prove());
      proof.settle(null);
      onDone(
        tr(`${K}.redeem.done`, {
          points: n(Number(res.points)),
          amount: formatIQD(Number(res.amount_iqd), locale),
        }),
      );
    } catch (e) {
      proof.settle(e);
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={tr(`${K}.redeem.title`)}
      subtitle={tr(`${K}.redeem.lead`, {
        name: member.displayName ?? tr(`${K}.member.unknownName`),
        points: n(member.balance),
      })}
      size="sm"
      dismissible={!busy}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            icon="star"
            busy={busy}
            disabled={block !== null || !proof.ready}
            onClick={() => void confirm()}
            data-testid="redeem-confirm"
          >
            {tr(`${K}.redeem.confirm`, { points: n(points ?? 0) })}
          </Button>
        </>
      )}
    >
      <Field
        label={tr(`${K}.redeem.points`)}
        hint={
          terms.pointValueIqd != null && remainingIqd != null
            ? tr(`${K}.redeem.maxHint`, { points: n(fit) })
            : undefined
        }
        error={block !== 'invalid' ? blockText : undefined}
        style={{ marginBlockEnd: 0 }}
      >
        <input
          style={{ ...inputStyle, inlineSize: '10rem', fontVariantNumeric: 'tabular-nums' }}
          dir="ltr"
          inputMode="numeric"
          autoFocus
          value={text}
          disabled={busy}
          data-testid="redeem-points"
          onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && !block && !busy && void confirm()}
        />
      </Field>
      {proof.field}
      <p
        style={{
          margin: 0,
          marginBlockStart: 'var(--tp-sp-2)',
          fontSize: 'var(--tp-fs-sm)',
          color: 'var(--tp-muted-fg)',
        }}
      >
        {worth !== null
          ? tr(`${K}.redeem.worth`, { amount: formatIQD(worth, locale) })
          : tr(`${K}.redeem.worthUnknown`)}
      </p>
      <ErrorText error={error} />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

function RewardsDialog({
  tabId,
  member,
  rewards,
  loading,
  onClose,
  onDone,
}: {
  tabId: string;
  member: MemberView;
  rewards: LoyaltyAdminReward[] | null;
  loading: boolean;
  onClose: () => void;
  onDone: (notice: string) => void;
}) {
  const { tr, locale } = useLocale();
  // One key per reward for as long as the dialog is open: a second press on the same reward
  // replays, a different reward is a different redemption.
  const keys = useRef(new Map<string, string>());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const proof = useRedeemProof(member.customerId);
  const n = (v: number) => formatNumber(v, locale);

  async function use(r: LoyaltyAdminReward) {
    if (!proof.ready) return;
    let key = keys.current.get(r.id);
    if (!key) {
      key = redeemKey();
      keys.current.set(r.id, key);
    }
    setBusyId(r.id);
    setError(null);
    try {
      const res = await redeemReward(tabId, r.id, key, await proof.prove());
      proof.settle(null);
      onDone(tr(`${K}.rewards.done`, { amount: formatIQD(Number(res.amount_iqd), locale) }));
    } catch (e) {
      proof.settle(e);
      setError(e);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal
      title={tr(`${K}.rewards.title`)}
      subtitle={tr(`${K}.rewards.lead`, {
        name: member.displayName ?? tr(`${K}.member.unknownName`),
        points: n(member.balance),
      })}
      size="sm"
      dismissible={busyId === null}
      onClose={onClose}
      footer={(close) => (
        <Button onClick={close} disabled={busyId !== null}>
          {tr('common.close')}
        </Button>
      )}
    >
      {rewards === null && !loading && (
        <MessagePresenter tone="info" icon="lock" message={tr(`${K}.rewards.unavailable`)} />
      )}
      {rewards !== null && rewards.length > 0 && proof.field}
      {rewards !== null && rewards.length === 0 && (
        <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>{tr(`${K}.rewards.empty`)}</p>
      )}
      {rewards !== null && rewards.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gap: 'var(--tp-sp-2)',
          }}
        >
          {rewards.map((r) => {
            const short = member.balance < r.cost_points;
            return (
              <li
                key={r.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 'var(--tp-sp-2)',
                }}
              >
                <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0 }}>
                  <strong>{locale === 'ar' ? r.name_ar : r.name_en}</strong>
                  <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                    {tr(`${K}.rewards.cost`, { points: n(r.cost_points) })} ·{' '}
                    {r.kind === 'iqd_off' && r.iqd_off != null
                      ? tr(`${K}.rewards.iqdOff`, { amount: formatIQD(r.iqd_off, locale) })
                      : tr(`${K}.rewards.item`)}
                  </span>
                </span>
                <Button
                  size="sm"
                  kind="primary"
                  busy={busyId === r.id}
                  disabled={short || busyId !== null || !proof.ready}
                  disabledReason={short ? tr(`${K}.rewards.tooFew`) : undefined}
                  onClick={() => void use(r)}
                >
                  {tr(`${K}.rewards.use`)}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <ErrorText error={error} />
    </Modal>
  );
}
