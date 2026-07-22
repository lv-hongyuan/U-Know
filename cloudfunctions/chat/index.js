const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const conversations = db.collection("conversations");
const messages = db.collection("messages");
const users = db.collection("users");
const follows = db.collection("follows");

const RECALL_MS = 3 * 60 * 1000;
const PAGE_DEFAULT = 20;
const PAGE_MAX = 50;
const MSG_TYPES = ["text", "image", "video", "post"];

/**
 * conversations
 * {
 *   type: 'dm' | 'activity',
 *   dmKey: string,                 // sorted openidA_openidB
 *   memberIds: [openidA, openidB],
 *   lastMessage: { id, type, preview, senderOpenid, createdAt },
 *   updatedAt,
 *   peerSnap: { [openid]: { nickName, avatarUrl } },
 *   memberState: {
 *     [openid]: { unread, hidden, deleted, clearedAt }
 *   }
 * }
 *
 * messages
 * {
 *   conversationId, clientMsgId, senderOpenid,
 *   type: text|image|video|post|system,
 *   content, media?, quote?, postCard?,
 *   status: normal|recalled,
 *   deletedFor: [openid],
 *   createdAt
 * }
 */

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (e) {
    // exists
  }
}

function now() {
  return new Date();
}

function clampLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n)) return PAGE_DEFAULT;
  return Math.min(PAGE_MAX, Math.max(1, Math.floor(n)));
}

