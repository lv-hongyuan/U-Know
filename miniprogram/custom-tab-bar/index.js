const { t, onLocaleChange, getI18nData } = require("../i18n/index");
const { isLoggedIn } = require("../utils/user");

function buildList() {
  return [
    {
      pagePath: "/pages/home/index",
      text: t("tab.home"),
      icon: "/images/tab/home.svg",
      iconActive: "/images/tab/home-active.svg",
    },
    {
      pagePath: "/pages/explore/index",
      text: t("tab.explore"),
      icon: "/images/tab/shop.svg",
      iconActive: "/images/tab/shop-active.svg",
    },
    {
      pagePath: "/pages/publish/index",
      text: t("tab.publish"),
      isPublish: true,
    },
    {
      pagePath: "/pages/message/index",
      text: t("tab.message"),
      icon: "/images/tab/message.svg",
      iconActive: "/images/tab/message-active.svg",
    },
    {
      pagePath: "/pages/profile/index",
      text: t("tab.profile"),
      icon: "/images/tab/profile.svg",
      iconActive: "/images/tab/profile-active.svg",
    },
  ];
}

Component({
  data: {
    selected: 0,
    hidden: false,
    list: buildList(),
    showPublishSheet: false,
    t: getI18nData(),
    messageBadge: "",
  },

  lifetimes: {
    attached() {
      this._offLocale = onLocaleChange(() => {
        this.setData({ list: buildList(), t: getI18nData() });
      });
    },
    detached() {
      if (this._offLocale) this._offLocale();
    },
  },

  pageLifetimes: {
    show() {
      this.setData({ list: buildList(), t: getI18nData() });
    },
  },

  methods: {
    noop() {},

    onTap(e) {
      const { index, path, publish } = e.currentTarget.dataset;

      if (publish) {
        if (!isLoggedIn()) {
          wx.showToast({ title: t("profile.tapToLogin"), icon: "none" });
          return;
        }
        this.setData({ showPublishSheet: true, t: getI18nData() });
        return;
      }

      wx.switchTab({ url: path });
      this.setData({ selected: index });
    },

    onClosePublishSheet() {
      this.setData({ showPublishSheet: false });
    },

    onPickAlbum() {
      this.setData({ showPublishSheet: false });
      this.pickMedia(["album"]);
    },

    onPickCamera() {
      this.setData({ showPublishSheet: false });
      this.pickMedia(["camera"]);
    },

    onPickText() {
      this.setData({ showPublishSheet: false });
      const app = getApp();
      if (app && app.globalData) {
        app.globalData.publishSession = {
          mode: "text",
          images: [],
        };
      }
      wx.navigateTo({ url: "/pages/publish/compose?mode=text" });
    },

    pickMedia(sourceType) {
      wx.chooseMedia({
        count: 1,
        mediaType: ["image"],
        sourceType,
        sizeType: ["original", "compressed"],
        success: (res) => {
          const file = res.tempFiles && res.tempFiles[0];
          if (!file || !file.tempFilePath) {
            wx.showToast({ title: t("publish.pickFailed"), icon: "none" });
            return;
          }
          const src = encodeURIComponent(file.tempFilePath);
          wx.navigateTo({ url: `/pages/publish/edit?src=${src}` });
        },
        fail: (err) => {
          const msg = (err && err.errMsg) || "";
          if (msg.indexOf("cancel") > -1) return;
          wx.showToast({ title: t("publish.pickFailed"), icon: "none" });
        },
      });
    },
  },
});
