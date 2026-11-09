/**
 * Renders the app's own padel racket, alone, to assets/court/racket.png: the
 * still the open-match screen puts on each taken seat of its flat court.
 *
 * The racket is not redrawn. This builds the join court's scene
 * (packages/court3d/src/scene.ts, top view), hides everything but one racket,
 * and draws it with the scene's own lights in a browser's WebGL, on a
 * transparent ground. Player 2 stands on the left, the first seat the court
 * fills (join.ts); the screen flips the picture for the seats on the right.
 *
 *   pnpm --filter @touch/mobile racket
 *
 * Needs Playwright with Chrome (the same one `store` uses). Run it again if
 * the racket's model or the scene's light changes; commit the new PNG.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const require = createRequire(join(root, 'package.json'));
const esbuild = require('esbuild');
const { chromium } = require('playwright');

const PX = 256;
const PLAYER = 2;
/** Seconds into the warm-up: the racket in its ready stance. */
const AT = 0.2;

const entry = `
import * as THREE from 'three';
import { buildCourtScene } from ${JSON.stringify(join(root, 'packages/court3d/src/scene.ts'))};

const court = buildCourtScene('full', { view: 'top', scene: 'join' });
court.setJoin({ taken: 4, spots: false, mirror: false }, false);
court.update(${AT}, 0, 0);
court.scene.updateMatrixWorld(true);

const rackets = court.scene.children.filter((o) => o.name === 'padel_racket');
for (const c of court.scene.children) {
  if (c instanceof THREE.Light || c === rackets[${PLAYER}]) continue;
  c.visible = false;
}
const box = new THREE.Box3().setFromObject(rackets[${PLAYER}]);
const centre = box.getCenter(new THREE.Vector3());
const size = box.getSize(new THREE.Vector3());
const half = Math.max(size.x, size.z) * 0.62;

// The top view: screen right is -z, screen up is -x (join.ts).
const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 100);
camera.up.set(-1, 0, 0);
camera.position.set(centre.x, 30, centre.z);
camera.lookAt(centre.x, 0, centre.z);

const canvas = document.getElementById('c');
canvas.width = ${PX};
canvas.height = ${PX};
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(${PX}, ${PX}, false);
renderer.setClearColor(0x000000, 0);
renderer.render(court.scene, camera);
window.done = true;
`;

const bundle = await esbuild.build({
  stdin: { contents: entry, resolveDir: root, loader: 'js' },
  bundle: true,
  format: 'iife',
  write: false,
  alias: { three: join(root, 'node_modules/three') },
  logLevel: 'warning',
});

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({ viewport: { width: PX, height: PX } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setContent('<!doctype html><body style="margin:0"><canvas id="c"></canvas></body>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.waitForFunction('window.done', null, { timeout: 30000 });
  if (errors.length) throw new Error(errors.join('\n'));
  const data = await page.evaluate("document.getElementById('c').toDataURL('image/png')");
  const out = join(here, '..', 'assets', 'court', 'racket.png');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
}
