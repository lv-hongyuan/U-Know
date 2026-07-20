const {
  getLocalUser,
  setLocalUser,
  isLoggedIn,
  displayNickName,
  displayAvatar,
  normalizeUser,
  DEFAULT_AVATAR,
  DEFAULT_NICK_NAME,
} = require("../../utils/user");

Page({
  data: {
    loggedIn: false,
    nickName: DEFAULT_NICK_NAME,
    avatarUrl: DEFAULT_AVATAR,
    phoneNumber: "",
    showLogin: false,
    submitting: false,
  },

  noop() {},

  onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 4 });
    }
    this.syncUser();
    this.refreshUserFromCloud();
  },

  applyUser(user) {
    const normalized = normalizeUser(user);
    if (normalized) {
      this.setData({
        loggedIn: true,
        nickName: displayNickName(normalized),
        avatarUrl: displayAvatar(normalized),
        phoneNumber: normalized.phoneNumber,
      });
      return;
    }

    this.setData({
      loggedIn: false,
      nickName: DEFAULT_NICK_NAME,
      avatarUrl: DEFAULT_AVATAR,
      phoneNumber: "",
    });
  },

  syncUser() {
    this.applyUser(getLocalUser());
  },

  async refreshUserFromCloud() {
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

      if (getLocalUser()) {
        setLocalUser(null);
        this.applyUser(null);
      }
    } catch (e) {
      console.warn("refreshUserFromCloud failed", e);
    }
  },

  onTapHeader() {
    if (this.data.loggedIn) {
      wx.navigateTo({ url: "/pages/profile/edit" });
      return;
    }
    this.setData({ showLogin: true });
  },

  onCloseLogin() {
    if (this.data.submitting) return;
    this.setData({ showLogin: false });
  },

  async onGetPhoneNumber(e) {
    if (this.data.submitting) return;

    const { code, errMsg } = e.detail || {};
    if (!code) {
      wx.showToast({
        title: errMsg && errMsg.indexOf("deny") > -1 ? "需要授权手机号" : "授权失败",
        icon: "none",
      });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: "登录中", mask: true });

    try {
      const loginRes = await wx.cloud.callFunction({
        name: "login",
        data: {
          type: "login",
          phoneCode: code,
        },
      });

      const result = loginRes.result || {};
      if (!result.ok || !result.user) {
        throw new Error(result.message || result.error || "登录失败");
      }

      const normalized = normalizeUser(result.user);
      setLocalUser(normalized);
      this.setData({
        showLogin: false,
        submitting: false,
      });
      this.applyUser(normalized);
      wx.showToast({ title: "登录成功", icon: "success" });
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
          title: "云函数 login 未部署",
          content:
            "请右键 cloudfunctions/login → 上传并部署：云端安装依赖后再试。",
          showCancel: false,
        });
      } else {
        wx.showToast({ title: "登录失败，请重试", icon: "none" });
      }
    } finally {
      wx.hideLoading();
    }
  },
});
