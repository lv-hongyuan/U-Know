const zhHans = require("./locales/zh-Hans");
const zhHant = require("./locales/zh-Hant");
const en = require("./locales/en");
const ja = require("./locales/ja");
const ko = require("./locales/ko");

const LOCALE_KEY = "uknow_locale";
const DEFAULT_LOCALE = "zh-Hans";

const LOCALES = {
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
  en,
  ja,
  ko,
};

const LOCALE_OPTIONS = [
  { code: "zh-Hans", label: "简体中文" },
  { code: "zh-Hant", label: "繁体中文" },
  { code: "en", label: "English" },
  { code: "ja", label: "日语" },
  { code: "ko", label: "韩语" },
];

const listeners = [];
let currentLocale = DEFAULT_LOCALE;

function readStoredLocale() {
  try {
    const saved = wx.getStorageSync(LOCALE_KEY);
    if (saved && LOCALES[saved]) return saved;
  } catch (e) {
    // ignore
  }
  return DEFAULT_LOCALE;
}

function initLocale() {
  currentLocale = readStoredLocale();
  return currentLocale;
}

function getLocale() {
  return currentLocale;
}

function getLocaleOptions() {
  return LOCALE_OPTIONS.slice();
}

function getLocaleLabel(code) {
  const item = LOCALE_OPTIONS.find((x) => x.code === code);
  return item ? item.label : LOCALE_OPTIONS[0].label;
}

function getMessages(locale = currentLocale) {
  return LOCALES[locale] || LOCALES[DEFAULT_LOCALE];
}

function t(path, locale = currentLocale) {
  if (!path) return "";
  const messages = getMessages(locale);
  const parts = path.split(".");
  let cur = messages;
  for (let i = 0; i < parts.length; i += 1) {
    if (cur == null || typeof cur !== "object") return path;
    cur = cur[parts[i]];
  }
  return typeof cur === "string" ? cur : path;
}

function setLocale(locale) {
  if (!LOCALES[locale]) {
    return currentLocale;
  }
  if (locale === currentLocale) {
    try {
      wx.setStorageSync(LOCALE_KEY, locale);
    } catch (e) {
      // ignore
    }
    return currentLocale;
  }
  currentLocale = locale;
  try {
    wx.setStorageSync(LOCALE_KEY, locale);
  } catch (e) {
    // ignore
  }
  listeners.slice().forEach((fn) => {
    try {
      fn(locale);
    } catch (err) {
      console.warn("i18n listener error", err);
    }
  });
  return currentLocale;
}

function isValidLocale(code) {
  return !!(code && LOCALES[code]);
}

/** Apply locale from user profile (cloud source of truth after login). */
function applyUserLocale(userOrLocale) {
  const code =
    typeof userOrLocale === "string"
      ? userOrLocale
      : userOrLocale && userOrLocale.locale;
  if (!isValidLocale(code)) return getLocale();
  return setLocale(code);
}

function onLocaleChange(fn) {
  if (typeof fn !== "function") return () => {};
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx > -1) listeners.splice(idx, 1);
  };
}

/** Flat map for wxml: {{t.edit.avatar}} needs nested object — return full tree */
function getI18nData() {
  return getMessages();
}

/**
 * Attach i18n to a Page/Component instance.
 * Sets `t` on data and refreshes when locale changes.
 */
function bindI18n(ctx, extra = {}) {
  if (!ctx || typeof ctx.setData !== "function") return () => {};

  const apply = () => {
    const patch = { t: getI18nData(), ...extra(getLocale()) };
    ctx.setData(patch);
  };

  apply();
  return onLocaleChange(apply);
}

initLocale();

module.exports = {
  LOCALE_KEY,
  DEFAULT_LOCALE,
  LOCALE_OPTIONS,
  initLocale,
  getLocale,
  setLocale,
  isValidLocale,
  applyUserLocale,
  getLocaleOptions,
  getLocaleLabel,
  getMessages,
  getI18nData,
  t,
  onLocaleChange,
  bindI18n,
};
