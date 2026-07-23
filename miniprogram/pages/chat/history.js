const { getI18nData, t, onLocaleChange } = require("../../i18n/index");
const { DEFAULT_AVATAR } = require("../../utils/user");

const VIEW_KEY = "uknow_chat_history_view";

Page({
  data: {
    t: getI18nData(),
    title: "",
    items: [],
    defaultAvatar: DEFAULT_AVATAR,
  },

  onLoad() {
    this._offLocale = onLocaleChange(() => this.applyI18n());
    this.applyI18n();
    let card = null;
    try {
      card = wx.getStorageSync(VIEW_KEY);
    } catch (e) {
      card = null;
    }
    if (!card || !Array.isArray(card.items) || !card.items.length) {
      wx.showToast({ title: t("common.noData"), icon: "none" });
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 400);
      return;
    }
    const items = card.items.map((item) => ({
      ...item,
      displayText: this.itemText(item),
    }));
    this.setData({
      title: card.title || t("chat.chatHistory"),
      items,
    });
    wx.setNavigationBarTitle({
      title: card.title || t("chat.chatHistory"),
    });
  },

  onUnload() {
    if (this._offLocale) this._offLocale();
    try {
      wx.removeStorageSync(VIEW_KEY);
    } catch (e) {
      // ignore
    }
  },

  applyI18n() {
    this.setData({ t: getI18nData() });
  },

  itemText(item) {
    if (!item) return "";
    if (item.type === "text") return item.content || "";
    if (item.type === "image") return t("chat.previewImage");
    if (item.type === "video") return t("chat.previewVideo");
    if (item.type === "post") return t("chat.previewPost");
    if (item.type === "history") return t("chat.previewHistory");
    return item.preview || item.content || "";
  },
});
