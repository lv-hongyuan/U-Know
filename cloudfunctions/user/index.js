const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const users = db.collection("users");
const follows = db.collection("follows");

const DEFAULT_NICK_NAME = "微信用户";
const DEFAULT_AVATAR = "";

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
    nickName: user.nickName || DEFAULT_NICK_NAME,
    avatarUrl: user.avatarUrl || DEFAULT_AVATAR,
    bio: user.bio || "",
    hometown: user.hometown || "",
    followerCount: toCount(user.followerCount),
    followingCount: toCount(user.followingCount),
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

  return {
    ok: true,
    tab,
    total,
    list: page,
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

  return { ok: false, error: "UNKNOWN_TYPE" };
};
