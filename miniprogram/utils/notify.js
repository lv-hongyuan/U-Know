/**
 * 互动通知：消息页三卡片分类未读
 * Tab 角标不再展示
 */
const { isLoggedIn } = require("./user");

function callNotify(data) {
  return wx.cloud
    .callFunction({
      name: "notify",
      data,
    })
    .then((res) => res.result || {});
}

function formatBadge(n) {
  const count = Math.max(0, Number(n) || 0);
  if (count <= 0) return "";
  if (count > 99) return "99+";
  return String(count);
}

function emptyCounts() {
  return { comment: 0, like: 0, follow: 0 };
}

function normalizeCounts(raw) {
  const src = raw || {};
  return {
    comment: Math.max(0, Number(src.comment) || 0),
    like: Math.max(0, Number(src.like) || 0),
    follow: Math.max(0, Number(src.follow) || 0),
  };
}

function getUnreadByCategory() {
  return callNotify({ type: "getUnreadByCategory" }).then((res) => {
    if (!res || !res.ok) return emptyCounts();
    return normalizeCounts(res);
  });
}

function markCategoryRead(category) {
  return callNotify({ type: "markCategoryRead", category }).then((res) => {
    if (!res || !res.ok) return emptyCounts();
    return normalizeCounts(res);
  });
}

function markAllRead() {
  return callNotify({ type: "markAllRead" }).then((res) => {
    if (!res || !res.ok) return emptyCounts();
    return normalizeCounts(res);
  });
}

function listByCategory({ category, skip = 0, limit = 20 } = {}) {
  return callNotify({
    type: "listByCategory",
    category,
    skip,
    limit,
  });
}

/** 拉取分类未读；未登录返回全 0 */
async function refreshCategoryUnread() {
  if (!isLoggedIn()) return emptyCounts();
  try {
    return await getUnreadByCategory();
  } catch (e) {
    return emptyCounts();
  }
}

module.exports = {
  formatBadge,
  emptyCounts,
  normalizeCounts,
  getUnreadByCategory,
  markCategoryRead,
  markAllRead,
  listByCategory,
  refreshCategoryUnread,
};
