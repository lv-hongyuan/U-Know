Page({
  onShow() {
    // 中间「+」不切换到此页；若被意外进入则回到首页
    wx.switchTab({ url: "/pages/home/index" });
  },
});
