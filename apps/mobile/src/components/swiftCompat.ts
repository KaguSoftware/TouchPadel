/**
 * A tint the SwiftUI sheets' already-installed phones understand. @expo/ui
 * 57.0.17 (2026-09-08) moved `tint` from a plain `color` to a `ShapeStyle`
 * (`tint`); the dev client on the owner's phone predates it and silently drops
 * the new key, so a red tint came out blue (owner, 2026-10-04: no new build
 * for this). The helper sends BOTH shapes: the native side reads the one it
 * knows and ignores the other. Text colour goes through `foregroundColor`,
 * whose `{ color }` never changed.
 *
 * Drop this for the plain `tint` once every installed build is 57.0.17 or
 * later.
 */
import { createModifier, type ModifierConfig } from '@expo/ui/swift-ui/modifiers';

export function tintColor(color: string): ModifierConfig {
  return createModifier('tint', { tint: { type: 'color', color }, color });
}
