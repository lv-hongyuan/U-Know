const {
  getI18nData,
  t,
  onLocaleChange,
} = require("../../i18n/index");
const { isLoggedIn, DEFAULT_AVATAR } = require("../../utils/user");
const { listRelations, follow, unfollow } = require("../../utils/follow");
const { openUserProfile } = require("../../utils/navigate");

const PAGE_SIZE = 20;

Page({
  data: {
    t: getI18nData(),
    tab: "following",
    keyword: "",
    searchPlaceholder: "",
    listTitle: "",
    emptyText: "",
    list: [],
    total: 0,
    hasMore: false,
    loading: false,
    refreshing: false,
    defaultAvatar: DEFAULT_AVATAR,
  },

  searchTimer: null,
  actingMap: {},

  onLoad(options) {
    const tab = this.normalizeTab(options && options.tab);
    this.setData({ tab });
    this._offLocale = onLocaleChange(() => {
      this.applyI18n();
      this.refreshListTexts();
    });
  },

  onUnload() {
    if (this._offLocale) this._offLocale();
    if (this.searchTimer) clearTimeout(this.searchTimer);
  },

  onShow() {
    if (!isLoggedIn()) {
      wx.showToast({ title: t("profile.tapToLogin"), icon: "none" });
      setTimeout(() => {
        wx.navigateBack({
          fail: () => wx.switchTab({ url: "/pages/profile/index" }),
        });
      }, 400);
      return;
    }
    this.applyI18n();
    this.loadList({ reset: true });
  },

  normalizeTab(tab) {
    if (tab === "followers" || tab === "mutual" || tab === "following") return tab;
    return "following";
  },

  applyI18n() {
    this.setData({ t: getI18nData() });
    wx.setNavigationBarTitle({ title: " " });
    this.refreshListTexts();
  },

  refreshListTexts() {
    const { tab, keyword } = this.data;
    let searchPlaceholder = t("relations.searchFollowing");
    let listTitle = t("relations.myFollowing");
    let emptyText = t("relations.emptyFollowing");

    if (tab === "followers") {
      searchPlaceholder = t("relations.searchFollowers");
      listTitle = t("relations.myFollowers");
      emptyText = t("relations.emptyFollowers");
    } else if (tab === "mutual") {
      searchPlaceholder = t("relations.searchMutual");
      listTitle = t("relations.myMutual");
      emptyText = t("relations.emptyMutual");
    }

    if (keyword) {
      emptyText = t("relations.emptySearch");
    }

    const list = (this.data.list || []).map((item) => ({
      ...item,
      actionText: this.actionTextOf(item),
    }));

    this.setData({ searchPlaceholder, listTitle, emptyText, list });
  },

  actionTextOf(item) {
    if (!item) return "";
    if (item.relation === "mutual" || (item.iFollow && item.theyFollow)) {
      return t("relations.mutual");
    }
    if (item.iFollow) return t("relations.followed");
    return t("relations.followBack");
  },

  onSwitchTab(e) {
    const tab = this.normalizeTab(e.currentTarget.dataset.tab);
    if (tab === this.data.tab) return;
    this.setData({ tab, keyword: "" });
    this.refreshListTexts();
    this.loadList({ reset: true });
  },

  onSearchInput(e) {
    const keyword = e.detail.value || "";
    this.setData({ keyword });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.refreshListTexts();
      this.loadList({ reset: true });
    }, 320);
  },

  onSearchConfirm() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.refreshListTexts();
    this.loadList({ reset: true });
  },

  onClearSearch() {
    this.setData({ keyword: "" });
    this.refreshListTexts();
    this.loadList({ reset: true });
  },

  onReachBottom() {
    if (this.data.loading || !this.data.hasMore) return;
    this.loadList({ reset: false });
  },

  onTapAvatar(e) {
    const openid = e.currentTarget.dataset.openid;
    openUserProfile({ openid, source: "default" });
  },

  async onRefresh() {
    this.setData({ refreshing: true });
    await this.loadList({ reset: true });
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
      const result = await listRelations({
        tab: this.data.tab,
        keyword: (this.data.keyword || "").trim(),
        skip,
        limit: PAGE_SIZE,
      });

      if (reqId !== this._listReqId) return;
      if (!result.ok) {
        throw new Error(result.error || "list failed");
      }

      const incoming = (result.list || []).map((item) => ({
        ...item,
        avatarUrl: item.avatarUrl || DEFAULT_AVATAR,
        actionText: this.actionTextOf(item),
      }));

      this.setData({
        list: reset ? incoming : this.data.list.concat(incoming),
        total: result.total || 0,
        hasMore: !!result.hasMore,
        loading: false,
        refreshing: false,
      });
      this.refreshListTexts();
    } catch (err) {
      if (reqId !== this._listReqId) return;
      console.error("load relations failed", err);
      this.setData({
        loading: false,
        refreshing: false,
        ...(reset ? { list: [], hasMore: false } : {}),
      });
      wx.showToast({ title: t("common.operationFailed"), icon: "none" });
    }
  },

  async onTapAction(e) {
    const openid = e.currentTarget.dataset.openid;
    const iFollow = Number(e.currentTarget.dataset.ifollow) === 1;
    if (!openid || this.actingMap[openid]) return;

    this.actingMap[openid] = true;
    try {
      const result = iFollow ? await unfollow(openid) : await follow(openid);
      if (!result.ok) {
        throw new Error(result.error || "action failed");
      }

      const prevLen = this.data.list.length;
      const list = this.data.list
        .map((item) => {
          if (item.openid !== openid) return item;
          const nextIFollow = !iFollow;
          const theyFollow = !!item.theyFollow;
          let relation = "none";
          if (nextIFollow && theyFollow) relation = "mutual";
          else if (nextIFollow) relation = "following";
          else if (theyFollow) relation = "follower";
          const next = {
            ...item,
            iFollow: nextIFollow,
            relation,
          };
          next.actionText = this.actionTextOf(next);
          return next;
        })
        .filter((item) => {
          if (this.data.tab === "following" && !item.iFollow) return false;
          if (this.data.tab === "mutual" && item.relation !== "mutual") return false;
          return true;
        });

      const removed = prevLen - list.length;
      this.setData({
        list,
        total: Math.max(0, this.data.total - removed),
      });
    } catch (err) {
      console.error("toggle follow failed", err);
      wx.showToast({ title: t("common.operationFailed"), icon: "none" });
    } finally {
      this.actingMap[openid] = false;
    }
  },
});
