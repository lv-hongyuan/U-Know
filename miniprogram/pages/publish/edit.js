const { getI18nData, t, onLocaleChange } = require("../../i18n/index");

Page({
  data: {
    t: getI18nData(),
    imagePath: "",
    cropped: false,
  },

  onLoad(options) {
    const src = options && options.src ? decodeURIComponent(options.src) : "";
    this.setData({ imagePath: src, cropped: false });
    this._offLocale = onLocaleChange(() => this.applyI18n());
    // 默认选用裁剪：进入页后自动调起一次
    if (src) {
      setTimeout(() => this.openCrop(true), 80);
    }
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
    this.openCrop(false);
  },

  openCrop(silentCancel) {
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
        this.setData({ imagePath: path, cropped: true });
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || "";
        if (msg.indexOf("cancel") > -1) {
          if (!silentCancel) return;
          return;
        }
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

    const goCompose = () => {
      const app = getApp();
      if (app && app.globalData) {
        app.globalData.publishSession = {
          mode: "image",
          images: [path],
        };
      }
      wx.redirectTo({ url: "/pages/publish/compose?mode=image" });
    };

    // 未裁剪过则先裁剪再进入
    if (!this.data.cropped && typeof wx.cropImage === "function") {
      wx.cropImage({
        src: path,
        cropScale: "1:1",
        success: (res) => {
          const next = (res && res.tempFilePath) || path;
          this.setData({ imagePath: next, cropped: true });
          const app = getApp();
          if (app && app.globalData) {
            app.globalData.publishSession = {
              mode: "image",
              images: [next],
            };
          }
          wx.redirectTo({ url: "/pages/publish/compose?mode=image" });
        },
        fail: (err) => {
          const msg = (err && err.errMsg) || "";
          if (msg.indexOf("cancel") > -1) return;
          goCompose();
        },
      });
      return;
    }

    goCompose();
  },
});
