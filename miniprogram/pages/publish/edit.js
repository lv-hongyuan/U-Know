const { getI18nData, t, onLocaleChange } = require("../../i18n/index");

Page({
  data: {
    t: getI18nData(),
    imagePath: "",
  },

  onLoad(options) {
    const src = options && options.src ? decodeURIComponent(options.src) : "";
    this.setData({ imagePath: src });
    this._offLocale = onLocaleChange(() => this.applyI18n());
  },

  onUnload() {
    if (this._offLocale) this._offLocale();
  },

  onShow() {
    this.applyI18n();
  },

  applyI18n() {
    this.setData({ t: getI18nData() });
    wx.setNavigationBarTitle({ title: t("nav.publishEdit") });
  },

  onTapCrop() {
    this.openCrop();
  },

  openCrop() {
    const src = this.data.imagePath;
    if (!src) return;

    if (typeof wx.cropImage !== "function") {
      wx.showModal({
        title: t("edit.cropUnsupportedTitle"),
        content: t("edit.cropUnsupportedContent"),
        showCancel: false,
      });
      return;
    }

    wx.cropImage({
      src,
      cropScale: "1:1",
      success: (res) => {
        const path = res && res.tempFilePath;
        if (!path) {
          wx.showToast({ title: t("edit.cropFailed"), icon: "none" });
          return;
        }
        this.setData({ imagePath: path });
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || "";
        if (msg.indexOf("cancel") > -1) return;
        wx.showToast({ title: t("edit.cropFailed"), icon: "none" });
      },
    });
  },

  onTapNext() {
    const path = this.data.imagePath;
    if (!path) {
      wx.showToast({ title: t("publish.pickFailed"), icon: "none" });
      return;
    }

    const app = getApp();
    if (app && app.globalData) {
      app.globalData.publishSession = {
        mode: "image",
        images: [path],
      };
    }
    wx.redirectTo({ url: "/pages/publish/compose?mode=image" });
  },
});
