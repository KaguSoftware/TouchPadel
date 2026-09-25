import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CourtCanvasOptions } from './courtCanvas';

// three.js is never loaded here: the dynamic import is replaced with a spy that
// records what CourtStage asked for and lets the test play the canvas's part.
const created: CourtCanvasOptions[] = [];
const dispose = vi.fn();
const setPaused = vi.fn();
const createCourtCanvas = vi.fn((opts: CourtCanvasOptions) => {
  created.push(opts);
  return {
    canvas: document.createElement('canvas'),
    setPaused,
    dispose,
  };
});
vi.mock('./courtCanvas', () => ({ createCourtCanvas }));

import { COURT_PAUSED_KEY, CourtStage } from './CourtStage';
import { courtCss } from './court.css';

const LABEL = 'A padel court seen from above, a rally in play';

/** Let the dynamic import's promise chain run. */
const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});

/**
 * three.js is fetched only once the stage comes within a screen of the viewport (perf
 * P6): a controllable IntersectionObserver stands in for the browser's, and `nearView()`
 * reports the stage as close.
 */
const observers: { cb: IntersectionObserverCallback; options?: IntersectionObserverInit }[] = [];
class FakeIO {
  constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    observers.push({ cb, options });
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
const nearView = () =>
  act(async () => {
    for (const { cb } of observers) {
      cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    }
    await new Promise((r) => setTimeout(r, 0));
  });

function withWebGL(available: boolean) {
  const lose = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) =>
    available && kind.startsWith('webgl')
      ? { getExtension: () => ({ loseContext: lose }) }
      : null) as unknown as HTMLCanvasElement['getContext']);
  return lose;
}

