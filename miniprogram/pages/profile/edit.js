const {
  getLocalUser,
  setLocalUser,
  logout,
  isLoggedIn,
  displayNickName,
  displayAvatar,
  normalizeUser,
  DEFAULT_AVATAR,
  defaultNickName,
  BIO_MAX_LENGTH,
} = require("../../utils/user");
const {
  getI18nData,
  t,
  onLocaleChange,
  getLocale,
  setLocale,
  applyUserLocale,
  getLocaleOptions,
  getLocaleLabel,
} = require("../../i18n/index");

function genderLabelOf(gender) {
  if (gender === "male") return t("edit.male");
  if (gender === "female") return t("edit.female");
  return t("edit.secret");
}

Page({
  data: {
    t: getI18nData(),
    avatarUrl: DEFAULT_AVATAR,
    nickName: "",
    shortId: "",
    phoneNumber: "",
    bio: "",
    bioCount: 0,
    bioMax: BIO_MAX_LENGTH,
    bioFocused: false,
    gender: "secret",
    genderLabel: "",
    draftGender: "secret",
    birthday: "",
    birthdayEnd: "",
    hometown: "",
    regionValue: [],
    schoolId: "",
    schoolLabel: "",
    showSchool: true,
    locale: getLocale(),
    localeLabel: getLocaleLabel(getLocale()),
    localeOptions: getLocaleOptions(),
    showAvatarSheet: false,
    showAvatarPreview: false,
    showPhoneSheet: false,
    showGenderSheet: false,
    showLocaleSheet: false,
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
    this.setData({
      birthdayEnd: `${y}-${m}-${d}`,
      genderLabel: genderLabelOf("secret"),
    });
    this._offLocale = onLocaleChange(() => this.applyI18n());
  },

  onUnload() {
    if (this._offLocale) this._offLocale();
    if (this.bioBlurTimer) clearTimeout(this.bioBlurTimer);
  },

  onShow() {
    this.applyI18n();
    const user = getLocalUser();
    if (!isLoggedIn(user)) {
      wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/profile/index" }) });
      return;
    }
    this.applyLocalUser(user);
    this.refreshFromCloud();
  },

  applyI18n() {
    const locale = getLocale();
    this.setData({
      t: getI18nData(),
      locale,
      localeLabel: getLocaleLabel(locale),
      localeOptions: getLocaleOptions(),
      genderLabel: genderLabelOf(this.data.gender || "secret"),
    });
    wx.setNavigationBarTitle({ title: t("nav.editProfile") });
  },

  applyLocalUser(raw) {
    const user = normalizeUser(raw);
    if (!user) return;

    applyUserLocale(user);

    const nickName =
      displayNickName(user) === defaultNickName() ? "" : displayNickName(user);
    this.originalNickName = nickName;
    this.originalBio = user.bio || "";

    const regionValue =
      user.hometownProvince && user.hometownCity
        ? [user.hometownProvince, user.hometownCity]
        : [];

    let schoolLabel = "";
    if (user.schoolName) {
      schoolLabel = user.schoolCampus
        ? `${user.schoolName} · ${user.schoolCampus}`
        : user.schoolName;
    }

    this.setData({
      avatarUrl: displayAvatar(user),
      nickName,
      shortId: user.shortId || "",
      phoneNumber: user.phoneNumber,
      bio: user.bio || "",
      bioCount: (user.bio || "").length,
      bioFocused: false,
      gender: user.gender || "secret",
      genderLabel: genderLabelOf(user.gender || "secret"),
      birthday: user.birthday || "",
      hometown: user.hometown || "",
      regionValue,
      schoolId: user.schoolId || "",
      schoolLabel,
      showSchool: user.showSchool !== false,
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

  async refreshFromCloud() {
    if (!isLoggedIn()) return;
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
      wx.showToast({ title: t("edit.noAvatarPreview"), icon: "none" });
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
      wx.showToast({ title: t("edit.noAvatarSave"), icon: "none" });
      return;
    }

    wx.showLoading({ title: t("common.saving"), mask: true });
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
      wx.showToast({ title: t("edit.savedToAlbum"), icon: "success" });
    } catch (err) {
      console.error("save avatar failed", err);
      if (err && (err.errMsg || "").indexOf("auth deny") > -1) {
        wx.showModal({
          title: t("edit.albumAuthTitle"),
          content: t("edit.albumAuthContent"),
          confirmText: t("edit.goSettings"),
          success: (res) => {
            if (res.confirm) wx.openSetting({});
          },
        });
      } else {
        wx.showToast({ title: t("common.saveFailed"), icon: "none" });
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

  /**
   * 选图后立刻调起微信原生 1:1 裁剪（需在用户手势/选图 success 同步链路中调用）
   * 确认裁剪后再上传；取消裁剪则不上传
   */
  openCropThenUpload(src) {
    if (!src) return;

    if (typeof wx.cropImage !== "function") {
      wx.showModal({
        title: t("edit.cropUnsupportedTitle"),
        content: t("edit.cropUnsupportedContent"),
        showCancel: false,
      });
      return;
    }

    wx.cropImage({
      src,
      cropScale: "1:1",
      success: (res) => {
        const path = res && res.tempFilePath;
        if (!path) {
          wx.showToast({ title: t("edit.cropFailed"), icon: "none" });
          return;
        }
        this.uploadAndSaveAvatar(path);
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || "";
        if (msg.indexOf("cancel") > -1) return;
        console.error("cropImage fail", err);
        wx.showToast({ title: t("edit.cropRequired"), icon: "none" });
      },
    });
  },

  onChooseWechatAvatar(e) {
    const { avatarUrl } = e.detail || {};
    if (!avatarUrl) return;
    // 先同步调起裁剪，再关弹层，避免打断手势链路
    this.openCropThenUpload(avatarUrl);
    this.setData({ showAvatarSheet: false });
  },

  onPickCamera() {
    this.setData({ showAvatarSheet: false });
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["camera"],
      sizeType: ["original", "compressed"],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file || !file.tempFilePath) return;
        this.openCropThenUpload(file.tempFilePath);
      },
      fail: (e) => {
        if (e && e.errMsg && e.errMsg.includes("cancel")) return;
        wx.showToast({ title: t("edit.cameraFailed"), icon: "none" });
      },
    });
  },

  onPickAlbum() {
    this.setData({ showAvatarSheet: false });
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album"],
      sizeType: ["original", "compressed"],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file || !file.tempFilePath) return;
        this.openCropThenUpload(file.tempFilePath);
      },
      fail: (e) => {
        if (e && e.errMsg && e.errMsg.includes("cancel")) return;
        wx.showToast({ title: t("edit.pickFailed"), icon: "none" });
      },
    });
  },

  onNickInput(e) {
    this.setData({ nickName: e.detail.value || "" });
  },

  async uploadAndSaveAvatar(filePath) {
    if (this.data.saving) return;
    this.setData({ saving: true });
    wx.showLoading({ title: t("common.uploading"), mask: true });

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
      wx.showToast({ title: t("edit.avatarUpdated"), icon: "success" });
    } catch (err) {
      console.error("upload avatar failed", err);
      this.setData({ saving: false });
      this.handleSaveError(err, t("edit.avatarUpdateFailed"));
    } finally {
      wx.hideLoading();
    }
  },

  async onSaveNickName() {
    if (this.data.saving) return;
    const nickName = (this.data.nickName || "").trim();
    if (nickName === this.originalNickName) return;
    if (!nickName) {
      wx.showToast({ title: t("edit.enterNickName"), icon: "none" });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: t("common.saving"), mask: true });
    try {
      const result = await this.updateProfile({ nickName });
      this.originalNickName =
        displayNickName(result) === defaultNickName()
          ? ""
          : displayNickName(result);
      this.setData({ nickName: this.originalNickName, saving: false });
      wx.showToast({ title: t("common.saved"), icon: "success" });
    } catch (err) {
      this.setData({ saving: false });
      this.handleSaveError(err, t("common.saveFailed"));
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
        title:
          errMsg && errMsg.indexOf("deny") > -1
            ? t("profile.needPhoneAuth")
            : t("profile.authFailed"),
        icon: "none",
      });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: t("edit.changing"), mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: "login",
        data: { type: "changePhone", phoneCode: code },
      });
      const result = res.result || {};
      if (!result.ok || !result.user) {
        throw new Error(
          result.message || result.error || t("edit.changeFailed")
        );
      }
      const user = normalizeUser(result.user);
      setLocalUser(user);
      this.setData({
        phoneNumber: user.phoneNumber,
        showPhoneSheet: false,
        saving: false,
      });
      wx.showToast({ title: t("edit.phoneUpdated"), icon: "success" });
    } catch (err) {
      console.error("change phone failed", err);
      this.setData({ saving: false });
      this.handleSaveError(err, t("edit.changeFailed"));
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
    wx.showLoading({ title: t("common.saving"), mask: true });
    try {
      const result = await this.updateProfile({ bio });
      this.originalBio = result.bio || "";
      this.setData({
        bio: this.originalBio,
        bioCount: this.originalBio.length,
        bioFocused: false,
        saving: false,
      });
      wx.showToast({ title: t("common.saved"), icon: "success" });
    } catch (err) {
      this.setData({ saving: false });
      this.handleSaveError(err, t("common.saveFailed"));
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
    wx.showLoading({ title: t("common.saving"), mask: true });
    try {
      await this.updateProfile({ gender });
      this.setData({
        gender,
        genderLabel: genderLabelOf(gender),
        showGenderSheet: false,
        saving: false,
      });
      wx.showToast({ title: t("common.saved"), icon: "success" });
    } catch (err) {
      this.setData({ saving: false });
      this.handleSaveError(err, t("common.saveFailed"));
    } finally {
      wx.hideLoading();
    }
  },

  onTapLocale() {
    this.setData({ showLocaleSheet: true });
  },

  onCloseLocaleSheet() {
    this.setData({ showLocaleSheet: false });
  },

  onPickLocale(e) {
    const code = e.currentTarget.dataset.code;
    if (!code) return;
    if (code === this.data.locale) {
      this.setData({ showLocaleSheet: false });
      return;
    }

    const prev = this.data.locale;
    setLocale(code);
    this.setData({ showLocaleSheet: false });

    // 编辑页仅登录可进；仍按登录态决定是否写用户表
    if (!isLoggedIn()) {
      wx.showToast({ title: t("common.saved"), icon: "success" });
      return;
    }

    this.setData({ saving: true });
    this.updateProfile({ locale: code })
      .then(() => {
        this.setData({ saving: false });
        wx.showToast({ title: t("common.saved"), icon: "success" });
      })
      .catch((err) => {
        setLocale(prev);
        this.setData({ saving: false });
        this.handleSaveError(err, t("common.saveFailed"));
      });
  },

  async onBirthdayChange(e) {
    const birthday = e.detail.value;
    if (!birthday || birthday === this.data.birthday) return;
    const prev = this.data.birthday;
    this.setData({ birthday, saving: true });
    try {
      await this.updateProfile({ birthday });
      this.setData({ saving: false });
      wx.showToast({ title: t("common.saved"), icon: "success" });
    } catch (err) {
      this.setData({ birthday: prev, saving: false });
      this.handleSaveError(err, t("common.saveFailed"));
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
      wx.showToast({ title: t("common.saved"), icon: "success" });
    } catch (err) {
      this.setData({
        hometown: prev.hometown,
        regionValue: prev.regionValue,
        saving: false,
      });
      this.handleSaveError(err, t("common.saveFailed"));
    }
  },

  onTapSchool() {
    wx.navigateTo({ url: "/pages/profile/school-picker" });
  },

  async onShowSchoolChange(e) {
    const showSchool = !!(e.detail && e.detail.value);
    const prev = this.data.showSchool;
    this.setData({ showSchool, saving: true });
    try {
      await this.updateProfile({ showSchool });
      this.setData({ saving: false });
    } catch (err) {
      this.setData({ showSchool: prev, saving: false });
      this.handleSaveError(err, t("common.saveFailed"));
    }
  },

  onTapLogout() {
    this.setData({ showLogoutConfirm: true });
  },

  onCloseLogoutConfirm() {
    this.setData({ showLogoutConfirm: false });
  },

  onConfirmLogout() {
    logout();
    this.setData({ showLogoutConfirm: false });
    wx.showToast({ title: t("edit.loggedOut"), icon: "none" });
    wx.switchTab({ url: "/pages/profile/index" });
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
      throw new Error(result.message || result.error || t("common.saveFailed"));
    }
    const user = normalizeUser(result.user);
    setLocalUser(user);
    return user;
  },

  handleSaveError(err, fallback) {
    const msg = (err && err.message) || "";
    if (msg.includes("UNKNOWN_TYPE")) {
      wx.showModal({
        title: t("edit.cloudOutdatedTitle"),
        content: t("edit.cloudOutdatedContent"),
        showCancel: false,
      });
      return;
    }
    wx.showToast({
      title: fallback || t("common.operationFailed"),
      icon: "none",
    });
  },
});
