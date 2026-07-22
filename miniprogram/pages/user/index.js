const { getI18nData, t, onLocaleChange } = require("../../i18n/index");
const { isLoggedIn, DEFAULT_AVATAR } = require("../../utils/user");
const {
  getPublicProfile,
  follow,
  unfollow,
} = require("../../utils/follow");
const { listUserPublic, mapFeedCards } = require("../../utils/post");

const PAGE_SIZE = 10;

Page({
  data: {
    t: getI18nData(),
    loading: true,
    refreshing: false,
    user: null,
    isSelf: false,
    following: false,
    followActing: false,
    list: [],
    listLoading: false,
    hasMore: true,
    defaultAvatar: DEFAULT_AVATAR,
    defaultSchoolLogo: "/images/school-badge.svg",
  },

  openid: "",

  onLoad(options) {
    this.openid = (options && options.openid) || "";
    this._offLocale = onLocaleChange(() => this.applyI18n());
    this.applyI18n();
    if (!this.openid) {
      wx.showToast({ title: t("user.notFound"), icon: "none" });
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 400);
      return;
    }
    this.bootstrap();
  },

  onUnload() {
    if (this._offLocale) this._offLocale();
  },

  onShow() {
    this.applyI18n();
  },

  applyI18n() {
    this.setData({ t: getI18nData() });
    wx.setNavigationBarTitle({ title: t("nav.userProfile") });
  },

  formatRegion(user) {
    if (!user) return "";
    const province = (user.hometownProvince || "").trim();
    const city = (user.hometownCity || "").trim();
    if (province && city) {
      return province === city ? province : `${province} ${city}`;
    }
    if (province || city) return province || city;
    const hometown = (user.hometown || "").trim();
    if (!hometown) return "";
    return hometown.replace(/-/g, " ");
  },

  async bootstrap() {
    this.setData({ loading: true });
    await Promise.all([
      this.loadProfile(),
      this.loadList({ reset: true }),
    ]);
    this.setData({ loading: false });
  },

  async loadProfile() {
    try {
      const result = await getPublicProfile(this.openid);
      if (!result.ok || !result.user) {
        throw new Error(result.error || "not found");
      }
      const user = {
        ...result.user,
        avatarUrl: result.user.avatarUrl || DEFAULT_AVATAR,
        regionText: this.formatRegion(result.user),
      };
      this.setData({
        user,
        isSelf: !!result.isSelf,
        following: !!result.following,
      });
    } catch (err) {
      console.error("load public profile failed", err);
      this.setData({ user: null });
      wx.showToast({ title: t("user.notFound"), icon: "none" });
    }
  },

  async loadList({ reset }) {
    if (!reset && (this.data.listLoading || !this.data.hasMore)) return;
    if (!this.openid) return;

    const reqId = (this._listReqId = (this._listReqId || 0) + 1);
    const skip = reset ? 0 : this.data.list.length;
    if (reset) {
      this.setData({ list: [], hasMore: true, listLoading: true });
    } else {
      this.setData({ listLoading: true });
    }

    try {
      const result = await listUserPublic({
        targetOpenid: this.openid,
        skip,
        limit: PAGE_SIZE,
      });
      if (reqId !== this._listReqId) return;
      if (!result.ok) throw new Error(result.error || "list failed");
      const cards = await mapFeedCards(result.list || []);
      if (reqId !== this._listReqId) return;
      this.setData({
        list: reset ? cards : this.data.list.concat(cards),
        hasMore: !!result.hasMore,
        listLoading: false,
        refreshing: false,
      });
    } catch (err) {
      if (reqId !== this._listReqId) return;
      console.error("load user posts failed", err);
      this.setData({
        listLoading: false,
        refreshing: false,
        ...(reset ? { list: [], hasMore: false } : {}),
      });
      wx.showToast({ title: t("common.operationFailed"), icon: "none" });
    }
  },

  async onRefresh() {
    this.setData({ refreshing: true });
    await Promise.all([
      this.loadProfile(),
      this.loadList({ reset: true }),
    ]);
    this.setData({ refreshing: false });
  },

  onLoadMore() {
    this.loadList({ reset: false });
  },

  onCopyShortId() {
    const shortId = this.data.user && this.data.user.shortId;
    if (!shortId) return;
    wx.setClipboardData({
      data: shortId,
      success: () => {
        wx.showToast({ title: t("user.idCopied"), icon: "none" });
      },
    });
  },

  onTapFollowers() {
    if (!this.data.isSelf) return;
    wx.navigateTo({ url: "/pages/relations/index?tab=followers" });
  },

  onTapFollowing() {
    if (!this.data.isSelf) return;
    wx.navigateTo({ url: "/pages/relations/index?tab=following" });
  },

  async onToggleFollow() {
    if (this.data.isSelf || this.data.followActing) return;
    if (!isLoggedIn()) {
      wx.showToast({ title: t("profile.tapToLogin"), icon: "none" });
      return;
    }
    this.setData({ followActing: true });
    const next = !this.data.following;
    try {
      const result = next
        ? await follow(this.openid)
        : await unfollow(this.openid);
      if (!result.ok) throw new Error(result.error || "follow failed");
      const user = this.data.user || {};
      const delta = next ? 1 : -1;
      this.setData({
        following: next,
        user: {
          ...user,
          followerCount: Math.max(0, (Number(user.followerCount) || 0) + delta),
        },
      });
    } catch (err) {
      console.error("toggle follow failed", err);
      wx.showToast({ title: t("common.operationFailed"), icon: "none" });
    } finally {
      this.setData({ followActing: false });
    }
  },

  onTapMessage() {
    if (!isLoggedIn()) {
      wx.showToast({ title: t("profile.tapToLogin"), icon: "none" });
      return;
    }
    const peer = this.openid || (this.data.user && this.data.user.openid);
    if (!peer) return;
    const nick = encodeURIComponent((this.data.user && this.data.user.nickName) || "");
    const avatar = encodeURIComponent((this.data.user && this.data.user.avatarUrl) || "");
    wx.navigateTo({
      url: `/pages/chat/room?peer=${encodeURIComponent(peer)}&nick=${nick}&avatar=${avatar}`,
    });
  },

  onTapPost(e) {
    const id = e.detail && e.detail.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/post/detail?id=${id}` });
  },
});
