/**
 * 私聊本地缓存：近 7 天消息 + 会话列表摘要
 * Storage 总预算约控制在 2MB 内，超出按 LRU 淘汰会话消息缓存
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_MS = 7 * DAY_MS;
const META_KEY = "chat.cache.meta";
const CONV_LIST_KEY = "chat.conv.list";
const MSG_PREFIX = "chat.msg.";
const BUDGET_BYTES = 1.8 * 1024 * 1024;

function safeGet(key, fallback) {
  try {
    const v = wx.getStorageSync(key);
    return v === "" || v === undefined || v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function safeSet(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

function safeRemove(key) {
  try {
    wx.removeStorageSync(key);
  } catch (e) {
    // ignore
  }
}

function estimateSize(obj) {
  try {
    return JSON.stringify(obj).length * 2;
  } catch (e) {
    return 0;
  }
}

function cutoffTs() {
  return Date.now() - KEEP_MS;
}

function withinWeek(createdAt) {
  const ts = new Date(createdAt).getTime();
  return Number.isFinite(ts) && ts >= cutoffTs();
}

function msgKey(conversationId) {
  return `${MSG_PREFIX}${conversationId}`;
}

function readMeta() {
  const meta = safeGet(META_KEY, null);
  if (!meta || typeof meta !== "object") {
    return { conversations: {}, totalBytes: 0 };
  }
  return meta;
}

function writeMeta(meta) {
  safeSet(META_KEY, meta);
}

function trimMessages(list) {
  const cut = cutoffTs();
  return (list || []).filter((m) => {
    const ts = new Date(m.createdAt).getTime();
    return Number.isFinite(ts) && ts >= cut;
  });
}

function touchMeta(conversationId, bytes) {
  const meta = readMeta();
  meta.conversations = meta.conversations || {};
  meta.conversations[conversationId] = {
    bytes: bytes || 0,
    touchedAt: Date.now(),
  };
  let total = 0;
  Object.keys(meta.conversations).forEach((id) => {
    total += meta.conversations[id].bytes || 0;
  });
  meta.totalBytes = total;
  writeMeta(meta);
  evictIfNeeded();
}

function evictIfNeeded() {
  const meta = readMeta();
  if ((meta.totalBytes || 0) <= BUDGET_BYTES) return;

  const entries = Object.keys(meta.conversations || {}).map((id) => ({
    id,
    ...(meta.conversations[id] || {}),
  }));
  entries.sort((a, b) => (a.touchedAt || 0) - (b.touchedAt || 0));

  for (let i = 0; i < entries.length && (meta.totalBytes || 0) > BUDGET_BYTES; i += 1) {
    const id = entries[i].id;
    safeRemove(msgKey(id));
    const bytes = (meta.conversations[id] && meta.conversations[id].bytes) || 0;
    delete meta.conversations[id];
    meta.totalBytes = Math.max(0, (meta.totalBytes || 0) - bytes);
  }
  writeMeta(meta);
}

function getCachedMessages(conversationId) {
  if (!conversationId) return [];
  const pack = safeGet(msgKey(conversationId), null);
  if (!pack || !Array.isArray(pack.messages)) return [];
  const list = trimMessages(pack.messages);
  if (list.length !== pack.messages.length) {
    setCachedMessages(conversationId, list);
  }
  return list;
}

function setCachedMessages(conversationId, messages) {
  if (!conversationId) return;
  const list = trimMessages(messages);
  const pack = { updatedAt: Date.now(), messages: list };
  const ok = safeSet(msgKey(conversationId), pack);
  if (ok) {
    touchMeta(conversationId, estimateSize(pack));
  } else {
    evictIfNeeded();
    safeSet(msgKey(conversationId), pack);
    touchMeta(conversationId, estimateSize(pack));
  }
}

function mergeCachedMessages(conversationId, incoming) {
  const map = {};
  getCachedMessages(conversationId).forEach((m) => {
    if (m && m.id) map[m.id] = m;
  });
  (incoming || []).forEach((m) => {
    if (!m || !m.id) return;
    if (!withinWeek(m.createdAt)) return;
    map[m.id] = m;
  });
  const merged = Object.keys(map)
    .map((id) => map[id])
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  setCachedMessages(conversationId, merged);
  return merged;
}

function removeCachedMessage(conversationId, messageId) {
  const list = getCachedMessages(conversationId).filter((m) => m.id !== messageId);
  setCachedMessages(conversationId, list);
  return list;
}

function clearConversationCache(conversationId) {
  if (!conversationId) return;
  safeRemove(msgKey(conversationId));
  const meta = readMeta();
  if (meta.conversations && meta.conversations[conversationId]) {
    const bytes = meta.conversations[conversationId].bytes || 0;
    delete meta.conversations[conversationId];
    meta.totalBytes = Math.max(0, (meta.totalBytes || 0) - bytes);
    writeMeta(meta);
  }
}

function getCachedConversationList() {
  const list = safeGet(CONV_LIST_KEY, []);
  return Array.isArray(list) ? list : [];
}

function setCachedConversationList(list) {
  safeSet(CONV_LIST_KEY, Array.isArray(list) ? list : []);
}

function upsertCachedConversation(item) {
  if (!item || !item.id) return getCachedConversationList();
  const list = getCachedConversationList().filter((c) => c.id !== item.id);
  list.unshift(item);
  list.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  setCachedConversationList(list);
  return list;
}

function removeCachedConversation(conversationId) {
  const list = getCachedConversationList().filter((c) => c.id !== conversationId);
  setCachedConversationList(list);
  clearConversationCache(conversationId);
  return list;
}

module.exports = {
  KEEP_MS,
  withinWeek,
  getCachedMessages,
  setCachedMessages,
  mergeCachedMessages,
  removeCachedMessage,
  clearConversationCache,
  getCachedConversationList,
  setCachedConversationList,
  upsertCachedConversation,
  removeCachedConversation,
};
