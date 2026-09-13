/**
 * IS THE COURT'S GL CONTEXT STILL THERE?
 *
 * The court has to ask, because the platform takes GL surfaces away without
 * telling JS. On Android a TextureView that leaves the window destroys its
 * context outright (expo-gl GLView.kt, `onSurfaceTextureDestroyed`), and a push
 * onto the root stack removes the whole tab navigator from the window once its
 * transition ends (react-native-screens ScreenStack.kt). No event reaches JS; a
 * replacement context only arrives when the view is next drawn.
 *
 * AND A DEAD CONTEXT DOES NOT THROW. Every expo-gl native method starts with
 * the `CTX()` guard (common/EXWebGLMethodsMacros.h), which answers a call on a
 * destroyed context with `undefined` and does nothing else. So a frame drawn
 * into one "succeeds": three issues every call, `endFrameEXP` returns, and the
 * court used to lift its stage on it — the on-net button standing over a
 * surface with no picture on it, for as long as the replacement context took to
 * build a renderer and compile every shader (owner, 2026-09-13: "for a really
 * short time the court isn't loaded and the rest of the page is loaded
 * already").
 *
 * That same guard is what makes a dead context observable, and cheaply:
 *
 *   · `endFrameEXP()` returns `null` from a live context (`return nullptr`) and
 *     `undefined` from a dead one, so the frame loop finds out on the frame it
 *     draws, for nothing.
 *   · `getParameter(UNPACK_COLORSPACE_CONVERSION_WEBGL)` answers a constant
 *     `false` from a live context, on the JS thread — no round trip to the GL
 *     thread, no GL state touched — so a surface nobody is drawing into (the
 *     tab is hidden) can be checked for the price of a property read.
 *
 * Both are pinned against expo-gl's own source by the test alongside this file,
 * so an upgrade that changes the contract fails there instead of bringing the
 * empty court back.
 *
 * Pure, and separate from Court3D.tsx, for the usual reason: the component
 * imports expo-gl and three and cannot be mounted under plain node.
 */

/** The two calls read here, structurally, so a test can hand in a fake context. */
export interface ProbeableContext {
  readonly UNPACK_COLORSPACE_CONVERSION_WEBGL: number;
  getParameter(pname: number): unknown;
  endFrameEXP(): unknown;
}

/**
 * Is this context still alive? Never blocks and never draws, so it is safe on a
 * surface nobody is looking at.
 *
 * On web the context is a real browser WebGL one, which answers this parameter
 * with a number — alive, which is right: nothing on web destroys it this way.
 */
export function contextAlive(gl: ProbeableContext): boolean {
  return gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL) !== undefined;
}

/**
 * Hand the frame just drawn to the surface, and say whether a surface took it.
 * `false` means the context is gone and nothing will reach the screen.
 *
 * `undefined` alone is not proof: expo-gl's WEB `endFrameEXP` is an empty
 * function (GLView.web.tsx), so every web frame returns it. Only then is the
 * context itself asked — the native live path, which is every frame the court
 * draws on a phone, never pays for the second call.
 */
export function presentFrame(gl: ProbeableContext): boolean {
  return gl.endFrameEXP() !== undefined || contextAlive(gl);
}
