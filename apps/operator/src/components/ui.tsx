/**
 * Shared UI kit for the operator app. Inline styles, CSS LOGICAL PROPERTIES
 * ONLY (RTL flips via dir on <html>), theme tokens from @touch/ui. Interaction
 * states live in GlobalStyles (class hooks: tp-btn, tp-tile, tp-row, tp-table).
 *
 * Every action control accepts `busy` (spec R10) and is non-actionable while
 * true. Nothing in here decides whether an action is permitted.
 */
import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useLocale } from '../lib/i18n';
import { errorToMessageKey } from '../lib/errors';
import { Icon, type IconName } from './icons';
import { BrandBall } from './brand';
import { SelectMenu } from './SelectMenu';

export const card: CSSProperties = {
  background: 'var(--tp-surface)',
  border: '1px solid var(--tp-border)',
  borderRadius: 'var(--tp-radius-panel)',
  // 0.85rem was on no rung of the 4px scale, so a card's inline inset never
  // lined up with the gaps the screens around it are laid out on.
  paddingBlock: 'var(--tp-sp-3)',
  paddingInline: 'var(--tp-sp-3)',
};

/** A quieter panel for toolbars and secondary groups. */
export const panelMuted: CSSProperties = {
  background: 'var(--tp-surface-2)',
  border: '1px solid var(--tp-border)',
  borderRadius: 'var(--tp-radius-panel)',
  paddingBlock: 'var(--tp-sp-3)',
  paddingInline: 'var(--tp-sp-3)',
};

export const inputStyle: CSSProperties = {
  paddingBlock: '0.45rem',
  paddingInline: '0.65rem',
  border: '1px solid var(--tp-border-strong)',
  borderRadius: 'var(--tp-radius-ctl)',
  fontSize: 'var(--tp-fs-md)',
  lineHeight: 1.35,
  inlineSize: '100%',
  // The same floor a table row stands on, so a form control and a row of data
  // are the same height on screen. 2.25rem drifted with the reading root.
  minBlockSize: 'var(--tp-row-h)',
  boxSizing: 'border-box',
  background: 'var(--tp-surface)',
  color: 'var(--tp-fg)',
};

export type ButtonKind = 'default' | 'primary' | 'danger' | 'ghost' | 'soft';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

