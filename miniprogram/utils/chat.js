/**
 * 私聊云函数封装
 */
function callChat(data) {
  return wx.cloud
    .callFunction({
      name: "chat",
      data,
    })
    .then((res) => res.result || {});
}

function openOrCreate(peerOpenid) {
  return callChat({ type: "openOrCreate", peerOpenid });
}

function listConversations(opts = {}) {
  return callChat({
    type: "listConversations",
    includeHidden: !!opts.includeHidden,
  });
}

function setConversationFlags(conversationId, flags = {}) {
  return callChat({
    type: "setConversationFlags",
    conversationId,
    hide: flags.hide,
    unhide: flags.unhide,
    delete: flags.delete,
    markUnread: flags.markUnread,
  });
}

function markRead(conversationId) {
  return callChat({ type: "markRead", conversationId });
}

function unreadTotal() {
  return callChat({ type: "unreadTotal" });
}

function listMessages({ conversationId, before, after, limit } = {}) {
  return callChat({
    type: "listMessages",
    conversationId,
    before,
    after,
    limit,
  });
}

function sendMessage({
  conversationId,
  msgType = "text",
  content = "",
  media = null,
  quote = null,
  postCard = null,
  historyCard = null,
  clientMsgId = "",
} = {}) {
  return callChat({
    type: "send",
    conversationId,
    msgType,
    content,
    media,
    quote,
    postCard,
    historyCard,
    clientMsgId,
  });
}

function recallMessage(messageId) {
  return callChat({ type: "recall", messageId });
}

function deleteMessage(messageId) {
  return callChat({ type: "deleteMessage", messageId });
}

function forwardMessage({ messageId, peerOpenids } = {}) {
  return callChat({
    type: "forward",
    messageId,
    peerOpenids,
  });
}

function listSharePeers({ keyword = "", skip = 0, limit = 20 } = {}) {
  return callChat({
    type: "listSharePeers",
    keyword,
    skip,
    limit,
  });
}

function sharePost({ peerOpenids, post } = {}) {
  return callChat({
    type: "sharePost",
    peerOpenids,
    post,
  });
}

function genClientMsgId() {
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 上传聊天媒体到云存储（支持进度回调 0-100）
 */
function uploadChatFile(openid, filePath, ext, onProgress) {
  const safeExt = String(ext || "bin").replace(/[^a-z0-9]/gi, "") || "bin";
  const cloudPath = `chat/${openid || "anon"}/${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}.${safeExt}`;
  return new Promise((resolve, reject) => {
    const task = wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: (res) => {
        if (res && res.fileID) resolve(res.fileID);
        else reject(new Error("upload_failed"));
      },
      fail: reject,
    });
    if (typeof onProgress === "function" && task && task.onProgressUpdate) {
      task.onProgressUpdate((res) => {
        const p = Math.max(0, Math.min(100, Number(res.progress) || 0));
        onProgress(p);
      });
    }
  });
}

module.exports = {
  openOrCreate,
  listConversations,
  setConversationFlags,
  markRead,
  unreadTotal,
  listMessages,
  sendMessage,
  recallMessage,
  deleteMessage,
  forwardMessage,
  listSharePeers,
  sharePost,
  genClientMsgId,
  uploadChatFile,
};
