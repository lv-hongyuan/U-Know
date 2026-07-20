const {
  getLocalUser,
  setLocalUser,
  clearLocalUser,
  isLoggedIn,
  displayNickName,
  displayAvatar,
  normalizeUser,
  DEFAULT_AVATAR,
  DEFAULT_NICK_NAME,
  BIO_MAX_LENGTH,
} = require("../../utils/user");

const GENDER_LABELS = {
  male: "男",
  female: "女",
  secret: "保密",
};

Page({
  data: {
    avatarUrl: DEFAULT_AVATAR,
    nickName: "",
    phoneNumber: "",
    bio: "",
    bioCount: 0,
    bioMax: BIO_MAX_LENGTH,
    bioFocused: false,
    gender: "secret",
    genderLabel: "保密",
    draftGender: "secret",
    birthday: "",
    birthdayEnd: "",
    hometown: "",
    regionValue: [],
    showAvatarSheet: false,
    showAvatarPreview: false,
    showPhoneSheet: false,
    showGenderSheet: false,
    showLogoutConfirm: false,
    saving: false,
  },

  originalNickName: "",
  originalBio: "",
  bioBlurTimer: null,

  noop() {},

  onLoad() {
    const now = new Date();
    const y = now.getFullYear();
    const m = `${now.getMonth() + 1}`.padStart(2, "0");
    const d = `${now.getDate()}`.padStart(2, "0");
    this.setData({ birthdayEnd: `${y}-${m}-${d}` });
  },

  onShow() {
    const user = getLocalUser();
    if (!isLoggedIn(user)) {
      wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/profile/index" }) });
      return;
    }
    this.applyLocalUser(user);
    this.refreshFromCloud();
  },

  applyLocalUser(raw) {
    const user = normalizeUser(raw);
    if (!user) return;

    const nickName =
      displayNickName(user) === DEFAULT_NICK_NAME ? "" : displayNickName(user);
    this.originalNickName = nickName;
    this.originalBio = user.bio || "";

    const regionValue =
      user.hometownProvince && user.hometownCity
        ? [user.hometownProvince, user.hometownCity]
        : [];

    this.setData({
      avatarUrl: displayAvatar(user),
      nickName,
      phoneNumber: user.phoneNumber,
      bio: user.bio || "",
      bioCount: (user.bio || "").length,
      bioFocused: false,
      gender: user.gender || "secret",
      genderLabel: GENDER_LABELS[user.gender] || "保密",
      birthday: user.birthday || "",
      hometown: user.hometown || "",
      regionValue,
    });
  },

  async refreshFromCloud() {
    try {
      const res = await wx.cloud.callFunction({
        name: "login",
        data: { type: "getProfile" },
      });
      const result = res.result || {};
      if (!result.ok || !result.user) return;
      const user = normalizeUser(result.user);
      if (!user) return;
      setLocalUser(user);
      this.applyLocalUser(user);
    } catch (e) {
      console.warn("refreshFromCloud failed", e);
    }
  },

  onTapAvatar() {
    this.setData({ showAvatarSheet: true });
  },

  onPreviewAvatar() {
    const url = this.data.avatarUrl;
    if (!url || url === DEFAULT_AVATAR) {
      wx.showToast({ title: "暂无头像可预览", icon: "none" });
      return;
    }
    this.setData({ showAvatarPreview: true });
  },

  onCloseAvatarPreview() {
    this.setData({ showAvatarPreview: false });
  },

  async onSaveAvatarToAlbum() {
    const url = this.data.avatarUrl;
    if (!url || url === DEFAULT_AVATAR) {
      wx.showToast({ title: "暂无头像可保存", icon: "none" });
      return;
    }

    wx.showLoading({ title: "保存中", mask: true });
    try {
      let filePath = url;
      if (url.indexOf("cloud://") === 0) {
        const down = await wx.cloud.downloadFile({ fileID: url });
        filePath = down.tempFilePath;
      } else if (url.indexOf("http://") === 0 || url.indexOf("https://") === 0) {
        const down = await wx.downloadFile({ url });
        if (down.statusCode !== 200) throw new Error("download failed");
        filePath = down.tempFilePath;
      }

      await this.saveImageWithAuth(filePath);
      wx.showToast({ title: "已保存到相册", icon: "success" });
    } catch (err) {
      console.error("save avatar failed", err);
      if (err && (err.errMsg || "").indexOf("auth deny") > -1) {
        wx.showModal({
          title: "需要相册权限",
          content: "请在设置中允许保存到相册",
          confirmText: "去设置",
          success: (res) => {
            if (res.confirm) wx.openSetting({});
          },
        });
      } else {
        wx.showToast({ title: "保存失败", icon: "none" });
      }
    } finally {
      wx.hideLoading();
    }
  },

  saveImageWithAuth(filePath) {
    return new Promise((resolve, reject) => {
      wx.getSetting({
        success: (setting) => {
          const auth = setting.authSetting || {};
          const doSave = () => {
            wx.saveImageToPhotosAlbum({
              filePath,
              success: resolve,
              fail: reject,
            });
          };

          if (auth["scope.writePhotosAlbum"] === false) {
            reject({ errMsg: "auth deny" });
            return;
          }

          if (auth["scope.writePhotosAlbum"]) {
            doSave();
            return;
          }

          wx.authorize({
            scope: "scope.writePhotosAlbum",
            success: doSave,
            fail: () => reject({ errMsg: "auth deny" }),
          });
        },
        fail: reject,
      });
    });
  },

  onCloseAvatarSheet() {
    this.setData({ showAvatarSheet: false });
  },

  onChooseWechatAvatar(e) {
    const { avatarUrl } = e.detail || {};
    this.setData({ showAvatarSheet: false });
    if (!avatarUrl) return;
    this.uploadAndSaveAvatar(avatarUrl);
  },

  async onPickCamera() {
    this.setData({ showAvatarSheet: false });
    try {
      const res = await wx.chooseMedia({
        count: 1,
        mediaType: ["image"],
        sourceType: ["camera"],
        sizeType: ["compressed"],
      });
      const file = res.tempFiles && res.tempFiles[0];
      if (!file || !file.tempFilePath) return;
      this.uploadAndSaveAvatar(file.tempFilePath);
    } catch (e) {
      if (e && e.errMsg && e.errMsg.includes("cancel")) return;
      wx.showToast({ title: "拍摄失败", icon: "none" });
    }
  },

  async onPickAlbum() {
    this.setData({ showAvatarSheet: false });
    try {
      const res = await wx.chooseMedia({
        count: 1,
        mediaType: ["image"],
        sourceType: ["album"],
        sizeType: ["compressed"],
      });
      const file = res.tempFiles && res.tempFiles[0];
      if (!file || !file.tempFilePath) return;
      this.uploadAndSaveAvatar(file.tempFilePath);
    } catch (e) {
      if (e && e.errMsg && e.errMsg.includes("cancel")) return;
      wx.showToast({ title: "选择失败", icon: "none" });
    }
  },

  onNickInput(e) {
    this.setData({ nickName: e.detail.value || "" });
  },

  async uploadAndSaveAvatar(filePath) {
    if (this.data.saving) return;
    this.setData({ saving: true });
    wx.showLoading({ title: "上传中", mask: true });

    try {
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `avatars/${Date.now()}-${Math.floor(Math.random() * 10000)}.jpg`,
        filePath,
      });
      const result = await this.updateProfile({ avatarUrl: uploadRes.fileID });
      this.setData({
        avatarUrl: displayAvatar(result),
        saving: false,
      });
      wx.showToast({ title: "头像已更新", icon: "success" });
    } catch (err) {
      console.error("upload avatar failed", err);
      this.setData({ saving: false });
      this.handleSaveError(err, "头像更新失败");
    } finally {
      wx.hideLoading();
    }
  },

  async onSaveNickName() {
    if (this.data.saving) return;
    const nickName = (this.data.nickName || "").trim();
    if (nickName === this.originalNickName) return;
    if (!nickName) {
      wx.showToast({ title: "请输入昵称", icon: "none" });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: "保存中", mask: true });
    try {
      const result = await this.updateProfile({ nickName });
      this.originalNickName =
        displayNickName(result) === DEFAULT_NICK_NAME ? "" : displayNickName(result);
      this.setData({ nickName: this.originalNickName, saving: false });
      wx.showToast({ title: "已保存", icon: "success" });
    } catch (err) {
      this.setData({ saving: false });
      this.handleSaveError(err, "保存失败");
    } finally {
      wx.hideLoading();
    }
  },

  onTapPhone() {
    this.setData({ showPhoneSheet: true });
  },

  onClosePhoneSheet() {
    if (this.data.saving) return;
    this.setData({ showPhoneSheet: false });
  },

  async onChangePhone(e) {
    if (this.data.saving) return;
    const { code, errMsg } = e.detail || {};
    if (!code) {
      wx.showToast({
        title: errMsg && errMsg.indexOf("deny") > -1 ? "需要授权手机号" : "授权失败",
        icon: "none",
      });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: "更换中", mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: "login",
        data: { type: "changePhone", phoneCode: code },
      });
      const result = res.result || {};
      if (!result.ok || !result.user) {
        throw new Error(result.message || result.error || "更换失败");
      }
      const user = normalizeUser(result.user);
      setLocalUser(user);
      this.setData({
        phoneNumber: user.phoneNumber,
        showPhoneSheet: false,
        saving: false,
      });
      wx.showToast({ title: "手机号已更新", icon: "success" });
    } catch (err) {
      console.error("change phone failed", err);
      this.setData({ saving: false });
      this.handleSaveError(err, "更换失败");
    } finally {
      wx.hideLoading();
    }
  },

  onBioInput(e) {
    const bio = (e.detail.value || "").slice(0, BIO_MAX_LENGTH);
    this.setData({ bio, bioCount: bio.length });
  },

  onBioFocus() {
    if (this.bioBlurTimer) {
      clearTimeout(this.bioBlurTimer);
      this.bioBlurTimer = null;
    }
    this.setData({ bioFocused: true });
  },

  onBioBlur() {
    // 延迟隐藏，避免点「保存」时先失焦导致按钮消失
    this.bioBlurTimer = setTimeout(() => {
      this.setData({ bioFocused: false });
      // 未保存则回滚文案
      if ((this.data.bio || "").trim() !== this.originalBio) {
        this.setData({
          bio: this.originalBio,
          bioCount: this.originalBio.length,
        });
      }
    }, 180);
  },

  async onSaveBio() {
    if (this.bioBlurTimer) {
      clearTimeout(this.bioBlurTimer);
      this.bioBlurTimer = null;
    }
    if (this.data.saving) return;
    const bio = (this.data.bio || "").trim();
    if (bio === this.originalBio) {
      this.setData({ bioFocused: false });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: "保存中", mask: true });
    try {
      const result = await this.updateProfile({ bio });
      this.originalBio = result.bio || "";
      this.setData({
        bio: this.originalBio,
        bioCount: this.originalBio.length,
        bioFocused: false,
        saving: false,
      });
      wx.showToast({ title: "已保存", icon: "success" });
    } catch (err) {
      this.setData({ saving: false });
      this.handleSaveError(err, "保存失败");
    } finally {
      wx.hideLoading();
    }
  },

  onTapGender() {
    this.setData({
      showGenderSheet: true,
      draftGender: this.data.gender || "secret",
    });
  },

  onCloseGenderSheet() {
    this.setData({ showGenderSheet: false });
  },

  onPickGender(e) {
    const gender = e.currentTarget.dataset.gender;
    if (!gender) return;
    this.setData({ draftGender: gender });
  },

  async onSaveGender() {
    if (this.data.saving) return;
    const gender = this.data.draftGender || "secret";
    if (gender === this.data.gender) {
      this.setData({ showGenderSheet: false });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: "保存中", mask: true });
    try {
      await this.updateProfile({ gender });
      this.setData({
        gender,
        genderLabel: GENDER_LABELS[gender] || "保密",
        showGenderSheet: false,
        saving: false,
      });
      wx.showToast({ title: "已保存", icon: "success" });
    } catch (err) {
      this.setData({ saving: false });
      this.handleSaveError(err, "保存失败");
    } finally {
      wx.hideLoading();
    }
  },

  async onBirthdayChange(e) {
    const birthday = e.detail.value;
    if (!birthday || birthday === this.data.birthday) return;
    const prev = this.data.birthday;
    this.setData({ birthday, saving: true });
    try {
      await this.updateProfile({ birthday });
      this.setData({ saving: false });
      wx.showToast({ title: "已保存", icon: "success" });
    } catch (err) {
      this.setData({ birthday: prev, saving: false });
      this.handleSaveError(err, "保存失败");
    }
  },

  async onHometownChange(e) {
    const value = e.detail.value || [];
    const province = value[0] || "";
    const city = value[1] || "";
    if (!province || !city) return;

    const hometown = `${province}-${city}`;
    if (hometown === this.data.hometown) return;

    const prev = {
      hometown: this.data.hometown,
      regionValue: this.data.regionValue,
    };

    this.setData({
      hometown,
      regionValue: [province, city],
      saving: true,
    });

    try {
      await this.updateProfile({
        hometown,
        hometownProvince: province,
        hometownCity: city,
      });
      this.setData({ saving: false });
      wx.showToast({ title: "已保存", icon: "success" });
    } catch (err) {
      this.setData({
        hometown: prev.hometown,
        regionValue: prev.regionValue,
        saving: false,
      });
      this.handleSaveError(err, "保存失败");
    }
  },

  onTapLogout() {
    this.setData({ showLogoutConfirm: true });
  },

  onCloseLogoutConfirm() {
    this.setData({ showLogoutConfirm: false });
  },

  onConfirmLogout() {
    clearLocalUser();
    this.setData({ showLogoutConfirm: false });
    wx.showToast({ title: "已退出登录", icon: "none" });
    setTimeout(() => {
      wx.navigateBack({
        fail: () => wx.switchTab({ url: "/pages/profile/index" }),
      });
    }, 400);
  },

  async updateProfile(patch) {
    const res = await wx.cloud.callFunction({
      name: "login",
      data: {
        type: "updateProfile",
        ...patch,
      },
    });
    const result = res.result || {};
    if (!result.ok || !result.user) {
      throw new Error(result.message || result.error || "保存失败");
    }
    const user = normalizeUser(result.user);
    setLocalUser(user);
    return user;
  },

  handleSaveError(err, fallback) {
    const msg = (err && err.message) || "";
    if (msg.includes("UNKNOWN_TYPE")) {
      wx.showModal({
        title: "云函数未更新",
        content: "请右键 cloudfunctions/login → 上传并部署：云端安装依赖后再试。",
        showCancel: false,
      });
      return;
    }
    wx.showToast({ title: fallback || "操作失败", icon: "none" });
  },
});
