import { en } from './catalogs/en';
import { ar } from './catalogs/ar';
import type { Messages } from './catalogs/en';

export type Locale = 'en' | 'ar';

/** Dotted key paths into the catalog, e.g. 'booking.confirmed' | 'degraded.bookingRefused'. */
export type MessageKey = Paths<Messages>;

type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

export const catalogs: Record<Locale, Messages> = { en, ar };

/** Values for {placeholder} interpolation. Numbers are stringified as-is (Western digits). */
export type TParams = Record<string, string | number>;

/**
 * Look up a message by dotted key and interpolate {placeholders}.
 * Missing keys fall back to English, then to the key itself (never throws).
 */
export function t(locale: Locale, key: MessageKey, params?: TParams): string {
  const template = lookup(catalogs[locale], key) ?? lookup(catalogs.en, key) ?? key;
  return interpolate(template, params);
}

/** Bind a locale once: const tr = makeT('ar'); tr('common.ok'). */
export function makeT(locale: Locale): (key: MessageKey, params?: TParams) => string {
  return (key, params) => t(locale, key, params);
}

function lookup(catalog: Messages, key: string): string | undefined {
  let node: unknown = catalog;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
