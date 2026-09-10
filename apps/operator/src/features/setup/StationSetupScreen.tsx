/**
 * StationSetupScreen — first run, before sign-in (spec §05 sibling of the
 * sign-in screen; same full-bleed composition). Pure: every state is a prop
 * and every intent is a dispatched action, so the container is the only
 * thing that talks to the bridge.
 *
 * Steps: choose a role (Till / Desk / Kitchen screen) → details → for a
 * kitchen screen, the LAN search for the till → saving (the shell relaunches).
 */
import type { FormEvent, ReactNode } from 'react';
import { formatPairingCode } from '@touch/core';
import { useLocale } from '../../lib/i18n';
import { Button, Field, Spinner, inputStyle } from '../../components/ui';
import { Icon, type IconName } from '../../components/icons';
import { BrandLockup, BrandSwoosh } from '../../components/brand';
import type { StationMode } from '../../ipc/bridge';
import {
  STATION_MODES,
  canSaveAnyway,
  detailsValidity,
  type DetailsState,
  type SetupAction,
  type SetupState,
} from './stationSetup';

const MODE_ICON: Record<StationMode, IconName> = { till: 'receipt', desk: 'calendar', kds: 'flame' };

/** The PIN-field treatment (kit.tsx PinPromptOverlay), minus the masking. */
const codeInputStyle = {
  ...inputStyle,
  fontSize: 'var(--tp-fs-2xl)',
  letterSpacing: '0.25em',
  textAlign: 'center' as const,
  fontVariantNumeric: 'tabular-nums' as const,
};

export interface StationSetupScreenProps {
  state: SetupState;
  appVersion: string;
  dispatch: (action: SetupAction) => void;
}

export function StationSetupScreen({ state, appVersion, dispatch }: StationSetupScreenProps) {
  const { tr, toggleLocale, locale } = useLocale();
  return (
    <div
      style={{
        minBlockSize: '100vh',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 5fr) minmax(0, 7fr)',
        background: 'var(--tp-bg)',
      }}
    >
      <aside
        aria-hidden="true"
        style={{
          position: 'relative',
          background: 'var(--tp-rail)',
          color: 'var(--tp-brand-white)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '2rem',
        }}
      >
        <div style={{ position: 'absolute', insetBlock: '22%', insetInline: '4%' }}>
          <BrandSwoosh opacity={0.5} />
        </div>
        <BrandLockup size={40} tone="onDark" style={{ position: 'relative' }} />
        <p style={{ position: 'relative', fontSize: 'var(--tp-fs-3xl)', fontWeight: 700, lineHeight: 1.1, maxInlineSize: '11ch' }}>
          {tr('ws.shell.setup.title')}
        </p>
      </aside>
      <div style={{ display: 'grid', placeItems: 'center', padding: 'var(--tp-sp-6)' }}>
        <div className="tp-rise" style={{ inlineSize: 'min(36rem, 100%)', display: 'grid', gap: 'var(--tp-sp-2)' }}>
          <Step state={state} dispatch={dispatch} />
          <footer
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBlockStart: 'var(--tp-sp-4)',
              color: 'var(--tp-muted-fg)',
              fontSize: 'var(--tp-fs-xs)',
            }}
          >
            <span dir="ltr">{tr('ws.shell.nav.version', { version: appVersion })}</span>
            <Button kind="ghost" size="sm" icon="globe" onClick={toggleLocale}>
              <span lang={locale === 'ar' ? 'en' : 'ar'}>{tr('ws.shell.nav.language')}</span>
            </Button>
          </footer>
        </div>
      </div>
    </div>
  );
}

function Step({ state, dispatch }: { state: SetupState; dispatch: (a: SetupAction) => void }) {
  const { tr } = useLocale();
  switch (state.step) {
    case 'mode':
      return <ModeStep dispatch={dispatch} />;
    case 'details':
      return <DetailsStep d={state} dispatch={dispatch} />;
    case 'scanning':
      return (
        <StepFrame title={tr('ws.shell.setup.mode.kds')}>
          <p style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
            <Spinner size="sm" />
            {tr('ws.shell.setup.scanning')}
          </p>
          <Actions>
            <Button onClick={() => dispatch({ type: 'back' })}>{tr('ws.shell.setup.back')}</Button>
          </Actions>
        </StepFrame>
      );
    case 'choose':
      return (
        <StepFrame title={tr('ws.shell.setup.mode.kds')}>
          <p>{tr('ws.shell.setup.choose')}</p>
          <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
            {state.tills.map((host) => (
              <Button key={host} size="lg" onClick={() => dispatch({ type: 'pickTill', host })}>
                <span dir="ltr">{host}</span>
              </Button>
            ))}
          </div>
          <Actions>
            <Button onClick={() => dispatch({ type: 'back' })}>{tr('ws.shell.setup.back')}</Button>
          </Actions>
        </StepFrame>
      );
    case 'notFound': {
      const key = { none: 'none', 'bad-code': 'badCode', 'no-lan': 'noLan', unreachable: 'unreachable' } as const;
      return (
        <StepFrame title={tr('ws.shell.setup.mode.kds')}>
          <p role="alert" style={alertStyle}>
            {tr(`ws.shell.setup.notFound.${key[state.reason]}`, { host: state.details.host })}
          </p>
          <Actions>
            <Button onClick={() => dispatch({ type: 'back' })}>{tr('ws.shell.setup.back')}</Button>
            {canSaveAnyway(state) && (
              <Button onClick={() => dispatch({ type: 'saveAnyway' })}>{tr('ws.shell.setup.saveAnyway')}</Button>
            )}
            <Button kind="primary" onClick={() => dispatch({ type: 'retry' })}>
              {tr('ws.shell.setup.retry')}
            </Button>
          </Actions>
        </StepFrame>
      );
    }
    case 'saving':
      return (
        <StepFrame title={tr(`ws.shell.setup.mode.${state.details.mode}`)}>
          <p style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
            <Spinner size="sm" />
            {tr('ws.shell.setup.saving')}
          </p>
        </StepFrame>
      );
    case 'failed':
      return (
        <StepFrame title={tr(`ws.shell.setup.mode.${state.details.mode}`)}>
          <p role="alert" style={alertStyle}>
            {state.error === 'already-configured' ? tr('ws.shell.setup.alreadyConfigured') : tr('ws.shell.setup.failed')}
          </p>
          <Actions>
            <Button onClick={() => dispatch({ type: 'back' })}>{tr('ws.shell.setup.back')}</Button>
            <Button kind="primary" onClick={() => dispatch({ type: 'retry' })}>
              {tr('ws.shell.setup.retry')}
            </Button>
          </Actions>
        </StepFrame>
      );
  }
}

