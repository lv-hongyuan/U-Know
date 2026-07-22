const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const posts = db.collection("posts");
const users = db.collection("users");
const follows = db.collection("follows");
const comments = db.collection("comments");
const commentLikes = db.collection("comment_likes");
const postLikes = db.collection("post_likes");
const postCollects = db.collection("post_collects");
const postViews = db.collection("post_views");
const notifications = db.collection("notifications");

const TITLE_MAX = 30;
const CONTENT_MAX = 1200;
const TOPIC_MAX_LEN = 10;
const IMAGE_MAX = 9;
const COMMENT_MAX = 300;
const REPLY_PREVIEW = 3;
const REPLY_EXPAND = 5;
const COMMENT_IMAGE_MAX = 1;

/**
 * posts
 * { ..., likeCount, commentCount, collectCount, viewCount, createdAt, updatedAt }
 *
 * comments / post_likes / post_collects / comment_likes — 见既有注释
 *
 * comment_likes 评论点赞
 * { commentId, postId, openid, createdAt }
 *
 * post_views 浏览去重（一人一帖一条，只计第一次）
 * { postId, openid, createdAt }
 *
 * notifications 由本函数直接写入（避免云函数互调 SOURCE 拦截导致丢通知）
 */

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (e) {
    // ignore
  }
}

async function findUserByOpenid(openid) {
  const { data } = await users.where({ openid }).limit(1).get();
  return data[0] || null;
}

