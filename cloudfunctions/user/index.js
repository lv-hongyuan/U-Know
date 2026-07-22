const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const users = db.collection("users");
const follows = db.collection("follows");

const DEFAULT_NICK_NAME = "微信用户";
const DEFAULT_AVATAR = "";
const SHORT_ID_LEN = 8;
const SHORT_ID_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (e) {
    // 集合已存在时忽略
  }
}

async function ensureUsersCollection() {
  await ensureCollection("users");
}

async function ensureFollowsCollection() {
  await ensureCollection("follows");
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function randomShortId() {
  let id = "";
  for (let i = 0; i < SHORT_ID_LEN; i += 1) {
    id += SHORT_ID_CHARS[Math.floor(Math.random() * SHORT_ID_CHARS.length)];
  }
  return id;
}

async function allocateShortId() {
  await ensureUsersCollection();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const shortId = randomShortId();
    const { data } = await users.where({ shortId }).limit(1).get();
    if (!data || !data.length) return shortId;
  }
  return randomShortId() + String(Date.now()).slice(-2);
}

async function ensureUserShortId(user) {
  if (!user || !user._id) return user;
  if (user.shortId && String(user.shortId).length === SHORT_ID_LEN) {
    return user;
  }
  const shortId = await allocateShortId();
  await users.doc(user._id).update({
    data: { shortId, updatedAt: db.serverDate() },
  });
  return { ...user, shortId };
}

async function findUserByOpenid(openid) {
  await ensureUsersCollection();
  const { data } = await users.where({ openid }).limit(1).get();
  return data[0] || null;
}

async function findFollowRelation(followerOpenid, followeeOpenid) {
  await ensureFollowsCollection();
  const { data } = await follows
    .where({ followerOpenid, followeeOpenid })
    .limit(1)
    .get();
  return data[0] || null;
}

