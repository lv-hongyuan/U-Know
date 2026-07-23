const { getI18nData, t, onLocaleChange } = require("../../i18n/index");
const { formatCommentTime } = require("../../utils/time");
const { isLoggedIn, getLocalUser } = require("../../utils/user");
const { follow, unfollow, isFollowing } = require("../../utils/follow");
const { openUserProfile } = require("../../utils/navigate");
const { sharePost } = require("../../utils/chat");
const {
  COMMENT_MAX,
  REPLY_PREVIEW,
  REPLY_EXPAND,
  DEFAULT_AVATAR,
  getPostDetail,
  toggleLike,
  toggleCollect,
  listComments,
  listReplies,
  createComment,
  toggleCommentLike,
  isCloudFileId,
} = require("../../utils/post");

const COMMENT_PAGE = 20;
const COMMENT_EMOJIS = [
  "😀", "😂", "🥰", "😍", "😊", "😭", "😅", "🤔",
  "👍", "👏", "🙏", "💪", "🎉", "❤️", "💚", "🔥", "✨", "🌹",
];

Page({
  data: {
    t: getI18nData(),
    loading: true,
    post: null,
    liked: false,
    collected: false,
    isOwner: false,
    following: false,
    followActing: false,
    comments: [],
    commentsLoading: false,
    commentsHasMore: true,
    commentDraft: "",
    canSend: false,
    commentMax: COMMENT_MAX,
    defaultAvatar: DEFAULT_AVATAR,
    replyTarget: null,
    commentPlaceholder: "",
    expandedCommentId: "",
    replyPreview: REPLY_PREVIEW,
    replyExpanding: false,
    showComposer: false,
    composerFocus: false,
    commentImage: "",
    showEmojiPanel: false,
    keyboardHeight: 0,
    commentEmojis: COMMENT_EMOJIS,
    swiperHeight: 360,
    acting: false,
    sending: false,
    commentLiking: false,
    scrollIntoView: "",
    focusAnchorId: "",
    showSharePicker: false,
    shareSending: false,
  },

  postId: "",
  focusCommentId: "",
  focusParentId: "",
  _didFocusComment: false,

  onLoad(options) {
    this.postId = (options && (options.id || options.postId)) || "";
    this.focusCommentId =
      (options && (options.commentId || options.focusCommentId)) || "";
    this.focusParentId =
      (options && (options.parentId || options.focusParentId)) || "";
    this._didFocusComment = false;
    this._offLocale = onLocaleChange(() => this.applyI18n());
    this.applyI18n();
    this.initSwiperHeight();
    this._keyboardHandler = (res) => {
      this.setData({ keyboardHeight: res.height || 0 });
    };
    if (typeof wx.onKeyboardHeightChange === "function") {
      wx.onKeyboardHeightChange(this._keyboardHandler);
    }
    if (!this.postId) {
      wx.showToast({ title: t("post.notFound"), icon: "none" });
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 400);
      return;
    }
    this.loadDetail();
  },

  onUnload() {
    if (this._offLocale) this._offLocale();
    if (this._keyboardHandler && typeof wx.offKeyboardHeightChange === "function") {
      wx.offKeyboardHeightChange(this._keyboardHandler);
    }
  },

  onShow() {
    this.applyI18n();
    if (this.postId && this.data.post) {
      this.loadDetail({ silent: true });
    }
  },

  noop() {},

  applyI18n() {
    const updates = {
      t: getI18nData(),
      commentPlaceholder: this.buildCommentPlaceholder(),
    };
    if (this.data.comments.length) {
      updates.comments = this.data.comments.map((item) =>
        this.normalizeComment(item)
      );
    }
    this.setData(updates);
    wx.setNavigationBarTitle({ title: " " });
  },

  buildCommentPlaceholder() {
    const target = this.data.replyTarget;
    if (target && target.replyToNickName) {
      return `${t("post.reply")} @${target.replyToNickName}…`;
    }
    return t("post.commentPlaceholder");
  },

  enrichCommentBase(item) {
    return {
      ...item,
      avatarUrl: item.avatarUrl || DEFAULT_AVATAR,
      image: item.image || "",
      likeCount: Number(item.likeCount) || 0,
      liked: !!item.liked,
      timeLabel: formatCommentTime(item.createdAt, t),
    };
  },

  normalizeComment(item) {
    const replies = (item.replies || []).map((reply) =>
      this.enrichCommentBase(reply)
    );
    const replyTotal =
      Number(item.replyTotal) >= 0 ? Number(item.replyTotal) : replies.length;
    return {
      ...this.enrichCommentBase(item),
      replyTotal,
      replies,
    };
  },

  collapseCommentReplies(comments, commentId) {
    if (!commentId) return comments;
    return comments.map((item) => {
      if (item._id !== commentId) return item;
      return {
        ...item,
        replies: item.replies.slice(0, REPLY_PREVIEW),
      };
    });
  },

  updateCommentById(comments, commentId, patch) {
    return comments.map((item) => {
      if (item._id !== commentId) return item;
      return { ...item, ...patch };
    });
  },

  patchCommentInList(comments, commentId, patch) {
    return comments.map((item) => {
      if (item._id === commentId) {
        return { ...item, ...patch };
      }
      if (item.replies && item.replies.length) {
        const replies = item.replies.map((reply) =>
          reply._id === commentId ? { ...reply, ...patch } : reply
        );
        if (replies !== item.replies) {
          return { ...item, replies };
        }
      }
      return item;
    });
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
      const isOwner = !!result.isOwner;
      this.setData({
        post,
        liked: !!result.liked,
        collected: !!result.collected,
        isOwner,
        following: false,
        loading: false,
      });
      await this.loadComments({ reset: true });
      if (!silent) {
        await this.focusTargetComment();
      }
      if (!isOwner && post.openid) {
        this.loadFollowState(post.openid);
      }
    } catch (err) {
      console.error("load detail failed", err);
      this.setData({ loading: false, post: null });
      wx.showToast({ title: t("post.notFound"), icon: "none" });
    }
  },

  async loadFollowState(authorOpenid) {
    if (!authorOpenid || !isLoggedIn()) {
      this.setData({ following: false });
      return;
    }
    const me = getLocalUser();
    if (me && me.openid && me.openid === authorOpenid) {
      this.setData({ following: false });
      return;
    }
    try {
      const result = await isFollowing(authorOpenid);
      if (result && result.ok) {
        this.setData({ following: !!result.following });
      }
    } catch (err) {
      console.error("load follow state failed", err);
    }
  },

  async onToggleFollow() {
    if (this.data.isOwner || this.data.followActing) return;
    if (!this.requireLogin()) return;
    const authorOpenid = this.data.post && this.data.post.openid;
    if (!authorOpenid) return;

    this.setData({ followActing: true });
    const nextFollowing = !this.data.following;
    try {
      const result = nextFollowing
        ? await follow(authorOpenid)
        : await unfollow(authorOpenid);
      if (!result.ok) throw new Error(result.error || "follow failed");
      this.setData({ following: nextFollowing });
    } catch (err) {
      console.error("toggle follow failed", err);
      wx.showToast({ title: t("common.operationFailed"), icon: "none" });
    } finally {
      this.setData({ followActing: false });
    }
  },

  async loadComments({ reset }) {
    if (this.data.commentsLoading) return false;
    if (!reset && !this.data.commentsHasMore) return false;

    const skip = reset ? 0 : this.data.comments.length;
    this.setData({ commentsLoading: true });

    try {
      const result = await listComments({
        postId: this.postId,
        skip,
        limit: COMMENT_PAGE,
      });
      if (!result.ok) throw new Error(result.error || "list comments failed");
      const list = (result.list || []).map((item) => this.normalizeComment(item));
      this.setData({
        comments: reset ? list : this.data.comments.concat(list),
        commentsHasMore: !!result.hasMore,
        commentsLoading: false,
        expandedCommentId: reset ? "" : this.data.expandedCommentId,
      });
      return true;
    } catch (err) {
      console.error("list comments failed", err);
      this.setData({ commentsLoading: false });
      return false;
    }
  },

  onLoadMoreComments() {
    this.loadComments({ reset: false });
  },

  findRootComment(commentId) {
    return (this.data.comments || []).find((item) => item._id === commentId);
  },

  async ensureRootCommentVisible(commentId) {
    if (!commentId) return false;
    const MAX_PAGES = 15;
    for (let i = 0; i < MAX_PAGES; i += 1) {
      if (this.findRootComment(commentId)) return true;
      if (!this.data.commentsHasMore) return false;
      const loaded = await this.loadComments({ reset: false });
      if (!loaded) return !!this.findRootComment(commentId);
    }
    return !!this.findRootComment(commentId);
  },

  async expandUntilReply(parentId, replyId) {
    const comment = this.findRootComment(parentId);
    if (!comment || !replyId) return false;

    if ((comment.replies || []).some((r) => r._id === replyId)) {
      return true;
    }

    if (this.data.replyExpanding) return false;

    let comments = this.data.comments;
    const prevExpanded = this.data.expandedCommentId;
    if (prevExpanded && prevExpanded !== parentId) {
      comments = this.collapseCommentReplies(comments, prevExpanded);
    }

    this.setData({
      replyExpanding: true,
      comments,
      expandedCommentId: parentId,
    });

    try {
      const result = await listReplies({
        postId: this.postId,
        parentId,
        untilId: replyId,
      });
      if (!result.ok) throw new Error(result.error || "list replies failed");
      if (!result.found) {
        this.setData({ replyExpanding: false });
        return false;
      }
      const replies = (result.list || []).map((reply) =>
        this.enrichCommentBase(reply)
      );
      const replyTotal = Number(result.total);
      const merged = this.updateCommentById(this.data.comments, parentId, {
        replies,
        replyTotal: Number.isFinite(replyTotal) ? replyTotal : replies.length,
      });
      this.setData({
        comments: merged,
        expandedCommentId: parentId,
        replyExpanding: false,
      });
      return replies.some((r) => r._id === replyId);
    } catch (err) {
      console.error("focus expand replies failed", err);
      this.setData({ replyExpanding: false });
      return false;
    }
  },

  scrollToAnchor(anchorId) {
    if (!anchorId) return;
    const viewId = `c-${anchorId}`;
    this.setData({ scrollIntoView: "", focusAnchorId: anchorId });
    setTimeout(() => {
      this.setData({ scrollIntoView: viewId });
      setTimeout(() => {
        if (this.data.scrollIntoView === viewId) {
          this.setData({ scrollIntoView: "" });
        }
      }, 450);
      setTimeout(() => {
        if (this.data.focusAnchorId === anchorId) {
          this.setData({ focusAnchorId: "" });
        }
      }, 1800);
    }, 80);
  },

  async focusTargetComment() {
    const commentId = this.focusCommentId;
    if (!commentId || this._didFocusComment) return;
    this._didFocusComment = true;

    try {
      const parentId = this.focusParentId || "";
      if (parentId) {
        const rootOk = await this.ensureRootCommentVisible(parentId);
        if (!rootOk) return;
        const replyOk = await this.expandUntilReply(parentId, commentId);
        if (!replyOk) return;
        this.scrollToAnchor(commentId);
        return;
      }

      const rootOk = await this.ensureRootCommentVisible(commentId);
      if (!rootOk) return;
      this.scrollToAnchor(commentId);
    } catch (err) {
      console.error("focus target comment failed", err);
    }
  },

  onSwiperChange() {},

  onPreviewImage(e) {
    const url = e.currentTarget.dataset.url;
    const urls = (this.data.post && this.data.post.images) || [];
    if (!url || !urls.length) return;
    wx.previewImage({ current: url, urls });
  },

  onPreviewCommentImage(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.previewImage({ current: url, urls: [url] });
  },

  onTapAuthorAvatar(e) {
    const openid = e.currentTarget.dataset.openid;
    openUserProfile({ openid, source: "author" });
  },

  onTapCommentAvatar(e) {
    const openid = e.currentTarget.dataset.openid;
    openUserProfile({ openid, source: "comment" });
  },

  onTapMenu() {
    if (!this.data.isOwner) return;
    wx.showActionSheet({
      itemList: [t("post.edit"), t("chat.shareToFriend")],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.navigateTo({
            url: `/pages/publish/compose?postId=${this.postId}`,
          });
        } else if (res.tapIndex === 1) {
          this.onTapShare();
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

  updateCanSend(draft, image) {
    const commentDraft = draft != null ? draft : this.data.commentDraft;
    const commentImage = image != null ? image : this.data.commentImage;
    return {
      canSend: !!(commentDraft.trim() || commentImage),
    };
  },

  onOpenComposer() {
    if (!this.requireLogin()) return;
    this.setData({
      showComposer: true,
      composerFocus: true,
      showEmojiPanel: false,
    });
  },

  onTapComments() {
    this.setData({ scrollIntoView: "comments-section" });
    setTimeout(() => {
      if (this.data.scrollIntoView === "comments-section") {
        this.setData({ scrollIntoView: "" });
      }
    }, 400);
  },

  onCloseComposer() {
    this.setData({
      showComposer: false,
      composerFocus: false,
      showEmojiPanel: false,
      keyboardHeight: 0,
      replyTarget: null,
      commentPlaceholder: t("post.commentPlaceholder"),
    });
  },

  onComposerInput(e) {
    const commentDraft = (e.detail.value || "").slice(0, COMMENT_MAX);
    this.setData({
      commentDraft,
      ...this.updateCanSend(commentDraft, null),
    });
  },

  onComposerFocus() {
    this.setData({ composerFocus: true, showEmojiPanel: false });
  },

  onComposerBlur() {
    this.setData({ composerFocus: false });
  },

  onToggleEmojiPanel() {
    this.setData({
      showEmojiPanel: !this.data.showEmojiPanel,
      composerFocus: !this.data.showEmojiPanel,
    });
  },

  onPickEmoji(e) {
    const emoji = e.currentTarget.dataset.emoji || "";
    if (!emoji) return;
    const next = (this.data.commentDraft + emoji).slice(0, COMMENT_MAX);
    this.setData({
      commentDraft: next,
      ...this.updateCanSend(next, null),
    });
  },

  onInsertAt() {
    const next = (this.data.commentDraft + "@").slice(0, COMMENT_MAX);
    this.setData({
      commentDraft: next,
      showEmojiPanel: false,
      composerFocus: true,
      ...this.updateCanSend(next, null),
    });
  },

  onChooseCommentImage() {
    if (this.data.commentImage) {
      wx.showToast({ title: t("post.commentImageLimit"), icon: "none" });
      return;
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album"],
      sizeType: ["compressed"],
      success: (res) => {
        const file = (res.tempFiles && res.tempFiles[0]) || null;
        if (!file || !file.tempFilePath) return;
        this.setData({
          commentImage: file.tempFilePath,
          ...this.updateCanSend(null, file.tempFilePath),
        });
      },
    });
  },

  onRemoveCommentImage() {
    this.setData({
      commentImage: "",
      ...this.updateCanSend(null, ""),
    });
  },

  onTapReply(e) {
    if (!this.requireLogin()) return;
    const { id, nick, openid, parentId, isReply } = e.currentTarget.dataset;
    if (!id) return;
    const rootId = isReply ? parentId : id;
    this.setData(
      {
        replyTarget: {
          parentId: rootId,
          replyToCommentId: id,
          replyToOpenid: openid || "",
          replyToNickName: nick || "",
        },
        showComposer: true,
        composerFocus: true,
        showEmojiPanel: false,
      },
      () => {
        this.setData({ commentPlaceholder: this.buildCommentPlaceholder() });
      }
    );
  },

  appendReplyToComments(comments, parentId, reply, expandedCommentId) {
    return comments.map((item) => {
      if (item._id !== parentId) return item;
      const replyTotal = (item.replyTotal || item.replies.length) + 1;
      const showNewReply =
        expandedCommentId === parentId || item.replies.length < REPLY_PREVIEW;
      return {
        ...item,
        replyTotal,
        replies: showNewReply
          ? item.replies.concat([this.enrichCommentBase(reply)])
          : item.replies,
      };
    });
  },

  onCollapseReplies(e) {
    const { id } = e.currentTarget.dataset;
    if (!id || this.data.expandedCommentId !== id) return;
    this.setData({
      expandedCommentId: "",
      comments: this.collapseCommentReplies(this.data.comments, id),
    });
  },

  async onExpandReplies(e) {
    const { id } = e.currentTarget.dataset;
    if (!id || this.data.replyExpanding) return;

    let comments = this.data.comments;
    const prevExpanded = this.data.expandedCommentId;
    if (prevExpanded && prevExpanded !== id) {
      comments = this.collapseCommentReplies(comments, prevExpanded);
    }

    const comment = comments.find((item) => item._id === id);
    if (!comment) return;

    const replyTotal = comment.replyTotal || 0;
    if (comment.replies.length >= replyTotal) {
      this.setData({ expandedCommentId: id, comments });
      return;
    }

    this.setData({ replyExpanding: true, comments, expandedCommentId: id });
    try {
      const result = await listReplies({
        postId: this.postId,
        parentId: id,
        skip: comment.replies.length,
        limit: REPLY_EXPAND,
      });
      if (!result.ok) throw new Error(result.error || "list replies failed");
      const more = (result.list || []).map((reply) =>
        this.enrichCommentBase(reply)
      );
      const merged = this.updateCommentById(comments, id, {
        replies: comment.replies.concat(more),
        replyTotal: Number(result.total) || replyTotal,
      });
      this.setData({
        comments: merged,
        expandedCommentId: id,
        replyExpanding: false,
      });
    } catch (err) {
      console.error("expand replies failed", err);
      this.setData({ replyExpanding: false });
      wx.showToast({ title: t("common.operationFailed"), icon: "none" });
    }
  },

  async onToggleCommentLike(e) {
    const { id } = e.currentTarget.dataset;
    if (!id || this.data.commentLiking) return;
    if (!this.requireLogin()) return;

    this.setData({ commentLiking: true });
    try {
      const result = await toggleCommentLike({
        postId: this.postId,
        commentId: id,
      });
      if (!result.ok) throw new Error(result.error || "comment like failed");
      this.setData({
        comments: this.patchCommentInList(this.data.comments, id, {
          liked: !!result.liked,
          likeCount: Number(result.likeCount) || 0,
        }),
      });
    } catch (err) {
      console.error("toggle comment like failed", err);
      wx.showToast({ title: t("common.operationFailed"), icon: "none" });
    } finally {
      this.setData({ commentLiking: false });
    }
  },

  uploadCommentImage(localPath) {
    if (!localPath) return Promise.resolve("");
    if (isCloudFileId(localPath)) return Promise.resolve(localPath);
    return wx.cloud
      .uploadFile({
        cloudPath: `comments/${this.postId}/${Date.now()}-${Math.floor(
          Math.random() * 10000
        )}.jpg`,
        filePath: localPath,
      })
      .then((res) => res.fileID || "");
  },

  async onSendComment() {
    if (this.data.sending) return;
    if (!this.requireLogin()) return;
    const content = (this.data.commentDraft || "").trim();
    const localImage = this.data.commentImage || "";
    if (!content && !localImage) {
      this.setData({ composerFocus: true, showComposer: true });
      return;
    }

    this.setData({ sending: true });
    const replyTarget = this.data.replyTarget;
    try {
      let image = "";
      if (localImage) {
        wx.showLoading({ title: t("common.uploading"), mask: true });
        image = await this.uploadCommentImage(localImage);
        wx.hideLoading();
        if (!image) throw new Error("upload failed");
      }

      const payload = {
        postId: this.postId,
        content,
        image,
      };
      if (replyTarget && replyTarget.parentId) {
        payload.parentId = replyTarget.parentId;
        payload.replyToOpenid = replyTarget.replyToOpenid;
        payload.replyToNickName = replyTarget.replyToNickName;
        payload.replyToCommentId =
          replyTarget.replyToCommentId || replyTarget.parentId;
      }
      const result = await createComment(payload);
      if (!result.ok || !result.comment) {
        throw new Error(result.error || "comment failed");
      }
      const comment = this.normalizeComment(
        replyTarget && replyTarget.parentId
          ? result.comment
          : { ...result.comment, replies: [] }
      );
      const nextCount =
        Number(result.commentCount) || (this.data.post.commentCount || 0) + 1;
      const updates = {
        commentDraft: "",
        commentImage: "",
        canSend: false,
        replyTarget: null,
        commentPlaceholder: t("post.commentPlaceholder"),
        showComposer: false,
        composerFocus: false,
        showEmojiPanel: false,
        keyboardHeight: 0,
        "post.commentCount": nextCount,
      };
      if (replyTarget && replyTarget.parentId) {
        updates.comments = this.appendReplyToComments(
          this.data.comments,
          replyTarget.parentId,
          comment,
          this.data.expandedCommentId
        );
      } else {
        updates.comments = this.data.comments.concat([comment]);
      }
      this.setData(updates);
    } catch (err) {
      wx.hideLoading();
      console.error("send comment failed", err);
      wx.showToast({ title: t("post.commentFailed"), icon: "none" });
    } finally {
      this.setData({ sending: false });
    }
  },

  onTapShare() {
    if (!this.requireLogin()) return;
    if (!this.data.post) return;
    this.setData({ showSharePicker: true });
  },

  closeSharePicker() {
    if (this.data.shareSending) return;
    this.setData({ showSharePicker: false });
  },

  buildSharePostPayload() {
    const post = this.data.post;
    if (!post) return null;
    let coverUrl = "";
    if (post.type === "image" && post.images && post.images.length) {
      coverUrl = post.images[0];
    }
    return {
      postId: post._id || this.postId,
      title: post.title || post.content || "",
      coverUrl,
      authorOpenid: post.openid || "",
      authorNickName: post.nickName || "",
      authorAvatarUrl: post.avatarUrl || DEFAULT_AVATAR,
      likeCount: Number(post.likeCount) || 0,
    };
  },

  async onShareConfirm(e) {
    const peers = (e.detail && e.detail.peers) || [];
    const peerOpenids = peers.map((p) => p.openid).filter(Boolean);
    const post = this.buildSharePostPayload();
    if (!post || !peerOpenids.length || this.data.shareSending) return;
    this.setData({ shareSending: true });
    try {
      const res = await sharePost({ peerOpenids, post });
      if (!res.ok) throw new Error(res.error || "share failed");
      wx.showToast({ title: t("chat.shareSuccess"), icon: "success" });
      this.setData({ showSharePicker: false, shareSending: false });
    } catch (err) {
      console.error("share post failed", err);
      this.setData({ shareSending: false });
      const code = String((err && err.message) || "");
      if (code === "cold_start_limit") {
        wx.showToast({ title: t("chat.coldStartLimit"), icon: "none" });
      } else {
        wx.showToast({ title: t("common.operationFailed"), icon: "none" });
      }
    }
  },
});
