import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MACHINE } from '@touch/court3d/drill';
import { buildCourtScene } from '@touch/court3d/scene';
import { buildPhoneCourt } from '../phoneCourt';

/** The logo: the last thing the phone court adds to the scene. */
const logoOf = (court: ReturnType<typeof buildPhoneCourt>) =>
  court.scene.children[court.scene.children.length - 1]!;

describe('the phone court', () => {
  it('hangs the brand pattern behind the glass (the shared scene draws none by default)', () => {
    const court = buildPhoneCourt('lite');
    expect(court.camera.children).toHaveLength(1);
    court.dispose();
  });

  it('leaves the Book view logo exactly where courtLogo puts it', () => {
    const court = buildPhoneCourt('lite');
    const logo = logoOf(court);
    expect(logo.rotation.y).toBe(0);
    expect(logo.position.toArray()).toEqual([0, 0, 0]);
    expect(logo.scale.toArray()).toEqual([1, 1, 1]);
    court.dispose();
  });

  it.each(['rally', 'drill'] as const)(
    'in the top view (%s) the logo is the Book court\'s, bigger, centred on the court, short of the machine',
    (scene) => {
      const book = buildPhoneCourt('lite');
      const court = buildPhoneCourt('lite', false, { scene, view: 'top' });
      const logo = logoOf(court);
      expect(logo.rotation.y).toBeCloseTo(Math.PI / 2); // upright on the landscape screen
      expect(logo.scale.toArray()).toEqual([1.3, 1.3, 1.3]); // bigger than the Book's
      logo.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(logo);
      expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 1); // centred across the court
      // The gap between the text rows (not the whole ink) is on the centre line (x 0).
      expect((box.min.x + box.max.x) / 2).toBeCloseTo(0.187 * 1.3, 1); // ink sits that far off, gap on x 0
      expect(box.min.z).toBeGreaterThan(MACHINE.z + 0.5); // short of the machine's drum
      expect(box.min.y).toBeGreaterThan(0); // still above the turf
      court.dispose();
      book.dispose();
    },
  );

  it('an overlay is only the rackets and the ball: no field, no pattern, no logo', () => {
    const court = buildPhoneCourt('lite', false, { scene: 'join', view: 'top', overlay: true });
    const plain = buildCourtScene('lite', { scene: 'join', view: 'top', field: false });
    expect(court.camera.children).toHaveLength(0);
    expect(court.scene.children).toHaveLength(plain.scene.children.length);
    court.dispose();
    plain.dispose();
  });
});
