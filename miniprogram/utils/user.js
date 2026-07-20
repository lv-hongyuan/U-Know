const USER_KEY = "uknow_user";
const DEFAULT_NICK_NAME = "微信用户";
const DEFAULT_AVATAR = "/images/default-avatar.svg";
const BIO_MAX_LENGTH = 60; // 约 20 字/行 × 3 行

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

function isLoggedIn(user = getLocalUser()) {
  return !!(user && user.phoneNumber);
}

function displayNickName(user) {
  return (user && user.nickName) || DEFAULT_NICK_NAME;
}

function displayAvatar(user) {
  return (user && user.avatarUrl) || DEFAULT_AVATAR;
}

function normalizeUser(user) {
  if (!user || !user.phoneNumber) return null;
  return {
    openid: user.openid || "",
    nickName: user.nickName || DEFAULT_NICK_NAME,
    avatarUrl: user.avatarUrl || "",
    phoneNumber: user.phoneNumber,
    bio: user.bio || "",
    gender: user.gender || "secret",
    birthday: user.birthday || "",
    hometown: user.hometown || "",
    hometownProvince: user.hometownProvince || "",
    hometownCity: user.hometownCity || "",
  };
}

module.exports = {
  USER_KEY,
  DEFAULT_NICK_NAME,
  DEFAULT_AVATAR,
  BIO_MAX_LENGTH,
  getLocalUser,
  setLocalUser,
  clearLocalUser,
  isLoggedIn,
  displayNickName,
  displayAvatar,
  normalizeUser,
};