interface ButtonProps {
  children?: ReactNode;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Prefetch hooks (the till's tab rail warms the detail query on hover). */
  onMouseEnter?: () => void;
  onFocus?: () => void;
  kind?: ButtonKind;
  size?: ButtonSize;
  icon?: IconName;
  iconEnd?: IconName;
  disabled?: boolean;
  /** Spec R10: non-actionable while true; shows a spinner in place of the icon. */
  busy?: boolean;
  /**
   * Why this control cannot be used right now — rulebook 4.3: a disabled
   * control is never a dead end. Rendered as a visible line beneath the button
   * and tied to it with aria-describedby, because `title` is the only channel
   * the app had and a tooltip reaches neither a keyboard nor a finger.
   * Purely presentational: it never decides whether anything is disabled.
   */
  disabledReason?: string;
  type?: 'button' | 'submit';
  style?: CSSProperties;
  /**
   * An extra class on the <button> itself, composed with .tp-btn rather than
   * replacing it. Only for a palette a token cannot reach: the rail's buttons
   * sit on the rail's own ground, so they are styled by .tp-rail-btn.tp-btn.
   */
  className?: string;
  autoFocus?: boolean;
  title?: string;
  'aria-label'?: string;
  /**
   * For a caller that renders its own reason text outside the button — a
   * joined pair cannot use `disabledReason`, whose grid wrapper would break
   * the shared border. Ignored while `disabledReason` is showing its own.
   */
  'aria-describedby'?: string;
  /** For toggle-group buttons (range presets): exposes which one is active. */
  'aria-pressed'?: boolean;
  /** For a control that shows or hides a region (a folding side list). */
  'aria-expanded'?: boolean;
  'data-testid'?: string;
}

export function Button(props: ButtonProps) {
  const {
    children,
    onClick,
    onMouseEnter,
    onFocus,
    kind = 'default',
    size = 'md',
    icon,
    iconEnd,
    disabled,
    busy,
    disabledReason,
    'aria-describedby': ariaDescribedBy,
    type = 'button',
    style,
    className,
    autoFocus,
    title,
    'aria-label': ariaLabel,
    'aria-pressed': ariaPressed,
    'aria-expanded': ariaExpanded,
    'data-testid': testId,
  } = props;
  const iconSize = size === 'sm' ? 14 : size === 'lg' ? 20 : size === 'xl' ? 22 : 16;
  const reasonId = useId();
  const showReason = disabledReason !== undefined && disabled === true;

  /*
   * Two ways to show `busy`, picked by whether this button owns a glyph.
   *
   * With an `icon`, the spinner takes the icon's box: one slot, two occupants,
   * the icon fades out as the spinner fades in and the label never moves.
   *
   * Without one, we used to reserve an empty glyph box *plus* a mirror spacer
   * on every button that merely accepts `busy` — 64 call sites — which left a
   * visible hole beside the label at rest, on buttons that are idle almost all
   * of the time. Now nothing is reserved: the spinner is painted as an overlay
   * centred over the whole button and the label is hidden beneath it, so the
   * press still costs zero layout and the resting button is just its label.
   */
  const hasGlyphSlot = icon !== undefined;
  const overlaySpinner = busy === true && icon === undefined;
  // No transition. `busy` flips true on the operator's own click, so a fade
  // here would animate the press itself — the exact case the motion rule
  // excludes, on the highest-frequency control in the building. The reserved
  // slot below is what fixes the label jump; the cross-fade never was.
  const glyphFade: CSSProperties = { opacity: busy ? 0 : 1 };

  const button = (
    <button
      type={type}
      className={`tp-btn${!children ? ' tp-iconbtn' : ''}${className ? ` ${className}` : ''}`}
      data-kind={kind}
      data-size={size}
      data-busy={busy ? 'true' : undefined}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onFocus={onFocus}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-describedby={showReason ? reasonId : ariaDescribedBy}
      style={overlaySpinner ? { position: 'relative', ...style } : style}
      autoFocus={autoFocus}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      aria-expanded={ariaExpanded}
      data-testid={testId}
    >
      {hasGlyphSlot && (
        <span
          style={{
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            inlineSize: `${iconSize}px`,
            blockSize: `${iconSize}px`,
            flex: '0 0 auto',
          }}
        >
          {/* Beneath the icon, revealed as the icon clears: one box, two
              occupants, nothing in the layout moves between them. */}
          {busy && <Spinner size="xs" style={{ position: 'absolute', inlineSize: '100%', blockSize: '100%' }} />}
          {icon && <Icon name={icon} size={iconSize} style={glyphFade} />}
        </span>
      )}
      {/* Glyph-less and busy: the label stays mounted (it is what sizes the
          button) but is hidden under the centred spinner, so the press neither
          resizes the button nor slides the text. */}
      {overlaySpinner ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'inherit', opacity: 0 }}>{children}</span>
      ) : (
        children
      )}
      {/* Stays mounted while busy for the same reason: dropping it narrowed the
          button mid-press and pulled the label with it. */}
      {iconEnd && <Icon name={iconEnd} size={iconSize} style={glyphFade} />}
      {overlaySpinner && (
        <Spinner
          size="xs"
          style={{
            position: 'absolute',
            insetBlockStart: '50%',
            insetInlineStart: '50%',
            transform: 'translate(-50%, -50%)',
            inlineSize: `${iconSize}px`,
            blockSize: `${iconSize}px`,
          }}
        />
      )}
    </button>
  );

  if (!showReason) return button;
  return (
    <span style={{ display: 'grid', justifyItems: 'start', rowGap: 'var(--tp-sp-1)' }}>
      {button}
      <span
        id={reasonId}
        style={{
          fontSize: 'var(--tp-fs-xs)',
          color: 'var(--tp-muted-fg)',
          lineHeight: 1.3,
          textAlign: 'start',
        }}
      >
        {disabledReason}
      </span>
    </span>
  );
}

