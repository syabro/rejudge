import type { Locale } from "../locales";
import { ru } from "./ru";

const dictionaries: Partial<Record<Locale, Record<string, string>>> = { ru };

const warned = new Set<string>();

function warnMissing(locale: Locale, key: string) {
  const seen = `${locale}:${key}`;
  if (warned.has(seen)) return;

  warned.add(seen);
  console.warn(`[i18n] no ${locale} translation for "${key}" — falling back to English`);
}

/**
 * English is written at the call site and always wins as the fallback:
 * an untranslated string renders in English instead of breaking the page.
 */
export function translator(locale: Locale) {
  const dictionary = dictionaries[locale];

  return (key: string, en: string): string => {
    if (!dictionary) return en;

    const translated = dictionary[key];
    if (translated === undefined) {
      warnMissing(locale, key);
      return en;
    }

    return translated;
  };
}