const alertStyle = {
  color: 'var(--tp-danger-fg)',
  background: 'var(--tp-danger-soft)',
  borderRadius: 'var(--tp-radius-ctl)',
  paddingBlock: 'var(--tp-sp-1-5)',
  paddingInline: 'var(--tp-sp-2-5)',
  fontSize: 'var(--tp-fs-sm)',
} as const;

function StepFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      <h1 style={{ fontSize: 'var(--tp-fs-2xl)' }}>{title}</h1>
      {children}
    </div>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--tp-sp-2)', marginBlockStart: 'var(--tp-sp-2)' }}>
      {children}
    </div>
  );
}

function ModeStep({ dispatch }: { dispatch: (a: SetupAction) => void }) {
  const { tr } = useLocale();
  return (
    <StepFrame title={tr('ws.shell.setup.title')}>
      <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.shell.setup.lead')}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(10rem, 1fr))', gap: 'var(--tp-sp-3)' }}>
        {STATION_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            className="tp-tile"
            onClick={() => dispatch({ type: 'chooseMode', mode })}
            style={{
              background: 'var(--tp-surface)',
              border: '1px solid var(--tp-border)',
              borderRadius: 'var(--tp-radius-panel)',
              paddingBlock: '1rem',
              paddingInline: '1rem',
              display: 'grid',
              gap: '0.5rem',
              minBlockSize: '8rem',
              textAlign: 'start',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                inlineSize: '2.25rem',
                blockSize: '2.25rem',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '50%',
                background: 'var(--tp-rail)',
                color: 'var(--tp-rail-green)',
              }}
            >
              <Icon name={MODE_ICON[mode]} size={18} />
            </span>
            <span style={{ fontWeight: 700, fontSize: 'var(--tp-fs-lg)' }}>{tr(`ws.shell.setup.mode.${mode}`)}</span>
            <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
              {tr(`ws.shell.setup.modeLead.${mode}`)}
            </span>
          </button>
        ))}
      </div>
    </StepFrame>
  );
}

function DetailsStep({ d, dispatch }: { d: DetailsState; dispatch: (a: SetupAction) => void }) {
  const { tr } = useLocale();
  const valid = detailsValidity(d);
  const codeComplete = d.code.length === 10;
  function submit(e: FormEvent) {
    e.preventDefault();
    dispatch({ type: 'confirm' });
  }
  return (
    <form onSubmit={submit}>
      <StepFrame title={tr(`ws.shell.setup.mode.${d.mode}`)}>
        <p style={{ color: 'var(--tp-muted-fg)' }}>{tr(`ws.shell.setup.modeLead.${d.mode}`)}</p>
        <Field
          label={tr('ws.shell.setup.stationId')}
          hint={tr('ws.shell.setup.stationIdHint')}
          error={valid.stationId ? undefined : tr('ws.shell.setup.stationIdInvalid')}
        >
          <input
            style={inputStyle}
            dir="ltr"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            autoFocus={d.mode !== 'kds'}
            value={d.stationId}
            onChange={(e) => dispatch({ type: 'stationId', value: e.target.value })}
          />
        </Field>
        {d.mode === 'kds' && (
          <>
            <Field
              label={tr('ws.shell.setup.code')}
              hint={tr('ws.shell.setup.codeHint')}
              error={codeComplete && !valid.code ? tr('ws.shell.setup.codeInvalid') : undefined}
            >
              <input
                style={codeInputStyle}
                dir="ltr"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                maxLength={12}
                value={codeComplete ? formatPairingCode(d.code) : d.code}
                onChange={(e) => dispatch({ type: 'code', value: e.target.value })}
              />
            </Field>
            <div>
              <Button kind="ghost" size="sm" aria-expanded={d.showAdvanced} onClick={() => dispatch({ type: 'toggleAdvanced' })}>
                {tr('ws.shell.setup.advanced')}
              </Button>
            </div>
            {d.showAdvanced && (
              <Field
                label={tr('ws.shell.setup.advanced')}
                hint={tr('ws.shell.setup.advancedHint')}
                error={valid.host ? undefined : tr('ws.shell.setup.hostInvalid')}
              >
                <input
                  style={inputStyle}
                  dir="ltr"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  value={d.host}
                  onChange={(e) => dispatch({ type: 'host', value: e.target.value })}
                />
              </Field>
            )}
          </>
        )}
        <Actions>
          <Button onClick={() => dispatch({ type: 'back' })}>{tr('ws.shell.setup.back')}</Button>
          <Button kind="primary" type="submit" disabled={!valid.all}>
            {tr('ws.shell.setup.confirm')}
          </Button>
        </Actions>
      </StepFrame>
    </form>
  );
}
