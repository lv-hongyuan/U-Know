const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const posts = db.collection("posts");
const users = db.collection("users");
const follows = db.collection("follows");
const comments = db.collection("comments");
const postLikes = db.collection("post_likes");
const postCollects = db.collection("post_collects");
const postViews = db.collection("post_views");

const TITLE_MAX = 30;
const CONTENT_MAX = 1200;
const TOPIC_MAX_LEN = 10;
const IMAGE_MAX = 9;
const COMMENT_MAX = 300;

/**
 * posts
 * { ..., likeCount, commentCount, collectCount, viewCount, createdAt, updatedAt }
 *
 * comments / post_likes / post_collects — 见既有注释
 *
 * post_views 浏览去重（一人一帖一条，只计第一次）
 * { postId, openid, createdAt }
 */

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (e) {
    // ignore
  }
}

function extractTopics(content) {
  if (!content) return [];
  const re = /#([^\s#]+)/g;
  const set = {};
  let m;
  while ((m = re.exec(content))) {
    const raw = (m[1] || "").trim();
    if (!raw) continue;
    const topic = raw.slice(0, TOPIC_MAX_LEN);
    if (topic) set[topic] = true;
  }
  return Object.keys(set);
}

async function findUserByOpenid(openid) {
  const { data } = await users.where({ openid }).limit(1).get();
  return data[0] || null;
}

