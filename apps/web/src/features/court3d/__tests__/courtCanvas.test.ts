// @vitest-environment jsdom
/**
 * The canvas factory's rules, with three's renderer swapped for a recorder
 * (jsdom has no WebGL). The scene itself is the real shared one (@touch/court3d).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ThreeModule from 'three';

const renders: string[] = [];
let lastCourt: ThreeModule.Scene | null = null;
const renderer = {
  shadowMap: { enabled: false, type: 0 },
  autoClear: true,
  setClearColor: vi.fn(),
  setPixelRatio: vi.fn(),
  setSize: vi.fn(),
  clearDepth: vi.fn(),
  render: vi.fn((scene: ThreeModule.Scene) => {
    const isCourt = scene.children.length > 50;
    if (isCourt) lastCourt = scene;
    renders.push(isCourt ? 'court' : 'overlay');
  }),
  compileAsync: vi.fn(() => Promise.resolve()),
  dispose: vi.fn(),
  forceContextLoss: vi.fn(),
};
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof ThreeModule>();
  return { ...actual, WebGLRenderer: vi.fn(() => renderer) };
});

import { createCourtCanvas, PIXEL_BUDGET } from '../courtCanvas';

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

/** Force the reduced-motion query to match (jsdom's stub never does). */
function withReducedMotion() {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => {
  renders.length = 0;
  lastCourt = null;
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
    const c = createCourtCanvas({ host: h, onFirstFrame });
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

  it("draws a phone's box at the screen's full 3x, and only an oversized box below it", async () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 3 });
    const phone = createCourtCanvas({ host: host(357, 442) });
    await settle();
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(3);
    phone.dispose();
    const huge = createCourtCanvas({ host: host(1200, 1200) });
    await settle();
    const ratio = renderer.setPixelRatio.mock.lastCall![0] as number;
    expect(ratio).toBeLessThan(3);
    expect(ratio * ratio * 1200 * 1200).toBeCloseTo(PIXEL_BUDGET, -2);
    huge.dispose();
  });

  it('always draws the full court: shadows on, with the 2048 map', async () => {
    const c = createCourtCanvas({ host: host() });
    await settle();
    expect(renderer.shadowMap.enabled).toBe(true);
    const sun = lastCourt!.children.find(
      (o): o is ThreeModule.DirectionalLight => (o as ThreeModule.DirectionalLight).isDirectionalLight === true,
    )!;
    expect(sun.castShadow).toBe(true);
    expect(sun.shadow.mapSize.x).toBe(2048);
    c.dispose();
  });

  it('loops while on screen', async () => {
    const c = createCourtCanvas({ host: host() });
    await settle();
    expect(rafQueue.length).toBe(1);
    rafQueue.shift()!(16);
    expect(rafQueue.length).toBe(1); // asked for the next frame after drawing
    c.dispose();
  });

  it('does not loop when the box starts off screen', async () => {
    const c = createCourtCanvas({ host: host(360, 450, 2000) });
    await settle();
    expect(renders).toEqual(['court', 'overlay']); // the first frame still goes out
    expect(rafQueue.length).toBe(0);
    c.dispose();
  });

  it('reduced motion: draws the rest frame once and never loops', async () => {
    withReducedMotion();
    const c = createCourtCanvas({ host: host(), scrollLinked: true });
    await settle();
    expect(renders).toEqual(['court', 'overlay']);
    expect(rafQueue.length).toBe(0);
    c.dispose();
  });

  it('stops while the document is hidden and resumes when it is shown', async () => {
    const c = createCourtCanvas({ host: host() });
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
    const c = createCourtCanvas({ host: host() });
    await settle();
    rafQueue = [];
    c.setPaused(true);
    expect(rafQueue.length).toBe(0); // no next frame: the last one stays on the canvas
    c.setPaused(false);
    expect(rafQueue.length).toBe(1);
    c.dispose();
  });

  it('starts held still when created paused, but still draws its first frame', async () => {
    const c = createCourtCanvas({ host: host(), paused: true });
    await settle();
    expect(renders).toEqual(['court', 'overlay']);
    expect(rafQueue.length).toBe(0);
    c.dispose();
  });

  it('pauses on context loss (and asks for a restore), draws again on restore', async () => {
    const c = createCourtCanvas({ host: host() });
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

  it('reports the net tape relative to the box centre, inside the box', async () => {
    const onNet = vi.fn();
    const c = createCourtCanvas({ host: host(360, 450), onNet });
    await settle();
    const net = onNet.mock.calls[0]![0];
    expect(Math.abs(net.dx)).toBeLessThan(360 / 4);
    expect(Math.abs(net.dy)).toBeLessThan(450 / 4);
    expect(net.width).toBeGreaterThan(360 * 0.4);
    expect(net.width).toBeLessThan(360);
    c.dispose();
  });

  it('sways with the SECTION scrolling past, not with its sticky box', async () => {
    const onNet = vi.fn();
    const h = host(360, 450, 100); // sticky: its rect never moves
    const section = document.createElement('section');
    let top = 600;
    section.getBoundingClientRect = () => new DOMRect(0, top, 360, 1600);
    const c = createCourtCanvas({ host: h, scrollLinked: true, scrollRoot: section, onNet });
    await settle();
    const entering = onNet.mock.lastCall![0];
    top = -1200; // the section is nearly gone off the top
    window.dispatchEvent(new Event('scroll'));
    for (let i = 1; i <= 90; i++) rafQueue.shift()!(i * 16); // the camera eases into place
    const leaving = onNet.mock.lastCall![0];
    expect(leaving).not.toEqual(entering);
    c.dispose();
  });

  it('paused, still follows the scroll: only the rally holds, and the loop rests once caught up', async () => {
    const onNet = vi.fn();
    const h = host(360, 450, 100);
    const section = document.createElement('section');
    let top = 600;
    section.getBoundingClientRect = () => new DOMRect(0, top, 360, 1600);
    const c = createCourtCanvas({ host: h, scrollLinked: true, scrollRoot: section, onNet, paused: true });
    await settle();
    let frames = 0;
    const drain = () => {
      while (rafQueue.length > 0 && frames < 500) rafQueue.shift()!(++frames * 16);
    };
    drain(); // the first measure re-reads the scroll once, then the loop rests
    expect(rafQueue.length).toBe(0);
    const entering = onNet.mock.lastCall![0];
    top = -1200;
    window.dispatchEvent(new Event('scroll'));
    expect(rafQueue.length).toBe(1); // the scroll wakes the resting loop
    drain();
    expect(onNet.mock.lastCall![0]).not.toEqual(entering); // the camera moved
    expect(frames).toBeLessThan(500); // and the loop rested once it caught up
    c.dispose();
  });

  it('dispose removes the canvas at once and releases the GPU once warmed', async () => {
    const h = host();
    const c = createCourtCanvas({ host: h });
    c.dispose(); // before the warm-up settles: strict mode's unmount
    expect(h.querySelector('canvas')).toBeNull();
    await settle();
    await settle();
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(renderer.forceContextLoss).toHaveBeenCalledTimes(1);
    expect(renderer.render).not.toHaveBeenCalled();
  });
});
