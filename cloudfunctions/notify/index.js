const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const notifications = db.collection("notifications");
const users = db.collection("users");
const posts = db.collection("posts");
const comments = db.collection("comments");
const follows = db.collection("follows");

/**
 * notifications 互动通知
 * {
 *   toOpenid, fromOpenid, fromNickName, fromAvatarUrl,
 *   category,          // comment | like | follow
 *   notifyType,        // comment | reply | post_like | comment_like | collect | follow
 *   postId?, commentId?, content?,
 *   read, createdAt
 * }
 *
 * users 分类未读（消息页卡片角标）
 *   unreadCommentCount / unreadLikeCount / unreadFollowCount
 *   unreadNotifyCount — 三者合计
 */

const CATEGORIES = ["comment", "like", "follow"];
const CATEGORY_FIELD = {
  comment: "unreadCommentCount",
  like: "unreadLikeCount",
  follow: "unreadFollowCount",
};

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (e) {
    // 已存在则忽略
  }
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function isCloudFileId(path) {
  return typeof path === "string" && path.indexOf("cloud://") === 0;
}

async function resolveCloudFileUrlMap(fileIds) {
  const ids = Array.from(new Set((fileIds || []).filter(isCloudFileId)));
  const map = {};
  if (!ids.length) return map;
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try {
      const res = await cloud.getTempFileURL({ fileList: chunk });
      (res.fileList || []).forEach((item) => {
        if (item.fileID && item.tempFileURL && item.status === 0) {
          map[item.fileID] = item.tempFileURL;
        }
      });
    } catch (e) {
      console.error("resolveCloudFileUrlMap failed", e);
    }
  }
  return map;
}

function readCategoryCounts(user) {
  return {
    comment: toCount(user && user.unreadCommentCount),
    like: toCount(user && user.unreadLikeCount),
    follow: toCount(user && user.unreadFollowCount),
  };
}

async function findUserByOpenid(openid) {
  await ensureCollection("users");
  const { data } = await users.where({ openid }).limit(1).get();
  return data[0] || null;
}

function toMs(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof value === "object") {
    if (typeof value.getTime === "function") {
      const t = value.getTime();
      return Number.isFinite(t) ? t : 0;
    }
    if (value.$date != null) return toMs(value.$date);
  }
  return 0;
}

async function fetchPostsMap(postIds) {
  const map = {};
  const unique = Array.from(new Set((postIds || []).filter(Boolean)));
  const chunkSize = 20;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    try {
      const { data } = await posts.where({ _id: _.in(chunk) }).get();
      (data || []).forEach((p) => {
        if (p && p._id) map[p._id] = p;
      });
    } catch (e) {
      await Promise.all(
        chunk.map(async (id) => {
          try {
            const { data } = await posts.doc(id).get();
            if (data) map[id] = data;
          } catch (err) {
            // ignore
          }
        })
      );
    }
  }
  return map;
}

async function fetchCommentsMap(commentIds) {
  const map = {};
  const unique = Array.from(new Set((commentIds || []).filter(Boolean)));
  // 微信云库 where(_id in ...) 常返回空且不抛错，统一按 doc 拉取
  await Promise.all(
    unique.map(async (id) => {
      try {
        const { data } = await comments.doc(id).get();
        if (data) map[id] = data;
      } catch (err) {
        // ignore
      }
    })
  );
  return map;
}

/** 当前用户是否已关注这些 openid */
async function fetchIFollowSet(openid, followeeOpenids) {
  const map = {};
  const unique = Array.from(new Set((followeeOpenids || []).filter(Boolean)));
  if (!openid || !unique.length) return map;
  await ensureCollection("follows");
  for (let i = 0; i < unique.length; i += 20) {
    const chunk = unique.slice(i, i + 20);
    try {
      const { data } = await follows
        .where({ followerOpenid: openid, followeeOpenid: _.in(chunk) })
        .limit(20)
        .get();
      (data || []).forEach((row) => {
        if (row.followeeOpenid) map[row.followeeOpenid] = true;
      });
    } catch (e) {
      // ignore chunk errors
    }
  }
  return map;
}

