/**
 * The on-screen keyboard (owner call 2026-11-20): the café till and the
 * cashier stations are touch screens, and every field on them — sign-in, the
 * manager PIN for Quit to desktop, the lock, a reason, a search — has to be
 * typeable with a finger. Pure rules (which field, which pad, the layouts,
 * the edits) are in lib/touchKeyboard.ts.
 *
 * It comes up when a typing field takes focus after a TOUCH (or pen), so a
 * mouse and a physical keyboard on the same station are left alone. Tapping a
 * field after Hide brings it back. Mounted once at the root, above sign-in,
 * the lock and every dialog.
 *
 * How it types: the field's own value setter plus an `input` event, which is
 * what React's onChange listens for, so every sanitiser (pinDigits,
 * digitsOnly, maxLength) runs exactly as for a real key. Enter and Delete are
 * sent as key presses first, so a field's own Enter handler (the PIN prompts,
 * the till filter's quick add) runs; only when nobody claimed the key does the
 * keyboard do the default (submit the form, delete a character).
 *
 * Room: while it is up, --tp-osk-inset holds its height. The shell and the
 * lock shrink by it, dialogs centre above it and the body is padded by it, so
 * the field being typed into is never under the keys.
 *
 * Windows' own touch keyboard is kept away by giving the field
 * inputmode="none" while this one owns it (restored when it lets go);
 * otherwise a till without a scanner would get both.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocale } from '../lib/i18n';
import {
  afterChar,
  deleteBackward,
  initialLang,
  insertText,
  isNumberPad,
  isTypingField,
  keyChar,
  keyboardKind,
  nextShift,
  numberPad,
  textRows,
  type EditState,
  type Key,
  type KeyboardKind,
  type KeyboardLang,
  type Layer,
  type ShiftState,
  type SpecialKey,
} from '../lib/touchKeyboard';
import { Icon, type IconName } from './icons';
import { useToast } from './toast';

type TypingEl = HTMLInputElement | HTMLTextAreaElement;

/** localStorage switch for a browser tab (dev, the visual check): 'on' shows the keyboard outside the shell too. */
export const OSK_STORAGE_KEY = 'touch-operator-osk';
const INSET_VAR = '--tp-osk-inset';
/** Set on the keyboard's root so click-outside handlers can tell a key from "outside". */
export const OSK_ATTR = 'data-tp-osk';

