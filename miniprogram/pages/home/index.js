const { getI18nData, t, onLocaleChange } = require("../../i18n/index");
const { listFeed, mapFeedCards } = require("../../utils/post");
const { isLoggedIn } = require("../../utils/user");

const PAGE_SIZE = 10;

Page({
  data: {
    t: getI18nData(),
    feed: "plaza",
    list: [],
    loading: false,
    refreshing: false,
    hasMore: true,
    emptyText: "",
    statusBarHeight: 20,
    navBarHeight: 64,
    menuHeight: 32,
    menuTopGap: 4,
  },

  onLoad() {
    this.initNavMetrics();
    this._offLocale = onLocaleChange(() => {
      this.applyI18n();
      this.refreshEmptyText();
    });
    this.loadList({ reset: true });
  },

  initNavMetrics() {
    try {
      const windowInfo =
        typeof wx.getWindowInfo === "function"
          ? wx.getWindowInfo()
          : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      const statusBarHeight = windowInfo.statusBarHeight || 20;
      const menuTopGap = Math.max(0, (menu.top || statusBarHeight) - statusBarHeight);
      const menuHeight = menu.height || 32;
      const navBarHeight = statusBarHeight + menuTopGap * 2 + menuHeight;
      this.setData({
        statusBarHeight,
        navBarHeight,
        menuHeight,
        menuTopGap,
      });
    } catch (e) {
      // keep defaults
    }
  },

  onUnload() {
    if (this._offLocale) this._offLocale();
  },

  onShow() {
    this.applyI18n();
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0, hidden: false });
    }
  },

  applyI18n() {
    this.setData({ t: getI18nData() });
    this.refreshEmptyText();
  },

  refreshEmptyText() {
    const emptyText =
      this.data.feed === "following"
        ? t("feed.emptyFollowing")
        : t("feed.emptyPlaza");
    this.setData({ emptyText });
  },

  onSwitchFeed(e) {
    const feed = e.currentTarget.dataset.feed === "following" ? "following" : "plaza";
    if (feed === this.data.feed) return;
    if (feed === "following" && !isLoggedIn()) {
      wx.showToast({ title: t("profile.tapToLogin"), icon: "none" });
      return;
    }
    this.setData({ feed });
    this.refreshEmptyText();
    this.loadList({ reset: true });
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
    if (this.data.feed === "following" && !isLoggedIn()) {
      this._listReqId = (this._listReqId || 0) + 1;
      this.setData({ list: [], hasMore: false, loading: false });
      return;
    }

    const reqId = (this._listReqId = (this._listReqId || 0) + 1);
    const skip = reset ? 0 : this.data.list.length;
    if (reset) {
      this.setData({ list: [], hasMore: true, loading: true });
    } else {
      this.setData({ loading: true });
    }

    try {
      const result = await listFeed({
        feed: this.data.feed,
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
      console.error("home feed failed", err);
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
