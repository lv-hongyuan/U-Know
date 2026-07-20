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
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3, hidden: false });
    }
  },

  applyI18n() {
    this.setData({ t: getI18nData() });
    wx.setNavigationBarTitle({ title: t("nav.message") });
  },
});