function dmKeyOf(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function emptyMemberState() {
  return {
    unread: 0,
    hidden: false,
    deleted: false,
    clearedAt: null,
  };
}

function previewOf(type, content) {
  if (type === "image") return "[image]";
  if (type === "video") return "[video]";
  if (type === "post") return "[post]";
  if (type === "system") return String(content || "");
  const text = String(content || "").trim();
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function normalizePostCard(card) {
  if (!card || !card.postId) return null;
  return {
    postId: String(card.postId),
    title: String(card.title || "").slice(0, 80),
    coverUrl: String(card.coverUrl || ""),
    authorOpenid: String(card.authorOpenid || ""),
    authorNickName: String(card.authorNickName || "").slice(0, 40),
    authorAvatarUrl: String(card.authorAvatarUrl || ""),
    likeCount: Math.max(0, Number(card.likeCount) || 0),
  };
}

async function getUserSnap(openid) {
  if (!openid) return { nickName: "", avatarUrl: "" };
  try {
    const res = await users.where({ openid }).limit(1).get();
    const u = (res.data && res.data[0]) || {};
    return {
      nickName: u.nickName || "",
      avatarUrl: u.avatarUrl || "",
    };
  } catch (e) {
    return { nickName: "", avatarUrl: "" };
  }
}

function memberStateOf(conv, openid) {
  const ms = (conv && conv.memberState) || {};
  return Object.assign(emptyMemberState(), ms[openid] || {});
}

async function findDm(openid, peerOpenid) {
  const key = dmKeyOf(openid, peerOpenid);
  const res = await conversations.where({ type: "dm", dmKey: key }).limit(1).get();
  return (res.data && res.data[0]) || null;
}

async function getConversation(id) {
  if (!id) return null;
  try {
    const res = await conversations.doc(id).get();
    return res.data || null;
  } catch (e) {
    return null;
  }
}

function assertMember(conv, openid) {
  return conv && Array.isArray(conv.memberIds) && conv.memberIds.indexOf(openid) >= 0;
}

async function openOrCreate(openid, peerOpenid) {
  if (!peerOpenid || peerOpenid === openid) {
    return { ok: false, error: "invalid_peer" };
  }

  let conv = await findDm(openid, peerOpenid);
  const [mySnap, peerSnap] = await Promise.all([
    getUserSnap(openid),
    getUserSnap(peerOpenid),
  ]);

  if (!conv) {
    const key = dmKeyOf(openid, peerOpenid);
    const memberIds =
      openid < peerOpenid ? [openid, peerOpenid] : [peerOpenid, openid];
    const doc = {
      type: "dm",
      dmKey: key,
      memberIds,
      lastMessage: null,
      updatedAt: now(),
      peerSnap: {
        [openid]: mySnap,
        [peerOpenid]: peerSnap,
      },
      memberState: {
        [openid]: emptyMemberState(),
        [peerOpenid]: emptyMemberState(),
      },
      createdAt: now(),
    };
    const addRes = await conversations.add({ data: doc });
    conv = { _id: addRes._id, ...doc };
  } else {
    const patch = {
      peerSnap: Object.assign({}, conv.peerSnap || {}, {
        [openid]: mySnap,
        [peerOpenid]: peerSnap,
      }),
      [`memberState.${openid}.deleted`]: false,
      [`memberState.${openid}.hidden`]: false,
    };
    await conversations.doc(conv._id).update({ data: patch });
    conv = await getConversation(conv._id);
  }

  return {
    ok: true,
    conversation: serializeConversation(conv, openid),
  };
}

function serializeConversation(conv, openid) {
  if (!conv) return null;
  const peerOpenid = (conv.memberIds || []).find((id) => id !== openid) || "";
  const peer = ((conv.peerSnap || {})[peerOpenid]) || {};
  const state = memberStateOf(conv, openid);
  const last = conv.lastMessage || null;
  return {
    id: conv._id,
    type: conv.type || "dm",
    peerOpenid,
    peerNickName: peer.nickName || "",
    peerAvatarUrl: peer.avatarUrl || "",
    lastMessage: last
      ? {
          id: last.id || "",
          type: last.type || "text",
          preview: last.preview || "",
          senderOpenid: last.senderOpenid || "",
          createdAt: last.createdAt,
        }
      : null,
    unread: state.unread || 0,
    hidden: !!state.hidden,
    updatedAt: conv.updatedAt,
  };
}

async function listConversations(openid, { includeHidden = false } = {}) {
  const res = await conversations
    .where({ memberIds: openid })
    .orderBy("updatedAt", "desc")
    .limit(100)
    .get();

  const rows = [];
  for (const c of res.data || []) {
    const state = memberStateOf(c, openid);
    if (state.deleted) continue;
    if (!includeHidden && state.hidden) continue;

    // 历史数据：消息已发但 lastMessage 未写上时补齐
    if (!c.lastMessage || !c.lastMessage.createdAt) {
      try {
        const msgRes = await messages
          .where({ conversationId: c._id })
          .orderBy("createdAt", "desc")
          .limit(1)
          .get();
        const m = msgRes.data && msgRes.data[0];
        if (m) {
          c.lastMessage = {
            id: m._id,
            type: m.status === "recalled" ? "system" : m.type,
            preview:
              m.status === "recalled"
                ? "[recalled]"
                : previewOf(m.type, m.content),
            senderOpenid: m.senderOpenid,
            createdAt: m.createdAt,
          };
          conversations
            .doc(c._id)
            .update({
              data: {
                lastMessage: c.lastMessage,
                updatedAt: m.createdAt || now(),
              },
            })
            .catch(() => {});
        }
      } catch (e) {
        // ignore hydrate errors
      }
    }

    rows.push(serializeConversation(c, openid));
  }

  return { ok: true, list: rows };
}

async function setConversationFlags(openid, conversationId, flags = {}) {
  const conv = await getConversation(conversationId);
  if (!assertMember(conv, openid)) {
    return { ok: false, error: "forbidden" };
  }

  const patch = {};
  if (flags.hide === true) patch[`memberState.${openid}.hidden`] = true;
  if (flags.unhide === true) patch[`memberState.${openid}.hidden`] = false;
  if (flags.markUnread === true) patch[`memberState.${openid}.unread`] = 1;
  if (flags.delete === true) {
    patch[`memberState.${openid}.deleted`] = true;
    patch[`memberState.${openid}.hidden`] = false;
    patch[`memberState.${openid}.unread`] = 0;
    patch[`memberState.${openid}.clearedAt`] = now();
  }

  if (!Object.keys(patch).length) {
    return { ok: false, error: "empty_flags" };
  }

  await conversations.doc(conversationId).update({ data: patch });
  return { ok: true };
}

async function markRead(openid, conversationId) {
  const conv = await getConversation(conversationId);
  if (!assertMember(conv, openid)) {
    return { ok: false, error: "forbidden" };
  }
  await conversations.doc(conversationId).update({
    data: {
      [`memberState.${openid}.unread`]: 0,
      [`memberState.${openid}.hidden`]: false,
      [`memberState.${openid}.deleted`]: false,
    },
  });
  return { ok: true };
}

async function unreadTotal(openid) {
  const res = await conversations.where({ memberIds: openid }).limit(100).get();
  let total = 0;
  (res.data || []).forEach((c) => {
    const state = memberStateOf(c, openid);
    if (state.deleted || state.hidden) return;
    total += Math.max(0, Number(state.unread) || 0);
  });
  return { ok: true, total };
}

function serializeMessage(m, openid) {
  if (!m) return null;
  const deletedFor = m.deletedFor || [];
  if (deletedFor.indexOf(openid) >= 0) return null;
  return {
    id: m._id,
    conversationId: m.conversationId,
    clientMsgId: m.clientMsgId || "",
    senderOpenid: m.senderOpenid,
    type: m.type,
    content: m.status === "recalled" ? "" : m.content || "",
    media: m.status === "recalled" ? null : m.media || null,
    quote: m.status === "recalled" ? null : m.quote || null,
    postCard: m.status === "recalled" ? null : m.postCard || null,
    status: m.status || "normal",
    createdAt: m.createdAt,
    mine: m.senderOpenid === openid,
  };
}

async function listMessages(openid, {
  conversationId,
  before,
  after,
  limit,
} = {}) {
  const conv = await getConversation(conversationId);
  if (!assertMember(conv, openid)) {
    return { ok: false, error: "forbidden" };
  }

  const state = memberStateOf(conv, openid);
  const pageSize = clampLimit(limit);
  const clearedTs = state.clearedAt ? new Date(state.clearedAt).getTime() : 0;

  const andConds = [{ conversationId }];
  if (before) andConds.push({ createdAt: _.lt(new Date(before)) });
  if (after) andConds.push({ createdAt: _.gt(new Date(after)) });
  if (clearedTs) andConds.push({ createdAt: _.gt(new Date(clearedTs)) });

  let q =
    andConds.length > 1
      ? messages.where(_.and(andConds))
      : messages.where({ conversationId });

  if (after && !before) {
    q = q.orderBy("createdAt", "asc").limit(pageSize);
  } else {
    q = q.orderBy("createdAt", "desc").limit(pageSize);
  }

  const res = await q.get();
  let rows = res.data || [];
  if (!(after && !before)) {
    rows = rows.reverse();
  }

  const list = rows
    .map((m) => serializeMessage(m, openid))
    .filter(Boolean);

  const peerOpenid = (conv.memberIds || []).find((id) => id !== openid) || "";
  const peer = ((conv.peerSnap || {})[peerOpenid]) || {};

  return {
    ok: true,
    list,
    hasMore: rows.length >= pageSize,
    peer: {
      openid: peerOpenid,
      nickName: peer.nickName || "",
      avatarUrl: peer.avatarUrl || "",
    },
  };
}

async function insertMessage(openid, {
  conversationId,
  type,
  content,
  media,
  quote,
  postCard,
  clientMsgId,
}) {
  if (MSG_TYPES.indexOf(type) < 0) {
    return { ok: false, error: "invalid_type" };
  }

  const conv = await getConversation(conversationId);
  if (!assertMember(conv, openid)) {
    return { ok: false, error: "forbidden" };
  }

  if (clientMsgId) {
    const existed = await messages
      .where({ conversationId, clientMsgId, senderOpenid: openid })
      .limit(1)
      .get();
    if (existed.data && existed.data[0]) {
      return {
        ok: true,
        message: serializeMessage(existed.data[0], openid),
        duplicated: true,
      };
    }
  }

  let quotePayload = null;
  if (quote && quote.messageId) {
    try {
      const qRes = await messages.doc(quote.messageId).get();
      const qm = qRes.data;
      if (qm && qm.conversationId === conversationId && qm.status !== "recalled") {
        const qMedia =
          (qm.type === "image" || qm.type === "video") && qm.media
            ? {
                fileId: qm.media.fileId || "",
                thumbFileId: qm.media.thumbFileId || "",
                width: qm.media.width || 0,
                height: qm.media.height || 0,
              }
            : null;
        quotePayload = {
          messageId: qm._id,
          senderOpenid: qm.senderOpenid,
          type: qm.type,
          preview: previewOf(qm.type, qm.content),
          media: qMedia,
        };
      }
    } catch (e) {
      // ignore bad quote
    }
  }

  const card = type === "post" ? normalizePostCard(postCard) : null;
  if (type === "post" && !card) {
    return { ok: false, error: "missing_post" };
  }

  const createdAt = now();
  const doc = {
    conversationId,
    clientMsgId: clientMsgId || "",
    senderOpenid: openid,
    type,
    content: type === "text" ? String(content || "").slice(0, 2000) : String(content || ""),
    media: media || null,
    quote: quotePayload,
    postCard: card,
    status: "normal",
    deletedFor: [],
    createdAt,
  };

  if (type === "text" && !doc.content.trim()) {
    return { ok: false, error: "empty_content" };
  }
  if ((type === "image" || type === "video") && !(media && media.fileId)) {
    return { ok: false, error: "missing_media" };
  }

  const addRes = await messages.add({ data: doc });
  const messageId = addRes._id;
  const preview = previewOf(type, doc.content);
  const peerOpenid = (conv.memberIds || []).find((id) => id !== openid);
  const message = serializeMessage({ _id: messageId, ...doc }, openid);

  try {
    const mySnap = await getUserSnap(openid);
    const peerState = peerOpenid ? memberStateOf(conv, peerOpenid) : null;
    const convPatch = {
      lastMessage: {
        id: messageId,
        type,
        preview,
        senderOpenid: openid,
        createdAt,
      },
      updatedAt: createdAt,
      [`peerSnap.${openid}`]: mySnap,
      [`memberState.${openid}.deleted`]: false,
      [`memberState.${openid}.hidden`]: false,
    };
    if (peerOpenid && peerState) {
      // 避免 _.inc 在动态路径上偶发失败（消息已写入却返回 internal）
      convPatch[`memberState.${peerOpenid}.unread`] =
        Math.max(0, Number(peerState.unread) || 0) + 1;
      convPatch[`memberState.${peerOpenid}.deleted`] = false;
      convPatch[`memberState.${peerOpenid}.hidden`] = false;
    }
    await conversations.doc(conversationId).update({ data: convPatch });
  } catch (e) {
    console.error("update conversation after send failed", e);
    // 消息已落库，仍视为发送成功
  }

  return {
    ok: true,
    message,
  };
}

async function recall(openid, messageId) {
  if (!messageId) return { ok: false, error: "invalid_id" };
  let msg;
  try {
    const res = await messages.doc(messageId).get();
    msg = res.data;
  } catch (e) {
    return { ok: false, error: "not_found" };
  }
  if (!msg || msg.senderOpenid !== openid) {
    return { ok: false, error: "forbidden" };
  }
  if (msg.status === "recalled") {
    return { ok: true, message: serializeMessage(msg, openid) };
  }
  const created = new Date(msg.createdAt).getTime();
  if (!Number.isFinite(created) || Date.now() - created > RECALL_MS) {
    return { ok: false, error: "recall_expired" };
  }

  await messages.doc(messageId).update({
    data: {
      status: "recalled",
      content: "",
      media: null,
      quote: null,
      postCard: null,
    },
  });

  const conv = await getConversation(msg.conversationId);
  if (conv && conv.lastMessage && conv.lastMessage.id === messageId) {
    await conversations.doc(msg.conversationId).update({
      data: {
        lastMessage: {
          id: messageId,
          type: "system",
          preview: "[recalled]",
          senderOpenid: openid,
          createdAt: msg.createdAt,
        },
      },
    });
  }

  const updated = await messages.doc(messageId).get();
  return { ok: true, message: serializeMessage(updated.data, openid) };
}

async function deleteMessage(openid, messageId) {
  if (!messageId) return { ok: false, error: "invalid_id" };
  let msg;
  try {
    const res = await messages.doc(messageId).get();
    msg = res.data;
  } catch (e) {
    return { ok: false, error: "not_found" };
  }
  const conv = await getConversation(msg.conversationId);
  if (!assertMember(conv, openid)) {
    return { ok: false, error: "forbidden" };
  }

  await messages.doc(messageId).update({
    data: {
      deletedFor: _.addToSet(openid),
    },
  });
  return { ok: true };
}

async function forward(openid, { messageId, peerOpenids }) {
  if (!messageId || !Array.isArray(peerOpenids) || !peerOpenids.length) {
    return { ok: false, error: "invalid_params" };
  }

  let src;
  try {
    const res = await messages.doc(messageId).get();
    src = res.data;
  } catch (e) {
    return { ok: false, error: "not_found" };
  }
  if (!src || src.status === "recalled") {
    return { ok: false, error: "unavailable" };
  }
  const srcConv = await getConversation(src.conversationId);
  if (!assertMember(srcConv, openid)) {
    return { ok: false, error: "forbidden" };
  }
  if ((src.deletedFor || []).indexOf(openid) >= 0) {
    return { ok: false, error: "unavailable" };
  }

  const uniquePeers = Array.from(
    new Set(peerOpenids.filter((p) => p && p !== openid))
  ).slice(0, 20);

  const results = [];
  for (const peer of uniquePeers) {
    const opened = await openOrCreate(openid, peer);
    if (!opened.ok) {
      results.push({ peerOpenid: peer, ok: false, error: opened.error });
      continue;
    }
    const sent = await insertMessage(openid, {
      conversationId: opened.conversation.id,
      type: src.type,
      content: src.content,
      media: src.media,
      clientMsgId: `fwd_${messageId}_${peer}_${Date.now()}`,
    });
    results.push({
      peerOpenid: peer,
      ok: !!sent.ok,
      conversationId: opened.conversation.id,
      error: sent.error || "",
    });
  }

  return { ok: true, results };
}

async function fetchFriendOpenids(openid) {
  const MAX = 500;
  const [followingRes, followerRes] = await Promise.all([
    follows.where({ followerOpenid: openid }).limit(MAX).get(),
    follows.where({ followeeOpenid: openid }).limit(MAX).get(),
  ]);
  const map = {};
  (followingRes.data || []).forEach((d) => {
    if (d && d.followeeOpenid && d.followeeOpenid !== openid) {
      map[d.followeeOpenid] = 1;
    }
  });
  (followerRes.data || []).forEach((d) => {
    if (d && d.followerOpenid && d.followerOpenid !== openid) {
      map[d.followerOpenid] = 1;
    }
  });
  return Object.keys(map);
}

async function fetchChatRank(openid) {
  const rank = {};
  try {
    const res = await conversations
      .where({ memberIds: openid })
      .orderBy("updatedAt", "desc")
      .limit(100)
      .get();
    (res.data || []).forEach((c, idx) => {
      const peer = (c.memberIds || []).find((id) => id !== openid);
      if (peer && rank[peer] == null) rank[peer] = idx;
    });
  } catch (e) {
    // index may be missing; ignore sort
  }
  return rank;
}

async function hydrateUsersByOpenids(ids) {
  const out = {};
  const unique = Array.from(new Set((ids || []).filter(Boolean)));
  for (let i = 0; i < unique.length; i += 20) {
    const chunk = unique.slice(i, i + 20);
    try {
      const res = await users.where({ openid: _.in(chunk) }).limit(20).get();
      (res.data || []).forEach((u) => {
        if (u && u.openid) {
          out[u.openid] = {
            openid: u.openid,
            nickName: u.nickName || "",
            avatarUrl: u.avatarUrl || "",
          };
        }
      });
    } catch (e) {
      // ignore chunk error
    }
  }
  return out;
}

/** 关注+粉丝，按最近聊天排序，分页返回（懒加载） */
async function listSharePeers(openid, { keyword = "", skip = 0, limit = 20 } = {}) {
  const pageSize = Math.min(PAGE_MAX, Math.max(1, Number(limit) || PAGE_DEFAULT));
  const offset = Math.max(0, Number(skip) || 0);
  const kw = String(keyword || "").trim().toLowerCase();

  const friendIds = await fetchFriendOpenids(openid);
  const rank = await fetchChatRank(openid);
  friendIds.sort((a, b) => {
    const ra = rank[a];
    const rb = rank[b];
    const ha = ra == null ? 1 : 0;
    const hb = rb == null ? 1 : 0;
    if (ha !== hb) return ha - hb;
    if (ra != null && rb != null && ra !== rb) return ra - rb;
    return a < b ? -1 : 1;
  });

  let ordered = friendIds;
  if (kw) {
    const userMap = await hydrateUsersByOpenids(friendIds);
    ordered = friendIds.filter((id) => {
      const u = userMap[id];
      return u && (u.nickName || "").toLowerCase().indexOf(kw) > -1;
    });
    const pageIds = ordered.slice(offset, offset + pageSize);
    const list = pageIds.map((id) => {
      const u = userMap[id] || { openid: id, nickName: "", avatarUrl: "" };
      return {
        openid: u.openid,
        nickName: u.nickName || "",
        avatarUrl: u.avatarUrl || "",
      };
    });
    return {
      ok: true,
      list,
      hasMore: offset + list.length < ordered.length,
      total: ordered.length,
    };
  }

  const pageIds = ordered.slice(offset, offset + pageSize);
  const userMap = await hydrateUsersByOpenids(pageIds);
  const list = pageIds.map((id) => {
    const u = userMap[id] || { openid: id, nickName: "", avatarUrl: "" };
    return {
      openid: u.openid,
      nickName: u.nickName || "",
      avatarUrl: u.avatarUrl || "",
    };
  });

  return {
    ok: true,
    list,
    hasMore: offset + list.length < ordered.length,
    total: ordered.length,
  };
}

async function sharePost(openid, { peerOpenids, post }) {
  const card = normalizePostCard(post);
  if (!card) return { ok: false, error: "missing_post" };
  const uniquePeers = Array.from(
    new Set((peerOpenids || []).filter((p) => p && p !== openid))
  ).slice(0, 20);
  if (!uniquePeers.length) return { ok: false, error: "invalid_params" };

  const results = [];
  for (const peer of uniquePeers) {
    const opened = await openOrCreate(openid, peer);
    if (!opened.ok) {
      results.push({ peerOpenid: peer, ok: false, error: opened.error });
      continue;
    }
    const sent = await insertMessage(openid, {
      conversationId: opened.conversation.id,
      type: "post",
      content: "",
      postCard: card,
      clientMsgId: `post_${card.postId}_${peer}_${Date.now()}`,
    });
    results.push({
      peerOpenid: peer,
      ok: !!sent.ok,
      conversationId: opened.conversation && opened.conversation.id,
      error: sent.error || "",
    });
  }
  return { ok: true, results };
}

exports.main = async (event) => {
  await Promise.all([
    ensureCollection("conversations"),
    ensureCollection("messages"),
  ]);

  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) {
    return { ok: false, error: "unauthorized" };
  }

  const type = event && event.type;
  try {
    if (type === "openOrCreate") {
      return await openOrCreate(openid, event.peerOpenid);
    }
    if (type === "listConversations") {
      return await listConversations(openid, {
        includeHidden: !!event.includeHidden,
      });
    }
    if (type === "setConversationFlags") {
      return await setConversationFlags(openid, event.conversationId, {
        hide: event.hide,
        unhide: event.unhide,
        delete: event.delete,
        markUnread: event.markUnread,
      });
    }
    if (type === "markRead") {
      return await markRead(openid, event.conversationId);
    }
    if (type === "unreadTotal") {
      return await unreadTotal(openid);
    }
    if (type === "listMessages") {
      return await listMessages(openid, {
        conversationId: event.conversationId,
        before: event.before,
        after: event.after,
        limit: event.limit,
      });
    }
    if (type === "send") {
      return await insertMessage(openid, {
        conversationId: event.conversationId,
        type: event.msgType || event.messageType || "text",
        content: event.content,
        media: event.media,
        quote: event.quote,
        postCard: event.postCard,
        clientMsgId: event.clientMsgId,
      });
    }
    if (type === "recall") {
      return await recall(openid, event.messageId);
    }
    if (type === "deleteMessage") {
      return await deleteMessage(openid, event.messageId);
    }
    if (type === "forward") {
      return await forward(openid, {
        messageId: event.messageId,
        peerOpenids: event.peerOpenids,
      });
    }
    if (type === "listSharePeers") {
      return await listSharePeers(openid, {
        keyword: event.keyword,
        skip: event.skip,
        limit: event.limit,
      });
    }
    if (type === "sharePost") {
      return await sharePost(openid, {
        peerOpenids: event.peerOpenids,
        post: event.post,
      });
    }
    return { ok: false, error: "unknown_type" };
  } catch (err) {
    console.error("chat failed", type, err);
    return {
      ok: false,
      error: "internal",
      message: (err && err.message) || String(err),
    };
  }
};
