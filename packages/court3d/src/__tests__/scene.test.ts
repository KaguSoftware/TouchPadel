/**
 * The seam between the two hosts. The phone and the site build the same court,
 * and the three things they do differently are options. Spin and the shadow map
 * default to the phone's; the backdrop defaults to none, and the phone passes its
 * pattern (apps/mobile courtTransition/phoneCourt.ts, tested there). These pin that
 * each option does what its host asks of it.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { buildCourtScene, type BackdropViewport, type CourtBackdrop } from '../scene';

const VIEW: BackdropViewport = {
  boxWidth: 390,
  boxHeight: 844,
  offsetX: 0,
  offsetY: 132,
  viewWidth: 390,
  viewHeight: 646,
};

function stubBackdrop() {
  const backdrop: CourtBackdrop = {
    group: new THREE.Group(),
    place: vi.fn(),
    setInk: vi.fn(),
    dispose: vi.fn(),
  };
  return backdrop;
}

/** The ball: the overlay's one group (its seams ride inside it). */
const ballOf = (court: ReturnType<typeof buildCourtScene>) =>
  court.overlay.children.find((o) => o instanceof THREE.Group)!;

const sunOf = (court: ReturnType<typeof buildCourtScene>) =>
  court.scene.children.find(
    (o): o is THREE.DirectionalLight => o instanceof THREE.DirectionalLight,
  )!;

/** Draw `seconds` of rally at `hz`, the way a host's loop does. */
function play(court: ReturnType<typeof buildCourtScene>, seconds: number, hz: number) {
  const frames = Math.round(seconds * hz);
  for (let i = 1; i <= frames; i++) court.update(i / hz, 0, 0);
}

describe('the backdrop option', () => {
  it('without one, nothing hangs off the camera and the backdrop calls are no-ops', () => {
    const court = buildCourtScene();
    expect(court.camera.children).toHaveLength(0);
    // The camera is still in the scene: update() relies on its world matrix.
    expect(court.camera.parent).toBe(court.scene);
    court.setBackdropViewport(VIEW);
    court.setBackdropInk('#123456');
    expect(() => court.update(0.5, 0, 0)).not.toThrow();
    court.dispose();
  });

  it('with one, it rides the camera, is placed on update once it has a viewport, and is disposed', () => {
    const backdrop = stubBackdrop();
    const court = buildCourtScene('full', { backdrop: () => backdrop });
    expect(backdrop.group.parent).toBe(court.camera);
    court.update(0, 0, 0);
    expect(backdrop.place).not.toHaveBeenCalled(); // nothing to place against yet
    court.setBackdropViewport(VIEW);
    court.update(0, 0, 1);
    // The lift at full pitch is SPEC.court.y[1]: the backdrop cancels it.
    expect(backdrop.place).toHaveBeenLastCalledWith(VIEW, -60);
    court.setBackdropInk('#abcdef');
    expect(backdrop.setInk).toHaveBeenCalledWith('#abcdef');
    court.dispose();
    expect(backdrop.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('the spin option', () => {
  it("'time' spins the ball the same on a 60 Hz and a 120 Hz screen", () => {
    const a = buildCourtScene('full', { spin: 'time' });
    const b = buildCourtScene('full', { spin: 'time' });
    play(a, 1, 60);
    play(b, 1, 120);
    expect(ballOf(a).rotation.x).toBeCloseTo(ballOf(b).rotation.x, 9);
    expect(ballOf(a).rotation.z).toBeCloseTo(ballOf(b).rotation.z, 9);
    expect(ballOf(a).rotation.x).toBeGreaterThan(0);
  });

  it("the default ('frame', the phone's) steps per drawn frame", () => {
    const a = buildCourtScene();
    const b = buildCourtScene();
    play(a, 1, 60);
    play(b, 1, 120);
    expect(ballOf(a).rotation.x).toBeCloseTo(60 * 0.12, 9);
    expect(ballOf(b).rotation.x).toBeCloseTo(120 * 0.12, 9);
  });
});

describe('the shadow map option', () => {
  it("is the phone's 1024 by default and takes the size asked for", () => {
    expect(sunOf(buildCourtScene()).shadow.mapSize.x).toBe(1024);
    const sun = sunOf(buildCourtScene('full', { shadowMapSize: 2048 }));
    expect(sun.castShadow).toBe(true);
    expect(sun.shadow.mapSize.x).toBe(2048);
    expect(sun.shadow.mapSize.y).toBe(2048);
  });

  it('lite casts no shadow at all', () => {
    expect(sunOf(buildCourtScene('lite', { shadowMapSize: 2048 })).castShadow).toBe(false);
  });
});
