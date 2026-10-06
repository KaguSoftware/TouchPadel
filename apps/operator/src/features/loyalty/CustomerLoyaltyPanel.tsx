/**
 * A customer's loyalty on the record (docs/design/loyalty/build-contracts-2026-10-05.md §1.3,
 * plan §5.3): balance, tier, the last 12 months' points, points ever earned, and the 100 newest
 * ledger rows, from app.loyalty_customer (every desk role).
 *
 * "Adjust points" (manager, owner: adjustLoyalty) asks for the points and a reason first (the
 * guest reads the reason in their history; REASON_REQUIRED on the server), then a manager PIN,
 * then app.loyalty_adjust (adjustPoints: verify_manager_pin first, the 0115 grant pattern). A
 * PIN refusal stays on the PIN prompt; anything else comes back to the form.
 *
 * A server without loyalty (RPC_MISSING) shows nothing. Adjusting is online only.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatNumber } from '@touch/i18n';
import { isRpcMissing } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { can, useAuth } from '../../lib/auth';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, Skeleton, inputStyle } from '../../components/ui';
import { DescriptionList, Panel, PinPromptOverlay } from '../../components/kit';
import { adjustErrors, isPinRefusal, ledgerKind, parseSigned } from './loyaltyLogic';
import { LOYALTY_KEYS, adjustPoints, useLoyaltyCustomer } from './useLoyalty';

const K = 'ws.loyalty';

export function CustomerLoyaltyPanel({ customerId, tz }: { customerId: string; tz: string }) {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const { reachable } = useStationReach();
  const allowed = can(staff?.role, 'attachMember');
  const q = useLoyaltyCustomer(customerId, allowed);
  const [adjusting, setAdjusting] = useState(false);
  const canAdjust = can(staff?.role, 'adjustLoyalty');

  if (!allowed || isRpcMissing(q.error)) return null;
  const d = q.data;
  const n = (v: number) => formatNumber(v, locale);
  const tier = d?.tier ? (locale === 'ar' ? d.tier.name_ar : d.tier.name_en) : null;

  return (
    <Panel
      title={tr(`${K}.panel.title`)}
      data-testid="customer-loyalty"
      actions={
        canAdjust && d ? (
          <Button
            size="sm"
            icon="sliders"
            disabled={!reachable}
            disabledReason={reachable ? undefined : tr(`${K}.member.noConnection`)}
            onClick={() => setAdjusting(true)}
          >
            {tr(`${K}.adjust.button`)}
          </Button>
        ) : undefined
      }
    >
      {q.isLoading && <Skeleton lines={3} />}
      {q.isError && !d && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
          <ErrorText error={q.error} style={{ marginBlock: 0 }} />
          <Button size="sm" icon="refresh" onClick={() => void q.refetch()}>
            {tr('ws.kit.async.retry')}
          </Button>
        </div>
      )}
      {d && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
          <DescriptionList
            columns={2}
            items={[
              {
                label: tr(`${K}.panel.balance`),
                value: <span data-testid="loyalty-balance">{n(d.balance)}</span>,
                numeric: true,
              },
              {
                label: tr(`${K}.panel.tier`),
                value: tier ? <bdi>{tier}</bdi> : tr(`${K}.panel.noTier`),
              },
              { label: tr(`${K}.panel.points12m`), value: n(d.points_12m), numeric: true },
              { label: tr(`${K}.panel.lifetime`), value: n(d.lifetime), numeric: true },
            ]}
          />
          <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
            <h3 style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>
              {tr(`${K}.panel.history`)}
            </h3>
            {d.history.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
                {tr(`${K}.panel.historyEmpty`)}
              </p>
            ) : (
              <div style={{ maxBlockSize: '20rem', overflowY: 'auto' }}>
                <table className="tp-table" data-dense="true">
                  <thead>
                    <tr>
                      <th>{tr(`${K}.panel.columns.when`)}</th>
                      <th>{tr(`${K}.panel.columns.what`)}</th>
                      <th style={{ textAlign: 'end' }}>{tr(`${K}.panel.columns.points`)}</th>
                      <th>{tr(`${K}.panel.columns.note`)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.history.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <bdi>{formatDateTime(new Date(r.created_at), locale, tz)}</bdi>
                        </td>
                        <td>{tr(`${K}.panel.kind.${ledgerKind(r.kind)}`)}</td>
                        <td
                          dir="ltr"
                          style={{
                            textAlign: 'end',
                            fontVariantNumeric: 'tabular-nums',
                            color: r.delta < 0 ? 'var(--tp-muted-fg)' : undefined,
                          }}
                        >
                          {r.delta > 0 ? `+${n(r.delta)}` : n(r.delta)}
                        </td>
                        <td>{r.note ? <bdi>{r.note}</bdi> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      {adjusting && <AdjustDialog customerId={customerId} onClose={() => setAdjusting(false)} />}
    </Panel>
  );
}

function AdjustDialog({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const { tr, locale } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pinError, setPinError] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);
  const errors = touched ? adjustErrors({ delta, reason }) : {};

  function next() {
    setTouched(true);
    setError(null);
    if (Object.keys(adjustErrors({ delta, reason })).length > 0) return;
    setPinError(null);
    setPinOpen(true);
  }

  async function submit(pin: string) {
    const points = parseSigned(delta);
    if (points === null) return;
    setBusy(true);
    setPinError(null);
    try {
      const res = await adjustPoints(customerId, points, reason.trim(), pin);
      void qc.invalidateQueries({ queryKey: LOYALTY_KEYS.customer(customerId) });
      void qc.invalidateQueries({ queryKey: LOYALTY_KEYS.member(customerId) });
      toast.ok(tr(`${K}.adjust.done`, { points: formatNumber(Number(res.balance), locale) }));
      setPinOpen(false);
      onClose();
    } catch (e) {
      if (isPinRefusal(e)) {
        setPinError(e);
      } else {
        setPinOpen(false);
        setError(e);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal
        title={tr(`${K}.adjust.title`)}
        subtitle={tr(`${K}.adjust.lead`)}
        size="sm"
        dismissible={!busy}
        onClose={onClose}
        footer={(close) => (
          <>
            <Button onClick={close} disabled={busy}>
              {tr('common.cancel')}
            </Button>
            <Button kind="primary" icon="lock" busy={busy} onClick={next} data-testid="adjust-next">
              {tr(`${K}.adjust.next`)}
            </Button>
          </>
        )}
      >
        <Field
          label={tr(`${K}.adjust.delta`)}
          hint={tr(`${K}.adjust.deltaHint`)}
          error={errors.delta ? tr(`${K}.adjust.deltaRequired`) : undefined}
        >
          <input
            style={{ ...inputStyle, inlineSize: '10rem', fontVariantNumeric: 'tabular-nums' }}
            dir="ltr"
            inputMode="numeric"
            autoFocus
            value={delta}
            data-testid="adjust-delta"
            onChange={(e) => setDelta(e.target.value.replace(/[^\d\-−]/g, ''))}
          />
        </Field>
        <Field
          label={tr(`${K}.adjust.reason`)}
          hint={tr(`${K}.adjust.reasonHint`)}
          error={errors.reason ? tr(`${K}.adjust.reasonRequired`) : undefined}
          style={{ marginBlockEnd: 0 }}
        >
          <input
            style={inputStyle}
            value={reason}
            maxLength={200}
            data-testid="adjust-reason"
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <ErrorText error={error} />
      </Modal>
      {pinOpen && (
        <PinPromptOverlay
          action={tr(`${K}.adjust.pinAction`)}
          busy={busy}
          error={pinError}
          onSubmit={(pin) => void submit(pin)}
          onCancel={() => setPinOpen(false)}
        />
      )}
    </>
  );
}
