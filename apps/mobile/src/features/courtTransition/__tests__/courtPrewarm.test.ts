import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CourtScene } from '@touch/court3d/scene';
import {
  courtKey,
  GAP_MS,
  noteInstancing,
  resetCourtPrewarm,
  runCourtPrewarm,
  SETTLE_MS,
  startCourtPrewarm,
  takePrebuiltCourt,
  type CourtBuildSpec,
  type PrewarmDeps,
} from '../courtPrewarm';

const join: CourtBuildSpec = { scene: 'join', view: 'top', quality: 'lite', lean: false };
const drill: CourtBuildSpec = { scene: 'drill', view: 'top', quality: 'lite', lean: false };

const fakeScene = (name: string) => ({ name, dispose: vi.fn() }) as unknown as CourtScene;

/** Deps that record what happened, in order, and never really wait. */
function deps(over: Partial<PrewarmDeps> = {}) {
  const log: string[] = [];
  const d: PrewarmDeps = {
    build: vi.fn((spec: CourtBuildSpec) => {
      log.push(`build:${spec.scene}`);
      return fakeScene(spec.scene);
    }),
    sleep: vi.fn(async (ms: number) => {
      log.push(`sleep:${ms}`);
    }),
    idle: vi.fn(async () => {
      log.push('idle');
    }),
    foreground: vi.fn(async () => {
      log.push('foreground');
    }),
    ...over,
  };
  return { d, log };
}

afterEach(() => resetCourtPrewarm());

describe('courts built ahead of their tab', () => {
  it('settles first, then builds one court per idle slot, a gap between them', async () => {
    noteInstancing(true);
    const { d, log } = deps();
    await runCourtPrewarm([join, drill], d);
    expect(log).toEqual([
      `sleep:${SETTLE_MS}`,
      'foreground',
      'idle',
      'build:join',
      `sleep:${GAP_MS}`,
      'foreground',
      'idle',
      'build:drill',
    ]);
  });

  it('hands a built court over once, to the tab that asks for it with the same key', async () => {
    noteInstancing(true);
    await runCourtPrewarm([join], deps().d);
    expect(takePrebuiltCourt(courtKey(join, false))).toBeNull(); // another renderer's answer
    const scene = takePrebuiltCourt(courtKey(join, true));
    expect(scene).not.toBeNull();
    expect(takePrebuiltCourt(courtKey(join, true))).toBeNull();
  });

  it('skips a court its tab already built for itself', async () => {
    noteInstancing(true);
    takePrebuiltCourt(courtKey(join, true)); // Play opened first: it built its own
    const { d } = deps();
    await runCourtPrewarm([join, drill], d);
    expect(d.build).toHaveBeenCalledTimes(1);
    expect(d.build).toHaveBeenCalledWith(drill, true);
  });

  it('builds nothing when no court ever had a context (no GL here)', async () => {
    const { d } = deps();
    await runCourtPrewarm([join, drill], d);
    expect(d.build).not.toHaveBeenCalled();
  });

  it('keeps the first renderer’s answer', async () => {
    noteInstancing(false);
    noteInstancing(true);
    const { d } = deps();
    await runCourtPrewarm([join], d);
    expect(d.build).toHaveBeenCalledWith(join, false);
  });

  it('stops at a failed build and reports it; the tab builds its own as before', async () => {
    noteInstancing(true);
    const onError = vi.fn();
    const { d } = deps({
      build: vi.fn(() => {
        throw new Error('boom');
      }),
      onError,
    });
    await runCourtPrewarm([join, drill], d);
    expect(d.build).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledOnce();
    expect(takePrebuiltCourt(courtKey(join, true))).toBeNull();
  });

  it('runs once per process, however often the Book tab asks', () => {
    const { d } = deps();
    startCourtPrewarm([join], d);
    startCourtPrewarm([join], d);
    expect(d.sleep).toHaveBeenCalledTimes(1);
  });
});
