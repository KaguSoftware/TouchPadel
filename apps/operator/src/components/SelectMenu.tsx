/**
 * A select whose popup we draw ourselves.
 *
 * A native <select> hands its open menu to the platform: on macOS AppKit
 * positions that menu so the CHOSEN row sits over the closed control, which
 * means the list overlaps the control's own border and no CSS can move,
 * clip or restyle it — it is not in the page's layer at all. Everywhere the
 * operator needs the open state to look like the rest of the app, the popup
 * has to be ours.
 *
 * It is deliberately the same machinery as RowActions in kit.tsx: a
 * position:fixed panel measured off the trigger's rect, dismissed on scroll
 * rather than chased, closed on outside pointerdown and on Escape. Fixed
 * because the analytics bar is itself sticky and its ancestors scroll — an
 * absolutely-positioned panel would be clipped by them.
 *
 * The panel is PORTALLED to <body>, and that is load-bearing rather than
 * tidiness. The analytics bar carries backdrop-filter (its frosted ground),
 * and a filtered element becomes a CONTAINING BLOCK for fixed-position
 * descendants AND its own stacking context. Rendered in place, the panel's
 * viewport coordinates would resolve against the bar — it hung ~22px low —
 * and the bar's z-index would trap it beneath the charts it must cover, no
 * matter how high --tp-z-popover goes. A portal escapes both.
 *
 * What the native control gave for free and is re-implemented below:
 * roving focus with the arrow keys, Home/End, Enter/Space to commit, Escape
 * to cancel, type-ahead, and the aria listbox contract (aria-activedescendant
 * on the trigger, aria-selected on the rows). Keep those working; they are
 * the reason a native select is the default elsewhere in the app.
 */
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';
import { useLocale } from '../lib/i18n';

export interface SelectMenuOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

/** How long a run of keystrokes counts as one type-ahead word. */
const TYPEAHEAD_MS = 600;

