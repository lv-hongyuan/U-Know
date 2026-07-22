const { getI18nData, t } = require("../../i18n/index");
const { DEFAULT_AVATAR } = require("../../utils/user");
const { listSharePeers } = require("../../utils/chat");

const PAGE = 20;

Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: "" },
  },

  data: {
    t: getI18nData(),
    keyword: "",
    list: [],
    selected: {},
    selectedCount: 0,
    loading: false,
    loadingMore: false,
    hasMore: true,
    skip: 0,
    defaultAvatar: DEFAULT_AVATAR,
  },

  observers: {
    show(val) {
      if (val) {
        this.setData({
          t: getI18nData(),
          keyword: "",
          selected: {},
          selectedCount: 0,
        });
        this.reload();
      }
    },
  },

  methods: {
    noop() {},

    onClose() {
      this.triggerEvent("close");
    },

    onSearch(e) {
      const keyword = (e.detail && e.detail.value) || "";
      this.setData({ keyword });
      if (this._timer) clearTimeout(this._timer);
      this._timer = setTimeout(() => this.reload(), 280);
    },

    async reload() {
      this.setData({
        list: [],
        skip: 0,
        hasMore: true,
        loading: true,
      });
      await this.loadMore({ reset: true });
    },

    async onScrollToLower() {
      if (!this.data.hasMore || this.data.loadingMore || this.data.loading) return;
      await this.loadMore({ reset: false });
    },

    async loadMore({ reset } = {}) {
      if (reset) {
        // already set loading
      } else {
        this.setData({ loadingMore: true });
      }
      try {
        const skip = reset ? 0 : this.data.skip;
        const res = await listSharePeers({
          keyword: this.data.keyword,
          skip,
          limit: PAGE,
        });
        if (!res.ok) throw new Error(res.error || "list failed");
        const chunk = (res.list || []).map((u) => ({
          openid: u.openid,
          nickName: u.nickName || t("common.wechatUser"),
          avatarUrl: u.avatarUrl || DEFAULT_AVATAR,
        }));
        const list = reset ? chunk : (this.data.list || []).concat(chunk);
        this.setData({
          list,
          skip: skip + chunk.length,
          hasMore: !!res.hasMore,
          loading: false,
          loadingMore: false,
        });
      } catch (e) {
        console.error("friend picker load failed", e);
        this.setData({ loading: false, loadingMore: false, hasMore: false });
        if (reset) {
          this.setData({ list: [] });
          wx.showToast({ title: t("common.operationFailed"), icon: "none" });
        }
      }
    },

    onToggle(e) {
      const openid = e.currentTarget.dataset.openid;
      if (!openid) return;
      const selected = Object.assign({}, this.data.selected);
      if (selected[openid]) delete selected[openid];
      else selected[openid] = true;
      this.setData({
        selected,
        selectedCount: Object.keys(selected).length,
      });
    },

    onConfirm() {
      const selected = this.data.selected || {};
      const peers = (this.data.list || []).filter((u) => selected[u.openid]);
      // 已选但不在当前页的：只带 openid
      Object.keys(selected).forEach((id) => {
        if (!peers.find((p) => p.openid === id)) {
          peers.push({ openid: id, nickName: "", avatarUrl: "" });
        }
      });
      if (!peers.length) {
        wx.showToast({ title: t("chat.pickFriendFirst"), icon: "none" });
        return;
      }
      this.triggerEvent("confirm", { peers });
    },
  },
});
