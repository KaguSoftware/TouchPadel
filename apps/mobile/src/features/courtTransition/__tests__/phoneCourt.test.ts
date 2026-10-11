import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MACHINE } from '@touch/court3d/drill';
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
    'in the top view (%s) the logo is the Book court\'s, same size and spot, clear of the net and the machine',
    (scene) => {
      const book = buildPhoneCourt('lite');
      const court = buildPhoneCourt('lite', false, { scene, view: 'top' });
      const logo = logoOf(court);
      const bookLogo = logoOf(book);
      expect(logo.rotation.y).toBe(0);
      expect(logo.scale.toArray()).toEqual(bookLogo.scale.toArray());
      expect(logo.position.toArray()).toEqual(bookLogo.position.toArray());
      logo.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(logo);
      expect(box.max.z).toBeLessThan(-0.3); // clear of the net
      expect(box.min.z).toBeGreaterThan(MACHINE.z + 0.5); // short of the machine's drum
      expect(box.min.y).toBeGreaterThan(0); // still above the turf
      court.dispose();
      book.dispose();
    },
  );
});
