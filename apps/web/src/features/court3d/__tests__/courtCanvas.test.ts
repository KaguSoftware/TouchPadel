// @vitest-environment jsdom
/**
 * The canvas factory's rules, with three's renderer swapped for a recorder
 * (jsdom has no WebGL). The scene itself is the real copied one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ThreeModule from 'three';

const renders: string[] = [];
const renderer = {
  shadowMap: { enabled: false, type: 0 },
  autoClear: true,
  setClearColor: vi.fn(),
  setPixelRatio: vi.fn(),
  setSize: vi.fn(),
  clearDepth: vi.fn(),
  render: vi.fn((scene: { isScene?: boolean; children: unknown[] }) => {
    renders.push(scene.children.length > 50 ? 'court' : 'overlay');
  }),
  compileAsync: vi.fn(() => Promise.resolve()),
  dispose: vi.fn(),
  forceContextLoss: vi.fn(),
};
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof ThreeModule>();
  return { ...actual, WebGLRenderer: vi.fn(() => renderer) };
});

import { createCourtCanvas } from '../courtCanvas';

let rafQueue: FrameRequestCallback[] = [];
function host(w = 360, h = 450, top = 100): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: w });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: h });
  el.getBoundingClientRect = () => new DOMRect(0, top, w, h);
  document.body.appendChild(el);
  return el;
}
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  renders.length = 0;
  rafQueue = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  for (const f of Object.values(renderer)) if (typeof f === 'function' && 'mockClear' in f) f.mockClear();
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('court canvas', () => {
  it('appends a transparent canvas and draws the court, then the ball over it, once warmed', async () => {
    const onFirstFrame = vi.fn();
    const h = host();
    const c = createCourtCanvas({ host: h, tier: 'full', onFirstFrame });
    expect(h.querySelector('canvas')).toBe(c.canvas);
    expect(renderer.setClearColor).toHaveBeenCalledWith(0x000000, 0);
    expect(renderer.render).not.toHaveBeenCalled(); // shaders warm first
    await settle();
    expect(renderer.compileAsync).toHaveBeenCalledTimes(2);
    expect(renders).toEqual(['court', 'overlay']);
    expect(renderer.clearDepth).toHaveBeenCalled();
    expect(onFirstFrame).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it('caps the pixel ratio: 2 on full, 1.5 on lite, and no shadows on lite', async () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 3 });
    const a = createCourtCanvas({ host: host(), tier: 'full' });
    await settle();
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(2);
    expect(renderer.shadowMap.enabled).toBe(true);
    a.dispose();
    const b = createCourtCanvas({ host: host(), tier: 'lite' });
    await settle();
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(1.5);
    expect(renderer.shadowMap.enabled).toBe(false);
    b.dispose();
  });

  it('loops while on screen', async () => {
    const c = createCourtCanvas({ host: host(), tier: 'full' });
    await settle();
    expect(rafQueue.length).toBe(1);
    rafQueue.shift()!(16);
    expect(rafQueue.length).toBe(1); // asked for the next frame after drawing
    c.dispose();
  });

  it('does not loop when the box starts off screen', async () => {
    const c = createCourtCanvas({ host: host(360, 450, 2000), tier: 'full' });
    await settle();
    expect(renders).toEqual(['court', 'overlay']); // the first frame still goes out
    expect(rafQueue.length).toBe(0);
    c.dispose();
  });

  it('reduced motion: draws the rest frame once and never loops', async () => {
    const c = createCourtCanvas({ host: host(), tier: 'full', reducedMotion: true, scrollLinked: true });
    await settle();
    expect(renders).toEqual(['court', 'overlay']);
    expect(rafQueue.length).toBe(0);
    c.dispose();
  });

  it('stops while the document is hidden and resumes when it is shown', async () => {
    const c = createCourtCanvas({ host: host(), tier: 'full' });
    await settle();
    rafQueue = [];
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(rafQueue.length).toBe(0);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(rafQueue.length).toBe(1);
    c.dispose();
  });

  it('holds still while the visitor has paused it, and picks up again (WCAG 2.2.2)', async () => {
    const c = createCourtCanvas({ host: host(), tier: 'full' });
    await settle();
    rafQueue = [];
    c.setPaused(true);
    expect(rafQueue.length).toBe(0); // no next frame: the last one stays on the canvas
    c.setPaused(false);
    expect(rafQueue.length).toBe(1);
    c.dispose();
  });

  it('starts held still when created paused, but still draws its first frame', async () => {
    const c = createCourtCanvas({ host: host(), tier: 'full', paused: true });
    await settle();
    expect(renders).toEqual(['court', 'overlay']);
    expect(rafQueue.length).toBe(0);
    c.dispose();
  });

  it('pauses on context loss (and asks for a restore), draws again on restore', async () => {
    const c = createCourtCanvas({ host: host(), tier: 'full' });
    await settle();
    rafQueue = [];
    const lost = new Event('webglcontextlost', { cancelable: true });
    c.canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    expect(rafQueue.length).toBe(0);
    c.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(rafQueue.length).toBe(1);
    c.dispose();
  });

  it('reports the net tape relative to the box centre', async () => {
    const onNet = vi.fn();
    const c = createCourtCanvas({ host: host(), tier: 'full', onNet });
    await settle();
    const net = onNet.mock.calls[0]![0];
    expect(Math.abs(net.dx)).toBeLessThan(1); // the rest camera sits on x = 0
    expect(net.dy).toBeGreaterThan(0); // a little below the middle at rest
    expect(net.width).toBeGreaterThan(100);
    c.dispose();
  });

  it('dispose removes the canvas at once and releases the GPU once warmed', async () => {
    const h = host();
    const c = createCourtCanvas({ host: h, tier: 'full' });
    c.dispose(); // before the warm-up settles: strict mode's unmount
    expect(h.querySelector('canvas')).toBeNull();
    await settle();
    await settle();
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(renderer.forceContextLoss).toHaveBeenCalledTimes(1);
    expect(renderer.render).not.toHaveBeenCalled();
  });
});
