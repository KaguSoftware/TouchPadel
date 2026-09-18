/**
 * The break screen (0105). Covers the station while the signed-in person is
 * away and nobody has taken over. It is a lock in the same sense the idle
 * lock is — everything behind it stays mounted, Tab is trapped, Escape does
 * nothing — with two ways off it, both behind a PIN:
 *
 *   - the person is back: their own PIN ends the break (app.end_break);
 *   - somebody covers: they tap their name and type THEIR PIN
 *     (app.cover_station); the station carries on with them named in the rail
 *     until the first person is back.
 *
 * Who is away is the headline, because it is the first thing anyone walking
 * up needs. The clock underneath answers the second question — how long —
 * and the allowance line the third: whether they are within their time.
 */
import { useRef, useState, type KeyboardEvent } from 'react';
import { formatNumber } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, card, inputStyle, trapTab } from '../../components/ui';
import { StatusBadge } from '../../components/kit';
import { CourtLines, Icon } from '../../components/icons';
import { BrandLockup } from '../../components/brand';
import { elapsedSeconds, formatElapsed, remainingSeconds, wholeMinutes, type BreakCandidate } from '../../lib/breaks';
import { PIN_MAX, PIN_MIN } from '../admin/staff/staffModel';
import { useBreak } from './BreakProvider';

/** Who is typing a PIN: the person coming back, or a cover candidate. */
type Who = { kind: 'self' } | { kind: 'cover'; who: BreakCandidate };

export function BreakOverlay() {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const toast = useToast();
  const brk = useBreak();
  const [who, setWho] = useState<Who | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);

  if (brk.phase !== 'away' || !staff || !brk.status) return null;
  const status = brk.status;

  const elapsed = elapsedSeconds(status, brk.nowMs);
  const remaining = remainingSeconds(status, brk.nowMs);
  const n = (v: number) => formatNumber(v, locale);

  function choose(next: Who | null) {
    setWho(next);
    setPin('');
    setError(null);
    requestAnimationFrame(() => (next ? fieldRef.current : cardRef.current)?.focus());
  }

  async function submit() {
    if (!who || pin.length < PIN_MIN || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (who.kind === 'self') {
        const r = await brk.end(pin);
        toast.ok(
          r.remaining_seconds >= 0
            ? tr('ws.shell.break.ended', { minutes: n(wholeMinutes(r.remaining_seconds)) })
            : tr('ws.shell.break.endedOver', { minutes: n(wholeMinutes(r.remaining_seconds)) }),
        );
      } else {
        await brk.cover(who.who.id, pin);
        toast.ok(tr('ws.shell.break.coverStarted', { name: who.who.display_name }));
      }
      setWho(null);
      setPin('');
    } catch (e) {
      setError(e);
      setPin('');
      requestAnimationFrame(() => fieldRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  const whoName = who?.kind === 'self' ? staff.displayName : who?.who.display_name;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr('ws.shell.break.onBreak')}
      className="tp-fade"
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Tab') trapTab(e, cardRef.current);
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          cardRef.current?.focus();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--tp-z-lock)',
        background: 'var(--tp-rail)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
        <CourtLines opacity={0.2} />
      </div>
      <BrandLockup size={28} tone="onDark" style={{ position: 'absolute', insetBlockStart: '2rem', insetInlineStart: '2rem' }} />

      <div
        ref={cardRef}
        tabIndex={-1}
        className="tp-rise"
        style={{ ...card, position: 'relative', outline: 'none', inlineSize: 'min(28rem, 92vw)', boxShadow: 'var(--tp-shadow-dialog)', paddingBlock: 'var(--tp-sp-5)', paddingInline: 'var(--tp-sp-5)', display: 'grid', gap: 'var(--tp-sp-4)' }}
      >
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: 'var(--tp-muted-fg)' }}>
            <Icon name="hourglass" size={15} />
            {tr('ws.shell.break.onBreak')}
          </p>
          <h2 style={{ fontSize: 'var(--tp-fs-2xl)', display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
            <bdi>{staff.displayName}</bdi>
            <StatusBadge size="sm" dot={false} label={tr(`op.roles.${staff.role}`)} />
          </h2>
          {/* One line, two facts: how long away, and where that leaves today's
              allowance. The clock is ASCII digits inside a bidi isolate. */}
          <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }} aria-live="off">
            {tr('ws.shell.break.away', { time: `⁨${formatElapsed(elapsed)}⁩` })}
            {' · '}
            {remaining >= 0 ? (
              tr('ws.shell.break.remainingToday', { minutes: n(wholeMinutes(remaining)) })
            ) : (
              <span style={{ color: 'var(--tp-warn-fg)', fontWeight: 600 }}>{tr('ws.shell.break.over', { minutes: n(wholeMinutes(remaining)) })}</span>
            )}
          </p>
        </div>

        {who === null ? (
          <>
            <Button kind="primary" size="lg" icon="undo" style={{ inlineSize: '100%' }} onClick={() => choose({ kind: 'self' })}>
              {tr('ws.shell.break.back')}
            </Button>
            <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
              <div style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
                <h3 style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700 }}>{tr('ws.shell.break.coverTitle')}</h3>
                <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                  {status.candidates.length > 0 ? tr('ws.shell.break.coverLead') : tr('ws.shell.break.coverNone')}
                </p>
              </div>
              {status.candidates.length > 0 && (
                <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))' }}>
                  {status.candidates.map((c) => (
                    <Button key={c.id} size="lg" icon="user" onClick={() => choose({ kind: 'cover', who: c })} style={{ justifyContent: 'flex-start' }}>
                      <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', textAlign: 'start', minInlineSize: 0 }}>
                        <bdi style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.display_name}</bdi>
                        <span style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 500, color: 'var(--tp-muted-fg)' }}>{tr(`op.roles.${c.role}`)}</span>
                      </span>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}
          >
            <Field label={tr('ws.shell.break.pinFor', { name: whoName ?? '' })} style={{ marginBlockEnd: 0 }}>
              <input
                ref={fieldRef}
                style={{ ...inputStyle, fontSize: 'var(--tp-fs-2xl)', letterSpacing: '0.35em', textAlign: 'center' }}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                dir="ltr"
                value={pin}
                maxLength={PIN_MAX}
                readOnly={busy}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <ErrorText error={error} style={{ marginBlock: 0 }} />
            <Button kind="primary" size="lg" type="submit" icon={who.kind === 'self' ? 'undo' : 'lock'} busy={busy} disabled={pin.length < PIN_MIN} style={{ inlineSize: '100%' }}>
              {who.kind === 'self' ? tr('ws.shell.break.back') : tr('ws.shell.break.confirm')}
            </Button>
            <Button kind="ghost" size="sm" onClick={() => choose(null)} disabled={busy}>
              {tr('ws.shell.break.chooseAgain')}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
