import { describe, expect, it } from 'vitest';
import { buildPhoneCourt } from '../phoneCourt';

describe('the phone court', () => {
  it('hangs the brand pattern behind the glass (the shared scene draws none by default)', () => {
    const court = buildPhoneCourt('lite');
    expect(court.camera.children).toHaveLength(1);
    court.dispose();
  });
});
