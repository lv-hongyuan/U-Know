const { getI18nData, t, onLocaleChange } = require("../../i18n/index");

Page({
  data: {
    t: getI18nData(),
  },

  onLoad() {
    this._offLocale = onLocaleChange(() => this.applyI18n());
  },

  onUnload() {
    if (this._offLocale) this._offLocale();
  },

  onShow() {
    this.applyI18n();
    // 中间「+」不切换到此页；若被意外进入则回到首页
    wx.switchTab({ url: "/pages/home/index" });
  },

  applyI18n() {
    this.setData({ t: getI18nData() });
    wx.setNavigationBarTitle({ title: t("nav.publish") });
  },
});