function formatPost(doc) {
  if (!doc) return null;
  return {
    _id: doc._id,
    openid: doc.openid,
    nickName: doc.nickName || "",
    avatarUrl: doc.avatarUrl || "",
    type: doc.type || "text",
    title: doc.title || "",
    content: doc.content || "",
    topics: doc.topics || [],
    images: doc.images || [],
    visibility: doc.visibility === "private" ? "private" : "public",
    status: doc.status || "published",
    likeCount: Number(doc.likeCount) || 0,
    commentCount: Number(doc.commentCount) || 0,
    collectCount: Number(doc.collectCount) || 0,
    viewCount: Number(doc.viewCount) || 0,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

function formatComment(doc) {
  if (!doc) return null;
  return {
    _id: doc._id,
    postId: doc.postId,
    openid: doc.openid,
    nickName: doc.nickName || "",
    avatarUrl: doc.avatarUrl || "",
    content: doc.content || "",
    createdAt: doc.createdAt || null,
  };
}

function canViewPost(doc, openid) {
  if (!doc || doc.status !== "published") return false;
  const visibility = doc.visibility === "private" ? "private" : "public";
  if (visibility === "public") return true;
  return !!(openid && doc.openid === openid);
}

async function getFollowingOpenids(openid) {
  await ensureCollection("follows");
  const { data } = await follows.where({ followerOpenid: openid }).limit(200).get();
  return (data || []).map((d) => d.followeeOpenid).filter(Boolean);
}

function resolvePostType(event) {
  if (
    event.postType === "image" ||
    event.mediaType === "image" ||
    event.contentType === "image"
  ) {
    return "image";
  }
  if (
    event.postType === "text" ||
    event.mediaType === "text" ||
    event.contentType === "text"
  ) {
    return "text";
  }
  if (event.type === "image" || event.type === "text") {
    return event.type;
  }
  return "text";
}

async function getPostDoc(postId) {
  if (!postId) return null;
  try {
    const { data } = await posts.doc(postId).get();
    return data || null;
  } catch (e) {
    return null;
  }
}

async function hasLike(postId, openid) {
  if (!postId || !openid) return false;
  await ensureCollection("post_likes");
  const { data } = await postLikes
    .where({ postId, openid })
    .limit(1)
    .get();
  return !!(data && data[0]);
}

async function hasCollect(postId, openid) {
  if (!postId || !openid) return false;
  await ensureCollection("post_collects");
  const { data } = await postCollects
    .where({ postId, openid })
    .limit(1)
    .get();
  return !!(data && data[0]);
}

async function bumpAuthorLikeCollect(authorOpenid) {
  if (!authorOpenid) return;
  const user = await findUserByOpenid(authorOpenid);
  if (!user || !user._id) return;
  const next = (Number(user.likeCollectCount) || 0) + 1;
  await users.doc(user._id).update({
    data: { likeCollectCount: next, updatedAt: db.serverDate() },
  });
}

function validatePostFields(event, { keepType } = {}) {
  const type = keepType || resolvePostType(event);
  const visibility = event.visibility === "private" ? "private" : "public";
  const title = typeof event.title === "string" ? event.title.trim() : "";
  const content = typeof event.content === "string" ? event.content.trim() : "";
  let images = Array.isArray(event.images) ? event.images.filter(Boolean) : [];

  if (!title) {
    return { ok: false, error: "EMPTY_TITLE", message: "请输入标题" };
  }
  if (title.length > TITLE_MAX) {
    return { ok: false, error: "TITLE_TOO_LONG" };
  }
  if (!content) {
    return { ok: false, error: "EMPTY_CONTENT", message: "请输入正文" };
  }
  if (content.length > CONTENT_MAX) {
    return { ok: false, error: "CONTENT_TOO_LONG" };
  }

  if (type === "image") {
    if (!images.length) {
      return { ok: false, error: "EMPTY_IMAGES", message: "请添加图片" };
    }
  } else {
    images = [];
  }
  if (images.length > IMAGE_MAX) {
    return { ok: false, error: "TOO_MANY_IMAGES" };
  }

  return {
    ok: true,
    type,
    visibility,
    title,
    content,
    images,
    topics: extractTopics(content),
  };
}

async function handleCreate(openid, event) {
  const user = await findUserByOpenid(openid);
  if (!user || !user.phoneNumber) {
    return { ok: false, error: "USER_NOT_FOUND", message: "请先登录" };
  }

  const checked = validatePostFields(event);
  if (!checked.ok) return checked;

  const now = db.serverDate();
  const payload = {
    openid,
    nickName: user.nickName || "微信用户",
    avatarUrl: user.avatarUrl || "",
    type: checked.type,
    title: checked.title,
    content: checked.content,
    topics: checked.topics,
    images: checked.images,
    visibility: checked.visibility,
    status: "published",
    likeCount: 0,
    commentCount: 0,
    collectCount: 0,
    viewCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  await ensureCollection("posts");
  const addRes = await posts.add({ data: payload });
  return {
    ok: true,
    post: formatPost({ ...payload, _id: addRes._id }),
  };
}

async function handleUpdate(openid, event) {
  const user = await findUserByOpenid(openid);
  if (!user || !user.phoneNumber) {
    return { ok: false, error: "USER_NOT_FOUND", message: "请先登录" };
  }

  const postId = event.postId || event.id;
  const doc = await getPostDoc(postId);
  if (!doc || doc.status !== "published") {
    return { ok: false, error: "NOT_FOUND", message: "帖子不存在" };
  }
  if (doc.openid !== openid) {
    return { ok: false, error: "FORBIDDEN", message: "无权编辑" };
  }

  const checked = validatePostFields(event, {
    keepType: doc.type === "image" ? "image" : "text",
  });
  if (!checked.ok) return checked;

  // 图文帖不允许改成纯文字（可改图片列表）；纯文字保持无图
  const type = doc.type === "image" ? "image" : "text";
  const images = type === "image" ? checked.images : [];
  if (type === "image" && !images.length) {
    return { ok: false, error: "EMPTY_IMAGES", message: "请添加图片" };
  }

  const now = db.serverDate();
  await posts.doc(postId).update({
    data: {
      title: checked.title,
      content: checked.content,
      topics: checked.topics,
      images,
      visibility: checked.visibility,
      nickName: user.nickName || doc.nickName || "微信用户",
      avatarUrl: user.avatarUrl || doc.avatarUrl || "",
      updatedAt: now,
    },
  });

  const latest = await getPostDoc(postId);
  return { ok: true, post: formatPost(latest) };
}

async function recordUniqueView(postId, openid, doc) {
  // 含作者自己查看：同一 openid 对同一帖只计 1 次
  if (!postId || !openid || !doc) {
    return Number(doc && doc.viewCount) || 0;
  }

  await ensureCollection("post_views");

  let existed = false;
  try {
    const { data } = await postViews.where({ postId, openid }).limit(1).get();
    existed = !!(data && data[0]);
  } catch (e) {
    console.error("query post_views failed", e);
  }

  if (existed) {
    const current = Number(doc.viewCount) || 0;
    if (current > 0) return current;
    // 修复历史脏数据：已有浏览记录但帖子 viewCount 未写入
    try {
      const countRes = await postViews.where({ postId }).count();
      const total = Number(countRes && countRes.total) || 0;
      if (total > 0) {
        await posts.doc(postId).update({ data: { viewCount: total } });
        return total;
      }
    } catch (e) {
      console.error("repair viewCount failed", e);
    }
    return current;
  }

  // 先落去重记录，再累加浏览量，避免只加了记录却没 +1 后永久卡 0
  try {
    await postViews.add({
      data: {
        postId,
        openid,
        createdAt: db.serverDate(),
      },
    });
  } catch (e) {
    // 并发下可能已插入
    const latest = await getPostDoc(postId);
    return Number(latest && latest.viewCount) || Number(doc.viewCount) || 0;
  }

  try {
    await posts.doc(postId).update({
      data: {
        viewCount: _.inc(1),
      },
    });
  } catch (e) {
    console.error("inc viewCount failed", e);
    // 兼容旧帖无 viewCount 字段时 inc 异常：直接写入
    try {
      await posts.doc(postId).update({
        data: {
          viewCount: (Number(doc.viewCount) || 0) + 1,
        },
      });
    } catch (e2) {
      console.error("set viewCount failed", e2);
    }
  }

  const latest = await getPostDoc(postId);
  const count = Number(latest && latest.viewCount);
  if (Number.isFinite(count) && count > 0) return count;
  return (Number(doc.viewCount) || 0) + 1;
}

async function handleGetDetail(openid, event) {
  await ensureCollection("posts");
  const postId = event.postId || event.id;
  const doc = await getPostDoc(postId);
  if (!canViewPost(doc, openid)) {
    return { ok: false, error: "NOT_FOUND", message: "帖子不存在或不可见" };
  }

  const viewCount = await recordUniqueView(postId, openid, doc);
  const [liked, collected] = await Promise.all([
    hasLike(postId, openid),
    hasCollect(postId, openid),
  ]);

  return {
    ok: true,
    post: formatPost({ ...doc, viewCount }),
    liked,
    collected,
    isOwner: !!(openid && doc.openid === openid),
  };
}

async function handleListMine(openid, event) {
  const user = await findUserByOpenid(openid);
  if (!user || !user.phoneNumber) {
    return { ok: false, error: "USER_NOT_FOUND", message: "请先登录" };
  }

  await ensureCollection("posts");
  const visibility =
    event.visibility === "private"
      ? "private"
      : event.visibility === "public"
        ? "public"
        : "all";
  const skip = Math.max(0, Number(event.skip) || 0);
  const limit = Math.min(20, Math.max(1, Number(event.limit) || 10));

  const { data } = await posts
    .where({ openid, status: "published" })
    .limit(200)
    .get();

  let list = data || [];
  const publicCount = list.filter((d) => d.visibility !== "private").length;
  const privateCount = list.filter((d) => d.visibility === "private").length;

  if (visibility === "public") {
    list = list.filter((d) => d.visibility !== "private");
  } else if (visibility === "private") {
    list = list.filter((d) => d.visibility === "private");
  }

  list = list.slice().sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });

  const total = list.length;
  const page = list.slice(skip, skip + limit);

  return {
    ok: true,
    list: page.map(formatPost),
    hasMore: skip + page.length < total,
    total,
    publicCount,
    privateCount,
  };
}

async function handleListCollected(openid, event) {
  const user = await findUserByOpenid(openid);
  if (!user || !user.phoneNumber) {
    return { ok: false, error: "USER_NOT_FOUND", message: "请先登录" };
  }

  await ensureCollection("post_collects");
  await ensureCollection("posts");
  const skip = Math.max(0, Number(event.skip) || 0);
  const limit = Math.min(20, Math.max(1, Number(event.limit) || 10));

  const { data: collects } = await postCollects
    .where({ openid })
    .limit(200)
    .get();

  const sorted = (collects || []).slice().sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });

  const postsList = [];
  for (const row of sorted) {
    const doc = await getPostDoc(row.postId);
    if (canViewPost(doc, openid)) {
      postsList.push(doc);
    }
  }

  const total = postsList.length;
  const page = postsList.slice(skip, skip + limit);

  return {
    ok: true,
    list: page.map(formatPost),
    hasMore: skip + page.length < total,
    total,
  };
}