/**
 * A labelled control. The `<label>` wraps ONLY its own text and the control:
 * hint and error are siblings, because everything inside a wrapping label
 * becomes part of the control's accessible name (a "Qty" field with a "g" hint
 * answered to "Qty g", and every exact label query missed it). The asterisk is
 * decorative — `required` on the control itself is what carries the meaning.
 *
 * The hint and the error are also ANNOUNCED, not merely coloured: both get an
 * id and the single child is cloned with `aria-describedby` (and `aria-invalid`
 * while an error stands). Before this a screen-reader user heard the label and
 * nothing else — the failure was carried by a red line the control never
 * pointed at.
 *
 * `group` is for a field whose control is a SET of controls — a weekday picker,
 * a segmented control. A `<label>` around those is not merely imprecise, it is
 * wrong at the pointer: an implicit label forwards both :hover and the click to
 * the FIRST labelable descendant, so the empty space beside "Weekdays" lit up
 * Sunday and selected it. With `group` the wrapper is a plain div and the label
 * text is tied to the group by id instead.
 */
export function Field({
  label,
  children,
  hint,
  error,
  required,
  optional,
  group,
  style,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /**
   * Rulebook 7.4: where most fields are required, mark the few that are not.
   * The marker is a sibling of the label TEXT and aria-hidden, so it never
   * joins the accessible name — screens that concatenate "(optional)" into the
   * label string rename the control and break every exact label query.
   */
  optional?: boolean;
  /** The control is a group of controls, not one — see the note above. */
  group?: boolean;
  style?: CSSProperties;
}) {
  const { tr } = useLocale();
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const labelId = `${id}-label`;
  // The hint is replaced by the error, never stacked with it, so exactly one
  // of the two is ever on screen to describe the control.
  const describedBy = error ? errorId : hint ? hintId : undefined;

  // A <select> inside its <label> takes the label's whole text as its name —
  // every <option> included ("RoleCashierKitchenCourt desk…"), which is what a
  // screen reader announced and why exact label queries found nothing. Naming
  // it by the label text alone fixes both.
  const isSelect = isValidElement(children) && (children.type === 'select' || children.type === Select);
  let control = children;
  if (isValidElement(children) && (describedBy !== undefined || group || isSelect)) {
    const child = children as ReactElement<Record<string, unknown>>;
    control = cloneElement(child, {
      // A control that already names its own description keeps it; ours is appended.
      ...(describedBy !== undefined
        ? {
            'aria-describedby': [child.props['aria-describedby'], describedBy].filter(Boolean).join(' '),
            'aria-invalid': error ? true : child.props['aria-invalid'],
          }
        : null),
      // The group carries the name the <label> can no longer give it.
      ...(group || isSelect ? { 'aria-labelledby': labelId } : null),
    });
  }

  // A <label> forwards a click anywhere inside it to its control, which for
  // the button-triggered Select meant the label text — and the empty space
  // beside a narrow menu — silently opened the dropdown. Those already carry
  // their name through aria-labelledby, so they get a plain <div> instead.
  const Wrapper = group || isSelect ? 'div' : 'label';

  return (
    <div style={{ marginBlockEnd: 'var(--tp-sp-4)', ...style }}>
      <Wrapper style={{ display: 'block' }}>
        <span
          id={group || isSelect ? labelId : undefined}
          // The required marker is a CSS pseudo-element, not a character: an
          // asterisk in the label's text becomes part of the control's name.
          className={required ? 'tp-req' : undefined}
          style={{
            display: 'block',
            fontSize: 'var(--tp-fs-sm)',
            fontWeight: 600,
            color: 'var(--tp-fg)',
            marginBlockEnd: 'var(--tp-sp-2)',
          }}
        >
          {label}
          {optional && (
            <span
              aria-hidden="true"
              style={{
                marginInlineStart: 'var(--tp-sp-1)',
                fontWeight: 400,
                color: 'var(--tp-muted-fg)',
              }}
            >
              {tr('ws.kit.common.optional')}
            </span>
          )}
        </span>
        {control}
      </Wrapper>
      {hint && !error && (
        <span
          id={hintId}
          style={{
            display: 'block',
            fontSize: 'var(--tp-fs-xs)',
            color: 'var(--tp-muted-fg)',
            marginBlockStart: 'var(--tp-sp-1)',
          }}
        >
          {hint}
        </span>
      )}
      {error && (
        <span
          id={errorId}
          role="alert"
          style={{
            display: 'block',
            fontSize: 'var(--tp-fs-xs)',
            color: 'var(--tp-danger-fg)',
            marginBlockStart: 'var(--tp-sp-1)',
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keep Tab / Shift+Tab cycling inside the panel (dialog focus trap).
 *
 * Exported because the shell's idle lock needs the same behaviour: a second
 * hand-rolled trap is a second set of edge cases (the empty-panel branch, the
 * `active === panel` case the first Shift+Tab lands on) to keep in step.
 */
export function trapTab(e: KeyboardEvent<HTMLElement>, panel: HTMLElement | null) {
  if (!panel) return;
  const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (nodes.length === 0) {
    e.preventDefault();
    return;
  }
  const first = nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === panel)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Longest Modal waits for the exit animation's `animationend` before it calls
 * `onClose` anyway. Comfortably past --tp-dur-base (220ms), which the exit
 * shares with the entrance; the fallback covers reduced motion (the animation
 * collapses to 0.01ms) and a backgrounded tab, where no animationend arrives
 * at all.
 */
const MODAL_EXIT_FALLBACK_MS = 400;

/**
 * Centered dialog: click-outside and Esc call `onClose`; focus is trapped
 * inside and restored to the opener on unmount.
 *
 * Closing is deferred so the exit can play. Every caller unmounts the dialog
 * the moment its state clears, which ripped the panel out between two frames:
 * it rose in on tpRise and then simply was not there. A close request instead
 * flips `data-closing` (GlobalStyles) and only calls the caller's `onClose`
 * when that animation ends, so the X, Esc and the backdrop all sink the panel
 * back the way it came.
 */
export function Modal({
  title,
  onClose,
  children,
  wide,
  size,
  subtitle,
  titleAfter,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  subtitle?: ReactNode;
  /** Rendered inline right after the heading — a status pill, not a second title. */
  titleAfter?: ReactNode;
  /**
   * The dialog's buttons. Given as a function, it receives the dialog's OWN
   * close — the one that plays the exit animation — which a Cancel / Close /
   * Back button should call in place of the `onClose` prop. Wiring such a
   * button straight to `onClose` unmounts the panel on the spot, so it
   * vanished while the X beside the title sank it.
   */
  footer?: ReactNode | ((close: () => void) => ReactNode);
}) {
  const { tr } = useLocale();
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  /*
   * The exit is driven off the DOM rather than a state flag: a re-render on the
   * way out would re-run the panel's children (a busy Button, a query that has
   * just settled) for a frame nobody sees. `closing` also guards against a
   * second request — an operator hitting Esc during the fade must not queue a
   * second onClose.
   */
  const closing = useRef(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (exitTimer.current !== null) clearTimeout(exitTimer.current);
  }, []);

  /*
   * Stable across renders: this is the context value, and a new function every
   * render would re-render every control in every dialog body on each keystroke
   * typed into one of them.
   */
  const requestCloseRef = useRef((): void => {
    requestClose();
  });

  function requestClose() {
    if (closing.current) return;
    const backdrop = backdropRef.current;
    if (!backdrop) {
      onCloseRef.current();
      return;
    }
    closing.current = true;
    backdrop.dataset.closing = 'true';
    /*
     * animationend BUBBLES, and the dialog body is full of other animations —
     * a .tp-rise row, a .tp-attention pulse, the skeleton sweep. Listening for
     * any of them closed the dialog early (or, for a loop, on its first
     * period), so only the backdrop's own tpFadeOut counts.
     */
    const done = (e?: AnimationEvent) => {
      if (e && (e.target !== backdrop || e.animationName !== 'tpFadeOut')) return;
      backdrop.removeEventListener('animationend', done as EventListener);
      if (exitTimer.current !== null) clearTimeout(exitTimer.current);
      exitTimer.current = null;
      onCloseRef.current();
    };
    backdrop.addEventListener('animationend', done as EventListener);
    exitTimer.current = setTimeout(done, MODAL_EXIT_FALLBACK_MS);
  }
  /*
   * Where the press STARTED. A mousedown inside the panel and a mouseup outside
   * it dispatch their click on the common ancestor — the backdrop — so dragging
   * a selection across a PIN or a reason field and releasing a few pixels past
   * the edge closed the dialog and discarded everything typed. The panel's
   * stopPropagation could not help: the click was never dispatched on the panel.
   */
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Callers may autoFocus a control; only claim focus when nothing inside has it.
    if (panel && !panel.contains(document.activeElement)) panel.focus();
    return () => {
      if (opener && typeof opener.focus === 'function' && opener.isConnected) opener.focus();
    };
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      requestClose();
    } else if (e.key === 'Tab') {
      trapTab(e, panelRef.current);
    }
  }

  /*
   * `wide` predates `size` and the two overlapped: the old ternary tested
   * `size === 'lg' || wide` BEFORE `size === 'xl'`, so a dialog asking for xl
   * and wide together silently rendered lg. Resolve `wide` to the size it
   * always meant and let an explicit `size` win, so one prop decides.
   */
  const resolvedSize = size ?? (wide ? 'lg' : 'md');
  const width =
    resolvedSize === 'sm'
      ? 'min(24rem, 94vw)'
      : resolvedSize === 'lg'
        ? 'min(56rem, 94vw)'
        : resolvedSize === 'xl'
          ? 'min(72rem, 96vw)'
          : 'min(32rem, 94vw)';

  return (
    <div
      ref={backdropRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="tp-fade"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--tp-overlay)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 'var(--tp-z-overlay)',
        padding: 'var(--tp-sp-4)',
      }}
      onMouseDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedBackdrop.current) requestClose();
      }}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="tp-rise"
        style={{
          background: 'var(--tp-surface)',
          color: 'var(--tp-fg)',
          borderRadius: 'var(--tp-radius-dialog)',
          boxShadow: 'var(--tp-shadow-dialog)',
          border: '1px solid var(--tp-border)',
          inlineSize: width,
          maxBlockSize: '92vh',
          display: 'flex',
          flexDirection: 'column',
          outline: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 'var(--tp-sp-4)',
            paddingBlock: 'var(--tp-sp-4) var(--tp-sp-2)',
            paddingInline: 'var(--tp-sp-4)',
          }}
        >
          <div style={{ minInlineSize: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', minInlineSize: 0 }}>
              <h2 style={{ fontSize: 'var(--tp-fs-xl)', fontWeight: 700, minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h2>
              {titleAfter}
            </div>
            {subtitle && (
              <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', marginBlockStart: 'var(--tp-sp-0)' }}>
                {subtitle}
              </p>
            )}
          </div>
          <Button kind="ghost" size="sm" icon="x" onClick={requestClose} aria-label={tr('common.close')} />
        </div>
        <div
          style={{
            paddingInline: 'var(--tp-sp-4)',
            paddingBlockEnd: footer ? 'var(--tp-sp-2)' : 'var(--tp-sp-4)',
            overflowY: 'auto',
            minBlockSize: 0,
          }}
        >
          {children}
        </div>
        {footer && (
          <div
            style={{
              display: 'flex',
              gap: 'var(--tp-sp-2)',
              justifyContent: 'flex-end',
              paddingBlock: 'var(--tp-sp-3)',
              paddingInline: 'var(--tp-sp-4)',
              borderBlockStart: '1px solid var(--tp-border)',
              background: 'var(--tp-surface-2)',
              borderEndStartRadius: 'var(--tp-radius-dialog)',
              borderEndEndRadius: 'var(--tp-radius-dialog)',
            }}
          >
            {typeof footer === 'function' ? footer(requestCloseRef.current) : footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** Localized error line for a caught RPC/network error; renders nothing when error is null. */
export function ErrorText({ error, style }: { error: unknown; style?: CSSProperties }) {
  const { tr } = useLocale();
  if (error == null) return null;
  return (
    <p
      role="alert"
      style={{
        display: 'flex',
        gap: '0.4rem',
        alignItems: 'flex-start',
        color: 'var(--tp-danger-fg)',
        background: 'var(--tp-danger-soft)',
        borderRadius: 'var(--tp-radius-ctl)',
        paddingBlock: '0.45rem',
        paddingInline: '0.6rem',
        fontSize: 'var(--tp-fs-sm)',
        marginBlock: '0.5rem',
        ...style,
      }}
    >
      <Icon name="alert" size={16} style={{ marginBlockStart: '0.1rem' }} />
      <span>{tr(errorToMessageKey(error))}</span>
    </p>
  );
}

/** Cash amount pad — appends digits / 000, backspace, clear. Keyboard-operable. */
export function AmountPad({
  value,
  onChange,
  onConfirm,
  max,
  disabled,
}: {
  value: number;
  onChange: (next: number) => void;
  onConfirm?: () => void;
  max?: number;
  disabled?: boolean;
}) {
  const { tr } = useLocale();
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', '⌫'];
  function press(k: string) {
    if (k === '⌫') onChange(Math.floor(value / 10));
    else {
      const next = Number(`${value}${k}`);
      // A press that would exceed the cap is ignored, so the pad stops at max.
      if (Number.isSafeInteger(next) && (max === undefined || next <= max)) onChange(next);
    }
  }
  return (
    <div
      role="group"
      aria-label={tr('ws.kit.keypad.confirm')}
      onKeyDown={(e) => {
        if (disabled) return;
        if (/^[0-9]$/.test(e.key)) {
          e.preventDefault();
          press(e.key);
        } else if (e.key === 'Backspace') {
          e.preventDefault();
          press('⌫');
        } else if (e.key === 'Enter' && onConfirm) {
          e.preventDefault();
          onConfirm();
        }
      }}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '0.4rem',
        inlineSize: '15rem',
      }}
    >
      {keys.map((k) => (
        <Button
          key={k}
          size="lg"
          disabled={disabled}
          aria-label={k === '⌫' ? tr('ws.kit.keypad.backspace') : k}
          onClick={() => press(k)}
          style={{ fontSize: 'var(--tp-fs-xl)', minBlockSize: '3.25rem' }}
        >
          {k === '⌫' ? <Icon name="undo" size={20} /> : k}
        </Button>
      ))}
      <Button kind="ghost" size="sm" disabled={disabled} onClick={() => onChange(0)} style={{ gridColumn: '1 / -1' }}>
        {tr('ws.kit.keypad.clear')}
      </Button>
    </div>
  );
}

export const REASON_CODES = [
  'customer_request',
  'wrong_item',
  'changed_mind',
  'quality',
  'spill',
  'staff_error',
  'duplicate',
  'comp',
  'weather',
  'expired',
  'other',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/**
 * PIN + reason modal shared by discount / void / refund flows.
 * Submits (pin, reasonCode); the caller runs the RPC and passes errors back in.
 */
export function PinReasonModal({
  title,
  onSubmit,
  onClose,
  busy,
  error,
  reasons = REASON_CODES,
  children,
}: {
  title: string;
  onSubmit: (pin: string, reasonCode: ReasonCode) => void;
  onClose: () => void;
  busy?: boolean;
  error?: unknown;
  reasons?: readonly ReasonCode[];
  children?: ReactNode;
}) {
  const { tr } = useLocale();
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState<ReasonCode>(reasons[0] ?? 'other');
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button kind="primary" busy={busy} disabled={pin.length < 4} onClick={() => onSubmit(pin, reason)}>
            {tr('common.confirm')}
          </Button>
        </>
      )}
    >
      {children}
      <Field label={tr('op.common.reason')}>
        <Select<ReasonCode>
          value={reason}
          onChange={setReason}
          options={reasons.map((r) => ({ value: r, label: tr(`op.reasons.${r}`) }))}
        />
      </Field>
      <Field label={tr('op.common.pin')}>
        <input
          style={inputStyle}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          maxLength={6}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
      </Field>
      <ErrorText error={error} />
    </Modal>
  );
}

/* ---------- foundation primitives ---------- */

const SPINNER_PX: Record<'xs' | 'sm' | 'md' | 'lg', string> = {
  xs: '0.9rem',
  sm: '1.1rem',
  md: '1.6rem',
  lg: '2.4rem',
};

/**
 * The waiting state — the one place inside a tool where the identity belongs.
 *
 * At `md` and `lg` this is the brand ball, turning. At `xs` and `sm` it stays
 * a neutral arc on purpose: `xs` is what every `<Button busy>` renders, and
 * three felt segments plus two seams mush at 13px — putting the mark inside
 * the highest-frequency control in the product, which PRODUCT.md rules out.
 *
 * The `role="status"` wrapper is load-bearing: BrandBall draws its own <svg>
 * with its own aria handling, so it goes INSIDE the wrapper with no `title`,
 * never in place of it, or every busy button loses its announcement.
 */
export function Spinner({
  size = 'sm',
  label,
  style,
}: {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  label?: string;
  style?: CSSProperties;
}) {
  const { tr } = useLocale();
  const px = SPINNER_PX[size];
  return (
    <span
      role="status"
      aria-label={label ?? tr('common.loading')}
      style={{ display: 'inline-block', inlineSize: px, blockSize: px, verticalAlign: 'middle', ...style }}
    >
      {size === 'md' || size === 'lg' ? (
        <BrandBall spin size="100%" style={{ inlineSize: '100%', blockSize: '100%' }} />
      ) : (
        <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" className="tp-spin" style={{ display: 'block' }}>
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
          <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}

/**
 * Placeholder blocks while a list or card loads. The ground is --tp-skeleton
 * rather than --tp-surface-3, which measured 1.09:1 against the panel it sits
 * on — a skeleton you cannot see reads as an empty panel, not as pending.
 */
export function Skeleton({
  lines = 3,
  blockSize = '0.9rem',
  style,
}: {
  lines?: number;
  blockSize?: string;
  style?: CSSProperties;
}) {
  return (
    <div aria-hidden="true" style={{ display: 'grid', gap: '0.55rem', ...style }}>
      {Array.from({ length: Math.max(1, lines) }, (_, i) => (
        <div
          key={i}
          className="tp-skel"
          style={{
            blockSize,
            inlineSize: i === lines - 1 && lines > 1 ? '60%' : '100%',
            borderRadius: 'var(--tp-radius-sm)',
            animationDelay: `${i * 0.12}s`,
          }}
        />
      ))}
    </div>
  );
}

export interface TabItem<T extends string> {
  id: T;
  label: string;
  disabled?: boolean;
  count?: number;
}

/** In-section tab strip (`role="tablist"`); arrow keys move, dir-aware. */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
  style,
}: {
  value: T;
  onChange: (next: T) => void;
  items: readonly TabItem<T>[];
  style?: CSSProperties;
}) {
  const { dir } = useLocale();
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const enabled = items.filter((t) => !t.disabled);
    const index = enabled.findIndex((t) => t.id === value);
    if (index === -1 || enabled.length === 0) return;
    const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const backward = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    let next = index;
    if (e.key === forward) next = (index + 1) % enabled.length;
    else if (e.key === backward) next = (index - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    else return;
    e.preventDefault();
    onChange(enabled[next]!.id);
  }
  return (
    <div
      role="tablist"
      onKeyDown={onKeyDown}
      style={{
        display: 'flex',
        gap: '0.25rem',
        borderBlockEnd: '1px solid var(--tp-border)',
        marginBlockEnd: '0.9rem',
        overflowX: 'auto',
        ...style,
      }}
    >
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              paddingBlock: '0.55rem',
              paddingInline: '0.85rem',
              border: 'none',
              borderBlockEnd: selected ? '2px solid var(--tp-accent)' : '2px solid transparent',
              marginBlockEnd: '-1px',
              background: 'transparent',
              color: selected ? 'var(--tp-fg)' : 'var(--tp-muted-fg)',
              fontWeight: selected ? 700 : 500,
              fontSize: 'var(--tp-fs-md)',
              cursor: item.disabled ? 'not-allowed' : 'pointer',
              opacity: item.disabled ? 'var(--tp-opacity-disabled)' : 1,
              whiteSpace: 'nowrap',
              // border-color rides with the colour: without it the 2px
              // underline teleported to the new tab while the label was still
              // half-way through fading, and the two read as separate events.
              transition:
                // Tab selection is a click, so the underline lands on its frame;
                // only the label colour eases, the same way .tp-btn dropped
                // `transform` from its transition list.
                'color var(--tp-dur-fast) var(--tp-ease-out)',
            }}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                style={{
                  fontSize: 'var(--tp-fs-xs)',
                  background: selected ? 'var(--tp-accent-soft)' : 'var(--tp-surface-3)',
                  color: selected ? 'var(--tp-accent-soft-fg)' : 'var(--tp-muted-fg)',
                  borderRadius: 'var(--tp-radius-pill)',
                  paddingInline: '0.4rem',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

/**
 * The app's dropdown. It renders SelectMenu — our own popup — rather than a
 * native <select>, because the platform draws a native select's open menu
 * itself: on macOS it lands over the control's own border and no CSS reaches
 * it. This is the one definition, so every caller gets the same menu.
 *
 * The props are the native control's, unchanged, so call sites did not move.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  id,
  style,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: {
  value: T | '';
  onChange: (next: T) => void;
  options: readonly SelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  style?: CSSProperties;
  className?: string;
  'aria-label'?: string;
  /** Set by Field, which names and describes the control it wraps. */
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  return (
    <SelectMenu<T>
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      disabled={disabled}
      id={id}
      className={className}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      style={{ ...inputStyle, ...style }}
    />
  );
}