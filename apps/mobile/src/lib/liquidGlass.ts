import { isLiquidGlassAvailable } from 'expo-glass-effect';

/**
 * iOS 26's Liquid Glass, for every surface that draws it (the PICK A TIME
 * capsule, the open-now pill, the date chips).
 *
 * `isLiquidGlassAvailable()` is the system's own answer, not a version check: it
 * is false on Android (where the module falls back to a plain View), false below
 * iOS 26, and false when the build has opted out of the new design. Anything
 * that answers false keeps its blur-and-tint or flat stand-in, so nothing
 * regresses on older phones.
 *
 * Read once at module scope. The native value cannot change while the app runs,
 * and calling it per render would cross the bridge on every frame of the
 * transition.
 */
export const liquidGlass = isLiquidGlassAvailable();
