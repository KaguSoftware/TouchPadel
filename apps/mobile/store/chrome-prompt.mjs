/**
 * Fill the store-release browser-agent prompt from the listing docs.
 *
 *   node store/chrome-prompt.mjs
 *
 * `store/chrome-prompt-3.template.md` carries the steps for App Store Connect and Google Play Console.
 * Every piece of copy in it is a placeholder resolved from the docs, so the agent pastes exactly what
 * copy-check counted:
 *
 *   {{EN:Field}} / {{AR:Field}}            fenced blocks in docs/store/app-store-listing.md §1–2
 *   {{PLAY_EN:Field}} / {{PLAY_AR:Field}}  the same doc's Google Play sections (§4–5)
 *   {{REVIEW_NOTES}}                       docs/store/app-store-submission.md, "### Review notes"
 *   {{DOC:<path>#<heading start>}}         a whole "## " section of a doc, heading line dropped
 *   {{SHOTS:<size>:<locale>}}              the frames of frames.mjs as absolute paths under store/out
 *   {{FILE:<repo path>}}                   an absolute path on this machine
 *
 * A screenshot or file not on disk yet is listed anyway, with a warning here and a marker in the
 * prompt, so the prompt can be read before the captures exist; regenerate once they do.
 *
 * Output: docs/client/store-release-chrome-prompt.md and its iOS-only half,
 * docs/client/store-release-chrome-prompt-ios.md. (Prompts 1 and 2, App Store Connect only,
 * were retired with this one on 2026-11-17; git has them.)
 */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES } from './frames.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const LISTING = path.join(ROOT, 'docs', 'store', 'app-store-listing.md');
const SUBMISSION = path.join(ROOT, 'docs', 'store', 'app-store-submission.md');
const PROMPTS = [
  ['chrome-prompt-3.template.md', 'store-release-chrome-prompt.md'],
  // The iOS half alone, for an App Store Connect-only session.
  ['chrome-prompt-ios.template.md', 'store-release-chrome-prompt-ios.md'],
];
const OUT = path.join(HERE, 'out');

/** `### Field — n / m` (or plain `### Field`) followed by a fenced block, per `## n · Section`. */
function fieldsBySection(md) {
  const sections = {};
  let current = null;
  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const section = /^## \d+ · (.+)$/.exec(lines[i]);
    if (section) {
      const name = section[1];
      current = name.startsWith('English')
        ? 'EN'
        : name.startsWith('Arabic')
          ? 'AR'
          : name.startsWith('Google Play, English')
            ? 'PLAY_EN'
            : name.startsWith('Google Play, Arabic')
              ? 'PLAY_AR'
              : null;
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

/** The body of the `## ` section whose title starts with `start` (the heading line dropped). */
async function docSection(rel, start) {
  const md = (await fs.readFile(path.join(ROOT, rel), 'utf8')).replace(/\r\n/g, '\n');
  const lines = md.split('\n');
  const from = lines.findIndex((l) => l.startsWith('## ') && l.slice(3).startsWith(start));
  if (from === -1) throw new Error(`${rel}: no "## ${start}" section`);
  let to = lines.findIndex((l, i) => i > from && /^## /.test(l));
  if (to === -1) to = lines.length;
  return lines
    .slice(from + 1, to)
    .join('\n')
    .replace(/\n+---\s*$/, '')
    .trim();
}

const warnings = [];
const winPath = (p) => p.replaceAll('/', '\\');

function fileRef(rel) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) warnings.push(`not on disk yet: ${rel}`);
  return winPath(abs) + (existsSync(abs) ? '' : '   (NOT RENDERED YET)');
}

function shots(size, locale) {
  const conf = LOCALES[locale];
  if (!conf) throw new Error(`Unknown locale ${locale}`);
  return conf.frames
    .map((f) => fileRef(path.relative(ROOT, path.join(OUT, size, locale, `${f.slug}.png`))))
    .join('\n');
}

const fields = fieldsBySection(await fs.readFile(LISTING, 'utf8'));
const notes = reviewNotes(await fs.readFile(SUBMISSION, 'utf8'));

for (const [template, output] of PROMPTS) {
  let out = await fs.readFile(path.join(HERE, template), 'utf8');
  const missing = [];

  // Whole doc sections first: they can contain neither placeholders nor ``` that would confuse the rest.
  for (const m of [...out.matchAll(/\{\{DOC:([^#}]+)#([^}]+)\}\}/g)]) {
    out = out.replace(m[0], await docSection(m[1], m[2]));
  }
  out = out.replace(/\{\{(EN|AR|PLAY_EN|PLAY_AR):([^}]+)\}\}/g, (_, loc, field) => {
    // Copyright is written once, in the English section.
    const value = fields[`${loc}:${field}`] ?? (field === 'Copyright' ? fields[`EN:${field}`] : undefined);
    if (value === undefined) missing.push(`${loc}:${field}`);
    return value ?? '';
  });
  out = out.replaceAll('{{REVIEW_NOTES}}', notes);
  out = out.replace(/\{\{SHOTS:([^:}]+):([^}]+)\}\}/g, (_, size, locale) => shots(size, locale));
  out = out.replace(/\{\{FILE:([^}]+)\}\}/g, (_, rel) => fileRef(rel));
  if (missing.length) throw new Error(`${template}: listing doc has no block for: ${missing.join(', ')}`);
  if (/\{\{[^}]+\}\}/.test(out)) throw new Error(`${template}: unfilled placeholder ${/\{\{[^}]+\}\}/.exec(out)[0]}`);

  const dest = path.join(ROOT, 'docs', 'client', output);
  await fs.writeFile(dest, out);
  console.log(`✓ wrote ${path.relative(ROOT, dest)}`);
}

if (warnings.length) {
  console.warn(`\n${warnings.length} file(s) the prompt names are not on disk yet:\n  ${warnings.join('\n  ')}`);
  console.warn('Render them (store/README.md) and run this again before pasting the prompt.');
}
