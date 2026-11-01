import { fontFaceCss } from '@touch/ui/fontFace';
import { padelPalette } from '@touch/ui/tokens/palette';
import { fontVars } from '@touch/ui/tokens/typography';
import { dirVars } from '@touch/ui/tokens/cafeBrand';
import { SITE_NIGHT_MODE, siteLightVars, siteNightVars, siteScaleVars } from '@touch/ui/tokens/site';
import { siteLostCss } from './lost.css';

/**
 * The sheet of `app/global-error.tsx` (F-43). That page replaces the root layout when the
 * layout itself throws, so none of the layout's inlined theme reaches it: it carries its own.
 *
 * Not `themeCss` (about 39 KB, every theme): the global error boundary is part of the app's
 * client JavaScript on every page, so it carries only what the error screen paints with, the
 * padel theme's tokens in light and night, the brand faces, the type tokens, and the error
 * screen's own rules (`siteLostCss`, shared with app/[locale]/error.tsx). Every value comes
 * from @touch/ui's token maps; none is spelled here. site-css.test.ts checks that every
 * token `siteLostCss` reads is declared, and the size.
 */
function block(selector: string, vars: Readonly<Record<string, string>>): string {
  const body = Object.entries(vars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  return `${selector} {\n${body}\n}`;
}

const SCOPE = `[data-theme='padel']`;

export const globalErrorCss: string = [
  fontFaceCss(),
  block(':root', { ...fontVars, ...dirVars }),
  block(SCOPE, { ...padelPalette, ...siteLightVars, ...siteScaleVars }),
  `${SCOPE}[data-mode='${SITE_NIGHT_MODE}'] {\n  color-scheme: dark;\n}`,
  block(`${SCOPE}[data-mode='${SITE_NIGHT_MODE}']`, siteNightVars),
  'html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }\nbody { margin: 0; }',
  siteLostCss,
].join('\n');
