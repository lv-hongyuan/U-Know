const { getI18nData, t, onLocaleChange } = require("../../i18n/index");
const { isLoggedIn, getLocalUser, DEFAULT_AVATAR } = require("../../utils/user");
const { openUserProfile } = require("../../utils/navigate");
const { formatChatDividerTime, shouldShowChatTime } = require("../../utils/time");
const {
  openOrCreate,
  listMessages,
  sendMessage,
  markRead,
  recallMessage,
  deleteMessage,
  forwardMessage,
  genClientMsgId,
  uploadChatFile,
} = require("../../utils/chat");
const {
  getCachedMessages,
  mergeCachedMessages,
  removeCachedMessage,
  withinWeek,
} = require("../../utils/chat-cache");

const PAGE_SIZE = 30;
const RECALL_MS = 3 * 60 * 1000;
const EMOJIS = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😜", "🤔", "😭",
  "😡", "👍", "👎", "👏", "🙏", "🔥", "❤️", "✨", "🎉", "😎",
];

Page({
  data: {
    t: getI18nData(),
    conversationId: "",
    peerOpenid: "",
    peerNickName: "",
    peerAvatarUrl: DEFAULT_AVATAR,
    myOpenid: "",
    myAvatarUrl: DEFAULT_AVATAR,
    list: [],
    loading: false,
    loadingMore: false,
    hasMore: true,
    inputValue: "",
    showEmoji: false,
    showPlus: false,
    quote: null,
    scrollIntoView: "",
    scrollWithAnimation: true,
    actionMsg: null,
    showAction: false,
    canRecall: false,
    showForward: false,
    forwardSending: false,
    actionPos: { top: 0, left: 0 },
    actionArrowLeft: 130,
    emojis: EMOJIS,
    defaultAvatar: DEFAULT_AVATAR,
    statusBarHeight: 20,
    navBarHeight: 44,
    keyboardHeight: 0,
    topSpace: 0,
    inputFocused: false,
  },

  onLoad(query) {
    this.initLayoutMetrics();
    this.bindKeyboard();
    this._offLocale = onLocaleChange(() => this.applyI18n());
    if (!isLoggedIn()) {
      wx.showToast({ title: t("profile.tapToLogin"), icon: "none" });
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 400);
      return;
    }
    const user = getLocalUser() || {};
    this.setData({
      myOpenid: user.openid || "",
      myAvatarUrl: user.avatarUrl || DEFAULT_AVATAR,
      conversationId: query.id || "",
      peerOpenid: query.peer || "",
      peerNickName: decodeURIComponent(query.nick || "") || "",
      peerAvatarUrl: decodeURIComponent(query.avatar || "") || DEFAULT_AVATAR,
    });
    this.applyI18n();
    this.bootstrap();
  },

  initLayoutMetrics() {
    try {
      const windowInfo =
        typeof wx.getWindowInfo === "function"
          ? wx.getWindowInfo()
          : wx.getSystemInfoSync();
      const statusBarHeight = windowInfo.statusBarHeight || 20;
      let navBarHeight = 44;
      try {
        const menu = wx.getMenuButtonBoundingClientRect();
        if (menu && menu.height) {
          const gap = Math.max(0, menu.top - statusBarHeight);
          navBarHeight = menu.height + gap * 2;
        }
      } catch (e) {
        // keep 44
      }
      this.setData({ statusBarHeight, navBarHeight });
    } catch (e) {
      // keep defaults
    }
  },

  /** 键盘高度垫在页面底部，整页 flex 收缩，输入栏贴键盘上方 */
  bindKeyboard() {
    this._onKeyboardHeight = (res) => {
      const h = Math.max(0, Math.floor((res && res.height) || 0));
      if (h === this.data.keyboardHeight) return;
      this.setData({ keyboardHeight: h }, () => this.updateTopSpace());
    };
    if (typeof wx.onKeyboardHeightChange === "function") {
      wx.onKeyboardHeightChange(this._onKeyboardHeight);
    }
  },

  unbindKeyboard() {
    if (
      this._onKeyboardHeight &&
      typeof wx.offKeyboardHeightChange === "function"
    ) {
      wx.offKeyboardHeightChange(this._onKeyboardHeight);
    }
    this._onKeyboardHeight = null;
  },

  /** 消息不足一屏时顶部补空白，气泡贴输入栏 */
  updateTopSpace() {
    const measure = () => {
      const query = this.createSelectorQuery();
      query.select(".room-scroll").boundingClientRect();
      query.select(".room-msgs").boundingClientRect();
      query.exec((res) => {
        const scrollRect = res && res[0];
        const msgsRect = res && res[1];
        if (!scrollRect || !msgsRect) return;
        const avail = scrollRect.height || 0;
        const space =
          msgsRect.height >= avail - 1
            ? 0
            : Math.max(0, Math.floor(avail - msgsRect.height));
        if (space !== this.data.topSpace) {
          this.setData({ topSpace: space });
        }
      });
    };
    if (typeof wx.nextTick === "function") wx.nextTick(measure);
    else setTimeout(measure, 0);
    clearTimeout(this._topSpaceTimer);
    this._topSpaceTimer = setTimeout(measure, 160);
  },

  onBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/message/index" }) });
  },

  onUnload() {
    if (this._offLocale) this._offLocale();
    clearTimeout(this._topSpaceTimer);
    this.unbindKeyboard();
    this.closeWatch();
  },

  onHide() {
    if (this.data.keyboardHeight) {
      this.setData({ keyboardHeight: 0 });
    }
    this.closeWatch();
  },

  onShow() {
    this.applyI18n();
    if (this.data.conversationId) {
      this.openWatch();
      markRead(this.data.conversationId).catch(() => {});
    }
  },

  applyI18n() {
    const patch = { t: getI18nData() };
    if ((this.data.list || []).length) {
      patch.list = this.mapMessages(this.data.list);
    }
    this.setData(patch);
  },

  onInput(e) {
    this.setData({ inputValue: e.detail.value || "" });
  },

  onFocus() {
    this.setData(
      {
        showEmoji: false,
        showPlus: false,
        inputFocused: true,
      },
      () => this.updateTopSpace()
    );
  },

  onBlur() {
    this.setData({ inputFocused: false });
    // 失焦后键盘高度回调偶发滞后，兜底清零
    setTimeout(() => {
      if (!this.data.inputFocused && this.data.keyboardHeight) {
        this.setData({ keyboardHeight: 0 }, () => this.updateTopSpace());
      }
    }, 80);
  },

  toggleEmoji() {
    const showEmoji = !this.data.showEmoji;
    this.setData(
      {
        showEmoji,
        showPlus: false,
      },
      () => this.updateTopSpace()
    );
  },

  togglePlus() {
    const showPlus = !this.data.showPlus;
    this.setData(
      {
        showPlus,
        showEmoji: false,
      },
      () => this.updateTopSpace()
    );
  },

  onTapEmoji(e) {
    const emoji = e.currentTarget.dataset.emoji || "";
    this.setData({ inputValue: `${this.data.inputValue || ""}${emoji}` });
  },

  clearQuote() {
    this.setData({ quote: null });
  },

  onPickKind(e) {
    const kind = e.currentTarget.dataset.kind === "video" ? "video" : "image";
    this.setData({ showPlus: false }, () => this.updateTopSpace());
    wx.showActionSheet({
      itemList: [t("publish.fromAlbum"), t("publish.fromCamera")],
      success: (res) => {
        const sourceType = res.tapIndex === 1 ? ["camera"] : ["album"];
        this.pickMedia(kind, sourceType);
      },
    });
  },

  async bootstrap() {
    // 首屏定位到最新消息时不播放滚动动画，避免进入会话后再从上向下滑。
    this.setData({ scrollWithAnimation: false });
    let conversationId = this.data.conversationId;
    let peerOpenid = this.data.peerOpenid;

    if (!conversationId && peerOpenid) {
      wx.showLoading({ title: t("common.loading"), mask: true });
      try {
        const res = await openOrCreate(peerOpenid);
        if (!res.ok || !res.conversation) throw new Error(res.error || "open failed");
        conversationId = res.conversation.id;
        this.setData({
          conversationId,
          peerNickName: res.conversation.peerNickName || this.data.peerNickName,
          peerAvatarUrl:
            res.conversation.peerAvatarUrl || this.data.peerAvatarUrl || DEFAULT_AVATAR,
        });
        this.applyI18n();
      } catch (e) {
        wx.showToast({ title: t("common.operationFailed"), icon: "none" });
        return;
      } finally {
        wx.hideLoading();
      }
    }

    if (!conversationId) return;

    const cached = getCachedMessages(conversationId);
    if (cached.length) {
      this.setData({
        list: this.mapMessages(cached),
        scrollIntoView: `msg-${cached[cached.length - 1].id}`,
      });
    }

    try {
      await this.loadMessages({ reset: true });
      await markRead(conversationId);
      this.openWatch();
    } finally {
      // 首屏定位完成后，后续新消息仍保留平滑滚动反馈。
      this.setData({ scrollWithAnimation: true });
    }
  },

  mapMessages(rows) {
    const myOpenid = this.data.myOpenid;
    let prevCreatedAt = null;
    return (rows || []).map((m) => {
      const createdAt = m.createdAt;
      const ts = new Date(createdAt).getTime();
      const showTime = shouldShowChatTime(prevCreatedAt, createdAt);
      const timeLabel = showTime ? formatChatDividerTime(createdAt, t) : "";
      if (Number.isFinite(ts)) prevCreatedAt = createdAt;
      const mine =
        typeof m.mine === "boolean"
          ? m.mine
          : !!(myOpenid && m.senderOpenid === myOpenid);
      const canRecall =
        !!mine &&
        !m.pending &&
        m.status !== "recalled" &&
        Number.isFinite(ts) &&
        Date.now() - ts <= RECALL_MS;
      return {
        ...m,
        mine,
        showTime,
        timeLabel,
        quote: this.normalizeQuote(m.quote),
        historyPreview: this.buildHistoryPreview(m.historyCard),
        canRecall,
        previewText: this.previewText(m),
      };
    });
  },

  buildHistoryPreview(card) {
    if (!card || !Array.isArray(card.items)) return [];
    return card.items.slice(0, 3).map((item) => {
      const name = item.senderNickName || "";
      let text = item.content || item.preview || "";
      if (item.type === "image") text = t("chat.previewImage");
      else if (item.type === "video") text = t("chat.previewVideo");
      else if (item.type === "post") text = t("chat.previewPost");
      else if (item.type === "history") text = t("chat.previewHistory");
      return name ? `${name}: ${text}` : text;
    });
  },

  showSendError(error) {
    const code = String((error && error.message) || error || "");
    if (code === "cold_start_limit") {
      wx.showToast({ title: t("chat.coldStartLimit"), icon: "none" });
      return;
    }
    wx.showToast({ title: t("common.operationFailed"), icon: "none" });
  },

  normalizeQuote(quote) {
    if (!quote) return null;
    let type = quote.type || "text";
    const rawPreview = String(quote.preview || "");
    if (type === "text") {
      if (rawPreview === "[image]" || rawPreview.indexOf("[image]") === 0) type = "image";
      else if (rawPreview === "[video]" || rawPreview.indexOf("[video]") === 0) type = "video";
      else if (rawPreview === "[post]" || rawPreview.indexOf("[post]") === 0) type = "post";
    }
    const media = quote.media || null;
    let thumbUrl =
      (media && (media.thumbFileId || media.fileId)) || quote.thumbUrl || "";
    // 视频 fileId 不能当图片缩略图；无 thumb 时留空走占位
    if (type === "video" && media && !media.thumbFileId && thumbUrl === media.fileId) {
      thumbUrl = "";
    }
    let preview = rawPreview;
    if (type === "image") preview = t("chat.previewImage");
    else if (type === "video") preview = t("chat.previewVideo");
    else if (type === "post") preview = t("chat.previewPost");
    return {
      ...quote,
      type,
      media,
      thumbUrl,
      preview,
    };
  },

  previewText(m) {
    if (!m || m.status === "recalled") return t("chat.recalled");
    if (m.type === "image") return t("chat.previewImage");
    if (m.type === "video") return t("chat.previewVideo");
    if (m.type === "post") return t("chat.previewPost");
    if (m.type === "history") return t("chat.previewHistory");
    return m.content || "";
  },

  async loadMessages({ reset, before } = {}) {
    const conversationId = this.data.conversationId;
    if (!conversationId) return;
    if (reset) {
      if (this.data.loading) return;
      this.setData({ loading: true, hasMore: true });
    } else {
      if (this.data.loadingMore || !this.data.hasMore) return;
      this.setData({ loadingMore: true });
    }

    try {
      const local = getCachedMessages(conversationId);
      let after;
      if (reset && local.length) {
        after = local[local.length - 1].createdAt;
      }

      const result = await listMessages({
        conversationId,
        before: before || undefined,
        after: reset && after ? after : undefined,
        limit: PAGE_SIZE,
      });

      if (!result.ok) throw new Error(result.error || "list failed");

      if (result.peer) {
        this.setData({
          peerOpenid: result.peer.openid || this.data.peerOpenid,
          peerNickName: result.peer.nickName || this.data.peerNickName,
          peerAvatarUrl: result.peer.avatarUrl || this.data.peerAvatarUrl || DEFAULT_AVATAR,
        });
        this.applyI18n();
      }

      let merged;
      if (reset) {
        // 增量 after：与本地合并；若无 after 则用服务器页替换近端
        if (after) {
          merged = mergeCachedMessages(conversationId, result.list || []);
          // 若本地很少，再拉一页历史填满
          if (merged.length < 12) {
            const older = await listMessages({
              conversationId,
              before: merged[0] && merged[0].createdAt,
              limit: PAGE_SIZE,
            });
            if (older.ok) {
              merged = mergeCachedMessages(conversationId, older.list || []);
              this.setData({ hasMore: !!older.hasMore });
            }
          } else {
            this.setData({ hasMore: true });
          }
        } else {
          const serverList = result.list || [];
          const weekList = serverList.filter((m) => withinWeek(m.createdAt));
          merged = mergeCachedMessages(conversationId, weekList);
          // 超过 7 天的仅展示本页，不强制写入长期缓存（merge 已裁剪）
          const olderOnly = serverList.filter((m) => !withinWeek(m.createdAt));
          if (olderOnly.length) {
            const map = {};
            merged.concat(olderOnly).forEach((m) => {
              if (m && m.id) map[m.id] = m;
            });
            merged = Object.keys(map)
              .map((id) => map[id])
              .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
          }
          this.setData({ hasMore: !!result.hasMore });
        }
      } else {
        const serverList = result.list || [];
        const weekList = serverList.filter((m) => withinWeek(m.createdAt));
        if (weekList.length) mergeCachedMessages(conversationId, weekList);
        const map = {};
        (serverList || []).concat(this.data.list).forEach((m) => {
          if (m && m.id) map[m.id] = m;
        });
        merged = Object.keys(map)
          .map((id) => map[id])
          .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        this.setData({ hasMore: !!result.hasMore });
      }

      const mapped = this.mapMessages(merged);
      const patch = {
        list: mapped,
        loading: false,
        loadingMore: false,
      };
      if (reset && mapped.length) {
        patch.scrollIntoView = `msg-${mapped[mapped.length - 1].id}`;
      }
      this.setData(patch, () => this.updateTopSpace());
    } catch (err) {
      console.error("load messages failed", err);
      this.setData({ loading: false, loadingMore: false });
      wx.showToast({ title: t("common.operationFailed"), icon: "none" });
    }
  },

  onScrollToUpper() {
    const first = this.data.list[0];
    if (!first) return;
    this.loadMessages({ before: first.createdAt });
  },

  openWatch() {
    this.closeWatch();
    const conversationId = this.data.conversationId;
    if (!conversationId || !wx.cloud || !wx.cloud.database) return;
    try {
      const db = wx.cloud.database();
      this._watcher = db
        .collection("messages")
        .where({ conversationId })
        .watch({
          onChange: (snapshot) => {
            const docs = snapshot.docs || [];
            if (!docs.length && snapshot.type === "init") return;
            const incoming = docs.map((d) => ({
              id: d._id,
              conversationId: d.conversationId,
              clientMsgId: d.clientMsgId || "",
              senderOpenid: d.senderOpenid,
              type: d.type,
              content: d.status === "recalled" ? "" : d.content || "",
              media: d.status === "recalled" ? null : d.media || null,
              quote: d.status === "recalled" ? null : d.quote || null,
              postCard: d.status === "recalled" ? null : d.postCard || null,
              historyCard: d.status === "recalled" ? null : d.historyCard || null,
              status: d.status || "normal",
              createdAt: d.createdAt,
              mine: d.senderOpenid === this.data.myOpenid,
            }));
            const week = incoming.filter((m) => withinWeek(m.createdAt));
            const merged = mergeCachedMessages(conversationId, week);
            const map = {};
            const byClient = {};
            merged.concat(this.data.list || []).concat(incoming).forEach((m) => {
              if (!m || !m.id) return;
              if (m.clientMsgId) {
                const prev = byClient[m.clientMsgId];
                if (prev && prev.pending && !m.pending) {
                  delete map[prev.id];
                }
                if (prev && !prev.pending && m.pending) {
                  return;
                }
                byClient[m.clientMsgId] = m;
              }
              map[m.id] = m;
            });
            const all = Object.keys(map)
              .map((id) => map[id])
              .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            const mapped = this.mapMessages(all);
            const last = mapped[mapped.length - 1];
            this.setData({
              list: mapped,
              scrollIntoView: last ? `msg-${last.id}` : "",
            });
            markRead(conversationId).catch(() => {});
          },
          onError: (err) => {
            console.warn("chat watch error", err);
          },
        });
    } catch (e) {
      console.warn("chat watch init failed", e);
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

  onTapPeer() {
    openUserProfile({ openid: this.data.peerOpenid, source: "default" });
  },

  async doSend({ msgType, content = "", media = null, clientMsgId = "" }) {
    const conversationId = this.data.conversationId;
    if (!conversationId) return null;
    const msgId = clientMsgId || genClientMsgId();
    const quote = this.data.quote
      ? {
          messageId: this.data.quote.id,
        }
      : null;

    const result = await sendMessage({
      conversationId,
      msgType,
      content,
      media,
      quote,
      clientMsgId: msgId,
    });
    if (!result.ok || !result.message) {
      throw new Error(result.error || "send failed");
    }
    const merged = mergeCachedMessages(conversationId, [result.message]);
    // 保留尚未完成的本地 pending
    const pendingKeep = (this.data.list || []).filter(
      (m) => m.pending && m.clientMsgId !== msgId
    );
    const map = {};
    merged.concat(pendingKeep).forEach((m) => {
      if (m && m.id) map[m.id] = m;
    });
    const all = Object.keys(map)
      .map((id) => map[id])
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const mapped = this.mapMessages(all);
    const last = mapped[mapped.length - 1];
    this.setData(
      {
        list: mapped,
        scrollIntoView: last ? `msg-${last.id}` : "",
        quote: null,
        showPlus: false,
      },
      () => this.updateTopSpace()
    );
    return result.message;
  },

  upsertListItem(item) {
    if (!item || !item.id) return;
    const list = (this.data.list || []).slice();
    const idx = list.findIndex(
      (m) => m.id === item.id || (item.clientMsgId && m.clientMsgId === item.clientMsgId)
    );
    if (idx >= 0) list[idx] = { ...list[idx], ...item };
    else list.push(item);
    const mapped = this.mapMessages(list);
    const last = mapped[mapped.length - 1];
    this.setData(
      {
        list: mapped,
        scrollIntoView: last ? `msg-${last.id}` : "",
      },
      () => this.updateTopSpace()
    );
  },

  patchListItem(localId, patch) {
    const list = (this.data.list || []).map((m) =>
      m.id === localId ? { ...m, ...patch } : m
    );
    this.setData({ list: this.mapMessages(list) }, () => this.updateTopSpace());
  },

  async onSendText() {
    const text = (this.data.inputValue || "").trim();
    if (!text || this._sending) return;
    this._sending = true;
    try {
      await this.doSend({ msgType: "text", content: text });
      this.setData({ inputValue: "", quote: null, showEmoji: false });
    } catch (err) {
      console.error("send failed", err);
      this.showSendError(err);
    } finally {
      this._sending = false;
    }
  },

  async pickMedia(mediaType, sourceType) {
    this.setData({ showPlus: false }, () => this.updateTopSpace());
    try {
      const res = await new Promise((resolve, reject) => {
        wx.chooseMedia({
          count: 1,
          mediaType: [mediaType],
          sourceType,
          sizeType: ["compressed"],
          maxDuration: 60,
          success: resolve,
          fail: reject,
        });
      });
      const file = res.tempFiles && res.tempFiles[0];
      if (!file || !file.tempFilePath) return;

      const clientMsgId = genClientMsgId();
      const localId = `local_${clientMsgId}`;
      const localPath = file.tempFilePath;
      const duration = file.duration || 0;
      const width = file.width || 0;
      const height = file.height || 0;

      // 立刻插入带进度的骨架气泡
      this.upsertListItem({
        id: localId,
        clientMsgId,
        conversationId: this.data.conversationId,
        senderOpenid: this.data.myOpenid,
        type: mediaType,
        content: "",
        media: null,
        quote: null,
        status: "normal",
        createdAt: new Date().toISOString(),
        mine: true,
        pending: true,
        progress: 1,
        sendFailed: false,
        localPath,
      });

      let filePath = localPath;
      if (mediaType === "video") {
        try {
          const compressed = await new Promise((resolve, reject) => {
            wx.compressVideo({
              src: filePath,
              quality: "medium",
              success: resolve,
              fail: reject,
            });
          });
          if (compressed && compressed.tempFilePath) {
            filePath = compressed.tempFilePath;
          }
        } catch (e) {
          // keep original
        }
        this.patchListItem(localId, { progress: 8 });
      }

      const ext = mediaType === "video" ? "mp4" : "jpg";
      const fileId = await uploadChatFile(
        this.data.myOpenid,
        filePath,
        ext,
        (progress) => {
          // 上传占 0-90，发送占余下
          const p = Math.max(8, Math.min(90, Math.round(progress * 0.9)));
          this.patchListItem(localId, { progress: p });
        }
      );

      this.patchListItem(localId, { progress: 92 });
      let message;
      try {
        message = await this.doSend({
          msgType: mediaType,
          content: "",
          media: {
            fileId,
            width,
            height,
            duration,
            thumbFileId: "",
          },
          clientMsgId,
        });
      } catch (sendErr) {
        this.patchListItem(localId, { sendFailed: true, progress: 0 });
        this.showSendError(sendErr);
        return;
      }

      // 去掉本地 pending，保留服务端回显（doSend 已合并；再清一次 pending）
      const cleaned = (this.data.list || []).filter((m) => m.id !== localId);
      if (message) {
        const exists = cleaned.some((m) => m.id === message.id);
        if (!exists) cleaned.push(message);
      }
      const mapped = this.mapMessages(
        cleaned.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      );
      const last = mapped[mapped.length - 1];
      this.setData({
        list: mapped,
        scrollIntoView: last ? `msg-${last.id}` : "",
      });
      if (message) {
        mergeCachedMessages(this.data.conversationId, [message]);
      }
    } catch (err) {
      const msg = (err && err.errMsg) || "";
      if (msg.indexOf("cancel") > -1) return;
      console.error("pick media failed", err);
      // 标记最近一条 pending 失败
      const list = this.data.list || [];
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (list[i].pending && !list[i].sendFailed) {
          this.patchListItem(list[i].id, { sendFailed: true, progress: 0 });
          break;
        }
      }
    }
  },

  onLongPressMsg(e) {
    const id = e.currentTarget.dataset.id;
    const msg = (this.data.list || []).find((m) => m.id === id);
    if (!msg || msg.status === "recalled" || msg.pending) return;
    const ts = new Date(msg.createdAt).getTime();
    const canRecall =
      !!msg.mine && Number.isFinite(ts) && Date.now() - ts <= RECALL_MS;
    const query = this.createSelectorQuery();
    query.select(`#msg-${id} .room-bubble-wrap`).boundingClientRect();
    query.exec((res) => {
      const rect = res && res[0];
      let top = 120;
      let targetX = 187;
      let viewportCenter = 187;
      try {
        const windowInfo =
          typeof wx.getWindowInfo === "function"
            ? wx.getWindowInfo()
            : wx.getSystemInfoSync();
        viewportCenter = (windowInfo.windowWidth || 375) / 2;
      } catch (err) {
        // keep fallback
      }
      if (rect) {
        top = Math.max(80, rect.top - 12);
        targetX = rect.left + rect.width / 2;
      }
      this.setData({
        actionMsg: msg,
        showAction: true,
        canRecall,
        actionPos: { top, left: viewportCenter },
        actionArrowLeft: 130,
        showEmoji: false,
        showPlus: false,
      }, () => {
        const menuQuery = this.createSelectorQuery();
        menuQuery.select(".room-pop-menu").boundingClientRect();
        menuQuery.exec((menuRes) => {
          const menuRect = menuRes && menuRes[0];
          if (!menuRect || !this.data.showAction) return;
          const edge = 18;
          const arrowLeft = Math.max(
            edge,
            Math.min(menuRect.width - edge, targetX - menuRect.left)
          );
          this.setData({ actionArrowLeft });
        });
      });
    });
  },

  closeAction() {
    this.setData({ showAction: false, actionMsg: null });
  },

  onActionQuote() {
    const msg = this.data.actionMsg;
    if (!msg) return;
    const media = msg.media || null;
    this.setData({
      quote: this.normalizeQuote({
        id: msg.id,
        messageId: msg.id,
        preview: this.previewText(msg),
        type: msg.type,
        media,
        thumbUrl:
          (media && (media.thumbFileId || media.fileId)) ||
          msg.localPath ||
          "",
      }),
      showAction: false,
      actionMsg: null,
    });
  },

  async onActionDelete() {
    const msg = this.data.actionMsg;
    if (!msg) return;
    this.setData({ showAction: false });
    try {
      const res = await deleteMessage(msg.id);
      if (!res.ok) throw new Error(res.error || "delete failed");
      removeCachedMessage(this.data.conversationId, msg.id);
      const list = this.data.list.filter((m) => m.id !== msg.id);
      this.setData({ list, actionMsg: null }, () => this.updateTopSpace());
    } catch (e) {
      wx.showToast({ title: t("common.operationFailed"), icon: "none" });
    }
  },

  async onActionRecall() {
    const msg = this.data.actionMsg;
    if (!msg || !this.data.canRecall) {
      wx.showToast({ title: t("chat.recallExpired"), icon: "none" });
      return;
    }
    this.setData({ showAction: false });
    try {
      const res = await recallMessage(msg.id);
      if (!res.ok) {
        if (res.error === "recall_expired") {
          wx.showToast({ title: t("chat.recallExpired"), icon: "none" });
          return;
        }
        throw new Error(res.error || "recall failed");
      }
      const merged = mergeCachedMessages(this.data.conversationId, [res.message]);
      this.setData(
        { list: this.mapMessages(merged), actionMsg: null },
        () => this.updateTopSpace()
      );
    } catch (e) {
      wx.showToast({ title: t("common.operationFailed"), icon: "none" });
    }
  },

  async onActionForward() {
    const msg = this.data.actionMsg;
    if (!msg) return;
    this.setData({ showAction: false, showForward: true });
  },

  closeForward() {
    if (this.data.forwardSending) return;
    this.setData({ showForward: false, actionMsg: null });
  },

  async onForwardConfirm(e) {
    const msg = this.data.actionMsg;
    const peers = (e.detail && e.detail.peers) || [];
    const peerOpenids = peers.map((p) => p.openid).filter(Boolean);
    if (!msg || !peerOpenids.length || this.data.forwardSending) return;
    this.setData({ forwardSending: true });
    try {
      const res = await forwardMessage({ messageId: msg.id, peerOpenids });
      if (!res.ok) throw new Error(res.error || "forward failed");
      wx.showToast({ title: t("chat.forwardSuccess"), icon: "success" });
      this.setData({
        showForward: false,
        forwardSending: false,
        actionMsg: null,
      });
    } catch (err) {
      this.setData({ forwardSending: false });
      this.showSendError(err);
    }
  },

  onTapHistoryCard(e) {
    const id = e.currentTarget.dataset.id;
    const msg = (this.data.list || []).find((m) => m.id === id);
    if (!msg || !msg.historyCard) return;
    try {
      wx.setStorageSync("uknow_chat_history_view", msg.historyCard);
    } catch (err) {
      wx.showToast({ title: t("common.operationFailed"), icon: "none" });
      return;
    }
    wx.navigateTo({ url: "/pages/chat/history" });
  },

  onTapPostCard(e) {
    const postId = e.currentTarget.dataset.id;
    if (!postId) return;
    wx.navigateTo({ url: `/pages/post/detail?id=${postId}` });
  },

  onPreviewImage(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.previewImage({ urls: [url], current: url });
  },

  noop() {},
});
