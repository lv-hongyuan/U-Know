const { t, setLocale, DEFAULT_LOCALE } = require("../i18n/index");

const USER_KEY = "uknow_user";
const DEFAULT_NICK_NAME = "微信用户";
const DEFAULT_AVATAR = "/images/default-avatar.svg";
const BIO_MAX_LENGTH = 60; // 约 20 字/行 × 3 行

function defaultNickName() {
  return t("common.wechatUser");
}

function getLocalUser() {
  try {
    return wx.getStorageSync(USER_KEY) || null;
  } catch (e) {
    return null;
  }
}

function setLocalUser(user) {
  const app = getApp();
  if (app && app.globalData) {
    app.globalData.userInfo = user;
  }
  if (user) {
    wx.setStorageSync(USER_KEY, user);
  } else {
    wx.removeStorageSync(USER_KEY);
  }
}

function clearLocalUser() {
  setLocalUser(null);
}

function logout() {
  clearLocalUser();
  setLocale(DEFAULT_LOCALE);
}

function isLoggedIn(user = getLocalUser()) {
  return !!(user && user.phoneNumber);
}

function displayNickName(user) {
  const nick = user && user.nickName;
  if (!nick || nick === DEFAULT_NICK_NAME || nick === "微信用户") {
    return defaultNickName();
  }
  return nick;
}

function displayAvatar(user) {
  return (user && user.avatarUrl) || DEFAULT_AVATAR;
}

function normalizeUser(user) {
  if (!user || !user.phoneNumber) return null;
  return {
    openid: user.openid || "",
    nickName: user.nickName || defaultNickName(),
    avatarUrl: user.avatarUrl || "",
    phoneNumber: user.phoneNumber,
    bio: user.bio || "",
    gender: user.gender || "secret",
    birthday: user.birthday || "",
    hometown: user.hometown || "",
    hometownProvince: user.hometownProvince || "",
    hometownCity: user.hometownCity || "",
    schoolId: user.schoolId || "",
    schoolName: user.schoolName || "",
    schoolShortName: user.schoolShortName || "",
    schoolCampus: user.schoolCampus || "",
    schoolLogoUrl: user.schoolLogoUrl || "",
    showSchool: user.showSchool !== false,
    locale: user.locale || "",
    followerCount: Number(user.followerCount) || 0,
    followingCount: Number(user.followingCount) || 0,
    likeCollectCount: Number(user.likeCollectCount) || 0,
    shortId: user.shortId || "",
  };
}

module.exports = {
  USER_KEY,
  DEFAULT_NICK_NAME,
  DEFAULT_AVATAR,
  BIO_MAX_LENGTH,
  defaultNickName,
  getLocalUser,
  setLocalUser,
  clearLocalUser,
  logout,
  isLoggedIn,
  displayNickName,
  displayAvatar,
  normalizeUser,
};