async function handleListFeed(openid, event) {
  await ensureCollection("posts");
  const feed = event.feed === "following" ? "following" : "plaza";
  const skip = Math.max(0, Number(event.skip) || 0);
  const limit = Math.min(20, Math.max(1, Number(event.limit) || 10));

  const { data } = await posts.where({ status: "published" }).limit(200).get();
  let list = (data || []).filter((doc) => canViewPost(doc, openid));

  if (feed === "following") {
    if (!openid) {
      return { ok: true, list: [], hasMore: false, total: 0 };
    }
    const following = await getFollowingOpenids(openid);
    const set = {};
    following.forEach((id) => {
      set[id] = true;
    });
    list = list.filter((doc) => set[doc.openid]);
  }

  list = list.slice().sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });

  const total = list.length;
  const page = list.slice(skip, skip + limit);

  return {
    ok: true,
    feed,
    list: page.map(formatPost),
    hasMore: skip + page.length < total,
    total,
  };
}

async function handleToggleLike(openid, event) {
  const user = await findUserByOpenid(openid);
  if (!user || !user.phoneNumber) {
    return { ok: false, error: "USER_NOT_FOUND", message: "请先登录" };
  }

  const postId = event.postId || event.id;
  const doc = await getPostDoc(postId);
  if (!canViewPost(doc, openid)) {
    return { ok: false, error: "NOT_FOUND", message: "帖子不存在" };
  }

  await ensureCollection("post_likes");
  const { data } = await postLikes.where({ postId, openid }).limit(1).get();
  const existing = data && data[0];

  if (existing) {
    await postLikes.doc(existing._id).remove();
    const next = Math.max(0, (Number(doc.likeCount) || 0) - 1);
    await posts.doc(postId).update({
      data: { likeCount: next, updatedAt: db.serverDate() },
    });
    // 获赞与收藏：取消不减
    return { ok: true, liked: false, likeCount: next };
  }

  await postLikes.add({
    data: { postId, openid, createdAt: db.serverDate() },
  });
  const next = (Number(doc.likeCount) || 0) + 1;
  await posts.doc(postId).update({
    data: { likeCount: next, updatedAt: db.serverDate() },
  });
  // 获赞与收藏：含自己给自己点赞；取消不减
  await bumpAuthorLikeCollect(doc.openid);
  return { ok: true, liked: true, likeCount: next };
}

