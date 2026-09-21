import { createInstance, type i18n } from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "../i18n/locales/en";
import { ja } from "../i18n/locales/ja";
import { ko } from "../i18n/locales/ko";
import {
  environmentLanguage,
  fallbackLanguage,
  supportedLanguages,
  type Language,
} from "../i18n/languages";
import type { Message } from "../shared/messages";

export const resources = {
  en: { translation: en },
  ja: { translation: ja },
  ko: { translation: ko },
} satisfies Record<Language, { translation: Record<keyof typeof en, string> }>;
export function createI18n(language: Language = fallbackLanguage) {
  const instance = createInstance();
  void instance.use(initReactI18next).init({
    resources: structuredClone(resources),
    lng: language,
    supportedLngs: supportedLanguages,
    fallbackLng: fallbackLanguage,
    keySeparator: false,
    initAsync: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  return instance;
}
export function formatMessage(message: Message, instance: i18n): string {
  if (typeof message === "string") return message;
  if (message.kind === "joined")
    return message.parts
      .map((part) => formatMessage(part, instance))
      .join(message.separator);
  const params = Object.fromEntries(
    Object.entries(message.params).map(([key, value]) => [
      key,
      typeof value === "object" ? formatMessage(value, instance) : value,
    ]),
  );
  return instance.t(message.key, params);
}
export const i18nInstance = createI18n(
  environmentLanguage(
    typeof navigator === "undefined" ? "" : navigator.language,
  ),
);
