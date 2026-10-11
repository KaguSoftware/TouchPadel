/**
 * The count the person last saw on their reward track, per person, branch and
 * business month, so the next visit can show what moved while they were on
 * the floor. A convenience only: lost storage means the track fills from zero
 * once, nothing more.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const key = (staffId: string, venueId: string, month: string) =>
  `tp.staff.rewardsSeen.${staffId}.${venueId}.${month}`;

export async function readSeen(staffId: string, venueId: string, month: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(key(staffId, venueId, month));
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export async function writeSeen(
  staffId: string,
  venueId: string,
  month: string,
  count: number,
): Promise<void> {
  try {
    await AsyncStorage.setItem(key(staffId, venueId, month), String(count));
  } catch {
    // Nothing to do: the next visit fills from zero.
  }
}
