const { getI18nData, t, onLocaleChange } = require("../../i18n/index");
const { listFeed, mapFeedCards } = require("../../utils/post");

const PAGE_SIZE = 10;

Page({
  data: {
    t: getI18nData(),
    list: [],
    loading: false,
    refreshing: false,
    hasMore: true,
  },

  onLoad() {
    this._offLocale = onLocaleChange(() => this.applyI18n());
    this.loadList({ reset: true });
  },

  onUnload() {
    if (this._offLocale) this._offLocale();
  },

  onShow() {
    this.applyI18n();
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1, hidden: false });
    }
  },

  applyI18n() {
    this.setData({ t: getI18nData() });
    wx.setNavigationBarTitle({ title: " " });
  },

  onRefresh() {
    this.setData({ refreshing: true });
    this.loadList({ reset: true }).finally(() => {
      this.setData({ refreshing: false });
    });
  },

  onLoadMore() {
    if (this.data.loading || !this.data.hasMore) return;
    this.loadList({ reset: false });
  },

  async loadList({ reset }) {
    if (!reset && (this.data.loading || !this.data.hasMore)) return;

    const reqId = (this._listReqId = (this._listReqId || 0) + 1);
    const skip = reset ? 0 : this.data.list.length;
    if (reset) {
      this.setData({ list: [], hasMore: true, loading: true });
    } else {
      this.setData({ loading: true });
    }

    try {
      const result = await listFeed({
        feed: "plaza",
        skip,
        limit: PAGE_SIZE,
      });
      if (reqId !== this._listReqId) return;
      if (!result.ok) {
        throw new Error(result.error || "list failed");
      }
      const cards = await mapFeedCards(result.list || []);
      if (reqId !== this._listReqId) return;
      this.setData({
        list: reset ? cards : this.data.list.concat(cards),
        hasMore: !!result.hasMore,
        loading: false,
      });
    } catch (err) {
      if (reqId !== this._listReqId) return;
      console.error("explore feed failed", err);
      this.setData({
        loading: false,
        ...(reset ? { list: [], hasMore: false } : {}),
      });
      wx.showToast({ title: t("common.operationFailed"), icon: "none" });
    }
  },

  onTapPost(e) {
    const id = e.detail && e.detail.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/post/detail?id=${id}` });
  },
});
