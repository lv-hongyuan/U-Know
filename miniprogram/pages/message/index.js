const { getI18nData, t, onLocaleChange } = require("../../i18n/index");
const { isLoggedIn, getLocalUser, DEFAULT_AVATAR } = require("../../utils/user");
const {
  formatBadge,
  emptyCounts,
  refreshCategoryUnread,
} = require("../../utils/notify");
const {
  listConversations,
  setConversationFlags,
  unreadTotal,
} = require("../../utils/chat");
const {
  getCachedConversationList,
  setCachedConversationList,
  removeCachedConversation,
  upsertCachedConversation,
  clearConversationCache,
} = require("../../utils/chat-cache");
const { formatCommentTime } = require("../../utils/time");

function toBadgeMap(counts) {
  const c = counts || emptyCounts();
  return {
    comment: formatBadge(c.comment),
    like: formatBadge(c.like),
    follow: formatBadge(c.follow),
  };
}

function toTimeMs(value) {
  if (!value) return NaN;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const ts = new Date(value).getTime();
    return ts;
  }
  if (typeof value === "object") {
    if (value.$date) return new Date(value.$date).getTime();
    if (typeof value.seconds === "number") return value.seconds * 1000;
    if (typeof value._seconds === "number") return value._seconds * 1000;
  }
  const ts = new Date(value).getTime();
  return ts;
}

function previewLabel(last, tFn) {
  if (!last) return "";
  const type = last.type || "";
  const preview = String(last.preview || "");
  if (type === "image" || preview === "[image]" || preview.indexOf("[image]") === 0) {
    return tFn("chat.previewImage");
  }
  if (type === "video" || preview === "[video]" || preview.indexOf("[video]") === 0) {
    return tFn("chat.previewVideo");
  }
  if (type === "system" || preview === "[recalled]") return tFn("chat.recalled");
  return preview || "";
}

