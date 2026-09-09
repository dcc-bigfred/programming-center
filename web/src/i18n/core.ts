import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import de from "./de.json";
import en from "./en.json";
import pl from "./pl.json";

export const LANGUAGE_KEY = "programming-center.lang";
export const SUPPORTED_LANGUAGES = ["pl", "en", "de"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<Language, string> = {
  pl: "Polski",
  en: "English",
  de: "Deutsch",
};

function initialLanguage(): Language {
  const stored = localStorage.getItem(LANGUAGE_KEY);
  if (stored && (SUPPORTED_LANGUAGES as readonly string[]).includes(stored)) {
    return stored as Language;
  }
  const nav = navigator.language.toLowerCase();
  if (nav.startsWith("pl")) return "pl";
  if (nav.startsWith("de")) return "de";
  return "en";
}

void i18n.use(initReactI18next).init({
  resources: {
    pl: { translation: pl },
    en: { translation: en },
    de: { translation: de },
  },
  lng: initialLanguage(),
  fallbackLng: "pl",
  interpolation: { escapeValue: false },
});

export function setLanguage(lang: Language): void {
  localStorage.setItem(LANGUAGE_KEY, lang);
  void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
}

/** Translate a catalog key. Missing copy → undefined (never the raw key). */
export function optionalT(
  key?: string,
  params?: Record<string, string | number>,
): string | undefined {
  if (!key) return undefined;
  const lang = (i18n.resolvedLanguage ?? i18n.language ?? "pl").split("-")[0];
  let value = i18n.getResource(lang, "translation", key);
  if (typeof value !== "string" || value.length === 0) {
    value = i18n.getResource("pl", "translation", key);
  }
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  if (!params) {
    return value;
  }
  const interpolated = i18n.t(key, params);
  return typeof interpolated === "string" && interpolated.length > 0 ? interpolated : undefined;
}

document.documentElement.lang = initialLanguage();

export default i18n;