function oskEnabled(): boolean {
  // Inside the Electron shell: every station (the shell is the till). A plain
  // browser tab on a tablet has the device's own keyboard.
  if (typeof window !== 'undefined' && window.touch) return true;
  try {
    return localStorage.getItem(OSK_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

/** True for an event that started on the keyboard (for a window-capture click-outside handler). */
export function fromTouchKeyboard(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${OSK_ATTR}]`) !== null;
}

function asTyping(el: Element | null): TypingEl | null {
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return null;
  return isTypingField(el) ? el : null;
}

/** inputmode each field had before the keyboard set it to "none". */
const originalMode = new WeakMap<TypingEl, string | null>();

function quietOsKeyboard(el: TypingEl): void {
  if (originalMode.has(el)) return;
  originalMode.set(el, el.getAttribute('inputmode'));
  el.setAttribute('inputmode', 'none');
}

function restoreOsKeyboard(el: TypingEl): void {
  if (!originalMode.has(el)) return;
  const was = originalMode.get(el) ?? null;
  originalMode.delete(el);
  if (was === null) el.removeAttribute('inputmode');
  else el.setAttribute('inputmode', was);
}

function readEdit(el: TypingEl): EditState {
  const value = el.value;
  // type=number and type=email have no selection API: type at the end.
  let start = value.length;
  let end = value.length;
  try {
    if (el.selectionStart !== null && el.selectionEnd !== null) {
      start = el.selectionStart;
      end = el.selectionEnd;
    }
  } catch {
    /* no selection on this input type */
  }
  return { value, start, end };
}

function writeEdit(el: TypingEl, next: EditState, inputType: string, data: string | null): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, next.value);
  else el.value = next.value;
  const select = () => {
    try {
      if (el.value === next.value) el.setSelectionRange(next.start, next.end);
    } catch {
      /* no selection on this input type */
    }
  };
  select();
  const event = typeof InputEvent === 'function' ? new InputEvent('input', { bubbles: true, inputType, data }) : new Event('input', { bubbles: true });
  el.dispatchEvent(event);
  // React may have re-rendered the value (a sanitiser); keep the caret where the edit left it.
  select();
}

/** Sends a key press to the field; true when a handler claimed it (preventDefault). */
function pressKey(el: TypingEl, key: 'Enter' | 'Backspace'): boolean {
  const init: KeyboardEventInit = { key, code: key, bubbles: true, cancelable: true };
  const down = new KeyboardEvent('keydown', init);
  // keyCode/which for the few listeners that still read them.
  const keyCode = key === 'Enter' ? 13 : 8;
  Object.defineProperty(down, 'keyCode', { get: () => keyCode });
  Object.defineProperty(down, 'which', { get: () => keyCode });
  const claimed = !el.dispatchEvent(down);
  el.dispatchEvent(new KeyboardEvent('keyup', init));
  return claimed;
}

/** What a real Enter does in a form: submit it, when it has a submit button or is a one-field form. */
function implicitSubmit(el: TypingEl): void {
  const form = el.form;
  if (!form) return;
  const submit = form.querySelector<HTMLButtonElement | HTMLInputElement>('button[type="submit"], button:not([type]), input[type="submit"]');
  if (submit && submit.disabled) return;
  const fields = Array.from(form.elements).filter((f) => f instanceof HTMLInputElement && isTypingField(f));
  if (!submit && fields.length !== 1) return;
  form.requestSubmit();
}

/** Remembered for the session: the language the operator last switched to. */
let rememberedLang: KeyboardLang | null = null;

interface Owned {
  el: TypingEl;
  kind: KeyboardKind;
}

/**
 * How tall a key is: a finger's 56px, but never so tall that the keyboard
 * passes 40% of the window. Four rows plus the panel's padding and gaps
 * (~2.5rem) fit in 40vh; on a 768px till that is still the full 56px, on an
 * 800×480 one it is 38px.
 */
const KEY_H = 'min(var(--tp-osk-key-h), calc((40vh - 2.5rem) / 4))';

/**
 * What has to be in view above the keys, `room` px tall: the whole form when
 * it fits (its button in reach too, as on sign-in and the lock); else the field
 * down to the form's bottom edge when that fits (the button still in reach on
 * an 800×480 screen); else the field alone.
 */
function roomTarget(el: TypingEl, room: number): { node: Element; bottom: number; block: ScrollLogicalPosition } {
  const field = el.getBoundingClientRect();
  const form = el.closest('form');
  if (form) {
    const f = form.getBoundingClientRect();
    if (f.height <= room) return { node: form, bottom: f.bottom, block: 'nearest' };
    if (f.bottom - field.top <= room) return { node: form, bottom: f.bottom, block: 'end' };
  }
  return { node: el, bottom: field.bottom, block: 'nearest' };
}

export function TouchKeyboard() {
  const { locale, tr } = useLocale();
  const [enabled] = useState(oskEnabled);
  const [owned, setOwned] = useState<Owned | null>(null);
  /** The pad drawn: kept after the keys go down, so the hidden panel never re-renders on the way out. */
  const [kind, setKind] = useState<KeyboardKind>('text');
  const [lang, setLang] = useState<KeyboardLang>('en');
  const [layer, setLayer] = useState<Layer>('letters');
  const [shift, setShift] = useState<ShiftState>('off');
  /**
   * True while the screen is shortened to make room (--tp-osk-inset). Only
   * when the field would otherwise be under the keys: a field already in
   * view (the till's search at the top, most dialogs) moves nothing.
   */
  const [pushed, setPushed] = useState(false);
  const panelHeight = useRef(0);
  const lastShiftTap = useRef(0);
  const lastPointer = useRef<string>('mouse');
  /** Pointers held down right now, so the screen never moves under a press that is still going. */
  const pointersDown = useRef(new Set<number>());
  const releaseWhenUp = useRef(false);
  const ownedRef = useRef<Owned | null>(null);
  ownedRef.current = owned;
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const panelRef = useRef<HTMLDivElement>(null);
  /** The field the keyboard last typed into: where the floating button goes back to. */
  const lastOwned = useRef<TypingEl | null>(null);
  const toast = useToast();
  /** A touch screen on this machine: the floating button is for those only, not the owner's mouse-driven PC. */
  const [touchScreen, setTouchScreen] = useState(hasTouchScreen);
  const touchScreenRef = useRef(touchScreen);

  const open = useCallback((el: TypingEl) => {
    const prev = ownedRef.current;
    if (prev && prev.el !== el) restoreOsKeyboard(prev.el);
    const k = keyboardKind(el, originalMode.has(el) ? originalMode.get(el) : undefined);
    quietOsKeyboard(el);
    lastOwned.current = el;
    releaseWhenUp.current = false;
    if (prev?.el === el) return;
    setOwned({ el, kind: k });
    setKind(k);
    setLayer('letters');
    setShift('off');
    const appLocale: KeyboardLang = localeRef.current === 'ar' ? 'ar' : 'en';
    const langAttr = el.closest('[lang]')?.getAttribute('lang') ?? null;
    // The document's own lang is the app locale, not a statement about this field.
    const fieldLang = el.closest('[lang]') === document.documentElement ? null : langAttr;
    setLang(initialLang({ dir: el.getAttribute('dir'), lang: fieldLang, kind: k }, rememberedLang, appLocale));
  }, []);

  /**
   * Give the room back. Not while a finger or the mouse button is still down:
   * the keys usually go down because a dialog's button took focus, and
   * re-centring the dialog between the press and the release moved that
   * button out from under the pointer, so the click missed it. It waits for
   * the release instead (and the click that follows it).
   */
  const releaseFallback = useRef<number | undefined>(undefined);
  const releaseRoom = useCallback(() => {
    window.clearTimeout(releaseFallback.current);
    if (pointersDown.current.size > 0) {
      releaseWhenUp.current = true;
      // A release the window never heard (it lost focus mid-press) must not hold the room for ever.
      releaseFallback.current = window.setTimeout(() => {
        if (!releaseWhenUp.current || ownedRef.current) return;
        pointersDown.current.clear();
        releaseWhenUp.current = false;
        setPushed(false);
      }, 1500);
      return;
    }
    releaseWhenUp.current = false;
    setPushed(false);
  }, []);

  const close = useCallback(() => {
    const prev = ownedRef.current;
    if (prev) restoreOsKeyboard(prev.el);
    setOwned(null);
    releaseRoom();
  }, [releaseRoom]);

  // Which kind of pointer touched last, which pointers are down, and a tap on the focused field after Hide.
  useEffect(() => {
    if (!enabled) return;
    const onDown = (e: PointerEvent) => {
      pointersDown.current.add(e.pointerId);
      lastPointer.current = e.pointerType || 'mouse';
      // Once: a setState on every touch, even an unchanged one, can cost React a render.
      if (e.pointerType === 'touch' && !touchScreenRef.current) {
        touchScreenRef.current = true;
        setTouchScreen(true);
      }
      if (fromTouchKeyboard(e.target)) return;
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      const el = asTyping(e.target instanceof Element ? e.target.closest('input, textarea') : null);
      if (!el) return;
      // Before focus lands, so Windows never decides to show its own keyboard.
      quietOsKeyboard(el);
      if (document.activeElement === el) open(el);
    };
    const onUp = (e: PointerEvent) => {
      pointersDown.current.delete(e.pointerId);
      if (pointersDown.current.size > 0 || !releaseWhenUp.current) return;
      // After the click this release produces, which is dispatched in the same task.
      window.setTimeout(() => {
        if (releaseWhenUp.current && !ownedRef.current && pointersDown.current.size === 0) {
          releaseWhenUp.current = false;
          setPushed(false);
        }
      }, 0);
    };
    // The window losing focus mid-press never delivers that press's release.
    const onBlur = () => pointersDown.current.clear();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('blur', onBlur);
      window.clearTimeout(releaseFallback.current);
    };
  }, [enabled, open]);

  // Follow focus: up for a typing field reached by touch, kept while focus moves field to field, down when it leaves.
  useEffect(() => {
    if (!enabled) return;
    const onFocusIn = (e: FocusEvent) => {
      const el = asTyping(e.target as Element | null);
      if (!el) return;
      const touched = lastPointer.current === 'touch' || lastPointer.current === 'pen';
      if (touched || ownedRef.current) open(el);
      else restoreOsKeyboard(el);
    };
    let timer: number | undefined;
    const onFocusOut = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const now = asTyping(document.activeElement);
        if (!now && ownedRef.current) close();
      }, 0);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, [enabled, open, close]);

  // A field that unmounts or turns disabled while owned (a dialog closed on submit) lets go. Browsers do not
  // reliably send focusout for a removed element, so this looks; four cheap checks a second, only while up.
  useEffect(() => {
    if (!owned) return;
    const id = window.setInterval(() => {
      const cur = ownedRef.current;
      if (cur && (!cur.el.isConnected || !isTypingField(cur.el))) close();
    }, 250);
    return () => window.clearInterval(id);
  }, [owned, close]);

  // On each field: is it (or its form) under the keys? Then make room, and bring it into view.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!owned || !panel) return;
    const h = Math.ceil(panel.getBoundingClientRect().height);
    if (h > 0) panelHeight.current = h;
    const room = window.innerHeight - panelHeight.current;
    const covered = roomTarget(owned.el, room).bottom > room - 8;
    if (!covered) return;
    // Once made, the room stays until the keys go down, so moving field to field never jumps the screen twice.
    setPushed(true);
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const t = roomTarget(owned.el, window.innerHeight - panelHeight.current);
        t.node.scrollIntoView?.({ block: t.block, inline: 'nearest' });
      }),
    );
    return () => cancelAnimationFrame(raf);
  }, [owned]);

  // Publish the room. A ResizeObserver keeps it right if the panel's height changes (a window resize).
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!pushed) {
      root.style.removeProperty(INSET_VAR);
      return;
    }
    root.style.setProperty(INSET_VAR, `${panelHeight.current}px`);
    const panel = panelRef.current;
    const ro =
      panel && typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            const h = Math.ceil(panel.getBoundingClientRect().height);
            if (h > 0 && h !== panelHeight.current) {
              panelHeight.current = h;
              root.style.setProperty(INSET_VAR, `${h}px`);
            }
          })
        : null;
    if (panel) ro?.observe(panel);
    return () => ro?.disconnect();
  }, [pushed]);
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty(INSET_VAR);
    },
    [],
  );

  // The keys live in their own container under <body>. React listens on a
  // portal's container, so the guards below sit on that same node:
  // stopPropagation spares the other listeners of the node it runs on, so the
  // keys' handlers still run, and then the press goes no further.
  // A tap must not take focus from the field, scroll the page, or count as
  // "outside" for a popover's click-outside listener on the document.
  const [host] = useState(() => (typeof document === 'undefined' ? null : document.createElement('div')));
  useEffect(() => {
    if (!enabled || !host) return;
    host.setAttribute(OSK_ATTR, '');
    document.body.appendChild(host);
    const keep = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const stop = (e: Event) => e.stopPropagation();
    host.addEventListener('touchstart', keep, { passive: false });
    host.addEventListener('mousedown', keep);
    host.addEventListener('pointerdown', stop);
    host.addEventListener('click', stop);
    return () => {
      host.removeEventListener('touchstart', keep);
      host.removeEventListener('mousedown', keep);
      host.removeEventListener('pointerdown', stop);
      host.removeEventListener('click', stop);
      host.remove();
    };
  }, [enabled, host]);

  const target = (): TypingEl | null => {
    const cur = ownedRef.current;
    if (!cur || !cur.el.isConnected) return null;
    if (document.activeElement !== cur.el) cur.el.focus({ preventScroll: true });
    return cur.el;
  };

  const typeChar = (text: string) => {
    const el = target();
    if (!el || text === '') return;
    const max = el.maxLength >= 0 ? el.maxLength : null;
    const next = insertText(readEdit(el), text, max);
    writeEdit(el, next, 'insertText', text);
    // Only a one-shot shift changes anything; an unchanged setState can still cost React a render, so it is not called.
    if (shift === 'once') setShift(afterChar);
  };

  const press = (key: Key) => {
    if ('char' in key) return typeChar(keyChar(key, shift !== 'off'));
    const el = target();
    switch (key.special) {
      case 'space':
        return typeChar(' ');
      case 'backspace': {
        if (!el || pressKey(el, 'Backspace')) return;
        const before = readEdit(el);
        const next = deleteBackward(before);
        if (next !== before) writeEdit(el, next, 'deleteContentBackward', null);
        return;
      }
      case 'enter': {
        if (!el || pressKey(el, 'Enter')) return;
        if (el instanceof HTMLTextAreaElement) typeChar('\n');
        else implicitSubmit(el);
        return;
      }
      case 'shift': {
        const now = performance.now();
        setShift((s) => nextShift(s, now - lastShiftTap.current));
        lastShiftTap.current = now;
        return;
      }
      case 'lang': {
        const next: KeyboardLang = lang === 'en' ? 'ar' : 'en';
        rememberedLang = next;
        setLang(next);
        setShift('off');
        return;
      }
      case 'symbols':
        setLayer('symbols');
        return;
      case 'letters':
        setLayer('letters');
        return;
      case 'hide':
        // Focus stays, so a scanner or a real keyboard keeps typing; a tap on the field brings the keys back.
        close();
        return;
    }
  };
  // One function for the keys' whole life, so a memoised key never re-renders because its handler is new.
  const pressRef = useRef(press);
  pressRef.current = press;
  const onPress = useCallback((k: Key) => pressRef.current(k), []);

  /**
   * The floating button: the focused field, else the one typed into last, else
   * the first field on the screen in front (the top dialog or the lock).
   */
  const summon = () => {
    const el = asTyping(document.activeElement) ?? fieldToSummon(lastOwned.current);
    if (!el) {
      toast.info(tr('ws.kit.osk.noField'));
      return;
    }
    if (document.activeElement !== el) el.focus();
    open(el);
  };

  if (!enabled || !host) return null;
  // The panel stays mounted, hidden, once drawn: opening it again is a style change, not forty keys rendered anew.
  return createPortal(
    <>
      {!owned && touchScreen && <KeyboardButton onPress={summon} label={tr('ws.kit.osk.show')} />}
      <div
        ref={panelRef}
        role="group"
        hidden={!owned}
        aria-hidden={!owned || undefined}
        aria-label={tr('ws.kit.osk.keyboard')}
        data-testid={owned ? 'osk' : undefined}
        data-osk-kind={kind}
        data-osk-lang={lang}
        style={panelStyle}
      >
        {isNumberPad(kind) ? <NumberPad kind={kind} onPress={onPress} /> : <TextKeys kind={kind} lang={lang} layer={layer} shift={shift} onPress={onPress} />}
      </div>
    </>,
    host,
  );
}

function hasTouchScreen(): boolean {
  if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) return true;
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(any-pointer: coarse)').matches;
}

function visible(el: Element): boolean {
  return el.getClientRects().length > 0 && !el.closest('[aria-hidden="true"], [inert]');
}

/** The layer in front: the open dialog (or the lock) with the highest z-index, the later on a tie; else the page. */
function frontLayer(): ParentNode {
  let best: Element | null = null;
  let bestZ = -Infinity;
  for (const d of Array.from(document.querySelectorAll('[aria-modal="true"]'))) {
    if (!visible(d)) continue;
    const z = Number.parseInt(getComputedStyle(d).zIndex, 10);
    const zi = Number.isFinite(z) ? z : 0;
    if (zi >= bestZ) {
      best = d;
      bestZ = zi;
    }
  }
  return best ?? document;
}

/** Where the button sends the keys when no field has focus. */
function fieldToSummon(last: TypingEl | null): TypingEl | null {
  const layer = frontLayer();
  const inLayer = (el: Element) => layer === document || (layer as Element).contains(el);
  if (last && last.isConnected && isTypingField(last) && visible(last) && inLayer(last)) return last;
  const fields = Array.from(layer.querySelectorAll('input, textarea'))
    .map((el) => asTyping(el))
    .filter((el): el is TypingEl => el !== null && visible(el) && !fromTouchKeyboard(el));
  return fields[0] ?? null;
}

const BUTTON_POS_KEY = 'touch-operator-osk-button';
const BUTTON_SIZE = 52;
/** A press that moves further than this is a drag, not a tap. */
const DRAG_SLOP = 8;

/** Where the operator left the button: fractions of the window, from the inline-start and top edges. */
function readButtonPos(): { i: number; b: number } | null {
  try {
    const raw = localStorage.getItem(BUTTON_POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { i?: unknown; b?: unknown };
    return typeof p.i === 'number' && typeof p.b === 'number' ? { i: p.i, b: p.b } : null;
  } catch {
    return null;
  }
}

/**
 * Owner call 2026-11-20: a button always on a touch screen that brings the
 * keyboard up, in case a field did not. It stays out of the way by being
 * movable: a finger slides it anywhere and the station remembers the spot; a
 * tap (no slide) opens the keys. It is hidden while the keys are up, whose
 * own Hide key puts them away.
 */
function KeyboardButton({ onPress, label }: { onPress: () => void; label: string }) {
  const { dir } = useLocale();
  const [pos, setPos] = useState(readButtonPos);
  const [, setViewport] = useState(0);
  const press = useRef<{ x: number; y: number; dragged: boolean; id: number } | null>(null);

  // Re-clamp on a window resize, so a remembered spot never leaves the screen.
  useEffect(() => {
    const onResize = () => setViewport((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 8), Math.max(8, max - BUTTON_SIZE - 8));
  const placed: CSSProperties = pos
    ? { insetInlineStart: clamp(pos.i * vw, vw), insetBlockStart: clamp(pos.b * vh, vh) }
    : // Default: the inline-end edge, lifted clear of the toasts and the update banner in that corner.
      { insetInlineEnd: 'var(--tp-sp-4)', insetBlockEnd: '6rem' };

  /** Distance of a point from the inline-start edge, whichever way the page reads. */
  const fromStart = (clientX: number) => (dir === 'rtl' ? vw - clientX : clientX);

  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      title={label}
      data-testid="osk-button"
      onPointerDown={(e) => {
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* jsdom, or a pointer already gone */
        }
        press.current = { x: e.clientX, y: e.clientY, dragged: false, id: e.pointerId };
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (!p || p.id !== e.pointerId) return;
        if (!p.dragged && Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_SLOP) return;
        p.dragged = true;
        setPos({ i: (fromStart(e.clientX) - BUTTON_SIZE / 2) / vw, b: (e.clientY - BUTTON_SIZE / 2) / vh });
      }}
      onPointerUp={() => {
        const p = press.current;
        press.current = null;
        if (!p) return;
        if (p.dragged) {
          try {
            if (pos) localStorage.setItem(BUTTON_POS_KEY, JSON.stringify(pos));
          } catch {
            /* storage blocked: the spot lasts until a reload */
          }
          return;
        }
        onPress();
      }}
      onPointerCancel={() => {
        press.current = null;
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPress();
        }
      }}
      style={{
        position: 'fixed',
        ...placed,
        zIndex: 'var(--tp-z-keyboard)' as CSSProperties['zIndex'],
        inlineSize: BUTTON_SIZE,
        blockSize: BUTTON_SIZE,
        borderRadius: '50%',
        border: '1px solid var(--tp-accent)',
        background: 'var(--tp-accent)',
        color: 'var(--tp-accent-contrast)',
        boxShadow: 'var(--tp-shadow-popover)',
        display: 'grid',
        placeItems: 'center',
        padding: 0,
        cursor: 'pointer',
        opacity: 0.92,
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      <Icon name="keyboard" size={24} />
    </button>
  );
}

const panelStyle: CSSProperties = {
  position: 'fixed',
  insetInline: 0,
  insetBlockEnd: 0,
  zIndex: 'var(--tp-z-keyboard)' as CSSProperties['zIndex'],
  background: 'var(--tp-surface-2)',
  borderBlockStart: '1px solid var(--tp-border-strong)',
  boxShadow: 'var(--tp-shadow-popover)',
  paddingBlock: 'var(--tp-sp-2)',
  paddingInline: 'var(--tp-sp-2)',
  touchAction: 'none',
  userSelect: 'none',
  WebkitUserSelect: 'none',
};

const TextKeys = memo(function TextKeys({ kind, lang, layer, shift, onPress }: { kind: KeyboardKind; lang: KeyboardLang; layer: Layer; shift: ShiftState; onPress: (k: Key) => void }) {
  const rows = useMemo(() => textRows(lang, layer, kind), [lang, layer, kind]);
  const shifted = shift !== 'off';
  return (
    // Keys sit where they sit on a physical keyboard in BOTH languages (ض is on the Q key), so the rows never mirror.
    <div dir="ltr" style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', maxInlineSize: '72rem', marginInline: 'auto' }}>
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', justifyContent: 'center' }}>
          {row.map((key, j) => (
            <KeyButton
              key={j}
              k={key}
              grow={'special' in key ? specialGrow(key.special) : 1}
              // Only the keys whose face changes with shift hear about it.
              shifted={'char' in key ? shifted : false}
              shiftOn={'special' in key && key.special === 'shift' ? shift : 'off'}
              lang={'special' in key ? lang : 'en'}
              onPress={onPress}
            />
          ))}
        </div>
      ))}
    </div>
  );
});

function specialGrow(s: SpecialKey): number {
  if (s === 'space') return 5;
  if (s === 'enter' || s === 'shift' || s === 'backspace') return 1.6;
  return 1.3;
}

const NumberPad = memo(function NumberPad({ kind, onPress }: { kind: KeyboardKind; onPress: (k: Key) => void }) {
  const pad = useMemo(() => numberPad(kind), [kind]);
  return (
    <div
      dir="ltr"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gridAutoRows: KEY_H,
        gap: 'var(--tp-sp-1-5)',
        maxInlineSize: '26rem',
        marginInline: 'auto',
      }}
    >
      {pad.map((p, i) => (
        <KeyButton key={i} k={p.key} shifted={false} shiftOn="off" lang="en" onPress={onPress} cols={p.cols} rows={p.rows} big />
      ))}
    </div>
  );
});

const COMBINING = /^\p{M}+$/u;

const KeyButton = memo(function KeyButton({
  k,
  grow,
  shifted,
  shiftOn,
  lang,
  onPress,
  cols,
  rows,
  big,
}: {
  k: Key;
  grow?: number;
  shifted: boolean;
  shiftOn: ShiftState;
  lang: KeyboardLang;
  onPress: (k: Key) => void;
  cols?: number;
  rows?: number;
  big?: boolean;
}) {
  const { tr } = useLocale();
  const repeat = useRef<{ delay?: number; every?: number }>({});
  const isBackspace = 'special' in k && k.special === 'backspace';

  const stopRepeat = () => {
    window.clearTimeout(repeat.current.delay);
    window.clearInterval(repeat.current.every);
    repeat.current = {};
  };
  useEffect(() => stopRepeat, []);

  let label: ReactNode;
  let aria: string;
  let icon: IconName | null = null;
  /** A part dropped on a narrow or short screen (GlobalStyles), where the key keeps only what identifies it. */
  let optional: 'icon' | 'label' | null = null;
  let tone: 'char' | 'special' | 'accent' = 'char';
  if ('char' in k) {
    const ch = keyChar(k, shifted);
    aria = ch;
    // A lone vowel mark is drawn on a dotted circle, as Arabic keyboards do, so it is visible at all.
    label = COMBINING.test(ch) ? `◌${ch}` : ch;
  } else {
    tone = 'special';
    switch (k.special) {
      case 'shift':
        icon = 'chevronUp';
        aria = tr('ws.kit.osk.shift');
        label = null;
        break;
      case 'backspace':
        icon = 'arrowStart';
        aria = tr('ws.kit.osk.backspace');
        label = null;
        break;
      case 'enter':
        tone = 'accent';
        icon = 'check';
        aria = tr('ws.kit.osk.enter');
        label = big ? null : aria;
        optional = 'label';
        break;
      case 'space':
        tone = 'char';
        aria = tr('ws.kit.osk.space');
        label = aria;
        break;
      case 'lang':
        icon = 'globe';
        aria = tr('ws.kit.osk.switchLang');
        // Names the language a tap switches TO, in that language.
        label = lang === 'en' ? 'عربي' : 'EN';
        optional = 'icon';
        break;
      case 'symbols':
        aria = tr('ws.kit.osk.symbols');
        label = '?123';
        break;
      case 'letters':
        aria = tr('ws.kit.osk.letters');
        label = lang === 'ar' ? 'أ ب ت' : 'ABC';
        break;
      case 'hide':
        icon = 'keyboard';
        aria = tr('ws.kit.osk.hide');
        label = <Icon name="chevronDown" size={16} />;
        break;
    }
  }
  const active = 'special' in k && k.special === 'shift' && shiftOn !== 'off';
  const sub = 'special' in k && k.special !== 'space';

  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={aria}
      aria-pressed={'special' in k && k.special === 'shift' ? active : undefined}
      data-osk-key={'char' in k ? k.char : k.special}
      // The pressed look is set on the element itself, not through React: a press re-renders nothing.
      onPointerDown={(e) => {
        e.preventDefault();
        const el = e.currentTarget;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* jsdom, or a pointer already gone */
        }
        el.setAttribute('data-down', '');
        if (isBackspace) {
          onPress(k);
          // Held: keeps deleting, as a real Backspace does.
          repeat.current.delay = window.setTimeout(() => {
            repeat.current.every = window.setInterval(() => onPress(k), 70);
          }, 450);
        }
      }}
      onPointerUp={(e) => {
        const el = e.currentTarget;
        const wasDown = el.hasAttribute('data-down');
        el.removeAttribute('data-down');
        if (isBackspace) {
          stopRepeat();
          return;
        }
        if (!wasDown) return;
        // Commits on release, and only when the finger lifted on this key, so a slide off cancels.
        const r = el.getBoundingClientRect();
        const inside = r.width === 0 || (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
        if (inside) onPress(k);
      }}
      onPointerCancel={(e) => {
        e.currentTarget.removeAttribute('data-down');
        stopRepeat();
      }}
      onKeyDown={(e) => {
        // A screen reader's or a switch user's activation, which arrives as a click without pointer events.
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPress(k);
        }
      }}
      className="tp-osk-key"
      data-tone={tone}
      data-big={big || undefined}
      data-active={active || undefined}
      style={{
        flex: grow ? `${grow} 1 0` : undefined,
        gridColumn: cols ? `span ${cols}` : undefined,
        gridRow: rows ? `span ${rows}` : undefined,
        minInlineSize: 0,
        blockSize: big ? '100%' : KEY_H,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--tp-sp-1)',
        border: '1px solid var(--tp-border)',
        borderRadius: 'var(--tp-radius-ctl)',
        fontWeight: tone === 'char' ? 500 : 600,
        lineHeight: 1,
        cursor: 'pointer',
        padding: 0,
        overflow: 'hidden',
        touchAction: 'none',
      }}
    >
      {icon && (
        <span data-osk-optional={optional === 'icon' || undefined} style={{ display: 'inline-flex' }}>
          <Icon name={icon} size={big ? 22 : 18} />
        </span>
      )}
      {label !== null && label !== undefined && (
        <span className={sub ? 'tp-osk-sub' : undefined} data-osk-optional={optional === 'label' || undefined}>
          {label}
        </span>
      )}
    </button>
  );
});

/**
 * Why a button is off, for a finger. Button's `disabledReason` (rulebook 4.3:
 * a disabled control is never a dead end) is a hover tooltip, and a touch
 * screen never hovers, so on a touch station the tap on a disabled button
 * says it as a toast instead. Both touchstart and pointerdown are heard, and
 * the button is found under the finger, because a disabled control does not
 * reliably receive pointer events itself.
 */
export function TouchDisabledReason() {
  const toast = useToast();
  const [enabled] = useState(oskEnabled);
  const toastRef = useRef(toast);
  toastRef.current = toast;
  useEffect(() => {
    if (!enabled) return;
    let last = { text: '', at: 0 };
    const reasonAt = (x: number, y: number): string | null => {
      const stack = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : [];
      for (const el of stack) {
        const btn = el.closest('button');
        if (!btn) continue;
        if (!btn.disabled) return null;
        const reason = btn.getAttribute('data-disabled-reason');
        return reason && reason.trim() ? reason.trim() : null;
      }
      return null;
    };
    const show = (x: number, y: number) => {
      const text = reasonAt(x, y);
      if (!text) return;
      const now = performance.now();
      // One tap arrives as a touchstart AND a pointerdown: one toast.
      if (text === last.text && now - last.at < 1500) return;
      last = { text, at: now };
      toastRef.current.info(text);
    };
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) show(t.clientX, t.clientY);
    };
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') show(e.clientX, e.clientY);
    };
    window.addEventListener('touchstart', onTouch, { capture: true, passive: true });
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('touchstart', onTouch, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [enabled]);
  return null;
}
