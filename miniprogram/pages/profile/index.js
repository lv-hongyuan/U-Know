const {
  getLocalUser,
  setLocalUser,
  isLoggedIn,
  displayNickName,
  displayAvatar,
  normalizeUser,
  DEFAULT_AVATAR,
  defaultNickName,
} = require("../../utils/user");
const { getI18nData, t, onLocaleChange, applyUserLocale, getLocale } = require("../../i18n/index");
const { listMine, listCollected, mapFeedCards } = require("../../utils/post");
const { getDrafts } = require("../../utils/draft");

const PAGE_SIZE = 10;

Page({
  data: {
    t: getI18nData(),
    loggedIn: false,
    nickName: defaultNickName(),
    avatarUrl: DEFAULT_AVATAR,
    shortId: "",
    bio: "",
    schoolLabel: "",
    schoolLogoUrl: "",
    showSchool: true,
    defaultSchoolLogo: "/images/school-badge.svg",
    followerCount: 0,
    followingCount: 0,
    likeCollectCount: 0,
    showLogin: false,
    submitting: false,
    mainTab: "posts",
    postFilter: "public",
    publicCount: 0,
    privateCount: 0,
    draftCount: 0,
    draftList: [],
    list: [],
    loading: false,
    refreshing: false,
    hasMore: true,
    emptyText: "",
  },

  noop() {},

  onLoad() {
    this._offLocale = onLocaleChange(() => {
      this.applyI18n();
      this.syncUser();
      this.refreshEmptyText();
    });
  },

  onUnload() {
    if (this._offLocale) this._offLocale();
  },

  onShow() {
    this.applyI18n();
    this.setTabBarHidden(this.data.showLogin);
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 4 });
    }
    this.syncUser();

    const loggedIn = isLoggedIn();
    const loginChanged =
      this._wasLoggedIn !== undefined && this._wasLoggedIn !== loggedIn;
    this._wasLoggedIn = loggedIn;

    if (!loggedIn) {
      this._listLoaded = false;
      this.setData({
        list: [],
        draftList: [],
        draftCount: 0,
        publicCount: 0,
        privateCount: 0,
        hasMore: false,
      });
      return;
    }

    // 草稿本地同步；资料计数后台更新；列表不因切 Tab 反复 reset
    this.refreshDrafts();
    this.refreshUserFromCloud();

    const isDraftTab =
      this.data.mainTab === "posts" && this.data.postFilter === "draft";
    if (isDraftTab) return;

    if (!this._listLoaded || loginChanged) {
      this.loadList({ reset: true });
    }
  },

  onPullRefresh() {
    this.setData({ refreshing: true });
    this.syncUser();
    Promise.resolve(this.refreshUserFromCloud())
      .then(() => {
        if (!isLoggedIn()) {
          this.setData({
            list: [],
            draftList: [],
            draftCount: 0,
            publicCount: 0,
            privateCount: 0,
            hasMore: false,
          });
          return;
        }
        this.refreshDrafts();
        return this.loadList({ reset: true });
      })
      .finally(() => {
        this.setData({ refreshing: false });
      });
  },

  setTabBarHidden(hidden) {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ hidden: !!hidden });
    }
  },

  applyI18n() {
    this.setData({ t: getI18nData() });
    wx.setNavigationBarTitle({ title: " " });
    this.refreshEmptyText();
  },

  refreshEmptyText() {
    let emptyText = "";
    if (this.data.mainTab === "collect") {
      emptyText = t("profile.emptyCollect");
    } else if (this.data.postFilter === "private") {
      emptyText = t("profile.emptyPrivate");
    } else if (this.data.postFilter === "draft") {
      emptyText = t("profile.emptyDraft");
    } else {
      emptyText = t("profile.emptyPublic");
    }
    this.setData({ emptyText });
  },

  applyUser(user) {
    const normalized = normalizeUser(user);
    if (normalized) {
      applyUserLocale(normalized);
      let schoolLabel = "";
      if (normalized.schoolName) {
        schoolLabel = normalized.schoolCampus
          ? `${normalized.schoolName} · ${normalized.schoolCampus}`
          : normalized.schoolName;
      }
      this.setData({
        loggedIn: true,
        nickName: displayNickName(normalized),
        avatarUrl: displayAvatar(normalized),
        shortId: normalized.shortId || "",
        bio: normalized.bio || "",
        schoolLabel,
        schoolLogoUrl: normalized.schoolLogoUrl || "",
        showSchool: normalized.showSchool !== false,
        followerCount: normalized.followerCount || 0,
        followingCount: normalized.followingCount || 0,
        likeCollectCount: normalized.likeCollectCount || 0,
      });
      return;
    }

    this.setData({
      loggedIn: false,
      nickName: defaultNickName(),
      avatarUrl: DEFAULT_AVATAR,
      shortId: "",
      bio: "",
      schoolLabel: "",
      schoolLogoUrl: "",
      showSchool: true,
      followerCount: 0,
      followingCount: 0,
      likeCollectCount: 0,
    });
  },

  onCopyShortId() {
    const shortId = this.data.shortId;
    if (!shortId) return;
    wx.setClipboardData({
      data: shortId,
      success: () => {
        wx.showToast({ title: t("user.idCopied"), icon: "none" });
      },
    });
  },

  syncUser() {
    this.applyUser(getLocalUser());
  },

  refreshDrafts() {
    const drafts = getDrafts();
    const draftList = drafts.map((d) => ({
      id: d.id,
      title: d.title || "",
      cover: d.type === "image" && d.images && d.images[0] ? d.images[0] : "",
    }));
    this.setData({
      draftList,
      draftCount: drafts.length,
    });
  },

  async refreshUserFromCloud() {
    if (!isLoggedIn()) return;

    try {
      const res = await wx.cloud.callFunction({
        name: "login",
        data: { type: "getProfile" },
      });
      const result = res.result || {};
      if (!result.ok) return;

      const normalized = normalizeUser(result.user);
      if (normalized) {
        setLocalUser(normalized);
        this.applyUser(normalized);
        return;
      }

      setLocalUser(null);
      this.applyUser(null);
    } catch (e) {
      console.warn("refreshUserFromCloud failed", e);
    }
  },

  onSwitchMainTab(e) {
    const tab = e.currentTarget.dataset.tab === "collect" ? "collect" : "posts";
    if (tab === this.data.mainTab) return;
    // 先切 Tab UI，再骨架屏 + 请求
    this.setData({ mainTab: tab });
    this.refreshEmptyText();
    if (tab === "posts") this.refreshDrafts();
    this.loadList({ reset: true });
  },

  onSwitchPostFilter(e) {
    const filter = e.currentTarget.dataset.filter;
    if (!["public", "private", "draft"].includes(filter)) return;
    if (filter === this.data.postFilter) return;
    // 先切筛选 UI，再骨架屏 + 请求
    this.setData({ postFilter: filter });
    this.refreshEmptyText();
    if (filter === "draft") {
      this._listReqId = (this._listReqId || 0) + 1;
      this.refreshDrafts();
      this.setData({ list: [], loading: false, hasMore: false });
      return;
    }
    this.loadList({ reset: true });
  },

  onReachBottomList() {
    if (this.data.mainTab === "posts" && this.data.postFilter === "draft") return;
    if (this.data.loading || !this.data.hasMore) return;
    this.loadList({ reset: false });
  },

  async loadList({ reset }) {
    if (!isLoggedIn()) return;
    if (this.data.mainTab === "posts" && this.data.postFilter === "draft") {
      this.refreshDrafts();
      return;
    }
    if (!reset && (this.data.loading || !this.data.hasMore)) return;

    const reqId = (this._listReqId = (this._listReqId || 0) + 1);
    const skip = reset ? 0 : this.data.list.length;
    if (reset) {
      this.setData({ list: [], hasMore: true, loading: true });
    } else {
      this.setData({ loading: true });
    }

    try {
      let result;
      if (this.data.mainTab === "collect") {
        result = await listCollected({ skip, limit: PAGE_SIZE });
      } else {
        result = await listMine({
          visibility: this.data.postFilter === "private" ? "private" : "public",
          skip,
          limit: PAGE_SIZE,
        });
      }

      if (reqId !== this._listReqId) return;
      if (!result.ok) {
        throw new Error(result.error || "list failed");
      }

      const cards = await mapFeedCards(result.list || []);
      if (reqId !== this._listReqId) return;

      const patch = {
        list: reset ? cards : this.data.list.concat(cards),
        hasMore: !!result.hasMore,
        loading: false,
      };
      if (this.data.mainTab === "posts") {
        if (typeof result.publicCount === "number") {
          patch.publicCount = result.publicCount;
        }
        if (typeof result.privateCount === "number") {
          patch.privateCount = result.privateCount;
        }
      }
      this.setData(patch);
      if (reset) this._listLoaded = true;
    } catch (err) {
      if (reqId !== this._listReqId) return;
      console.error("profile list failed", err);
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

  onTapDraft(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/publish/compose?draftId=${id}` });
  },

  onTapHeader() {
    if (this.data.loggedIn) {
      wx.navigateTo({ url: "/pages/profile/edit" });
      return;
    }
    this.setData({ showLogin: true });
    this.setTabBarHidden(true);
  },

  onTapSettings() {
    wx.navigateTo({ url: "/pages/settings/index" });
  },

  onTapFollowers() {
    if (!this.data.loggedIn) {
      this.setData({ showLogin: true });
      this.setTabBarHidden(true);
      return;
    }
    wx.navigateTo({ url: "/pages/relations/index?tab=followers" });
  },

  onTapFollowing() {
    if (!this.data.loggedIn) {
      this.setData({ showLogin: true });
      this.setTabBarHidden(true);
      return;
    }
    wx.navigateTo({ url: "/pages/relations/index?tab=following" });
  },

  onCloseLogin() {
    if (this.data.submitting) return;
    this.setData({ showLogin: false });
    this.setTabBarHidden(false);
  },

  async onGetPhoneNumber(e) {
    if (this.data.submitting) return;

    const { code, errMsg } = e.detail || {};
    if (!code) {
      wx.showToast({
        title:
          errMsg && errMsg.indexOf("deny") > -1
            ? t("profile.needPhoneAuth")
            : t("profile.authFailed"),
        icon: "none",
      });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: t("profile.loggingIn"), mask: true });

    try {
      const loginRes = await wx.cloud.callFunction({
        name: "login",
        data: {
          type: "login",
          phoneCode: code,
          locale: getLocale(),
        },
      });

      const result = loginRes.result || {};
      if (!result.ok || !result.user) {
        throw new Error(
          result.message || result.error || t("profile.loginFailedGeneric")
        );
      }

      const normalized = normalizeUser(result.user);
      setLocalUser(normalized);
      this.setData({
        showLogin: false,
        submitting: false,
      });
      this.setTabBarHidden(false);
      this.applyUser(normalized);
      this.refreshDrafts();
      this.loadList({ reset: true });
      wx.showToast({ title: t("profile.loginSuccess"), icon: "success" });
    } catch (err) {
      console.error("login failed", err);
      this.setData({ submitting: false });
      const msg = (err && (err.errMsg || err.message)) || "";
      const notDeployed =
        msg.includes("-501000") ||
        msg.includes("reource is not found") ||
        msg.includes("resource is not found") ||
        msg.includes("FunctionName") ||
        msg.includes("FUNCTION_NOT_FOUND");

      if (notDeployed) {
        wx.showModal({
          title: t("profile.cloudNotDeployedTitle"),
          content: t("profile.cloudNotDeployedContent"),
          showCancel: false,
        });
      } else {
        wx.showToast({ title: t("profile.loginFailed"), icon: "none" });
      }
    } finally {
      wx.hideLoading();
    }
  },
});
