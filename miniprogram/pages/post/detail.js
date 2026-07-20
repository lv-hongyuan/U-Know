const { getI18nData, t, onLocaleChange } = require("../../i18n/index");
const { isLoggedIn } = require("../../utils/user");
const {
  COMMENT_MAX,
  DEFAULT_AVATAR,
  getPostDetail,
  toggleLike,
  toggleCollect,
  listComments,
  createComment,
} = require("../../utils/post");

const COMMENT_PAGE = 20;

Page({
  data: {
    t: getI18nData(),
    loading: true,
    post: null,
    liked: false,
    collected: false,
    isOwner: false,
    comments: [],
    commentsLoading: false,
    commentsHasMore: true,
    commentDraft: "",
    canSend: false,
    commentFocus: false,
    commentMax: COMMENT_MAX,
    defaultAvatar: DEFAULT_AVATAR,
    swiperHeight: 360,
    acting: false,
    sending: false,
  },

  postId: "",

  onLoad(options) {
    this.postId = (options && (options.id || options.postId)) || "";
    this._offLocale = onLocaleChange(() => this.applyI18n());
    this.applyI18n();
    this.initSwiperHeight();
    if (!this.postId) {
      wx.showToast({ title: t("post.notFound"), icon: "none" });
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 400);
      return;
    }
    this.loadDetail();
  },

  onUnload() {
    if (this._offLocale) this._offLocale();
  },

  onShow() {
    this.applyI18n();
    if (this.postId && this.data.post) {
      this.loadDetail({ silent: true });
    }
  },

  applyI18n() {
    this.setData({ t: getI18nData() });
    wx.setNavigationBarTitle({ title: t("nav.postDetail") });
  },

  initSwiperHeight() {
    try {
      const info =
        typeof wx.getWindowInfo === "function"
          ? wx.getWindowInfo()
          : wx.getSystemInfoSync();
      const width = info.windowWidth || 375;
      this.setData({ swiperHeight: Math.round(width * 1.15) });
    } catch (e) {
      // keep default
    }
  },

  requireLogin() {
    if (isLoggedIn()) return true;
    wx.showToast({ title: t("profile.tapToLogin"), icon: "none" });
    return false;
  },

  async loadDetail({ silent } = {}) {
    if (!silent) this.setData({ loading: true });
    try {
      const result = await getPostDetail(this.postId);
      if (!result.ok || !result.post) {
        throw new Error(result.error || "not found");
      }
      const post = {
        ...result.post,
        images: result.post.images || [],
        topics: result.post.topics || [],
        avatarUrl: result.post.avatarUrl || DEFAULT_AVATAR,
      };
      this.setData({
        post,
        liked: !!result.liked,
        collected: !!result.collected,
        isOwner: !!result.isOwner,
        loading: false,
      });
      this.loadComments({ reset: true });
    } catch (err) {
      console.error("load detail failed", err);
      this.setData({ loading: false, post: null });
      wx.showToast({ title: t("post.notFound"), icon: "none" });
    }
  },

  async loadComments({ reset }) {
    if (this.data.commentsLoading) return;
    if (!reset && !this.data.commentsHasMore) return;

    const skip = reset ? 0 : this.data.comments.length;
    this.setData({ commentsLoading: true });

    try {
      const result = await listComments({
        postId: this.postId,
        skip,
        limit: COMMENT_PAGE,
      });
      if (!result.ok) throw new Error(result.error || "list comments failed");
      const list = (result.list || []).map((item) => ({
        ...item,
        avatarUrl: item.avatarUrl || DEFAULT_AVATAR,
      }));
      this.setData({
        comments: reset ? list : this.data.comments.concat(list),
        commentsHasMore: !!result.hasMore,
        commentsLoading: false,
      });
    } catch (err) {
      console.error("list comments failed", err);
      this.setData({ commentsLoading: false });
    }
  },

  onLoadMoreComments() {
    this.loadComments({ reset: false });
  },

  onSwiperChange() {},

  onPreviewImage(e) {
    const url = e.currentTarget.dataset.url;
    const urls = (this.data.post && this.data.post.images) || [];
    if (!url || !urls.length) return;
    wx.previewImage({ current: url, urls });
  },

  onTapMenu() {
    if (!this.data.isOwner) return;
    wx.showActionSheet({
      itemList: [t("post.edit")],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.navigateTo({
            url: `/pages/publish/compose?postId=${this.postId}`,
          });
        }
      },
    });
  },

  async onToggleLike() {
    if (this.data.acting) return;
    if (!this.requireLogin()) return;
    this.setData({ acting: true });
    try {
      const result = await toggleLike(this.postId);
      if (!result.ok) throw new Error(result.error || "like failed");
      this.setData({
        liked: !!result.liked,
        "post.likeCount": Number(result.likeCount) || 0,
      });
    } catch (err) {
      console.error("toggle like failed", err);
      wx.showToast({ title: t("common.operationFailed"), icon: "none" });
    } finally {
      this.setData({ acting: false });
    }
  },

  async onToggleCollect() {
    if (this.data.acting) return;
    if (!this.requireLogin()) return;
    this.setData({ acting: true });
    try {
      const result = await toggleCollect(this.postId);
      if (!result.ok) throw new Error(result.error || "collect failed");
      this.setData({
        collected: !!result.collected,
        "post.collectCount": Number(result.collectCount) || 0,
      });
    } catch (err) {
      console.error("toggle collect failed", err);
      wx.showToast({ title: t("common.operationFailed"), icon: "none" });
    } finally {
      this.setData({ acting: false });
    }
  },

  onCommentInput(e) {
    const commentDraft = (e.detail.value || "").slice(0, COMMENT_MAX);
    this.setData({
      commentDraft,
      canSend: !!commentDraft.trim(),
    });
  },

  onCommentFocus() {
    this.setData({ commentFocus: true });
  },

  onCommentBlur() {
    this.setData({ commentFocus: false });
  },

  async onSendComment() {
    if (this.data.sending) return;
    if (!this.requireLogin()) return;
    const content = (this.data.commentDraft || "").trim();
    if (!content) {
      this.setData({ commentFocus: true });
      return;
    }

    this.setData({ sending: true });
    try {
      const result = await createComment({
        postId: this.postId,
        content,
      });
      if (!result.ok || !result.comment) {
        throw new Error(result.error || "comment failed");
      }
      const comment = {
        ...result.comment,
        avatarUrl: result.comment.avatarUrl || DEFAULT_AVATAR,
      };
      this.setData({
        commentDraft: "",
        canSend: false,
        comments: this.data.comments.concat([comment]),
        "post.commentCount": Number(result.commentCount) || this.data.post.commentCount + 1,
      });
    } catch (err) {
      console.error("send comment failed", err);
      wx.showToast({ title: t("post.commentFailed"), icon: "none" });
    } finally {
      this.setData({ sending: false });
    }
  },
});