async function handleToggleCollect(openid, event) {
  const user = await findUserByOpenid(openid);
  if (!user || !user.phoneNumber) {
    return { ok: false, error: "USER_NOT_FOUND", message: "请先登录" };
  }

  const postId = event.postId || event.id;
  const doc = await getPostDoc(postId);
  if (!canViewPost(doc, openid)) {
    return { ok: false, error: "NOT_FOUND", message: "帖子不存在" };
  }

  await ensureCollection("post_collects");
  const { data } = await postCollects.where({ postId, openid }).limit(1).get();
  const existing = data && data[0];

  if (existing) {
    await postCollects.doc(existing._id).remove();
    const next = Math.max(0, (Number(doc.collectCount) || 0) - 1);
    await posts.doc(postId).update({
      data: { collectCount: next, updatedAt: db.serverDate() },
    });
    // 获赞与收藏：取消不减
    return { ok: true, collected: false, collectCount: next };
  }

  await postCollects.add({
    data: { postId, openid, createdAt: db.serverDate() },
  });
  const next = (Number(doc.collectCount) || 0) + 1;
  await posts.doc(postId).update({
    data: { collectCount: next, updatedAt: db.serverDate() },
  });
  // 获赞与收藏：含自己收藏；取消不减
  await bumpAuthorLikeCollect(doc.openid);
  return { ok: true, collected: true, collectCount: next };
}