Page({
  data: {
    t: getI18nData(),
    navBarHeight: 64,
    refreshing: false,
    loadingConvs: false,
    badge: {
      comment: "",
      like: "",
      follow: "",
    },
    conversations: [],
    defaultAvatar: DEFAULT_AVATAR,
  },

  onLoad() {
    this.initNavMetrics();
    this._offLocale = onLocaleChange(() => {
      this.applyI18n();
      this.remapConversationTexts();
    });
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
      this.setData({ navBarHeight });
    } catch (e) {
      // keep default
    }
  },

  onUnload() {
    if (this._offLocale) this._offLocale();
    this.closeWatch();
  },

  onHide() {
    this.closeWatch();
  },

  onShow() {
    this.applyI18n();
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3, hidden: false });
    }
    this.loadBadges();
    this.loadConversations({ reset: true });
    this.openWatch();
  },

  applyI18n() {
    this.setData({ t: getI18nData() });
  },

  mapConversation(item) {
    const last = item.lastMessage;
    const createdAt = last && last.createdAt;
    const ts = toTimeMs(createdAt);
    return {
      ...item,
      peerAvatarUrl: item.peerAvatarUrl || DEFAULT_AVATAR,
      peerNickName: item.peerNickName || t("common.wechatUser"),
      previewText: previewLabel(last, t),
      timeText: Number.isFinite(ts) ? formatCommentTime(new Date(ts), t) : "",
      unreadText: formatBadge(item.unread),
    };
  },

  remapConversationTexts() {
    const conversations = (this.data.conversations || []).map((item) =>
      this.mapConversation(item)
    );
    this.setData({ conversations });
  },

  async loadBadges() {
    if (!isLoggedIn()) {
      this.setData({ badge: toBadgeMap(emptyCounts()) });
      this.updateTabChatBadge(0);
      return;
    }
    const [counts, chatRes] = await Promise.all([
      refreshCategoryUnread(),
      unreadTotal().catch(() => ({ ok: false, total: 0 })),
    ]);
    this.setData({ badge: toBadgeMap(counts) });
    this.updateTabChatBadge((chatRes && chatRes.total) || 0);
  },

  updateTabChatBadge(total) {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({
        messageBadge: formatBadge(total),
      });
    }
  },

  async loadConversations({ reset }) {
    if (!isLoggedIn()) {
      this.setData({ conversations: [], loadingConvs: false });
      return;
    }

    if (reset) {
      const cached = getCachedConversationList().map((c) => this.mapConversation(c));
      if (cached.length) {
        this.setData({ conversations: cached });
      }
      this.setData({ loadingConvs: !cached.length });
    }

    try {
      const result = await listConversations();
      if (!result.ok) throw new Error(result.error || "list failed");
      const list = (result.list || []).map((c) => this.mapConversation(c));
      setCachedConversationList(result.list || []);
      this.setData({ conversations: list, loadingConvs: false });

      const total = list.reduce((sum, c) => sum + (Number(c.unread) || 0), 0);
      this.updateTabChatBadge(total);
    } catch (err) {
      console.error("load conversations failed", err);
      this.setData({ loadingConvs: false });
      if (reset && !(this.data.conversations || []).length) {
        wx.showToast({ title: t("common.operationFailed"), icon: "none" });
      }
    }
  },

  openWatch() {
    this.closeWatch();
    if (!isLoggedIn() || !wx.cloud || !wx.cloud.database) return;
    const user = getLocalUser();
    const openid = user && user.openid;
    if (!openid) return;
    try {
      const db = wx.cloud.database();
      this._watcher = db
        .collection("conversations")
        .where({ memberIds: openid })
        .watch({
          onChange: () => {
            this.loadConversations({ reset: false });
            unreadTotal()
              .then((res) => this.updateTabChatBadge((res && res.total) || 0))
              .catch(() => {});
          },
          onError: (err) => {
            console.warn("conversation watch error", err);
          },
        });
    } catch (e) {
      console.warn("conversation watch init failed", e);
    }
  },

  closeWatch() {
    if (this._watcher && typeof this._watcher.close === "function") {
      try {
        this._watcher.close();
      } catch (e) {
        // ignore
      }
    }
    this._watcher = null;
  },

  async onRefresh() {
    this.setData({ refreshing: true });
    try {
      await Promise.all([
        this.loadBadges(),
        this.loadConversations({ reset: true }),
      ]);
    } catch (e) {
      // ignore
    } finally {
      this.setData({ refreshing: false });
    }
  },

  onTapModule(e) {
    const { path } = e.currentTarget.dataset;
    if (!path) return;
    wx.navigateTo({ url: path });
  },

  onTapConversation(e) {
    const id = e.currentTarget.dataset.id;
    const item = (this.data.conversations || []).find((c) => c.id === id);
    if (!item) return;
    const nick = encodeURIComponent(item.peerNickName || "");
    const avatar = encodeURIComponent(item.peerAvatarUrl || "");
    wx.navigateTo({
      url: `/pages/chat/room?id=${encodeURIComponent(item.id)}&peer=${encodeURIComponent(
        item.peerOpenid || ""
      )}&nick=${nick}&avatar=${avatar}`,
    });
  },

  async onConvAction(e) {
    const id = e.currentTarget.dataset.id;
    const action = e.currentTarget.dataset.action;
    await this.onSwipeAction({
      currentTarget: { dataset: { id } },
      detail: { action },
    });
  },

  async onSwipeAction(e) {
    const id = e.currentTarget.dataset.id;
    const action = e.detail && e.detail.action;
    if (!id || !action) return;

    try {
      if (action === "delete") {
        const res = await setConversationFlags(id, { delete: true });
        if (!res.ok) throw new Error(res.error || "delete failed");
        removeCachedConversation(id);
        clearConversationCache(id);
        this.setData({
          conversations: this.data.conversations.filter((c) => c.id !== id),
        });
      } else if (action === "hide") {
        const res = await setConversationFlags(id, { hide: true });
        if (!res.ok) throw new Error(res.error || "hide failed");
        removeCachedConversation(id);
        this.setData({
          conversations: this.data.conversations.filter((c) => c.id !== id),
        });
      } else if (action === "unread") {
        const res = await setConversationFlags(id, { markUnread: true });
        if (!res.ok) throw new Error(res.error || "unread failed");
        const conversations = this.data.conversations.map((c) => {
          if (c.id !== id) return c;
          const next = this.mapConversation({ ...c, unread: 1 });
          upsertCachedConversation({
            id: next.id,
            type: next.type,
            peerOpenid: next.peerOpenid,
            peerNickName: next.peerNickName,
            peerAvatarUrl: next.peerAvatarUrl,
            lastMessage: next.lastMessage,
            unread: 1,
            hidden: false,
            updatedAt: next.updatedAt,
          });
          return next;
        });
        this.setData({ conversations });
        const total = conversations.reduce((sum, c) => sum + (Number(c.unread) || 0), 0);
        this.updateTabChatBadge(total);
      }
    } catch (err) {
      console.error("swipe action failed", err);
      wx.showToast({ title: t("common.operationFailed"), icon: "none" });
    }
  },
});