beforeEach(() => {
  created.length = 0;
  observers.length = 0;
  dispose.mockClear();
  setPaused.mockClear();
  createCourtCanvas.mockClear();
  vi.stubGlobal('IntersectionObserver', FakeIO);
  try {
    window.localStorage.removeItem(COURT_PAUSED_KEY);
  } catch {
    /* no storage in this environment */
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CourtStage — server render (what SSR and no-JS visitors get)', () => {
  it('renders the flat court, labelled, with the children on the net', () => {
    const html = renderToString(
      <CourtStage label={LABEL}>
        <a href="#app">Book in the app</a>
      </CourtStage>,
    );
    expect(html).toContain('data-court="flat"');
    expect(html).toContain('role="img"');
    expect(html).toContain(`aria-label="${LABEL}"`);
    expect(html).toContain('tp-court-illustration');
    expect(html).toContain('viewBox="0 0 320 396"');
    expect(html).toMatch(/tp-court-stage__net[^>]*>.*Book in the app/);
    expect(html).not.toContain('<canvas');
  });

  it('renders no overlay when there are no children', () => {
    expect(renderToString(<CourtStage label={LABEL} />)).not.toContain('tp-court-stage__overlay');
  });
});

describe('CourtStage — in the browser', () => {
  it('keeps the children out of the picture: interactive and in tab order', () => {
    withWebGL(false);
    render(
      <CourtStage label={LABEL}>
        <a href="#app">Book in the app</a>
      </CourtStage>,
    );
    const img = screen.getByRole('img', { name: LABEL });
    const link = screen.getByRole('link', { name: 'Book in the app' });
    expect(img.contains(link)).toBe(false);
    expect(link.tabIndex).toBe(0);
  });

  it('without WebGL: never fetches three.js, the flat court stays', async () => {
    withWebGL(false);
    const { container } = render(<CourtStage label={LABEL} />);
    await flush();
    expect(createCourtCanvas).not.toHaveBeenCalled();
    expect(container.querySelector('.tp-court-stage')?.getAttribute('data-court')).toBe('flat');
  });

  it('with WebGL: loads the canvas into its host, cross-fades on the first frame, rides the net', async () => {
    const lose = withWebGL(true);
    const { container } = render(
      <section>
        <CourtStage label={LABEL} scrollLinked>
          <button type="button">Book</button>
        </CourtStage>
      </section>,
    );
    await flush();
    expect(lose).toHaveBeenCalled(); // the probe hands its context back
    // Not yet: the stage is not near the viewport.
    expect(createCourtCanvas).not.toHaveBeenCalled();
    expect(observers[0]?.options?.rootMargin).toBe('100% 0px');
    await nearView();
    expect(createCourtCanvas).toHaveBeenCalledTimes(1);
    const opts = created[0]!;
    expect(opts.scrollLinked).toBe(true);
    expect(opts.host.classList.contains('tp-court-stage__gl')).toBe(true);
    // The section drives the camera: the court's own box is sticky on a desktop.
    expect(opts.scrollRoot).toBe(container.querySelector('section'));

    const stage = container.querySelector('.tp-court-stage')!;
    expect(stage.getAttribute('data-court')).toBe('flat');
    act(() => {
      opts.onNet?.({ dx: 2.5, dy: -14, width: 180 });
      opts.onFirstFrame?.();
    });
    expect(stage.getAttribute('data-court')).toBe('live');
    expect(stage.getAttribute('data-net')).toBe('settling');
    const net = container.querySelector<HTMLElement>('.tp-court-stage__net')!;
    expect(net.style.getPropertyValue('--tp-court-net-dx')).toBe('2.5px');
    expect(net.style.getPropertyValue('--tp-court-net-dy')).toBe('-14px');
  });

  it('disposes the canvas on unmount (strict mode mounts twice)', async () => {
    withWebGL(true);
    const { unmount } = render(<CourtStage label={LABEL} />);
    await nearView();
    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('an unmount before three.js arrives never creates a canvas', async () => {
    withWebGL(true);
    const { unmount } = render(<CourtStage label={LABEL} />);
    unmount();
    await flush();
    expect(createCourtCanvas).not.toHaveBeenCalled();
  });
});

describe('the rally can be paused (WCAG 2.2.2)', () => {
  it('draws no switch without a label, and none on the server', () => {
    withWebGL(false);
    render(<CourtStage label={LABEL} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(renderToString(<CourtStage label={LABEL} pauseLabel="Pause the rally" />)).not.toContain(
      'tp-court-stage__pause',
    );
  });

  it('pauses and resumes the flat court and the canvas, and remembers the choice', async () => {
    withWebGL(true);
    const { container } = render(<CourtStage label={LABEL} pauseLabel="Pause the rally" />);
    await nearView();
    const stage = container.querySelector('.tp-court-stage')!;
    expect(stage.hasAttribute('data-js')).toBe(true);
    const button = screen.getByRole('button', { name: 'Pause the rally' });
    expect(button.getAttribute('aria-pressed')).toBe('false');

    await userEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(stage.hasAttribute('data-paused')).toBe(true);
    expect(setPaused).toHaveBeenLastCalledWith(true);
    expect(window.localStorage.getItem(COURT_PAUSED_KEY)).toBe('1');

    await userEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(stage.hasAttribute('data-paused')).toBe(false);
    expect(setPaused).toHaveBeenLastCalledWith(false);
    expect(window.localStorage.getItem(COURT_PAUSED_KEY)).toBeNull();
  });

  it('starts paused for a visitor who paused it before', async () => {
    withWebGL(true);
    window.localStorage.setItem(COURT_PAUSED_KEY, '1');
    render(<CourtStage label={LABEL} pauseLabel="Pause the rally" />);
    await nearView();
    expect(screen.getByRole('button', { name: 'Pause the rally' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(created[0]?.paused).toBe(true);
  });

  it('stops the flat court’s keyframes while paused, and plays under 5 s without JS', () => {
    expect(courtCss).toContain(
      ".tp-court-stage[data-paused] .tp-court-illustration * { animation-play-state: paused; }",
    );
    // 0.75 of the 6.6 s loop is 4.95 s, then it holds.
    expect(courtCss).toMatch(
      /\.tp-court-stage:not\(\[data-js\]\) \.tp-court-illustration__racket \{\s*animation-iteration-count: 0\.75;\s*animation-fill-mode: forwards;/,
    );
    const block = courtCss.slice(courtCss.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toContain('.tp-court-stage__pause { display: none; }');
  });
});

describe('reduced motion', () => {
  it('the flat court holds still and the canvas cross-fade is cut', () => {
    const block = courtCss.slice(courtCss.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toContain('.tp-court-illustration__ball');
    expect(block).toContain('.tp-court-illustration__racket { animation: none; }');
    expect(block).toMatch(/\.tp-court-stage__gl canvas,[\s\S]*transition: none/);
  });

  it('the flat court rests on the first keyframe (ball at the far-left racket), not at the origin', () => {
    expect(courtCss).toMatch(/\.tp-court-illustration__ball \{[^}]*transform: translate\(102\.4px, 92px\) scale\(1\)/);
  });
});
