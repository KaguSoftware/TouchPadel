// Windows signing hook (win.signtoolOptions.sign): signs ONE file in place with
// SSL.com CodeSignTool (eSigner cloud signing). Wired by electron-builder.config.cjs
// only when the WIN_ESIGNER_* env is complete, or in dry-run mode.
//
// electron-builder calls this once per file per hash algorithm (config.hash;
// the config pins ['sha256'], so once per file). eSigner bills per signing, so
// do not add sha1 back. `configuration.path` is the file; the hook signs it in
// place (no resultOutputPath), which is what -override does.
//
// Why java directly and not CodeSignTool.bat: the bat is a cmd.exe wrapper, so
// a password with a quote or % would be re-parsed by cmd (and Node refuses to
// spawn .bat without a shell). The Windows zip bundles its own JDK, so we run
// that java against the jar. cwd must be the tool folder: the jar reads
// .\conf\code_sign_tool.properties relative to it.
//
// CodeSignTool exits 0 even when it fails (a missing file or a bad OTP still
// returns 0), so the exit code proves nothing: we scan its output for errors
// and then ask Windows whether the file now carries a signature.
//
// WIN_SIGN_DRY_RUN=1: sign nothing, log "would sign <path> <bytes>" to stdout
// and, when WIN_SIGN_DRY_RUN_LOG is set, append it to that file. Used to count
// the signings one release costs.

'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const env = (key) => (process.env[key] ?? '').trim();

/** Finds java.exe + the jar inside the unzipped CodeSignTool folder. */
function locateTool(dir) {
  if (!dir || !fs.existsSync(dir)) {
    throw new Error(`CODESIGNTOOL_PATH is not a folder: "${dir}" (unzip CodeSignTool-vX-windows.zip there)`);
  }
  const jdk = fs.readdirSync(dir).find((n) => /^jdk-/.test(n));
  const jarDir = path.join(dir, 'jar');
  const jar =
    fs.existsSync(jarDir) && fs.readdirSync(jarDir).find((n) => /^code_sign_tool-.*\.jar$/.test(n));
  if (!jdk || !jar) {
    throw new Error(`CODESIGNTOOL_PATH "${dir}" has no jdk-*/ folder or jar/code_sign_tool-*.jar`);
  }
  return { java: path.join(dir, jdk, 'bin', 'java.exe'), jar: path.join(jarDir, jar) };
}

/** Throws unless the file carries an Authenticode signature. */
function assertSigned(file) {
  const r = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$s = Get-AuthenticodeSignature -LiteralPath $env:SIGN_CHECK_FILE; ' +
        'Write-Output ("{0}|{1}" -f $s.Status, $s.SignerCertificate.Subject)',
    ],
    { encoding: 'utf8', env: { ...process.env, SIGN_CHECK_FILE: file } },
  );
  const [status, subject] = (r.stdout ?? '').trim().split('|');
  if (r.status !== 0 || !subject || status === 'NotSigned' || status === 'HashMismatch') {
    throw new Error(`sign-win: ${file} is not signed after CodeSignTool ran (status: ${status || r.stderr})`);
  }
  console.log(`sign-win: signed ${path.basename(file)} (${status}) by ${subject}`);
}

/** @param {{ path: string }} configuration */
exports.default = async function signWin(configuration) {
  const file = configuration.path;

  if (env('WIN_SIGN_DRY_RUN') === '1') {
    const line = `would sign ${file} (${fs.statSync(file).size} bytes, hash ${configuration.hash})`;
    console.log(`sign-win [dry run]: ${line}`);
    if (env('WIN_SIGN_DRY_RUN_LOG')) fs.appendFileSync(env('WIN_SIGN_DRY_RUN_LOG'), `${line}\n`);
    return;
  }

  const dir = env('CODESIGNTOOL_PATH');
  const { java, jar } = locateTool(dir);
  // Secrets go in argv only (no shell string, never logged).
  const args = [
    '-jar',
    jar,
    'sign',
    `-username=${env('WIN_ESIGNER_USERNAME')}`,
    `-password=${env('WIN_ESIGNER_PASSWORD')}`,
    `-credential_id=${env('WIN_ESIGNER_CREDENTIAL_ID')}`,
    `-totp_secret=${env('WIN_ESIGNER_TOTP_SECRET')}`,
    `-input_file_path=${file}`,
    '-override',
  ];
  const r = spawnSync(java, args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  // Output can echo arguments on some failures: redact before it reaches a log.
  const secrets = ['WIN_ESIGNER_PASSWORD', 'WIN_ESIGNER_TOTP_SECRET', 'WIN_ESIGNER_USERNAME'].map(env).filter((v) => v.length >= 4);
  const safe = secrets.reduce((s, v) => s.split(v).join('***'), out).trim();
  if (r.error || r.status !== 0 || /\b(error|exception)\b/i.test(safe)) {
    throw new Error(`sign-win: CodeSignTool failed for ${file} (exit ${r.status}): ${r.error?.message ?? safe}`);
  }
  assertSigned(file);
};
