// electron-builder afterSign hook: notarize the signed .app on OUR schedule.
//
// Why not electron-builder's own `notarize: true`: it shells out to
// `xcrun notarytool submit --wait`, one HTTPS long-poll that must survive for
// as long as Apple takes. On the first mac release run (operator-v0.2.5,
// 2026-09-07) Apple sat on the submission for ~55 minutes and then the GitHub
// macOS runner dropped its network for a moment; notarytool died with
// "The Internet connection appears to be offline", the job failed, and an hour
// of 10x-billed mac minutes was gone — while Apple, on its side, was still
// processing a perfectly good submission.
//
// Here: submit with --no-wait (retried), then ask `notarytool info` every
// 30 s, treating any transport failure as "ask again later", until Apple says
// Accepted (staple, done) or Invalid (fetch the log, fail loudly). The one
// thing that still ends the job early is the hard deadline below.
//
// Runs only on darwin, only when the five APPLE_/CSC values the workflow
// injects are present; otherwise it says so and lets the build continue
// unnotarized (a local `pnpm dist:dir` on a Mac, say).
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const POLL_MS = 30_000;
const DEADLINE_MS = 3 * 60 * 60 * 1000; // Apple's first-ever submissions can take an hour+
const SUBMIT_ATTEMPTS = 3;

const log = (msg) => console.log(`  • notarize        ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function xcrun(args, { json = false } = {}) {
  const r = spawnSync('xcrun', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '').trim();
  const err = (r.stderr || '').trim();
  if (r.error) return { ok: false, transport: true, out, err: String(r.error) };
  if (r.status !== 0) return { ok: false, transport: looksLikeTransport(err + out), out, err };
  if (!json) return { ok: true, out, err };
  try {
    return { ok: true, data: JSON.parse(out), out, err };
  } catch {
    return { ok: false, transport: true, out, err: `unparseable notarytool output: ${out.slice(0, 200)}` };
  }
}

function looksLikeTransport(text) {
  return /offline|NSURLErrorDomain|timed out|timeout|network|connection|ECONNRESET|EAI_AGAIN|503|502|TLS/i.test(text);
}

module.exports = async function notarizeMac(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    log('skipped — APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not all set');
    return;
  }
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  if (!fs.existsSync(appPath)) throw new Error(`notarize: ${appPath} does not exist`);

  const auth = ['--apple-id', APPLE_ID, '--team-id', APPLE_TEAM_ID, '--password', APPLE_APP_SPECIFIC_PASSWORD];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notarize-'));
  const zipPath = path.join(tmp, `${appName}.zip`);

  log(`zipping ${appPath}`);
  const ditto = spawnSync('ditto', ['-c', '-k', '--keepParent', appPath, zipPath], { encoding: 'utf8' });
  if (ditto.status !== 0) throw new Error(`notarize: ditto failed: ${ditto.stderr}`);

  let id = null;
  for (let attempt = 1; attempt <= SUBMIT_ATTEMPTS && !id; attempt++) {
    log(`submitting (attempt ${attempt}/${SUBMIT_ATTEMPTS})`);
    const r = xcrun(['notarytool', 'submit', zipPath, ...auth, '--no-wait', '--output-format', 'json'], { json: true });
    if (r.ok && r.data && r.data.id) {
      id = r.data.id;
    } else if (r.transport && attempt < SUBMIT_ATTEMPTS) {
      log(`submit failed on transport, retrying in ${POLL_MS / 1000}s: ${r.err.split('\n')[0]}`);
      await sleep(POLL_MS);
    } else {
      throw new Error(`notarize: submit failed: ${r.err || r.out}`);
    }
  }
  log(`submission id ${id} — polling every ${POLL_MS / 1000}s, deadline ${DEADLINE_MS / 60000} min`);

  const started = Date.now();
  let lastStatus = '';
  let transportFailures = 0;
  for (;;) {
    if (Date.now() - started > DEADLINE_MS) {
      throw new Error(`notarize: gave up after ${DEADLINE_MS / 60000} min; submission ${id} last status "${lastStatus}"`);
    }
    await sleep(POLL_MS);
    const r = xcrun(['notarytool', 'info', id, ...auth, '--output-format', 'json'], { json: true });
    if (!r.ok) {
      transportFailures++;
      log(`info failed (${transportFailures} so far, will keep asking): ${(r.err || r.out).split('\n')[0]}`);
      continue;
    }
    const status = r.data.status || '';
    if (status !== lastStatus) {
      log(`status ${status} (${Math.round((Date.now() - started) / 60000)} min)`);
      lastStatus = status;
    }
    if (status === 'Accepted') break;
    if (status === 'Invalid' || status === 'Rejected') {
      const l = xcrun(['notarytool', 'log', id, ...auth]);
      throw new Error(`notarize: Apple returned ${status} for ${id}\n${l.out || l.err}`);
    }
  }

  log(`stapling ${appPath}`);
  const staple = spawnSync('xcrun', ['stapler', 'staple', appPath], { encoding: 'utf8' });
  if (staple.status !== 0) throw new Error(`notarize: stapler failed: ${staple.stderr || staple.stdout}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  log('done');
};