export function SelectMenu<T extends string>({
  value,
  onChange,
  options,
  disabled,
  id,
  style,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: {
  value: T | '';
  onChange: (next: T) => void;
  options: readonly SelectMenuOption<T>[];
  disabled?: boolean;
  id?: string;
  /** Applied to the trigger, so callers keep styling it like an input. */
  style?: CSSProperties;
  /** Also on the trigger — the analytics bar passes its glass class here. */
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}) {
  const { dir } = useLocale();
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const typed = useRef<{ text: string; at: number }>({ text: '', at: 0 });

  // Panel geometry is measured once per open, like RowActions: the bar is
  // sticky and a scroll would leave the panel behind, so movement dismisses.
  const [box, setBox] = useState<{ start: number; blockStart: number; minInlineSize: number } | null>(null);
  // The row the keyboard is on. Mouse hover does NOT move it: a pointer
  // drifting across the panel must not retarget what Enter would commit.
  const [active, setActive] = useState(0);

  const open = box !== null;
  const selectedIndex = options.findIndex((o) => o.value === value);

  const close = useCallback((focusTrigger: boolean) => {
    setBox(null);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  const openPanel = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setBox({
      // insetInlineStart is resolved by the browser against the panel's own
      // direction, which it inherits from <html> through the portal: in
      // Arabic it already measures from the RIGHT edge. So the value handed
      // over is the same rect.left in both directions, and flipping it here
      // as well double-flipped it — the panel's right edge landed ~24px past
      // the trigger's whenever the panel was the wider of the two.
      start: dir === 'rtl' ? window.innerWidth - rect.right : rect.left,
      blockStart: rect.bottom,
      minInlineSize: rect.width,
    });
    // Open onto the current choice, the way the native menu does.
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
  }, [dir, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const dismiss = () => setBox(null);
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !triggerRef.current?.contains(t)) setBox(null);
    };
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  // Focus follows the active row so the panel owns the keyboard while open.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.focus();
  }, [open, active]);

  function step(from: number, delta: number): number {
    // Skips disabled rows; stops at the ends rather than wrapping, so holding
    // an arrow key cannot silently loop past the choice you were aiming for.
    for (let i = from + delta; i >= 0 && i < options.length; i += delta) {
      if (!options[i]?.disabled) return i;
    }
    return from;
  }

  function firstEnabled(): number {
    const i = options.findIndex((o) => !o.disabled);
    return i < 0 ? 0 : i;
  }

  function lastEnabled(): number {
    for (let i = options.length - 1; i >= 0; i -= 1) if (!options[i]?.disabled) return i;
    return 0;
  }

  function commit(i: number) {
    const o = options[i];
    if (!o || o.disabled) return;
    onChange(o.value);
    close(true);
  }

  function typeahead(key: string) {
    const now = Date.now();
    const text = (now - typed.current.at > TYPEAHEAD_MS ? '' : typed.current.text) + key.toLowerCase();
    typed.current = { text, at: now };
    const i = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(text));
    if (i >= 0) setActive(i);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPanel();
      }
      return;
    }
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation(); // A dialog behind the panel must not close too.
        close(true);
        return;
      case 'Tab':
        // Tab commits nothing and lets focus leave, matching a native menu.
        setBox(null);
        return;
      case 'ArrowDown':
        e.preventDefault();
        setActive((i) => step(i, 1));
        return;
      case 'ArrowUp':
        e.preventDefault();
        setActive((i) => step(i, -1));
        return;
      case 'Home':
        e.preventDefault();
        setActive(firstEnabled());
        return;
      case 'End':
        e.preventDefault();
        setActive(lastEnabled());
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        commit(active);
        return;
      default:
        if (e.key.length === 1) typeahead(e.key);
    }
  }

  const current = selectedIndex >= 0 ? options[selectedIndex]?.label : undefined;

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        className={className}
        onClick={() => (open ? close(false) : openPanel())}
        onKeyDown={onKeyDown}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--tp-sp-2)',
          textAlign: 'start',
          cursor: disabled ? 'not-allowed' : 'pointer',
          ...style,
        }}
      >
        <span>{current ?? ''}</span>
        <Icon name="chevronDown" size={14} style={{ color: 'var(--tp-muted-fg)', flexShrink: 0 }} />
      </button>
      {box && createPortal(
        <div
          ref={panelRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          onKeyDown={onKeyDown}
          // The frost, the border and the 12px corner live in the class
          // (GlobalStyles .tp-menu-glass): backdrop-filter needs a @supports
          // fallback, and a hover rule cannot be written inline at all.
          className="tp-menu-glass tp-rise"
          // The marker a surrounding dismiss-on-outside-click looks for. The
          // panel is portalled to <body>, so it is DOM-outside any dialog or
          // popover that contains its trigger; without this, opening this menu
          // inside the analytics Settings panel closed that panel instead of
          // choosing an option.
          data-menu-portal=""
          style={{
            position: 'fixed',
            // insetInlineStart resolves against THIS element's direction, and
            // the panel is portalled to <body> where it inherits the document
            // one — so in Arabic the inset is measured from the right edge,
            // which is exactly the anchor we want. The value in `start` is
            // already the distance from that reading-side edge.
            insetInlineStart: `${box.start}px`,
            insetBlockStart: `${box.blockStart}px`,
            // The gap that the native menu refuses to leave.
            marginBlockStart: 'var(--tp-sp-1)',
            minInlineSize: `${box.minInlineSize}px`,
            zIndex: 'var(--tp-z-popover)',
            display: 'grid',
            maxBlockSize: '18rem',
            overflowY: 'auto',
            // Inset, so a tinted row's rounded corner sits inside the pane's
            // rather than fighting it.
            padding: 'var(--tp-sp-1)',
          }}
        >
          {options.map((o, i) => {
            const isSelected = o.value === value;
            return (
              <button
                key={o.value}
                id={`${listId}-${i}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-active={i === active ? 'true' : undefined}
                disabled={o.disabled}
                tabIndex={-1}
                onClick={() => commit(i)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--tp-sp-2)',
                  inlineSize: '100%',
                  minBlockSize: 'var(--tp-touch)',
                  paddingBlock: 'var(--tp-sp-2)',
                  paddingInline: 'var(--tp-sp-3)',
                  border: 'none',
                  font: 'inherit',
                  textAlign: 'start',
                  whiteSpace: 'nowrap',
                  color: i === active ? 'var(--tp-accent-soft-fg)' : 'var(--tp-fg)',
                  cursor: o.disabled ? 'not-allowed' : 'pointer',
                  opacity: o.disabled ? 'var(--tp-opacity-disabled)' : undefined,
                  // The keyboard's row is the one that is tinted; the check
                  // marks what is CHOSEN. Two different questions, so the
                  // panel answers both at once rather than conflating them.
                  // Inline, so it out-ranks the class's hover rule.
                  background: i === active ? 'var(--tp-accent-soft)' : 'transparent',
                }}
              >
                <Icon name="check" size={14} style={{ flexShrink: 0, visibility: isSelected ? undefined : 'hidden' }} />
                {o.label}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
