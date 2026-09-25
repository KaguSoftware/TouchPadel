/**
 * Whether this browser can draw the 3D court at all. The only gate there is: with
 * WebGL every visitor gets the full court (courtCanvas.ts), without it the flat
 * SVG court stays (CourtIllustration). Throwaway canvas; never throws.
 */
export function canDrawWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    // Hand the probe's context straight back: browsers cap live contexts (~16).
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
