/**
 * The two builds of the court. `lite` drops the shadow pass and draws the plainer
 * racket (scene.ts, racket.ts). Which device gets which is the app's call:
 * apps/mobile decides it from expo-device (features/courtTransition/quality.ts);
 * the website always draws `full`.
 */
export type CourtQuality = 'full' | 'lite';
