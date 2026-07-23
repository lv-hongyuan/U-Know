const { getI18nData, t, onLocaleChange } = require("../../../i18n/index");
const { isLoggedIn } = require("../../../utils/user");
const { formatCommentTime } = require("../../../utils/time");
const { markCategoryRead, listByCategory } = require("../../../utils/notify");
const { follow, unfollow } = require("../../../utils/follow");
const { openUserProfile } = require("../../../utils/navigate");

const PAGE_SIZE = 20;
const DEFAULT_AVATAR = "/images/default-avatar.svg";

Page({
  data: {
    t: getI18nData(),
    list: [],
    loading: true,
    refreshing: false,
    hasMore: true,
    defaultAvatar: DEFAULT_AVATAR,
  },

  actingMap: {},

  onLoad() {
    this._offLocale = onLocaleChange(() => {
      this.applyI18n();
      this.remapTexts();
    });
    this.applyI18n();
    this.loadList({ reset: true });
  },

  onUnload() {
    if (this._offLocale) this._offLocale();
  },

  onShow() {
    this.applyI18n();
    if (isLoggedIn()) {
      markCategoryRead("follow").catch(() => {});
    }
  },

  applyI18n() {
    this.setData({ t: getI18nData() });
    wx.setNavigationBarTitle({ title: t("nav.messageFollows") });
  },

  actionBtnText(iFollow) {
    return iFollow ? t("relations.followed") : t("relations.followBack");
  },

  mapItem(row) {
    const iFollow = !!row.iFollow;
    return {
      id: row.id,
      fromOpenid: row.fromOpenid || "",
      fromNickName: row.fromNickName || t("common.wechatUser"),
      fromAvatarUrl: row.fromAvatarUrl || DEFAULT_AVATAR,
      actionText: t("message.followedYou"),
      iFollow,
      actionBtnText: this.actionBtnText(iFollow),
      timeText: formatCommentTime(row.createdAt, t),
      createdAt: row.createdAt,
    };
  },

  remapTexts() {
    const list = (this.data.list || []).map((item) => ({
      ...item,
      fromNickName: item.fromNickName || t("common.wechatUser"),
      actionText: t("message.followedYou"),
      actionBtnText: this.actionBtnText(!!item.iFollow),
      timeText: formatCommentTime(item.createdAt, t),
    }));
    this.setData({ list });
  },

  async loadList({ reset }) {
    if (!reset && (this.data.loading || !this.data.hasMore)) return;

    if (!isLoggedIn()) {
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
      const result = await listByCategory({
        category: "follow",
        skip,
        limit: PAGE_SIZE,
      });
      if (reqId !== this._listReqId) return;
      if (!result.ok) throw new Error(result.error || "list failed");
      const page = (result.list || []).map((row) => this.mapItem(row));
      this.setData({
        list: reset ? page : this.data.list.concat(page),
        hasMore: !!result.hasMore,
        loading: false,
        refreshing: false,
      });
    } catch (err) {
      if (reqId !== this._listReqId) return;
      console.error("load follow notifies failed", err);
      wx.showToast({ title: t("common.operationFailed"), icon: "none" });
      this.setData({
        loading: false,
        refreshing: false,
        ...(reset ? { list: [], hasMore: false } : {}),
      });
    }
  },

  async onRefresh() {
    this.setData({ refreshing: true });
    await this.loadList({ reset: true });
  },

  onLoadMore() {
    this.loadList({ reset: false });
  },

  onTapAvatar(e) {
    const openid = e.currentTarget.dataset.openid;
    openUserProfile({ openid, source: "notify" });
  },

  onTapItem(e) {
    const openid = e.currentTarget.dataset.openid;
    openUserProfile({ openid, source: "notify" });
  },

  async onTapAction(e) {
    const openid = e.currentTarget.dataset.openid;
    const ifollow = Number(e.currentTarget.dataset.ifollow) === 1;
    if (!openid || this.actingMap[openid]) return;
    if (!isLoggedIn()) {
      wx.showToast({ title: t("profile.tapToLogin"), icon: "none" });
      return;
    }

    this.actingMap[openid] = true;
    try {
      const result = ifollow ? await unfollow(openid) : await follow(openid);
      if (!result.ok) throw new Error(result.error || "action failed");
      const nextIFollow = !ifollow;
      const list = (this.data.list || []).map((item) => {
        if (item.fromOpenid !== openid) return item;
        return {
          ...item,
          iFollow: nextIFollow,
          actionBtnText: this.actionBtnText(nextIFollow),
        };
      });
      this.setData({ list });
    } catch (err) {
      console.error("toggle follow from notify failed", err);
      wx.showToast({ title: t("common.operationFailed"), icon: "none" });
    } finally {
      this.actingMap[openid] = false;
    }
  },
});
