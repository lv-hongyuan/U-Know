const {
  getI18nData,
  t,
  onLocaleChange,
  getLocale,
  setLocale,
  getLocaleOptions,
  getLocaleLabel,
} = require("../../i18n/index");
const { isLoggedIn, setLocalUser, normalizeUser } = require("../../utils/user");

Page({
  data: {
    t: getI18nData(),
    locale: getLocale(),
    localeLabel: getLocaleLabel(getLocale()),
    localeOptions: getLocaleOptions(),
    showLocaleSheet: false,
    saving: false,
  },

  noop() {},

  onLoad() {
    this._offLocale = onLocaleChange(() => this.applyI18n());
  },

  onUnload() {
    if (this._offLocale) this._offLocale();
  },

  onShow() {
    this.applyI18n();
  },

  applyI18n() {
    const locale = getLocale();
    this.setData({
      t: getI18nData(),
      locale,
      localeLabel: getLocaleLabel(locale),
      localeOptions: getLocaleOptions(),
    });
    wx.setNavigationBarTitle({ title: t("nav.settings") });
  },

  onTapEditProfile() {
    wx.navigateTo({ url: "/pages/profile/edit" });
  },

  onTapLocale() {
    this.setData({ showLocaleSheet: true });
  },

  onCloseLocaleSheet() {
    this.setData({ showLocaleSheet: false });
  },

  async onPickLocale(e) {
    const code = e.currentTarget.dataset.code;
    if (!code) return;
    if (code === this.data.locale) {
      this.setData({ showLocaleSheet: false });
      return;
    }

    const prev = this.data.locale;
    setLocale(code);
    this.setData({ showLocaleSheet: false });

    if (!isLoggedIn()) {
      wx.showToast({ title: t("common.saved"), icon: "success" });
      return;
    }

    this.setData({ saving: true });
    try {
      const res = await wx.cloud.callFunction({
        name: "login",
        data: { type: "updateProfile", locale: code },
      });
      const result = res.result || {};
      if (!result.ok || !result.user) {
        throw new Error(result.message || result.error || t("common.saveFailed"));
      }
      const user = normalizeUser(result.user);
      if (user) setLocalUser(user);
      this.setData({ saving: false });
      wx.showToast({ title: t("common.saved"), icon: "success" });
    } catch (err) {
      console.error("save locale failed", err);
      setLocale(prev);
      this.setData({ saving: false });
      wx.showToast({ title: t("common.saveFailed"), icon: "none" });
    }
  },

  onTapAbout() {
    wx.navigateTo({ url: "/pages/about/index" });
  },

  onTapContact() {
    wx.navigateTo({ url: "/pages/contact/index" });
  },
});
