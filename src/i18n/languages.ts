export const languages = {
  ja: { label: "日本語" },
  en: { label: "English" },
  ko: { label: "한국어" },
} as const;
export type Language = keyof typeof languages;
export const supportedLanguages = Object.keys(languages) as Language[];
export const fallbackLanguage: Language = "en";
export function isLanguage(value: unknown): value is Language {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(languages, value)
  );
}
export function environmentLanguage(locale: string): Language {
  const base = locale.toLowerCase().split("-")[0];
  return isLanguage(base) ? base : fallbackLanguage;
}
