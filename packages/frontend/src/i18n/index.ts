import dayjs from "dayjs";
import "dayjs/locale/en-gb";
import "dayjs/locale/es";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enGB from "./en-GB.json";
import esES from "./es-ES.json";

// Map i18n language codes to dayjs locale codes
const dayjsLocaleMap: Record<string, string> = {
  "es-ES": "es",
  "en-GB": "en-gb",
};

function syncDayjsLocale(lng: string) {
  const dayjsLocale = dayjsLocaleMap[lng] ?? "es";
  dayjs.locale(dayjsLocale);
}

const savedLanguage = localStorage.getItem("i18n-language") || "es-ES";

// Set initial dayjs locale
syncDayjsLocale(savedLanguage);

i18n.use(initReactI18next).init({
  resources: {
    "es-ES": { translation: esES },
    "en-GB": { translation: enGB },
  },
  lng: savedLanguage,
  fallbackLng: "es-ES",
  interpolation: {
    escapeValue: false,
  },
});

i18n.on("languageChanged", (lng) => {
  localStorage.setItem("i18n-language", lng);
  syncDayjsLocale(lng);
});

export default i18n;
