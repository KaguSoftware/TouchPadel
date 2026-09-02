/**
 * The court tier for THIS phone (quality.ts decides; this file only reads the
 * signals). Read once per app run — the hardware does not change — so the
 * scene is built the same way on every remount.
 */
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import { courtQualityFor, type CourtOS, type CourtQuality } from './quality';

let detected: CourtQuality | null = null;

export function detectCourtQuality(): CourtQuality {
  if (detected === null) {
    const os: CourtOS =
      Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'other';
    detected = courtQualityFor({
      os,
      yearClass: Device.deviceYearClass ?? null,
      totalMemory: Device.totalMemory ?? null,
    });
  }
  return detected;
}
