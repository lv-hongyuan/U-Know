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
const SHORT_ID_LEN = 8;
const SHORT_ID_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

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

/** 确保用户有 8 位短账号；缺则生成并落库，返回更新后的 user */
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

function formatUser(user) {
  if (!user) return null;
  return {
    openid: user.openid,
    shortId: user.shortId || "",
    nickName: user.nickName || DEFAULT_NICK_NAME,
    avatarUrl: user.avatarUrl || DEFAULT_AVATAR,
    phoneNumber: user.phoneNumber || "",
    bio: user.bio || "",
    gender: user.gender || "secret",
    birthday: user.birthday || "",
    hometown: user.hometown || "",
    hometownProvince: user.hometownProvince || "",
    hometownCity: user.hometownCity || "",
    schoolId: user.schoolId || "",
    schoolName: user.schoolName || "",
    schoolShortName: user.schoolShortName || "",
    schoolCampus: user.schoolCampus || "",
    schoolLogoUrl: user.schoolLogoUrl || "",
    showSchool: user.showSchool !== false,
    locale: LOCALES.includes(user.locale) ? user.locale : "",
    followerCount: toCount(user.followerCount),
    followingCount: toCount(user.followingCount),
    likeCollectCount: toCount(user.likeCollectCount),
    unreadNotifyCount: toCount(user.unreadNotifyCount),
    unreadCommentCount: toCount(user.unreadCommentCount),
    unreadLikeCount: toCount(user.unreadLikeCount),
    unreadFollowCount: toCount(user.unreadFollowCount),
  };
}

async function resolveOpenSchool(schoolId) {
  if (!schoolId) return null;
  try {
    const schools = db.collection("schools");
    const { data } = await schools.doc(schoolId).get();
    if (!data || data.isOpen === false) return null;
    return data;
  } catch (e) {
    return null;
  }
}

async function enrichUserSchoolLogo(user) {
  const formatted = formatUser(user);
  if (!formatted) return null;
  let schoolLogo = formatted.schoolLogoUrl || "";
  if (!schoolLogo && formatted.schoolId) {
    const school = await resolveOpenSchool(formatted.schoolId);
    if (school && school.logoUrl) schoolLogo = school.logoUrl;
  }
  if (schoolLogo && schoolLogo.indexOf("cloud://") === 0) {
    try {
      const res = await cloud.getTempFileURL({ fileList: [schoolLogo] });
      const item = (res.fileList || [])[0];
      if (item && item.tempFileURL && item.status === 0) {
        schoolLogo = item.tempFileURL;
      }
    } catch (e) {
      // keep cloud id
    }
  }
  formatted.schoolLogoUrl = schoolLogo;
  return formatted;
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
    if (typeof existing.unreadNotifyCount !== "number") {
      data.unreadNotifyCount = 0;
    }
    if (typeof existing.unreadCommentCount !== "number") {
      data.unreadCommentCount = 0;
    }
    if (typeof existing.unreadLikeCount !== "number") {
      data.unreadLikeCount = 0;
    }
    if (typeof existing.unreadFollowCount !== "number") {
      data.unreadFollowCount = 0;
    }
    if (!existing.shortId) {
      data.shortId = await allocateShortId();
    }
    await users.doc(existing._id).update({ data });
    return formatUser({ ...existing, ...data });
  }

  const payload = {
    openid,
    phoneNumber,
    shortId: await allocateShortId(),
    nickName: DEFAULT_NICK_NAME,
    avatarUrl: DEFAULT_AVATAR,
    bio: "",
    gender: "secret",
    birthday: "",
    hometown: "",
    hometownProvince: "",
    hometownCity: "",
    schoolId: "",
    schoolName: "",
    schoolShortName: "",
    schoolCampus: "",
    schoolLogoUrl: "",
    showSchool: true,
    locale: nextLocale,
    followerCount: 0,
    followingCount: 0,
    likeCollectCount: 0,
    unreadNotifyCount: 0,
    unreadCommentCount: 0,
    unreadLikeCount: 0,
    unreadFollowCount: 0,
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
    let user = await findUserByOpenid(OPENID);
    if (user) user = await ensureUserShortId(user);
    return { ok: true, user: await enrichUserSchoolLogo(user) };
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

    if (typeof event.showSchool === "boolean") {
      patch.showSchool = event.showSchool;
    }

    if (Object.prototype.hasOwnProperty.call(event, "schoolId")) {
      const schoolId =
        typeof event.schoolId === "string" ? event.schoolId.trim() : "";
      if (!schoolId) {
        patch.schoolId = "";
        patch.schoolName = "";
        patch.schoolShortName = "";
        patch.schoolCampus = "";
        patch.schoolLogoUrl = "";
      } else {
        const school = await resolveOpenSchool(schoolId);
        if (!school) {
          return {
            ok: false,
            error: "SCHOOL_NOT_FOUND",
            message: "学校不存在或已关闭",
          };
        }
        patch.schoolId = schoolId;
        patch.schoolName = school.name || "";
        patch.schoolShortName = school.shortName || "";
        patch.schoolCampus = school.campus || "";
        patch.schoolLogoUrl = school.logoUrl || "";
      }
    }

    await users.doc(existing._id).update({ data: patch });
    return {
      ok: true,
      user: await enrichUserSchoolLogo({ ...existing, ...patch }),
    };
  }

  return { ok: false, error: "UNKNOWN_TYPE" };
};