async function handleGetUnreadByCategory(openid) {
  const user = await findUserByOpenid(openid);
  if (!user) {
    return { ok: true, comment: 0, like: 0, follow: 0 };
  }
  const counts = readCategoryCounts(user);
  const patch = {};
  if (typeof user.unreadCommentCount !== "number") patch.unreadCommentCount = 0;
  if (typeof user.unreadLikeCount !== "number") patch.unreadLikeCount = 0;
  if (typeof user.unreadFollowCount !== "number") patch.unreadFollowCount = 0;
  if (Object.keys(patch).length) {
    patch.updatedAt = db.serverDate();
    await users.doc(user._id).update({ data: patch });
  }
  return { ok: true, ...counts };
}

async function handleMarkCategoryRead(openid, event) {
  const category =
    typeof event.category === "string" ? event.category.trim() : "";
  if (!CATEGORIES.includes(category)) {
    return { ok: false, error: "INVALID_CATEGORY" };
  }

  const user = await findUserByOpenid(openid);
  if (!user) {
    return { ok: false, error: "USER_NOT_FOUND" };
  }

  await ensureCollection("notifications");
  try {
    await notifications
      .where({ toOpenid: openid, category, read: false })
      .update({ data: { read: true } });
  } catch (e) {
    // ignore
  }

  const field = CATEGORY_FIELD[category];
  const counts = readCategoryCounts(user);
  counts[category] = 0;
  const total = counts.comment + counts.like + counts.follow;

  await users.doc(user._id).update({
    data: {
      [field]: 0,
      unreadNotifyCount: total,
      updatedAt: db.serverDate(),
    },
  });

  return { ok: true, ...counts };
}

async function handleMarkAllRead(openid) {
  const user = await findUserByOpenid(openid);
  if (!user) {
    return { ok: false, error: "USER_NOT_FOUND" };
  }

  await ensureCollection("notifications");
  try {
    await notifications.where({ toOpenid: openid, read: false }).update({
      data: { read: true },
    });
  } catch (e) {
    // ignore
  }

  await users.doc(user._id).update({
    data: {
      unreadCommentCount: 0,
      unreadLikeCount: 0,
      unreadFollowCount: 0,
      unreadNotifyCount: 0,
      updatedAt: db.serverDate(),
    },
  });

  return { ok: true, comment: 0, like: 0, follow: 0 };
}

