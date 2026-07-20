const {
  t,
  getI18nData,
  onLocaleChange,
  getLocale,
  setLocale,
  applyUserLocale,
  DEFAULT_LOCALE,
} = require("./i18n/index");

App({
  onLaunch: function () {
    this.globalData = {
      // env 参数说明：
      // env 参数决定接下来小程序发起的云开发调用（wx.cloud.xxx）会请求到哪个云环境的资源
      // 此处请填入环境 ID, 环境 ID 可在微信开发者工具右上顶部工具栏点击云开发按钮打开获取
      env: "cloudbase-2gta2u0scd51b686",
      themeColor: "#028527",
      userInfo: null,
      locale: getLocale(),
    };
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true,
      });
    }

    try {
      this.globalData.userInfo = wx.getStorageSync("uknow_user") || null;
    } catch (e) {
      this.globalData.userInfo = null;
    }

    const loggedIn = !!(
      this.globalData.userInfo && this.globalData.userInfo.phoneNumber
    );
    if (loggedIn) {
      // 已登录：用本地缓存的用户语言先对齐（云端 getProfile 还会再校准）
      applyUserLocale(this.globalData.userInfo);
    } else {
      // 未登录：默认简体中文
      setLocale(DEFAULT_LOCALE);
    }
    this.globalData.locale = getLocale();

    onLocaleChange((locale) => {
      this.globalData.locale = locale;
    });
  },

  t,
  getI18nData,
});
