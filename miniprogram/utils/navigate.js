/**
 * 打开用户主页。
 *
 * source:
 * - author — 帖子作者头像：若栈中已有该用户主页则 navigateBack，避免循环堆栈
 * - comment | notify | default — 始终 navigateTo，允许无限前进
 */
const USER_ROUTE = "pages/user/index";

function openUserProfile({ openid, source = "default" } = {}) {
  const target = typeof openid === "string" ? openid.trim() : "";
  if (!target) return;

  const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];

  if (source === "author" && pages.length > 1) {
    for (let i = pages.length - 2; i >= 0; i -= 1) {
      const page = pages[i];
      const route = (page && (page.route || page.__route__)) || "";
      if (route === USER_ROUTE && page.openid === target) {
        wx.navigateBack({ delta: pages.length - 1 - i });
        return;
      }
    }
  }

  wx.navigateTo({
    url: `/pages/user/index?openid=${encodeURIComponent(target)}`,
  });
}

module.exports = {
  USER_ROUTE,
  openUserProfile,
};
