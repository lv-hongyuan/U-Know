const { getI18nData, t, onLocaleChange } = require("../../i18n/index");
const { isLoggedIn, getLocalUser } = require("../../utils/user");
const {
  TITLE_MAX,
  CONTENT_MAX,
  TOPIC_MAX_LEN,
  IMAGE_MAX,
  extractTopics,
  createPost,
  updatePost,
  getPostDetail,
  isCloudFileId,
} = require("../../utils/post");
const { saveDraft, removeDraft, getDraft } = require("../../utils/draft");
const { formatSchoolLabel } = require("../../utils/school");

Page({
  data: {
    t: getI18nData(),
    mode: "text",
    images: [],
    title: "",
    content: "",
    topics: [],
    visibility: "public",
    showVisibilitySheet: false,
    attachSchool: true,
    hasSchool: false,
    schoolPreview: "",
    titleMax: TITLE_MAX,
    contentMax: CONTENT_MAX,
    imageMax: IMAGE_MAX,
    publishing: false,
    isEdit: false,
  },

  draftId: "",
  postId: "",

  onLoad(options) {
    this.postId = (options && (options.postId || options.id)) || "";
    this.draftId = (options && options.draftId) || `draft_${Date.now()}`;
    this._offLocale = onLocaleChange(() => this.applyI18n());

    if (this.postId) {
      this.setData({ isEdit: true });
      this.loadEditPost(this.postId);
      return;
    }

    if (options && options.draftId) {
      this.loadDraft(options.draftId);
      return;
    }

    const mode = options && options.mode === "image" ? "image" : "text";
    const app = getApp();
    const session = (app && app.globalData && app.globalData.publishSession) || {};
    const images =
      mode === "image" && Array.isArray(session.images)
        ? session.images.slice(0, IMAGE_MAX)
        : [];

    this.setData({
      mode,
      images,
      title: "",
      content: "",
      topics: [],
      visibility: "public",
      showVisibilitySheet: false,
      isEdit: false,
    });
  },

  loadDraft(draftId) {
    const draft = getDraft(draftId);
    if (!draft) {
      wx.showToast({ title: t("profile.emptyDraft"), icon: "none" });
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 400);
      return;
    }
    this.draftId = draft.id;
    this.setData({
      mode: draft.type === "image" ? "image" : "text",
      images: Array.isArray(draft.images) ? draft.images.slice(0, IMAGE_MAX) : [],
      title: draft.title || "",
      content: draft.content || "",
      topics: extractTopics(draft.content || ""),
      visibility: draft.visibility === "private" ? "private" : "public",
      showVisibilitySheet: false,
      isEdit: false,
    });
  },

  async loadEditPost(postId) {
    wx.showLoading({ title: t("common.loading"), mask: true });
    try {
      const result = await getPostDetail(postId);
      if (!result.ok || !result.post) {
        throw new Error(result.error || "not found");
      }
      if (!result.isOwner) {
        wx.showToast({ title: t("post.editForbidden"), icon: "none" });
        setTimeout(() => wx.navigateBack({ fail: () => {} }), 400);
        return;
      }
      const post = result.post;
      this.setData({
        mode: post.type === "image" ? "image" : "text",
        images: Array.isArray(post.images) ? post.images.slice(0, IMAGE_MAX) : [],
        title: post.title || "",
        content: post.content || "",
        topics: post.topics || extractTopics(post.content || ""),
        visibility: post.visibility === "private" ? "private" : "public",
        attachSchool: !!(post.schoolId || post.schoolName),
        showVisibilitySheet: false,
        isEdit: true,
      });
      this.syncSchoolState({ preserveAttach: true });
      wx.showToast({ title: t("post.notFound"), icon: "none" });
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 400);
    } finally {
      wx.hideLoading();
    }
  },

  onUnload() {
    if (this._offLocale) this._offLocale();
  },

  onShow() {
    this.applyI18n();
    this.syncSchoolState();
  },

  applyI18n() {
    this.setData({ t: getI18nData() });
    wx.setNavigationBarTitle({
      title: this.data.isEdit || this.postId ? t("nav.publishEditPost") : t("nav.publishCompose"),
    });
  },

  syncSchoolState({ preserveAttach } = {}) {
    const user = getLocalUser() || {};
    const hasSchool = !!(user.schoolId && user.schoolName);
    const schoolPreview = hasSchool
      ? formatSchoolLabel({
          name: user.schoolName,
          campus: user.schoolCampus,
        })
      : "";
    const patch = { hasSchool, schoolPreview };
    if (!hasSchool) {
      patch.attachSchool = false;
    } else if (!preserveAttach) {
      // keep current if already set in edit load; else default on
      if (typeof this.data.attachSchool !== "boolean") {
        patch.attachSchool = true;
      }
    }
    this.setData(patch);
  },

  onToggleAttachSchool() {
    if (!this.data.hasSchool) {
      wx.showToast({ title: t("publish.needSchoolFirst"), icon: "none" });
    }
  },

  onAttachSchoolSwitch(e) {
    if (!this.data.hasSchool) {
      wx.showToast({ title: t("publish.needSchoolFirst"), icon: "none" });
      this.setData({ attachSchool: false });
      return;
    }
    this.setData({ attachSchool: !!(e.detail && e.detail.value) });
  },

  onTitleInput(e) {
    const title = (e.detail.value || "").slice(0, TITLE_MAX);
    this.setData({ title });
  },

  onContentInput(e) {
    const content = (e.detail.value || "").slice(0, CONTENT_MAX);
    this.setData({
      content,
      topics: extractTopics(content),
    });
  },

  onAddTopic() {
    let content = this.data.content || "";
    if (content && !/\s$/.test(content) && !content.endsWith("#")) {
      content += " ";
    }
    content += "#";
    if (content.length > CONTENT_MAX) {
      content = content.slice(0, CONTENT_MAX);
    }
    this.setData({
      content,
      topics: extractTopics(content),
    });
    wx.showToast({ title: t("publish.topicHint"), icon: "none" });
  },

  onAddImage() {
    if (this.data.mode !== "image") return;
    const remain = IMAGE_MAX - this.data.images.length;
    if (remain <= 0) return;

    wx.chooseMedia({
      count: remain,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["original", "compressed"],
      success: (res) => {
        const files = (res.tempFiles || [])
          .map((f) => f.tempFilePath)
          .filter(Boolean);
        const images = this.data.images.concat(files).slice(0, IMAGE_MAX);
        this.setData({ images });
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || "";
        if (msg.indexOf("cancel") > -1) return;
        wx.showToast({ title: t("publish.pickFailed"), icon: "none" });
      },
    });
  },

  onRemoveImage(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(index)) return;
    const images = this.data.images.slice();
    images.splice(index, 1);
    this.setData({ images });
  },

  noop() {},

  onOpenVisibilitySheet() {
    this.setData({ showVisibilitySheet: true });
  },

  onCloseVisibilitySheet() {
    this.setData({ showVisibilitySheet: false });
  },

  onPickVisibility(e) {
    const visibility = e.currentTarget.dataset.visibility;
    if (visibility !== "public" && visibility !== "private") return;
    this.setData({
      visibility,
      showVisibilitySheet: false,
    });
  },

  onSaveDraft() {
    if (this.data.isEdit) return;
    const item = saveDraft({
      id: this.draftId,
      type: this.data.mode,
      title: this.data.title,
      content: this.data.content,
      images: this.data.images,
      visibility: this.data.visibility === "private" ? "private" : "public",
    });
    this.draftId = item.id;
    wx.showToast({ title: t("publish.draftSaved"), icon: "success" });
  },

  async onPublish() {
    if (this.data.publishing) return;
    if (!isLoggedIn()) {
      wx.showToast({ title: t("profile.tapToLogin"), icon: "none" });
      return;
    }

    const title = (this.data.title || "").trim();
    const content = (this.data.content || "").trim();
    if (!title) {
      wx.showToast({ title: t("publish.needTitle"), icon: "none" });
      return;
    }
    if (!content) {
      wx.showToast({ title: t("publish.needContent"), icon: "none" });
      return;
    }
    if (this.data.mode === "image" && !this.data.images.length) {
      wx.showToast({ title: t("publish.needImage"), icon: "none" });
      return;
    }

    const topics = extractTopics(content);
    const tooLong = topics.find((x) => x.length > TOPIC_MAX_LEN);
    if (tooLong) {
      wx.showToast({ title: t("publish.topicTooLong"), icon: "none" });
      return;
    }

    const isEdit = !!(this.data.isEdit && this.postId);
    this.setData({ publishing: true });
    wx.showLoading({
      title: isEdit ? t("publish.updating") : t("publish.publishing"),
      mask: true,
    });

    try {
      let images = [];
      if (this.data.mode === "image") {
        images = await this.uploadImages(this.data.images);
      }

      const payload = {
        type: this.data.mode,
        title,
        content,
        images,
        visibility: this.data.visibility === "private" ? "private" : "public",
        attachSchool: !!(this.data.hasSchool && this.data.attachSchool),
      };

      const result = isEdit
        ? await updatePost({ ...payload, postId: this.postId })
        : await createPost(payload);

      if (!result.ok) {
        const errMsg = result.message || result.error || "publish failed";
        console.error("publish result", result);
        throw new Error(errMsg);
      }

      const app = getApp();
      if (app && app.globalData) {
        app.globalData.publishSession = null;
      }
      if (!isEdit) removeDraft(this.draftId);

      wx.showToast({
        title: isEdit ? t("publish.updateSuccess") : t("publish.publishSuccess"),
        icon: "success",
      });
      setTimeout(() => {
        if (isEdit) {
          wx.navigateBack({
            fail: () =>
              wx.redirectTo({ url: `/pages/post/detail?id=${this.postId}` }),
          });
        } else {
          wx.switchTab({ url: "/pages/home/index" });
        }
      }, 500);
    } catch (err) {
      console.error("publish failed", err);
      wx.showToast({
        title: isEdit ? t("publish.updateFailed") : t("publish.publishFailed"),
        icon: "none",
      });
    } finally {
      this.setData({ publishing: false });
      wx.hideLoading();
    }
  },

  uploadImages(localPaths) {
    const tasks = (localPaths || []).map((filePath, index) => {
      if (isCloudFileId(filePath)) {
        return Promise.resolve(filePath);
      }
      return wx.cloud
        .uploadFile({
          cloudPath: `posts/${Date.now()}-${index}-${Math.floor(Math.random() * 10000)}.jpg`,
          filePath,
        })
        .then((res) => res.fileID);
    });
    return Promise.all(tasks);
  },
});