/** 按分类拉取通知列表（赞和收藏 / 评论 / 关注） */
async function handleListByCategory(openid, event) {
  const category =
    typeof event.category === "string" ? event.category.trim() : "";
  if (!CATEGORIES.includes(category)) {
    return { ok: false, error: "INVALID_CATEGORY" };
  }

  const skip = Math.max(0, Number(event.skip) || 0);
  const limit = Math.min(50, Math.max(1, Number(event.limit) || 20));

  await ensureCollection("notifications");

  let rows = [];
  try {
    const { data } = await notifications
      .where({ toOpenid: openid, category })
      .orderBy("createdAt", "desc")
      .skip(skip)
      .limit(limit)
      .get();
    rows = data || [];
  } catch (e) {
    const { data } = await notifications
      .where({ toOpenid: openid, category })
      .limit(200)
      .get();
    rows = (data || [])
      .slice()
      .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))
      .slice(skip, skip + limit);
  }

  const postIds = rows.map((r) => r.postId).filter(Boolean);
  const commentIds = rows
    .filter(
      (r) =>
        r.commentId &&
        (r.notifyType === "comment_like" ||
          r.notifyType === "comment" ||
          r.notifyType === "reply")
    )
    .map((r) => r.commentId);
  const [postsMap, commentsMap] = await Promise.all([
    fetchPostsMap(postIds),
    fetchCommentsMap(commentIds),
  ]);

  let iFollowSet = {};
  if (category === "follow") {
    iFollowSet = await fetchIFollowSet(
      openid,
      rows.map((r) => r.fromOpenid)
    );
  }

  // 旧回复通知无 originalContent 快照时，回查被回复评论
  const originalIds = [];
  rows.forEach((row) => {
    if (row.notifyType !== "reply") return;
    if (String(row.originalContent || "").trim()) return;
    if (row.replyToCommentId) {
      originalIds.push(row.replyToCommentId);
      return;
    }
    const reply = row.commentId ? commentsMap[row.commentId] : null;
    if (!reply) return;
    const oid = reply.replyToCommentId || reply.parentId;
    if (oid) originalIds.push(oid);
  });
  const originalsMap = originalIds.length
    ? await fetchCommentsMap(originalIds)
    : {};

  const previewOf = (doc, fallback) => {
    if (doc) {
      let text = String(doc.content || "").trim();
      if (!text && doc.image) text = "[图片]";
      if (text) return text;
    }
    return String(fallback || "").trim();
  };

  const fileIds = [];
  rows.forEach((row) => {
    if (isCloudFileId(row.fromAvatarUrl)) fileIds.push(row.fromAvatarUrl);
    const post = row.postId ? postsMap[row.postId] : null;
    const images = (post && post.images) || [];
    if (isCloudFileId(images[0])) fileIds.push(images[0]);
  });
  const urlMap = await resolveCloudFileUrlMap(fileIds);

  const list = rows.map((row) => {
    const post = row.postId ? postsMap[row.postId] : null;
    const images = (post && post.images) || [];
    const needsComment =
      row.commentId &&
      (row.notifyType === "comment_like" ||
        row.notifyType === "comment" ||
        row.notifyType === "reply");
    const comment = needsComment ? commentsMap[row.commentId] : null;

    let commentContent = "";
    if (needsComment) {
      commentContent = previewOf(comment, row.content);
    }

    let originalContent = "";
    if (row.notifyType === "reply") {
      originalContent = String(row.originalContent || "").trim();
      if (!originalContent) {
        const oid =
          row.replyToCommentId ||
          (comment && (comment.replyToCommentId || comment.parentId)) ||
          "";
        originalContent = previewOf(oid ? originalsMap[oid] : null, "");
      }
    }

    return {
      id: row._id,
      category: row.category,
      notifyType: row.notifyType || "",
      fromOpenid: row.fromOpenid || "",
      fromNickName: row.fromNickName || "微信用户",
      fromAvatarUrl: urlMap[row.fromAvatarUrl] || row.fromAvatarUrl || "",
      postId: row.postId || "",
      commentId: row.commentId || "",
      // 根评论为空；回复则为所属根评论 id，供详情页定位/展开
      parentId: comment ? String(comment.parentId || "") : "",
      commentMissing: !!(needsComment && !comment),
      postTitle: (post && post.title) || "",
      commentContent,
      originalContent,
      postCover: urlMap[images[0]] || images[0] || "",
      postMissing: !!(row.postId && !post),
      iFollow: !!(row.fromOpenid && iFollowSet[row.fromOpenid]),
      createdAt: row.createdAt || null,
    };
  });

  return {
    ok: true,
    category,
    list,
    hasMore: list.length >= limit,
  };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { type } = event;

  if (!OPENID) {
    return { ok: false, error: "NO_OPENID" };
  }

  if (type === "getUnreadByCategory") {
    return handleGetUnreadByCategory(OPENID);
  }

  if (type === "markCategoryRead") {
    return handleMarkCategoryRead(OPENID, event);
  }

  if (type === "markAllRead") {
    return handleMarkAllRead(OPENID);
  }

  if (type === "listByCategory") {
    return handleListByCategory(OPENID, event);
  }

  if (type === "getUnreadCount") {
    const res = await handleGetUnreadByCategory(OPENID);
    return {
      ok: res.ok,
      count: (res.comment || 0) + (res.like || 0) + (res.follow || 0),
    };
  }

  return { ok: false, error: "UNKNOWN_TYPE" };
};
