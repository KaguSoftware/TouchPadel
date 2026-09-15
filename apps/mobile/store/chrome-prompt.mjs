/**
 * Fill the App Store Connect browser-agent prompt from the listing docs.
 *
 *   node store/chrome-prompt.mjs
 *
 * `store/chrome-prompt.template.md` carries the steps; every piece of listing copy
 * in it is a `{{EN:Field}}` / `{{AR:Field}}` placeholder resolved from the fenced
 * blocks in `docs/store/app-store-listing.md` (the same blocks copy-check counts),
 * `{{REVIEW_NOTES}}` from `docs/store/app-store-submission.md`, and
 * `{{SHOTS:<locale>}}` from the rendered screenshots on disk. Output:
 * `docs/client/app-store-connect-chrome-prompt.md`.
 *
 * Hand-typing copy into a prompt is how a subtitle ends up 31 characters long;
 * generating it means the browser agent pastes exactly what was checked.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(HERE, '..', '..', '..');
const LISTING = path.join(ROOT, 'docs', 'store', 'app-store-listing.md');
const SUBMISSION = path.join(ROOT, 'docs', 'store', 'app-store-submission.md');
const TEMPLATE = path.join(HERE, 'chrome-prompt.template.md');
const OUT = path.join(ROOT, 'docs', 'client', 'app-store-connect-chrome-prompt.md');
const SHOTS = path.join(HERE, 'out', 'iphone-6.9');

/** `### Field — n / m` (or plain `### Field`) followed by a fenced block, per `## n · Section`. */
function fieldsBySection(md) {
  const sections = {};
  let current = null;
  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const section = /^## \d+ · (.+)$/.exec(lines[i]);
    if (section) {
      current = section[1].startsWith('English') ? 'EN' : section[1].startsWith('Arabic') ? 'AR' : null;
      continue;
    }
    const heading = /^### (.+?)(?: — .*)?$/.exec(lines[i]);
    if (!current || !heading) continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    if (!lines[j]?.startsWith('```')) continue;
    const body = [];
    for (j = j + 1; j < lines.length && !lines[j].startsWith('```'); j++) body.push(lines[j]);
    sections[`${current}:${heading[1].trim()}`] = body.join('\n');
  }
  return sections;
}

function reviewNotes(md) {
  const m = /### Review notes[^\n]*\n+```\n([\s\S]*?)\n```/.exec(md);
  if (!m) throw new Error('No review-notes block in app-store-submission.md');
  return m[1];
}

async function shots(locale) {
  const dir = path.join(SHOTS, locale);
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.png')).sort();
  if (files.length !== 6) throw new Error(`Expected 6 screenshots in ${dir}, found ${files.length}`);
  return files.map((f) => path.join(dir, f).replaceAll('/', '\\')).join('\n');
}

const fields = fieldsBySection(await fs.readFile(LISTING, 'utf8'));
const notes = reviewNotes(await fs.readFile(SUBMISSION, 'utf8'));
let out = await fs.readFile(TEMPLATE, 'utf8');

const missing = [];
out = out.replace(/\{\{(EN|AR):([^}]+)\}\}/g, (_, loc, field) => {
  // Copyright is written once, in the English section.
  const value = fields[`${loc}:${field}`] ?? (field === 'Copyright' ? fields[`EN:${field}`] : undefined);
  if (value === undefined) missing.push(`${loc}:${field}`);
  return value ?? '';
});
out = out.replace('{{REVIEW_NOTES}}', notes);
out = out.replace('{{SHOTS:en}}', await shots('en')).replace('{{SHOTS:ar}}', await shots('ar'));
if (missing.length) throw new Error(`Listing doc has no block for: ${missing.join(', ')}`);
if (/\{\{[^}]+\}\}/.test(out)) throw new Error(`Unfilled placeholder: ${/\{\{[^}]+\}\}/.exec(out)[0]}`);

await fs.writeFile(OUT, out);
console.log(`✓ wrote ${path.relative(ROOT, OUT)}`);
