/**
 * "Pair a kitchen screen": the till's pairing card (design-arch §2.4; SEC-31
 * "a bearer token minted at pairing"), on the owner's Setup home. It sat at
 * the bottom of every till's sidebar, where every cashier saw it all shift for
 * a job done once per kitchen screen (Parsa, 2026-09-22: Setup only).
 *
 * The code IS the LAN secret, and it lives on the till machine itself (the
 * shell's main process holds the key), so the card can only show it when
 * Setup is opened ON the till. Anywhere else it says where to go. The reveal
 * sits behind a manager PIN, as Quit does: verify_manager_pin server-side
 * when online, the offline cache in main otherwise (touch:get-pairing-info
 * re-checks).
 */
import { useState, type ReactNode } from 'react';
import { formatPairingCode } from '@touch/core';
import { appRpc, AppRpcError } from '../../lib/appRpc';
import { isElectron } from '../../lib/mutate';
import { useLocale } from '../../lib/i18n';
import { touch } from '../../ipc/bridge';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { Panel } from '../../components/kit';
import { CardTitle } from '../ops/OpsVisuals';

export function KitchenPairingPanel() {
  const { tr } = useLocale();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ host: string | null; port: number; code: string } | null>(null);
  const [refusal, setRefusal] = useState<'not-a-till' | 'no-psk' | 'custom-psk' | null>(null);
  const onTill = isElectron() && touch.getStation().mode === 'till';

  function close() {
    setOpen(false);
    setPin('');
    setInfo(null);
    setRefusal(null);
    setError(null);
  }

  async function reveal() {
    setBusy(true);
    setError(null);
    try {
      try {
        // verify_manager_pin RETURNS null for a wrong PIN (it raises only for a
        // lockout or a non-staff caller). Treating that null as success cached the
        // wrong PIN as observed and the shell's cache check then passed it: any
        // PIN opened this gate while online. Refuse here, before the cache learns it.
        const authorizer = await appRpc<string | null>('verify_manager_pin', {
          p_pin: pin,
          p_device_id: touch.getStation().stationId,
        });
        if (authorizer === null) throw new AppRpcError('PIN_INVALID', 'PIN_INVALID');
        touch.pinObserved(pin, authorizer);
      } catch (e) {
        // Offline: fall through to the cache check in main. A server REFUSAL
        // (PIN_INVALID / PIN_LOCKED) still surfaces.
        if (e instanceof AppRpcError && e.code !== 'UNKNOWN') throw e;
      }
      const res = await touch.getPairingInfo(pin);
      if (!('ok' in res)) throw new Error(res.error);
      if (!res.ok) {
        if (res.error === 'pin not recognised') throw new Error(res.error);
        setRefusal(res.error);
        return;
      }
      setInfo({ host: res.host, port: res.port, code: res.code });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const refusalKey = { 'not-a-till': 'notTill', 'no-psk': 'noPsk', 'custom-psk': 'customPsk' } as const;

  return (
    <>
      <Panel title={<CardTitle icon="qr">{tr('ws.owner.setupHome.kitchen.title')}</CardTitle>}>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', justifyItems: 'start' }}>
          <p style={{ color: 'var(--tp-muted-fg)' }}>{tr(onTill ? 'ws.owner.setupHome.kitchen.lead' : 'ws.owner.setupHome.kitchen.notTill')}</p>
          {onTill && (
            <Button kind="primary" icon="qr" onClick={() => setOpen(true)}>
              {tr('ws.shell.pair.title')}
            </Button>
          )}
        </div>
      </Panel>
      {open && (
        <Modal
          title={tr('ws.shell.pair.title')}
          size="sm"
          onClose={close}
          footer={
            info || refusal ? (
              <Button kind={info ? 'primary' : 'default'} onClick={close}>
                {tr(info ? 'ws.shell.pair.done' : 'common.back')}
              </Button>
            ) : (
              <>
                <Button onClick={close}>{tr('common.back')}</Button>
                {/* Says what it does. It used to repeat the dialog's title,
                    "Pair a kitchen screen", which pairs nothing: it shows a code. */}
                <Button kind="primary" icon="eye" busy={busy} disabled={pin.length < 4} onClick={() => void reveal()}>
                  {tr('ws.shell.pair.reveal')}
                </Button>
              </>
            )
          }
        >
          {info ? (
            /*
             * Two numbered steps with the code between them, in the order they
             * happen at the kitchen screen. The QR code that sat under the code
             * is gone: nothing reads it — the kitchen screen's setup has a text
             * field and no camera — so it was a large square that looked like
             * the thing to use. The port is gone too: nothing asks for it.
             */
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-3)' }}>
              <PairStep n={1}>{tr('ws.shell.pair.step1')}</PairStep>
              <PairStep n={2}>
                {tr('ws.shell.pair.step2')}
                <p
                  dir="ltr"
                  aria-label={tr('ws.shell.pair.code')}
                  style={{
                    marginBlockStart: 'var(--tp-sp-2)',
                    paddingBlock: 'var(--tp-sp-3)',
                    paddingInline: 'var(--tp-sp-3)',
                    borderRadius: 'var(--tp-radius-ctl)',
                    background: 'var(--tp-surface-2)',
                    textAlign: 'center',
                    fontSize: 'var(--tp-fs-3xl)',
                    fontWeight: 700,
                    letterSpacing: '0.18em',
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--tp-fg)',
                  }}
                >
                  {formatPairingCode(info.code)}
                </p>
              </PairStep>
              <li style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
                {info.host ? tr('ws.shell.pair.host', { host: `\u2068${info.host}\u2069`, port: String(info.port) }) : tr('ws.shell.pair.noHost')}
              </li>
            </ol>
          ) : refusal ? (
            <p role="alert">{tr(`ws.shell.pair.${refusalKey[refusal]}`)}</p>
          ) : (
            <>
              <p style={{ color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.shell.pair.pinLead')}</p>
              <Field label={tr('op.common.pin')}>
                <input
                  style={inputStyle}
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  dir="ltr"
                  autoFocus
                  value={pin}
                  readOnly={busy}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && pin.length >= 4 && !busy && void reveal()}
                />
              </Field>
              <ErrorText error={error} />
            </>
          )}
        </Modal>
      )}
    </>
  );
}

/** One numbered instruction in the pairing card. */
function PairStep({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li style={{ display: 'grid', gridTemplateColumns: '1.5rem 1fr', columnGap: 'var(--tp-sp-2)', alignItems: 'start' }}>
      <span
        aria-hidden="true"
        style={{
          display: 'grid',
          placeItems: 'center',
          inlineSize: '1.375rem',
          blockSize: '1.375rem',
          borderRadius: '999px',
          fontSize: 'var(--tp-fs-xs)',
          fontWeight: 700,
          background: 'var(--tp-accent-soft)',
          color: 'var(--tp-accent-soft-fg)',
        }}
      >
        {n}
      </span>
      <div>{children}</div>
    </li>
  );
}
