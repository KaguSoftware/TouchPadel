/**
 * Synthesised chimes (WebAudio, no asset files) + autoplay arming.
 * Patterns: 'ticket' E5→G5 (~350 ms), 'call' A5 ×2, 'alarm' C5 ×3 louder.
 * Arming is per window; on Electron stations `autoplayPolicy:
 * 'no-user-gesture-required'` makes ctx.resume() succeed on mount so the
 * banner never shows. In browsers, arm() must run inside a click handler.
 */
import { createElement, useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useLocale } from './i18n';

export type ChimeKind = 'ticket' | 'call' | 'alarm';

let ctx: AudioContext | null = null;
let armedFlag = false;
const listeners = new Set<(armed: boolean) => void>();

function getCtx(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
    typeof window !== 'undefined'
      ? (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

function setArmed(v: boolean) {
  if (armedFlag === v) return;
  armedFlag = v;
  for (const l of listeners) l(v);
}

export function isAudioArmed(): boolean {
  return armedFlag;
}

interface Note {
  freq: number;
  at: number; // seconds offset
  dur: number; // seconds
  gain: number;
}

const PATTERNS: Record<ChimeKind, Note[]> = {
  ticket: [
    { freq: 659.25, at: 0, dur: 0.18, gain: 0.25 }, // E5
    { freq: 783.99, at: 0.17, dur: 0.18, gain: 0.25 }, // G5
  ],
  call: [
    { freq: 880, at: 0, dur: 0.14, gain: 0.25 }, // A5
    { freq: 880, at: 0.2, dur: 0.14, gain: 0.25 },
  ],
  alarm: [
    { freq: 523.25, at: 0, dur: 0.14, gain: 0.45 }, // C5
    { freq: 523.25, at: 0.2, dur: 0.14, gain: 0.45 },
    { freq: 523.25, at: 0.4, dur: 0.14, gain: 0.45 },
  ],
};

function playNotes(ac: AudioContext, notes: Note[]) {
  const t0 = ac.currentTime + 0.01;
  for (const n of notes) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = n.freq;
    g.gain.setValueAtTime(0.0001, t0 + n.at);
    g.gain.exponentialRampToValueAtTime(n.gain, t0 + n.at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t0 + n.at);
    osc.stop(t0 + n.at + n.dur + 0.02);
  }
}

/** Play a chime. Silently no-ops when audio is not armed / unavailable. */
export function chime(kind: ChimeKind): void {
  if (!armedFlag) return;
  const ac = getCtx();
  if (!ac || ac.state !== 'running') return;
  try {
    playNotes(ac, PATTERNS[kind]);
  } catch {
    /* audio is best-effort */
  }
}

/** Create/resume the context (inside a user gesture in browsers) and play a near-silent tick. */
export async function armAudio(): Promise<boolean> {
  const ac = getCtx();
  if (!ac) return false;
  try {
    if (ac.state !== 'running') await ac.resume();
  } catch {
    /* fall through — state check below */
  }
  if (ac.state !== 'running') return false;
  try {
    playNotes(ac, [{ freq: 440, at: 0, dur: 0.03, gain: 0.001 }]);
  } catch {
    /* ignore */
  }
  setArmed(true);
  return true;
}

export function useAudioArming(): { armed: boolean; arm: () => void } {
  const [armed, set] = useState(armedFlag);
  useEffect(() => {
    listeners.add(set);
    set(armedFlag);
    // Electron autoplayPolicy / already-unlocked page: resume succeeds without a gesture.
    if (!armedFlag) void armAudio();
    return () => {
      listeners.delete(set);
    };
  }, []);
  const arm = useCallback(() => void armAudio(), []);
  return { armed, arm };
}

const bannerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.6rem',
  padding: '0.5rem 0.8rem',
  marginBlockEnd: '0.6rem',
  borderRadius: '8px',
  background: 'var(--tp-accent)',
  color: 'var(--tp-accent-contrast)',
  cursor: 'pointer',
  border: 'none',
  inlineSize: '100%',
  textAlign: 'start',
  font: 'inherit',
};

/** "Start shift" banner — the whole strip is the arming click target. Hidden once armed. */
export function StartShiftBanner() {
  const { tr } = useLocale();
  const { armed, arm } = useAudioArming();
  if (armed) return null;
  // createElement keeps this a plain .ts module (no JSX transform needed here).
  return createElement(
    'button',
    { type: 'button', onClick: arm, style: bannerStyle, 'data-testid': 'start-shift' },
    createElement('span', { style: { fontSize: '0.85rem', opacity: 0.9 } }, tr('op.kds.startShiftHint')),
    createElement('strong', { style: { whiteSpace: 'nowrap' } }, `▶ ${tr('op.kds.startShift')}`),
  );
}
