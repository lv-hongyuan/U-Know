/**
 * 发帖草稿箱（本地多份，最多 20）
 */
const DRAFT_KEY = "uknow_post_draft";
const DRAFTS_KEY = "uknow_post_drafts";
const MAX_DRAFTS = 20;

function normalizeDraft(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    id: raw.id || `draft_${Date.now()}`,
    type: raw.type === "image" ? "image" : "text",
    title: raw.title || "",
    content: raw.content || "",
    images: Array.isArray(raw.images) ? raw.images.slice() : [],
    visibility: raw.visibility === "private" ? "private" : "public",
    updatedAt: Number(raw.updatedAt) || Date.now(),
    createdAt: Number(raw.createdAt) || Date.now(),
  };
}

function readDraftsRaw() {
  try {
    const list = wx.getStorageSync(DRAFTS_KEY);
    if (Array.isArray(list) && list.length) {
      return list.map(normalizeDraft).filter(Boolean);
    }
  } catch (e) {
    // ignore
  }
  // 兼容旧单草稿
  try {
    const one = wx.getStorageSync(DRAFT_KEY);
    const item = normalizeDraft(one);
    return item ? [item] : [];
  } catch (e) {
    return [];
  }
}

function writeDrafts(list) {
  const next = (list || [])
    .map(normalizeDraft)
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, MAX_DRAFTS);
  wx.setStorageSync(DRAFTS_KEY, next);
  try {
    wx.removeStorageSync(DRAFT_KEY);
  } catch (e) {
    // ignore
  }
  return next;
}

function getDrafts() {
  return readDraftsRaw().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function getDraft(id) {
  const list = getDrafts();
  if (id) {
    return list.find((d) => d.id === id) || null;
  }
  return list[0] || null;
}

function saveDraft(draft) {
  const now = Date.now();
  const list = getDrafts();
  const id = (draft && draft.id) || `draft_${Date.now()}`;
  const prev = list.find((d) => d.id === id);
  const item = normalizeDraft({
    ...(draft || {}),
    id,
    updatedAt: now,
    createdAt: (prev && prev.createdAt) || (draft && draft.createdAt) || now,
  });
  const next = [item].concat(list.filter((d) => d.id !== id));
  writeDrafts(next);
  return item;
}

function removeDraft(id) {
  if (!id) return getDrafts();
  return writeDrafts(getDrafts().filter((d) => d.id !== id));
}

function clearDraft() {
  try {
    wx.removeStorageSync(DRAFT_KEY);
    wx.removeStorageSync(DRAFTS_KEY);
  } catch (e) {
    // ignore
  }
}

module.exports = {
  DRAFT_KEY,
  DRAFTS_KEY,
  MAX_DRAFTS,
  getDraft,
  getDrafts,
  saveDraft,
  removeDraft,
  clearDraft,
};