async function handleCreateComment(openid, event) {
  const user = await findUserByOpenid(openid);
  if (!user || !user.phoneNumber) {
    return { ok: false, error: "USER_NOT_FOUND", message: "请先登录" };
  }

  const postId = event.postId || event.id;
  const doc = await getPostDoc(postId);
  if (!canViewPost(doc, openid)) {
    return { ok: false, error: "NOT_FOUND", message: "帖子不存在" };
  }

  const content = typeof event.content === "string" ? event.content.trim() : "";
  if (!content) {
    return { ok: false, error: "EMPTY_COMMENT", message: "请输入评论" };
  }
  if (content.length > COMMENT_MAX) {
    return { ok: false, error: "COMMENT_TOO_LONG" };
  }

  await ensureCollection("comments");
  const now = db.serverDate();
  const payload = {
    postId,
    openid,
    nickName: user.nickName || "微信用户",
    avatarUrl: user.avatarUrl || "",
    content,
    status: "published",
    createdAt: now,
    updatedAt: now,
  };
  const addRes = await comments.add({ data: payload });
  const next = (Number(doc.commentCount) || 0) + 1;
  await posts.doc(postId).update({
    data: { commentCount: next, updatedAt: now },
  });

  return {
    ok: true,
    comment: formatComment({ ...payload, _id: addRes._id }),
    commentCount: next,
  };
}

async function handleListComments(openid, event) {
  const postId = event.postId || event.id;
  const doc = await getPostDoc(postId);
  if (!canViewPost(doc, openid)) {
    return { ok: false, error: "NOT_FOUND", message: "帖子不存在" };
  }

  await ensureCollection("comments");
  const skip = Math.max(0, Number(event.skip) || 0);
  const limit = Math.min(50, Math.max(1, Number(event.limit) || 20));

  const { data } = await comments
    .where({ postId, status: "published" })
    .limit(200)
    .get();

  const list = (data || [])
    .slice()
    .sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return ta - tb;
    });

  const total = list.length;
  const page = list.slice(skip, skip + limit);

  return {
    ok: true,
    list: page.map(formatComment),
    hasMore: skip + page.length < total,
    total,
  };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || event.type;

  if (!OPENID) {
    return { ok: false, error: "NO_OPENID" };
  }

  if (action === "create") {
    return handleCreate(OPENID, event);
  }
  if (action === "image" || action === "text") {
    return handleCreate(OPENID, { ...event, postType: action });
  }
  if (action === "update") {
    return handleUpdate(OPENID, event);
  }
  if (action === "getDetail") {
    return handleGetDetail(OPENID, event);
  }
  if (action === "listFeed") {
    return handleListFeed(OPENID, event);
  }
  if (action === "listMine") {
    return handleListMine(OPENID, event);
  }
  if (action === "listCollected") {
    return handleListCollected(OPENID, event);
  }
  if (action === "toggleLike") {
    return handleToggleLike(OPENID, event);
  }
  if (action === "toggleCollect") {
    return handleToggleCollect(OPENID, event);
  }
  if (action === "createComment") {
    return handleCreateComment(OPENID, event);
  }
  if (action === "listComments") {
    return handleListComments(OPENID, event);
  }

  return {
    ok: false,
    error: "UNKNOWN_TYPE",
    message: `未知操作: ${action || "(empty)"}，请重新上传部署 cloudfunctions/post`,
  };
};
