export type Locale = "en" | "ru";

export type LocaleInfo = {
  lang: string;
  ogLocale: string;
  path: string;
  alternate: Locale;
  alternateLabel: string;
};

export const locales: Record<Locale, LocaleInfo> = {
  en: { lang: "en", ogLocale: "en_US", path: "/", alternate: "ru", alternateLabel: "RU" },
  ru: { lang: "ru", ogLocale: "ru_RU", path: "/ru/", alternate: "en", alternateLabel: "EN" },
};
