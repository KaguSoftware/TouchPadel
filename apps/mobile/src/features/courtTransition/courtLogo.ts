/**
 * The Touch Padel logo painted on the turf of the Book tab's court (owner,
 * 2026-09-26: the logo moved off the header onto the court's ground, made of
 * the owner's carpet texture, with the tennis ball in green).
 *
 * It is the brand file's one-line lockup — the same outlines as `logo.png` and
 * `assets/icon.png`, as vector shapes rather than a raster. The letters and
 * the swoosh ARE the owner's carpet (carpetTexture.ts), in its own blue; the
 * ball is brand green carrying the same carpet's grain (its seams are the turf
 * showing between its arcs). Laid flat in the far half's service area and read
 * upright from the court view's near top-down camera (-z is screen-up there).
 *
 * WHY IT READS AS FLOOR PAINT. It is lit exactly like the turf under it (the
 * same MeshStandardMaterial roughness, the same sun and hemisphere light, the
 * ball's shadow falling across it on tiers that draw one), and the carpet's
 * fibres break the fill up. It is opaque: the artwork is a stack of
 * overlapping pieces, and a see-through fill would show where they overlap.
 */
import * as THREE from 'three';
import { brand } from '../../theme/tokens';
import { CARPET_PX, CARPET_RGB_BASE64 } from './carpetTexture';
import { buildLogoLineShapes } from './logoMark';

/** Width of the lockup in metres (the court is 10 m wide); height follows at 900:332. */
const WIDTH = 8;
/** Centre of the badge on the far half (net at z 0; the far service line is at z -6, level with the side wall's first post). */
const CENTRE_Z = -3.5;
/** Above the court lines (0.02): the centre line runs underneath the badge. */
const LIFT = 0.03;
/** The ball: a hair above the wordmark, so the two never fight where they touch. */
const BALL_LIFT = 0.033;
/** Curve segments per bezier; the mark is a few metres wide, seen from ~60 m. */
const SEGMENTS = 6;
/** Metres of court one carpet tile covers: ~1-2 screen px a texel at the court view's distance. */
const CARPET_METRES = 1.5;

export interface CourtLogo {
  group: THREE.Group;
  dispose(): void;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Plain base64 → bytes (no padding in our data's length, but '=' is tolerated). */
function decodeBase64(text: string): Uint8Array {
  const out = new Uint8Array(Math.floor((text.replace(/=+$/, '').length * 3) / 4));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (const ch of text) {
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >> bits) & 0xff;
    }
  }
  return out;
}

/**
 * The carpet (carpetTexture.ts) as two textures from the same pixels: `color`,
 * its own blue, for the wordmark; and `grain`, its brightness only, scaled so
 * the brightest fibre is 1, multiplied into the ball's green so it carries the
 * same carpet without turning blue.
 *
 * Tiled MIRRORED: the photo is not a seamless tile, and a mirrored repeat has
 * no seam to show.
 */
function buildCarpet(): { color: THREE.DataTexture; grain: THREE.DataTexture } {
  const rgb = decodeBase64(CARPET_RGB_BASE64);
  const n = CARPET_PX * CARPET_PX;
  const color = new Uint8Array(n * 4);
  const lum = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3]!;
    const g = rgb[i * 3 + 1]!;
    const b = rgb[i * 3 + 2]!;
    color.set([r, g, b, 255], i * 4);
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    max = Math.max(max, lum[i]!);
  }
  const grey = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const v = Math.round((lum[i]! / max) * 255);
    grey.set([v, v, v, 255], i * 4);
  }
  const texture = (data: Uint8Array<ArrayBuffer>, srgb: boolean) => {
    const t = new THREE.DataTexture(data, CARPET_PX, CARPET_PX, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
    // ShapeGeometry's uvs are the shape's own coordinates, i.e. metres here.
    t.repeat.set(1 / CARPET_METRES, 1 / CARPET_METRES);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { color: texture(color, true), grain: texture(grey, false) };
}

/**
 * The lockup's shapes, parsed ONCE per process: the SVG parse is most of what
 * the logo costs to build (about 8 of its 10 ms in node) and its answer never
 * changes. Each tab's court (Book, Play, Coaches) builds a logo, so every one
 * after the first used to parse the same paths again. Shared read-only:
 * ShapeGeometry only reads a shape.
 */
let lineShapes: ReturnType<typeof buildLogoLineShapes> | null = null;

/**
 * Where the gap between the lockup's two text rows lies, in the mark's own
 * frame (metres at WIDTH 8, y up): the first row spans -1.474 to 0.163, the
 * second 0.211 to 1.185, so the gap's middle is (0.163 + 0.211) / 2.
 */
const ROW_GAP_Y = 0.187;

/**
 * `centreZ` defaults to the Book court's spot; the top view passes 0, the middle
 * of the court. `onRowGap` puts the gap between the two text rows (not the
 * centre of the whole ink, ball included) on that spot, so a line along it
 * runs between the rows.
 */
export function buildCourtLogo(centreZ: number = CENTRE_Z, onRowGap = false): CourtLogo {
  const carpet = buildCarpet();
  const { wordmark, ball } = (lineShapes ??= buildLogoLineShapes(WIDTH));
  const paint = (color: string, map: THREE.Texture) =>
    new THREE.MeshStandardMaterial({ color, map, roughness: 0.85,
      metalness: 0,
      // The lines pull forward with polygonOffset -2; pull harder so the badge wins.
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
  const layers = [
    // White, so the carpet's own blue comes through unchanged.
    { shapes: wordmark, material: paint(brand.white, carpet.color), y: LIFT },
    // A hair higher, so where the ball meets the "T" it wins cleanly.
    { shapes: ball, material: paint(brand.green, carpet.grain), y: BALL_LIFT },
  ].map(({ shapes, material, y }) => ({
    geometry: new THREE.ShapeGeometry(shapes, SEGMENTS),
    material,
    y,
  }));

  const group = new THREE.Group();
  for (const { geometry, material, y } of layers) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    // Shape y maps to -z, so the gap (shape y = ROW_GAP_Y) is brought to centreZ by +ROW_GAP_Y.
    mesh.position.set(0, y, centreZ + (onRowGap ? ROW_GAP_Y : 0));
    // Takes the ball's cast shadow like the turf does; a no-op on the lite
    // tier, which draws no shadow map.
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return {
    group,
    dispose() {
      for (const { geometry, material } of layers) {
        geometry.dispose();
        material.dispose();
      }
      carpet.color.dispose();
      carpet.grain.dispose();
    },
  };
}