/** 写入互动通知 + 分类未读；成功返回接收方分类未读，失败返回 null */
async function pushNotify(fromOpenid, payload) {
  try {
    const toOpenid =
      typeof payload.toOpenid === "string" ? payload.toOpenid.trim() : "";
    const category =
      typeof payload.category === "string" ? payload.category.trim() : "";
    if (!fromOpenid || !toOpenid) return null;
    if (!["comment", "like", "follow"].includes(category)) return null;

    // 后续可按需打开：自己给自己不发通知
    // if (toOpenid === fromOpenid) return null;

    const fromUser = await findUserByOpenid(fromOpenid);
    if (!fromUser) return null;

    await ensureCollection("notifications");
    const data = {
      toOpenid,
      fromOpenid,
      fromNickName: fromUser.nickName || "微信用户",
      fromAvatarUrl: fromUser.avatarUrl || "",
      category,
      notifyType: payload.notifyType,
      read: false,
      createdAt: db.serverDate(),
    };
    if (typeof payload.postId === "string" && payload.postId) {
      data.postId = payload.postId;
    }
    if (typeof payload.commentId === "string" && payload.commentId) {
      data.commentId = payload.commentId;
    }
    if (typeof payload.content === "string" && payload.content) {
      data.content = payload.content.slice(0, 120);
    }
    if (typeof payload.originalContent === "string" && payload.originalContent) {
      data.originalContent = payload.originalContent.slice(0, 120);
    }
    if (
      typeof payload.replyToCommentId === "string" &&
      payload.replyToCommentId
    ) {
      data.replyToCommentId = payload.replyToCommentId;
    }

    await notifications.add({ data });

    const target = await findUserByOpenid(toOpenid);
    if (!target) return null;

    const counts = {
      comment: Number(target.unreadCommentCount) || 0,
      like: Number(target.unreadLikeCount) || 0,
      follow: Number(target.unreadFollowCount) || 0,
    };
    counts[category] += 1;
    const total = counts.comment + counts.like + counts.follow;

    await users.doc(target._id).update({
      data: {
        unreadCommentCount: counts.comment,
        unreadLikeCount: counts.like,
        unreadFollowCount: counts.follow,
        unreadNotifyCount: total,
        updatedAt: db.serverDate(),
      },
    });
    return counts;
  } catch (e) {
    console.error("pushNotify failed", e);
    return null;
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

function formatPost(doc) {
  if (!doc) return null;
  const schoolName = doc.schoolName || "";
  const schoolCampus = doc.schoolCampus || "";
  let schoolLabel = "";
  if (schoolName) {
    schoolLabel = schoolCampus ? `${schoolName} · ${schoolCampus}` : schoolName;
  }
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
    attachSchool: !!(doc.schoolId || schoolName),
    schoolId: doc.schoolId || "",
    schoolName,
    schoolShortName: doc.schoolShortName || "",
    schoolCampus,
    schoolLabel,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

function schoolSnapshotFromUser(user, attachSchool) {
  if (!attachSchool || !user || !user.schoolId || !user.schoolName) {
    return {
      schoolId: "",
      schoolName: "",
      schoolShortName: "",
      schoolCampus: "",
    };
  }
  return {
    schoolId: user.schoolId || "",
    schoolName: user.schoolName || "",
    schoolShortName: user.schoolShortName || "",
    schoolCampus: user.schoolCampus || "",
  };
}

function formatComment(doc, liked) {
  if (!doc) return null;
  return {
    _id: doc._id,
    postId: doc.postId,
    openid: doc.openid,
    nickName: doc.nickName || "",
    avatarUrl: doc.avatarUrl || "",
    content: doc.content || "",
    image: doc.image || "",
    likeCount: Number(doc.likeCount) || 0,
    liked: !!liked,
    parentId: doc.parentId || "",
    replyToOpenid: doc.replyToOpenid || "",
    replyToNickName: doc.replyToNickName || "",
    createdAt: doc.createdAt || null,
  };
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

function collectCloudFileIdsFromPosts(docs) {
  const ids = [];
  (docs || []).forEach((doc) => {
    if (!doc) return;
    if (isCloudFileId(doc.avatarUrl)) ids.push(doc.avatarUrl);
    (doc.images || []).forEach((id) => {
      if (isCloudFileId(id)) ids.push(id);
    });
  });
  return ids;
}

function applyUrlMapToPost(doc, urlMap) {
  const post = formatPost(doc);
  if (post.avatarUrl && urlMap[post.avatarUrl]) {
    post.avatarUrl = urlMap[post.avatarUrl];
  }
  if (post.images && post.images.length) {
    post.images = post.images.map((id) => urlMap[id] || id);
  }
  return post;
}

async function formatPostsWithUrls(rawPosts) {
  const urlMap = await resolveCloudFileUrlMap(collectCloudFileIdsFromPosts(rawPosts));
  return (rawPosts || []).map((doc) => applyUrlMapToPost(doc, urlMap));
}

async function formatPostWithUrls(doc) {
  const list = await formatPostsWithUrls([doc]);
  return list[0] || formatPost(doc);
}

function collectCloudFileIdsFromFormattedComments(items) {
  const ids = [];
  const walk = (c) => {
    if (!c) return;
    if (isCloudFileId(c.avatarUrl)) ids.push(c.avatarUrl);
    if (isCloudFileId(c.image)) ids.push(c.image);
  };
  (items || []).forEach((item) => {
    walk(item);
    (item.replies || []).forEach(walk);
  });
  return ids;
}

function applyUrlMapToFormattedComment(comment, urlMap) {
  if (!comment) return comment;
  const next = { ...comment };
  if (next.avatarUrl && urlMap[next.avatarUrl]) {
    next.avatarUrl = urlMap[next.avatarUrl];
  }
  if (next.image && urlMap[next.image]) {
    next.image = urlMap[next.image];
  }
  if (next.replies && next.replies.length) {
    next.replies = next.replies.map((r) => applyUrlMapToFormattedComment(r, urlMap));
  }
  return next;
}

async function getCommentLikedMap(openid, commentIds) {
  const map = {};
  if (!openid || !commentIds || !commentIds.length) return map;
  await ensureCollection("comment_likes");
  const ids = commentIds.filter(Boolean);
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20);
    const { data } = await commentLikes
      .where({ openid, commentId: _.in(chunk) })
      .limit(20)
      .get();
    (data || []).forEach((row) => {
      if (row.commentId) map[row.commentId] = true;
    });
  }
  return map;
}

function collectCommentIdsFromList(list) {
  const ids = [];
  (list || []).forEach((item) => {
    if (item && item._id) ids.push(item._id);
    (item.replies || []).forEach((reply) => {
      if (reply && reply._id) ids.push(reply._id);
    });
  });
  return ids;
}

async function attachLikedToCommentList(openid, list) {
  const likedMap = await getCommentLikedMap(openid, collectCommentIdsFromList(list));
  const formatted = (list || []).map((item) => ({
    ...formatComment(item, likedMap[item._id]),
    replyTotal: item.replyTotal,
    replies: (item.replies || []).map((reply) =>
      formatComment(reply, likedMap[reply._id])
    ),
  }));
  const urlMap = await resolveCloudFileUrlMap(
    collectCloudFileIdsFromFormattedComments(formatted)
  );
  return formatted.map((item) => applyUrlMapToFormattedComment(item, urlMap));
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

  const attachSchool = event.attachSchool !== false;
  const schoolSnap = schoolSnapshotFromUser(user, attachSchool);

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
    ...schoolSnap,
    createdAt: now,
    updatedAt: now,
  };

  await ensureCollection("posts");
  const addRes = await posts.add({ data: payload });
  return {
    ok: true,
    post: await formatPostWithUrls({ ...payload, _id: addRes._id }),
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
  const attachSchool = event.attachSchool !== false;
  const schoolSnap = schoolSnapshotFromUser(user, attachSchool);
  await posts.doc(postId).update({
    data: {
      title: checked.title,
      content: checked.content,
      topics: checked.topics,
      images,
      visibility: checked.visibility,
      nickName: user.nickName || doc.nickName || "微信用户",
      avatarUrl: user.avatarUrl || doc.avatarUrl || "",
      ...schoolSnap,
      updatedAt: now,
    },
  });

  const latest = await getPostDoc(postId);
  return { ok: true, post: await formatPostWithUrls(latest) };
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
  const [liked, collected, author] = await Promise.all([
    hasLike(postId, openid),
    hasCollect(postId, openid),
    findUserByOpenid(doc.openid),
  ]);

  const authorShowSchool = !!(
    author &&
    author.showSchool !== false &&
    (author.schoolShortName || author.schoolName)
  );

  return {
    ok: true,
    post: await formatPostWithUrls({ ...doc, viewCount }),
    liked,
    collected,
    isOwner: !!(openid && doc.openid === openid),
    authorShowSchool,
    authorSchoolShortName: authorShowSchool
      ? author.schoolShortName || author.schoolName || ""
      : "",
  };
}

async function handleListUserPublic(openid, event) {
  const targetOpenid =
    typeof event.targetOpenid === "string"
      ? event.targetOpenid.trim()
      : typeof event.openid === "string"
        ? event.openid.trim()
        : "";
  if (!targetOpenid) {
    return { ok: false, error: "MISSING_TARGET" };
  }

  await ensureCollection("posts");
  const skip = Math.max(0, Number(event.skip) || 0);
  const limit = Math.min(20, Math.max(1, Number(event.limit) || 10));

  const { data } = await posts
    .where({ openid: targetOpenid, status: "published" })
    .limit(200)
    .get();

  let list = (data || [])
    .filter((d) => d.visibility !== "private")
    .slice()
    .sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });

  const total = list.length;
  const page = list.slice(skip, skip + limit);

  return {
    ok: true,
    list: await formatPostsWithUrls(page),
    hasMore: skip + page.length < total,
    total,
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
    list: await formatPostsWithUrls(page),
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
    list: await formatPostsWithUrls(page),
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
    list: await formatPostsWithUrls(page),
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
  const unreadByCategory = await pushNotify(openid, {
    toOpenid: doc.openid,
    category: "like",
    notifyType: "post_like",
    postId,
  });
  const res = { ok: true, liked: true, likeCount: next };
  if (doc.openid === openid && unreadByCategory) {
    res.unreadByCategory = unreadByCategory;
  }
  return res;
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
  const unreadByCategory = await pushNotify(openid, {
    toOpenid: doc.openid,
    category: "like",
    notifyType: "collect",
    postId,
  });
  const res = { ok: true, collected: true, collectCount: next };
  if (doc.openid === openid && unreadByCategory) {
    res.unreadByCategory = unreadByCategory;
  }
  return res;
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
  let image = typeof event.image === "string" ? event.image.trim() : "";
  if (!image && Array.isArray(event.images) && event.images[0]) {
    image = String(event.images[0]).trim();
  }
  if (!content && !image) {
    return { ok: false, error: "EMPTY_COMMENT", message: "请输入评论" };
  }
  if (content.length > COMMENT_MAX) {
    return { ok: false, error: "COMMENT_TOO_LONG" };
  }

  await ensureCollection("comments");
  const parentId =
    typeof event.parentId === "string" ? event.parentId.trim() : "";
  let replyToOpenid =
    typeof event.replyToOpenid === "string" ? event.replyToOpenid.trim() : "";
  let replyToNickName =
    typeof event.replyToNickName === "string"
      ? event.replyToNickName.trim()
      : "";
  let replyToCommentId =
    typeof event.replyToCommentId === "string"
      ? event.replyToCommentId.trim()
      : "";

  let parent = null;
  let originalDoc = null;
  if (parentId) {
    try {
      const { data } = await comments.doc(parentId).get();
      parent = data || null;
    } catch (e) {
      parent = null;
    }
    if (
      !parent ||
      parent.postId !== postId ||
      parent.status !== "published" ||
      parent.parentId
    ) {
      return { ok: false, error: "PARENT_NOT_FOUND", message: "回复目标不存在" };
    }
    if (!replyToOpenid) replyToOpenid = parent.openid || "";
    if (!replyToNickName) replyToNickName = parent.nickName || "";
    if (!replyToCommentId) replyToCommentId = parentId;

    originalDoc = parent;
    if (replyToCommentId && replyToCommentId !== parentId) {
      try {
        const { data } = await comments.doc(replyToCommentId).get();
        if (
          data &&
          data.postId === postId &&
          data.status === "published"
        ) {
          originalDoc = data;
        }
      } catch (e) {
        // keep parent as original
      }
    }
  }

  const now = db.serverDate();
  const payload = {
    postId,
    openid,
    nickName: user.nickName || "微信用户",
    avatarUrl: user.avatarUrl || "",
    content,
    image,
    likeCount: 0,
    status: "published",
    createdAt: now,
    updatedAt: now,
  };
  if (parentId) {
    payload.parentId = parentId;
    payload.replyToOpenid = replyToOpenid;
    payload.replyToNickName = replyToNickName;
    payload.replyToCommentId = replyToCommentId || parentId;
  }
  const addRes = await comments.add({ data: payload });
  const next = (Number(doc.commentCount) || 0) + 1;
  await posts.doc(postId).update({
    data: { commentCount: next, updatedAt: now },
  });

  const commentId = addRes._id;
  let notifyTo = "";
  let unreadByCategory = null;
  if (parentId && replyToOpenid) {
    let originalContent = String((originalDoc && originalDoc.content) || "").trim();
    if (!originalContent && originalDoc && originalDoc.image) {
      originalContent = "[图片]";
    }
    notifyTo = replyToOpenid;
    unreadByCategory = await pushNotify(openid, {
      toOpenid: replyToOpenid,
      category: "comment",
      notifyType: "reply",
      postId,
      commentId,
      content,
      originalContent,
      replyToCommentId: replyToCommentId || parentId,
    });
  } else if (doc.openid) {
    notifyTo = doc.openid;
    unreadByCategory = await pushNotify(openid, {
      toOpenid: doc.openid,
      category: "comment",
      notifyType: "comment",
      postId,
      commentId,
      content,
    });
  }

  const comment = formatComment({ ...payload, _id: commentId }, false);
  const urlMap = await resolveCloudFileUrlMap(
    collectCloudFileIdsFromFormattedComments([comment])
  );
  const res = {
    ok: true,
    comment: applyUrlMapToFormattedComment(comment, urlMap),
    commentCount: next,
  };
  if (notifyTo === openid && unreadByCategory) {
    res.unreadByCategory = unreadByCategory;
  }
  return res;
}

async function handleToggleCommentLike(openid, event) {
  const user = await findUserByOpenid(openid);
  if (!user || !user.phoneNumber) {
    return { ok: false, error: "USER_NOT_FOUND", message: "请先登录" };
  }

  const postId = event.postId || event.id;
  const commentId =
    typeof event.commentId === "string" ? event.commentId.trim() : "";
  if (!commentId) {
    return { ok: false, error: "INVALID_COMMENT", message: "缺少评论 ID" };
  }

  const postDoc = await getPostDoc(postId);
  if (!canViewPost(postDoc, openid)) {
    return { ok: false, error: "NOT_FOUND", message: "帖子不存在" };
  }

  await ensureCollection("comments");
  let commentDoc = null;
  try {
    const { data } = await comments.doc(commentId).get();
    commentDoc = data || null;
  } catch (e) {
    commentDoc = null;
  }
  if (
    !commentDoc ||
    commentDoc.postId !== postId ||
    commentDoc.status !== "published"
  ) {
    return { ok: false, error: "COMMENT_NOT_FOUND", message: "评论不存在" };
  }

  await ensureCollection("comment_likes");
  const { data } = await commentLikes
    .where({ commentId, openid })
    .limit(1)
    .get();
  const existing = data && data[0];

  if (existing) {
    await commentLikes.doc(existing._id).remove();
    const next = Math.max(0, (Number(commentDoc.likeCount) || 0) - 1);
    await comments.doc(commentId).update({
      data: { likeCount: next, updatedAt: db.serverDate() },
    });
    return { ok: true, liked: false, likeCount: next };
  }

  await commentLikes.add({
    data: { commentId, postId, openid, createdAt: db.serverDate() },
  });
  const next = (Number(commentDoc.likeCount) || 0) + 1;
  await comments.doc(commentId).update({
    data: { likeCount: next, updatedAt: db.serverDate() },
  });
  await bumpAuthorLikeCollect(commentDoc.openid);
  const commentSnippet = String(commentDoc.content || "").trim();
  const unreadByCategory = await pushNotify(openid, {
    toOpenid: commentDoc.openid,
    category: "like",
    notifyType: "comment_like",
    postId,
    commentId,
    content: commentSnippet || (commentDoc.image ? "[图片]" : ""),
  });
  const res = { ok: true, liked: true, likeCount: next };
  if (commentDoc.openid === openid && unreadByCategory) {
    res.unreadByCategory = unreadByCategory;
  }
  return res;
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

  const sortByTime = (a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ta - tb;
  };

  const all = (data || []).slice().sort(sortByTime);
  const replyMap = {};
  const topLevel = [];

  all.forEach((doc) => {
    if (doc.parentId) {
      if (!replyMap[doc.parentId]) replyMap[doc.parentId] = [];
      replyMap[doc.parentId].push(doc);
    } else {
      topLevel.push(doc);
    }
  });

  Object.keys(replyMap).forEach((key) => {
    replyMap[key].sort(sortByTime);
  });

  const total = topLevel.length;
  const pageRaw = topLevel.slice(skip, skip + limit).map((doc) => {
    const allReplies = replyMap[doc._id] || [];
    return {
      ...doc,
      replyTotal: allReplies.length,
      replies: allReplies.slice(0, REPLY_PREVIEW),
    };
  });
  const page = await attachLikedToCommentList(openid, pageRaw);

  return {
    ok: true,
    list: page,
    hasMore: skip + page.length < total,
    total,
  };
}

async function handleListReplies(openid, event) {
  const postId = event.postId || event.id;
  const parentId =
    typeof event.parentId === "string" ? event.parentId.trim() : "";
  const doc = await getPostDoc(postId);
  if (!canViewPost(doc, openid)) {
    return { ok: false, error: "NOT_FOUND", message: "帖子不存在" };
  }
  if (!parentId) {
    return { ok: false, error: "INVALID_PARENT", message: "缺少评论 ID" };
  }

  let parent = null;
  await ensureCollection("comments");
  try {
    const { data } = await comments.doc(parentId).get();
    parent = data || null;
  } catch (e) {
    parent = null;
  }
  if (
    !parent ||
    parent.postId !== postId ||
    parent.status !== "published" ||
    parent.parentId
  ) {
    return { ok: false, error: "PARENT_NOT_FOUND", message: "评论不存在" };
  }

  const skip = Math.max(0, Number(event.skip) || 0);
  const untilId =
    typeof event.untilId === "string" ? event.untilId.trim() : "";
  // untilId：一次取到目标回复为止（含目标），上限 100，避免详情定位多次往返
  const FOCUS_REPLY_CAP = 100;
  const limit = untilId
    ? FOCUS_REPLY_CAP
    : Math.min(20, Math.max(1, Number(event.limit) || REPLY_EXPAND));

  const { data } = await comments
    .where({ postId, parentId, status: "published" })
    .limit(200)
    .get();

  const sortByTime = (a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ta - tb;
  };

  const all = (data || []).slice().sort(sortByTime);
  const total = all.length;

  let pageRaw;
  let found = false;
  if (untilId) {
    const idx = all.findIndex((item) => item._id === untilId);
    if (idx < 0) {
      pageRaw = [];
      found = false;
    } else {
      found = idx < FOCUS_REPLY_CAP;
      pageRaw = all.slice(0, Math.min(idx + 1, FOCUS_REPLY_CAP));
    }
  } else {
    pageRaw = all.slice(skip, skip + limit);
  }

  const page = await attachLikedToCommentList(
    openid,
    pageRaw.map((doc) => ({ ...doc }))
  );

  return {
    ok: true,
    list: page,
    hasMore: untilId
      ? page.length < total
      : skip + page.length < total,
    total,
    found: untilId ? found : undefined,
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
  if (action === "listUserPublic") {
    return handleListUserPublic(OPENID, event);
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
  if (action === "listReplies") {
    return handleListReplies(OPENID, event);
  }
  if (action === "toggleCommentLike") {
    return handleToggleCommentLike(OPENID, event);
  }

  return {
    ok: false,
    error: "UNKNOWN_TYPE",
    message: `未知操作: ${action || "(empty)"}，请重新上传部署 cloudfunctions/post`,
  };
};
