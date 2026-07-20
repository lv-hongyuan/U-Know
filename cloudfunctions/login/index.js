const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const users = db.collection("users");

const DEFAULT_NICK_NAME = "微信用户";
const DEFAULT_AVATAR = "";
const BIO_MAX_LENGTH = 60;
const GENDERS = ["male", "female", "secret"];
const LOCALES = ["zh-Hans", "zh-Hant", "en", "ja", "ko"];
const DEFAULT_LOCALE = "zh-Hans";

async function ensureUsersCollection() {
  try {
    await db.createCollection("users");
  } catch (e) {
    // 集合已存在时忽略
  }
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function formatUser(user) {
  if (!user) return null;
  return {
    openid: user.openid,
    nickName: user.nickName || DEFAULT_NICK_NAME,
    avatarUrl: user.avatarUrl || DEFAULT_AVATAR,
    phoneNumber: user.phoneNumber || "",
    bio: user.bio || "",
    gender: user.gender || "secret",
    birthday: user.birthday || "",
    hometown: user.hometown || "",
    hometownProvince: user.hometownProvince || "",
    hometownCity: user.hometownCity || "",
    locale: LOCALES.includes(user.locale) ? user.locale : "",
    followerCount: toCount(user.followerCount),
    followingCount: toCount(user.followingCount),
    likeCollectCount: toCount(user.likeCollectCount),
  };
}

async function getPhoneNumber(code) {
  const res = await cloud.openapi.phonenumber.getPhoneNumber({ code });
  const info = res.phoneInfo || res.phone_info || {};
  return info.phoneNumber || info.purePhoneNumber || "";
}

async function findUserByOpenid(openid) {
  await ensureUsersCollection();
  const { data } = await users.where({ openid }).limit(1).get();
  return data[0] || null;
}

async function upsertUserByPhone({ openid, phoneNumber, locale }) {
  const now = db.serverDate();
  const existing = await findUserByOpenid(openid);
  const nextLocale = LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;

  if (existing) {
    const data = {
      phoneNumber,
      updatedAt: now,
    };
    // 老用户尚无语言字段时，用本次登录带来的本地语言回填一次
    if (!LOCALES.includes(existing.locale) && LOCALES.includes(locale)) {
      data.locale = locale;
    }
    // 老用户补齐关注 / 获赞计数字段
    if (typeof existing.followerCount !== "number") {
      data.followerCount = 0;
    }
    if (typeof existing.followingCount !== "number") {
      data.followingCount = 0;
    }
    if (typeof existing.likeCollectCount !== "number") {
      data.likeCollectCount = 0;
    }
    await users.doc(existing._id).update({ data });
    return formatUser({ ...existing, ...data });
  }

  const payload = {
    openid,
    phoneNumber,
    nickName: DEFAULT_NICK_NAME,
    avatarUrl: DEFAULT_AVATAR,
    bio: "",
    gender: "secret",
    birthday: "",
    hometown: "",
    hometownProvince: "",
    hometownCity: "",
    locale: nextLocale,
    followerCount: 0,
    followingCount: 0,
    likeCollectCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  await users.add({ data: payload });
  return formatUser(payload);
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { type } = event;

  if (!OPENID) {
    return { ok: false, error: "NO_OPENID" };
  }

  if (type === "getProfile") {
    const user = await findUserByOpenid(OPENID);
    return { ok: true, user: formatUser(user) };
  }

  if (type === "login") {
    const { phoneCode } = event;
    if (!phoneCode) {
      return { ok: false, error: "MISSING_PHONE_CODE" };
    }

    let phoneNumber = "";
    try {
      phoneNumber = await getPhoneNumber(phoneCode);
    } catch (e) {
      console.error("getPhoneNumber failed", e);
      return {
        ok: false,
        error: "PHONE_FAILED",
        message: e.message || "获取手机号失败",
      };
    }

    if (!phoneNumber) {
      return { ok: false, error: "PHONE_EMPTY" };
    }

    const user = await upsertUserByPhone({
      openid: OPENID,
      phoneNumber,
      locale: event.locale,
    });

    return { ok: true, user };
  }

  if (type === "changePhone") {
    const { phoneCode } = event;
    if (!phoneCode) {
      return { ok: false, error: "MISSING_PHONE_CODE" };
    }

    const existing = await findUserByOpenid(OPENID);
    if (!existing) {
      return { ok: false, error: "USER_NOT_FOUND" };
    }

    let phoneNumber = "";
    try {
      phoneNumber = await getPhoneNumber(phoneCode);
    } catch (e) {
      console.error("changePhone failed", e);
      return {
        ok: false,
        error: "PHONE_FAILED",
        message: e.message || "获取手机号失败",
      };
    }

    if (!phoneNumber) {
      return { ok: false, error: "PHONE_EMPTY" };
    }

    await users.doc(existing._id).update({
      data: {
        phoneNumber,
        updatedAt: db.serverDate(),
      },
    });

    return { ok: true, user: formatUser({ ...existing, phoneNumber }) };
  }

  if (type === "updateProfile") {
    const existing = await findUserByOpenid(OPENID);
    if (!existing) {
      return { ok: false, error: "USER_NOT_FOUND" };
    }

    const patch = { updatedAt: db.serverDate() };

    if (typeof event.nickName === "string") {
      const name = event.nickName.trim();
      if (!name) {
        return { ok: false, error: "EMPTY_NICKNAME", message: "昵称不能为空" };
      }
      patch.nickName = name;
    }

    if (typeof event.avatarUrl === "string" && event.avatarUrl) {
      patch.avatarUrl = event.avatarUrl;
    }

    if (typeof event.bio === "string") {
      const bio = event.bio.trim().slice(0, BIO_MAX_LENGTH);
      patch.bio = bio;
    }

    if (typeof event.gender === "string") {
      if (!GENDERS.includes(event.gender)) {
        return { ok: false, error: "INVALID_GENDER" };
      }
      patch.gender = event.gender;
    }

    if (typeof event.birthday === "string") {
      patch.birthday = event.birthday;
    }

    if (typeof event.hometown === "string") {
      patch.hometown = event.hometown;
      patch.hometownProvince = event.hometownProvince || "";
      patch.hometownCity = event.hometownCity || "";
    }

    if (typeof event.locale === "string") {
      if (!LOCALES.includes(event.locale)) {
        return { ok: false, error: "INVALID_LOCALE" };
      }
      patch.locale = event.locale;
    }

    await users.doc(existing._id).update({ data: patch });
    return { ok: true, user: formatUser({ ...existing, ...patch }) };
  }

  return { ok: false, error: "UNKNOWN_TYPE" };
};
