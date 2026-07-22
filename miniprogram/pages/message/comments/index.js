const { getI18nData, t, onLocaleChange } = require("../../../i18n/index");
const { isLoggedIn } = require("../../../utils/user");
const { formatCommentTime } = require("../../../utils/time");
const { markCategoryRead, listByCategory } = require("../../../utils/notify");
const { openUserProfile } = require("../../../utils/navigate");

const PAGE_SIZE = 20;
const DEFAULT_AVATAR = "/images/default-avatar.svg";

Page({
  data: {
    t: getI18nData(),
    list: [],
    loading: false,
    refreshing: false,
    hasMore: true,
    defaultAvatar: DEFAULT_AVATAR,
  },

  onLoad() {
    this._offLocale = onLocaleChange(() => {
      this.applyI18n();
      this.remapTimes();
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
      markCategoryRead("comment").catch(() => {});
    }
  },

  applyI18n() {
    this.setData({ t: getI18nData() });
    wx.setNavigationBarTitle({ title: t("nav.messageComments") });
  },

  actionText(notifyType) {
    if (notifyType === "reply") return t("message.repliedYourComment");
    return t("message.commentedYourPost");
  },

  mapItem(row) {
    const isReply = row.notifyType === "reply";
    return {
      id: row.id,
      notifyType: row.notifyType || "",
      fromOpenid: row.fromOpenid || "",
      fromNickName: row.fromNickName || t("common.wechatUser"),
      fromAvatarUrl: row.fromAvatarUrl || DEFAULT_AVATAR,
      postId: row.postId || "",
      commentId: row.commentId || "",
      parentId: row.parentId || "",
      commentMissing: !!row.commentMissing,
      originalText: isReply ? row.originalContent || "" : "",
      previewText: row.commentContent || "",
      postCover: row.postCover || "",
      postMissing: !!row.postMissing,
      actionText: this.actionText(row.notifyType),
      timeText: formatCommentTime(row.createdAt, t),
      createdAt: row.createdAt,
    };
  },

  remapTimes() {
    const list = (this.data.list || []).map((item) => ({
      ...item,
      actionText: this.actionText(item.notifyType),
      timeText: formatCommentTime(item.createdAt, t),
      fromNickName: item.fromNickName || t("common.wechatUser"),
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
        category: "comment",
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
      console.error("load comment notifies failed", err);
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
    const {
      postid,
      missing,
      commentid,
      parentid,
      commentmissing,
    } = e.currentTarget.dataset;
    if (!postid || Number(missing) === 1) {
      wx.showToast({ title: t("post.notFound"), icon: "none" });
      return;
    }
    let url = `/pages/post/detail?id=${encodeURIComponent(postid)}`;
    if (commentid && Number(commentmissing) !== 1) {
      url += `&commentId=${encodeURIComponent(commentid)}`;
      if (parentid) {
        url += `&parentId=${encodeURIComponent(parentid)}`;
      }
    }
    wx.navigateTo({ url });
  },
});