function formatPublicUser(user) {
  if (!user) return null;
  return {
    openid: user.openid,
    shortId: user.shortId || "",
    nickName: user.nickName || DEFAULT_NICK_NAME,
    avatarUrl: user.avatarUrl || DEFAULT_AVATAR,
    bio: user.bio || "",
    hometown: user.hometown || "",
    hometownProvince: user.hometownProvince || "",
    hometownCity: user.hometownCity || "",
    schoolId: user.schoolId || "",
    schoolName: user.schoolName || "",
    schoolShortName: user.schoolShortName || "",
    schoolCampus: user.schoolCampus || "",
    schoolLogoUrl: user.schoolLogoUrl || "",
    showSchool: user.showSchool !== false,
    followerCount: toCount(user.followerCount),
    followingCount: toCount(user.followingCount),
    likeCollectCount: toCount(user.likeCollectCount),
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

async function handleGetPublicProfile(openid, event) {
  const targetOpenid =
    typeof event.targetOpenid === "string"
      ? event.targetOpenid.trim()
      : typeof event.openid === "string"
        ? event.openid.trim()
        : "";
  if (!targetOpenid) {
    return { ok: false, error: "MISSING_TARGET" };
  }

  let user = await findUserByOpenid(targetOpenid);
  if (!user) {
    return { ok: false, error: "USER_NOT_FOUND" };
  }
  user = await ensureUserShortId(user);

  let following = false;
  if (openid && openid !== targetOpenid) {
    const relation = await findFollowRelation(openid, targetOpenid);
    following = !!relation;
  }

  const profile = formatPublicUser(user);

  // 校徽：优先用户快照，否则按 schoolId 回查 schools
  let schoolLogo = profile.schoolLogoUrl || "";
  if (!schoolLogo && profile.schoolId) {
    try {
      const { data: schoolDoc } = await db.collection("schools").doc(profile.schoolId).get();
      if (schoolDoc && schoolDoc.logoUrl) schoolLogo = schoolDoc.logoUrl;
    } catch (e) {
      // ignore
    }
  }

  const fileIds = [];
  if (isCloudFileId(profile.avatarUrl)) fileIds.push(profile.avatarUrl);
  if (isCloudFileId(schoolLogo)) fileIds.push(schoolLogo);
  if (fileIds.length) {
    const urlMap = await resolveCloudFileUrlMap(fileIds);
    if (urlMap[profile.avatarUrl]) profile.avatarUrl = urlMap[profile.avatarUrl];
    if (urlMap[schoolLogo]) schoolLogo = urlMap[schoolLogo];
  }
  profile.schoolLogoUrl = schoolLogo;

  return {
    ok: true,
    user: profile,
    isSelf: openid === targetOpenid,
    following,
  };
}

async function queryFollowDocs(where) {
  await ensureFollowsCollection();
  const MAX = 200;
  const { data } = await follows.where(where).limit(MAX).get();
  return data || [];
}

async function fetchUsersByOpenids(openidList) {
  const unique = Array.from(new Set((openidList || []).filter(Boolean)));
  const map = {};
  const chunkSize = 20;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const part = unique.slice(i, i + chunkSize);
    const { data } = await users.where({ openid: _.in(part) }).get();
    (data || []).forEach((u) => {
      map[u.openid] = u;
    });
  }
  return map;
}

async function buildOpenidSet(docs, field) {
  const set = {};
  (docs || []).forEach((d) => {
    if (d[field]) set[d[field]] = true;
  });
  return set;
}

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

    await db.collection("notifications").add({ data });

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

async function handleFollow(openid, targetOpenid) {
  if (!targetOpenid) {
    return { ok: false, error: "MISSING_TARGET" };
  }
  if (targetOpenid === openid) {
    return { ok: false, error: "CANNOT_FOLLOW_SELF" };
  }

  const me = await findUserByOpenid(openid);
  const target = await findUserByOpenid(targetOpenid);
  if (!me || !target) {
    return { ok: false, error: "USER_NOT_FOUND" };
  }

  const existing = await findFollowRelation(openid, targetOpenid);
  if (existing) {
    return {
      ok: true,
      following: true,
      followerCount: toCount(target.followerCount),
      followingCount: toCount(me.followingCount),
    };
  }

  await ensureFollowsCollection();
  await follows.add({
    data: {
      followerOpenid: openid,
      followeeOpenid: targetOpenid,
      createdAt: db.serverDate(),
    },
  });

  await users.doc(me._id).update({
    data: {
      followingCount: _.inc(1),
      updatedAt: db.serverDate(),
    },
  });
  await users.doc(target._id).update({
    data: {
      followerCount: _.inc(1),
      updatedAt: db.serverDate(),
    },
  });

  await pushNotify(openid, {
    toOpenid: targetOpenid,
    category: "follow",
    notifyType: "follow",
  });

  return {
    ok: true,
    following: true,
    followerCount: toCount(target.followerCount) + 1,
    followingCount: toCount(me.followingCount) + 1,
  };
}

async function handleUnfollow(openid, targetOpenid) {
  if (!targetOpenid) {
    return { ok: false, error: "MISSING_TARGET" };
  }
  if (targetOpenid === openid) {
    return { ok: false, error: "CANNOT_UNFOLLOW_SELF" };
  }

  const me = await findUserByOpenid(openid);
  const target = await findUserByOpenid(targetOpenid);
  if (!me || !target) {
    return { ok: false, error: "USER_NOT_FOUND" };
  }

  const existing = await findFollowRelation(openid, targetOpenid);
  if (!existing) {
    return {
      ok: true,
      following: false,
      followerCount: toCount(target.followerCount),
      followingCount: toCount(me.followingCount),
    };
  }

  await follows.doc(existing._id).remove();

  const nextFollowing = Math.max(0, toCount(me.followingCount) - 1);
  const nextFollower = Math.max(0, toCount(target.followerCount) - 1);

  await users.doc(me._id).update({
    data: {
      followingCount: nextFollowing,
      updatedAt: db.serverDate(),
    },
  });
  await users.doc(target._id).update({
    data: {
      followerCount: nextFollower,
      updatedAt: db.serverDate(),
    },
  });

  return {
    ok: true,
    following: false,
    followerCount: nextFollower,
    followingCount: nextFollowing,
  };
}

async function handleListRelations(openid, event) {
  const tab = event.tab || "following";
  if (!["following", "followers", "mutual"].includes(tab)) {
    return { ok: false, error: "INVALID_TAB" };
  }

  const keyword = typeof event.keyword === "string" ? event.keyword.trim() : "";
  const skip = Math.max(0, Number(event.skip) || 0);
  const limit = Math.min(50, Math.max(1, Number(event.limit) || 20));

  const me = await findUserByOpenid(openid);
  if (!me) {
    return { ok: false, error: "USER_NOT_FOUND" };
  }

  const followingDocs = await queryFollowDocs({ followerOpenid: openid });
  const followerDocs = await queryFollowDocs({ followeeOpenid: openid });
  const followingSet = await buildOpenidSet(followingDocs, "followeeOpenid");
  const followerSet = await buildOpenidSet(followerDocs, "followerOpenid");

  let targetOpenids = [];
  if (tab === "following") {
    targetOpenids = followingDocs.map((d) => d.followeeOpenid).filter(Boolean);
  } else if (tab === "followers") {
    targetOpenids = followerDocs.map((d) => d.followerOpenid).filter(Boolean);
  } else {
    targetOpenids = Object.keys(followingSet).filter((id) => followerSet[id]);
  }

  const userMap = await fetchUsersByOpenids(targetOpenids);
  let list = targetOpenids
    .map((id) => {
      const user = userMap[id];
      if (!user) return null;
      const iFollow = !!followingSet[id];
      const theyFollow = !!followerSet[id];
      let relation = "none";
      if (iFollow && theyFollow) relation = "mutual";
      else if (iFollow) relation = "following";
      else if (theyFollow) relation = "follower";
      return {
        ...formatPublicUser(user),
        relation,
        iFollow,
        theyFollow,
      };
    })
    .filter(Boolean);

  if (keyword) {
    const lower = keyword.toLowerCase();
    list = list.filter((item) => {
      const name = (item.nickName || "").toLowerCase();
      const bio = (item.bio || "").toLowerCase();
      const hometown = (item.hometown || "").toLowerCase();
      return (
        name.indexOf(lower) > -1 ||
        bio.indexOf(lower) > -1 ||
        hometown.indexOf(lower) > -1
      );
    });
  }

  const total = list.length;
  const page = list.slice(skip, skip + limit);
  const urlMap = await resolveCloudFileUrlMap(page.map((item) => item.avatarUrl));
  const resolvedPage = page.map((item) => ({
    ...item,
    avatarUrl: urlMap[item.avatarUrl] || item.avatarUrl,
  }));

  return {
    ok: true,
    tab,
    total,
    list: resolvedPage,
    hasMore: skip + page.length < total,
  };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { type } = event;

  if (!OPENID) {
    return { ok: false, error: "NO_OPENID" };
  }

  if (type === "follow") {
    return handleFollow(OPENID, event.targetOpenid);
  }

  if (type === "unfollow") {
    return handleUnfollow(OPENID, event.targetOpenid);
  }

  if (type === "isFollowing") {
    const targetOpenid = event.targetOpenid;
    if (!targetOpenid) {
      return { ok: false, error: "MISSING_TARGET" };
    }
    const relation = await findFollowRelation(OPENID, targetOpenid);
    return { ok: true, following: !!relation };
  }

  if (type === "listRelations") {
    return handleListRelations(OPENID, event);
  }

  if (type === "getPublicProfile") {
    return handleGetPublicProfile(OPENID, event);
  }

  return { ok: false, error: "UNKNOWN_TYPE" };
};
