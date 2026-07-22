const cloud = require("wx-server-sdk");
const fs = require("fs");
const path = require("path");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const schools = db.collection("schools");

const ADMIN_KEY = "uknow-school-admin";
const LOGO_DIR = path.join(__dirname, "logos");

/**
 * schools 高校目录（一校区一条）
 * {
 *   name, shortName, campus, logoUrl, isOpen, province, sort,
 *   createdAt, updatedAt
 * }
 *
 * 小程序只读 listOpen；管理接口需 adminKey
 */

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (e) {
    // ignore
  }
}

function isCloudFileId(url) {
  return typeof url === "string" && url.indexOf("cloud://") === 0;
}

function formatSchool(doc) {
  if (!doc) return null;
  return {
    _id: doc._id,
    name: doc.name || "",
    shortName: doc.shortName || "",
    campus: doc.campus || "",
    logoUrl: doc.logoUrl || "",
    isOpen: doc.isOpen !== false,
    province: doc.province || "广东",
    sort: Number(doc.sort) || 0,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

function requireAdmin(event) {
  return event && event.adminKey === ADMIN_KEY;
}

async function fetchAllSchools() {
  await ensureCollection("schools");
  const MAX = 1000;
  const all = [];
  let skip = 0;
  while (skip < 5000) {
    const { data } = await schools.skip(skip).limit(MAX).get();
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < MAX) break;
    skip += MAX;
  }
  return all;
}

async function resolveLogoUrls(list) {
  const ids = [];
  (list || []).forEach((item) => {
    if (item && isCloudFileId(item.logoUrl)) ids.push(item.logoUrl);
  });
  const unique = Array.from(new Set(ids));
  if (!unique.length) return list || [];

  const map = {};
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    try {
      const res = await cloud.getTempFileURL({ fileList: chunk });
      (res.fileList || []).forEach((f) => {
        if (f.fileID && f.tempFileURL && f.status === 0) {
          map[f.fileID] = f.tempFileURL;
        }
      });
    } catch (e) {
      console.error("resolveLogoUrls failed", e);
    }
  }

  return (list || []).map((item) => {
    if (!item) return item;
    if (item.logoUrl && map[item.logoUrl]) {
      return { ...item, logoUrl: map[item.logoUrl] };
    }
    return item;
  });
}

function listLocalLogoFiles() {
  if (!fs.existsSync(LOGO_DIR)) return [];
  return fs
    .readdirSync(LOGO_DIR)
    .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
    .map((name) => ({
      name: name.replace(/\.(png|jpe?g|webp)$/i, ""),
      file: path.join(LOGO_DIR, name),
      ext: (name.match(/\.(png|jpe?g|webp)$/i) || [".png"])[0].toLowerCase(),
    }));
}

async function handleSyncLogos(event) {
  if (!requireAdmin(event)) {
    return { ok: false, error: "FORBIDDEN" };
  }

  const force = !!event.force;
  const localLogos = listLocalLogoFiles();
  if (!localLogos.length) {
    return { ok: false, error: "NO_LOCAL_LOGOS", message: "云函数未打包 logos 目录" };
  }

  const all = await fetchAllSchools();
  const byName = {};
  all.forEach((doc) => {
    if (!doc || !doc.name) return;
    if (!byName[doc.name]) byName[doc.name] = [];
    byName[doc.name].push(doc);
  });

  let uploaded = 0;
  let updated = 0;
  let skipped = 0;
  let missing = 0;

  for (const logo of localLogos) {
    const docs = byName[logo.name];
    if (!docs || !docs.length) {
      missing += 1;
      continue;
    }

    const needUpload = force || docs.some((d) => !d.logoUrl);
    if (!needUpload) {
      skipped += 1;
      continue;
    }

    const cloudPath = `schools/logos/${Buffer.from(logo.name)
      .toString("base64")
      .replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" }[c]))}${logo.ext}`;

    let fileID = "";
    try {
      const buf = fs.readFileSync(logo.file);
      const up = await cloud.uploadFile({
        cloudPath,
        fileContent: buf,
      });
      fileID = up.fileID;
      uploaded += 1;
    } catch (e) {
      console.error("upload logo failed", logo.name, e);
      continue;
    }

    for (const doc of docs) {
      if (!force && doc.logoUrl) continue;
      try {
        await schools.doc(doc._id).update({
          data: { logoUrl: fileID, updatedAt: db.serverDate() },
        });
        updated += 1;
      } catch (e) {
        console.error("update school logo failed", doc._id, e);
      }
    }
  }

  return {
    ok: true,
    localLogoCount: localLogos.length,
    uploaded,
    updated,
    skipped,
    unmatchedFiles: missing,
  };
}

async function handleListOpen(event) {
  const keyword =
    typeof event.keyword === "string" ? event.keyword.trim().toLowerCase() : "";
  let list = (await fetchAllSchools())
    .filter((d) => d.isOpen !== false)
    .filter((d) => {
      if (!keyword) return true;
      const name = String(d.name || "").toLowerCase();
      const shortName = String(d.shortName || "").toLowerCase();
      const campus = String(d.campus || "").toLowerCase();
      return (
        name.indexOf(keyword) > -1 ||
        shortName.indexOf(keyword) > -1 ||
        campus.indexOf(keyword) > -1
      );
    })
    .sort((a, b) => {
      const sa = Number(a.sort) || 0;
      const sb = Number(b.sort) || 0;
      if (sa !== sb) return sa - sb;
      const na = String(a.name || "").localeCompare(String(b.name || ""), "zh");
      if (na !== 0) return na;
      return String(a.campus || "").localeCompare(String(b.campus || ""), "zh");
    })
    .map(formatSchool);

  list = await resolveLogoUrls(list);
  return { ok: true, list, total: list.length };
}

async function handleListAll(event) {
  if (!requireAdmin(event)) {
    return { ok: false, error: "FORBIDDEN" };
  }
  const keyword =
    typeof event.keyword === "string" ? event.keyword.trim().toLowerCase() : "";
  let list = (await fetchAllSchools())
    .filter((d) => {
      if (!keyword) return true;
      const name = String(d.name || "").toLowerCase();
      const shortName = String(d.shortName || "").toLowerCase();
      return name.indexOf(keyword) > -1 || shortName.indexOf(keyword) > -1;
    })
    .sort((a, b) => {
      const na = String(a.name || "").localeCompare(String(b.name || ""), "zh");
      if (na !== 0) return na;
      return String(a.campus || "").localeCompare(String(b.campus || ""), "zh");
    })
    .map(formatSchool);
  list = await resolveLogoUrls(list);
  return { ok: true, list, total: list.length };
}

async function handleCreate(event) {
  if (!requireAdmin(event)) {
    return { ok: false, error: "FORBIDDEN" };
  }
  const name = typeof event.name === "string" ? event.name.trim() : "";
  const shortName =
    typeof event.shortName === "string" ? event.shortName.trim() : "";
  const campus = typeof event.campus === "string" ? event.campus.trim() : "";
  if (!name || !shortName) {
    return { ok: false, error: "INVALID_FIELDS", message: "学校名与简称必填" };
  }

  await ensureCollection("schools");
  const { data } = await schools.where({ name, campus }).limit(1).get();
  if (data && data[0]) {
    return { ok: false, error: "DUPLICATE", message: "该校区已存在" };
  }

  const now = db.serverDate();
  const payload = {
    name,
    shortName,
    campus,
    logoUrl: typeof event.logoUrl === "string" ? event.logoUrl.trim() : "",
    isOpen: event.isOpen === false ? false : true,
    province:
      typeof event.province === "string" && event.province.trim()
        ? event.province.trim()
        : "广东",
    sort: Number(event.sort) || 0,
    createdAt: now,
    updatedAt: now,
  };
  const addRes = await schools.add({ data: payload });
  return { ok: true, school: formatSchool({ ...payload, _id: addRes._id }) };
}

async function handleUpdate(event) {
  if (!requireAdmin(event)) {
    return { ok: false, error: "FORBIDDEN" };
  }
  const id = event.id || event.schoolId;
  if (!id) return { ok: false, error: "MISSING_ID" };

  let doc = null;
  try {
    const { data } = await schools.doc(id).get();
    doc = data;
  } catch (e) {
    doc = null;
  }
  if (!doc) return { ok: false, error: "NOT_FOUND" };

  const patch = { updatedAt: db.serverDate() };
  if (typeof event.name === "string") {
    const name = event.name.trim();
    if (!name) return { ok: false, error: "EMPTY_NAME" };
    patch.name = name;
  }
  if (typeof event.shortName === "string") {
    const shortName = event.shortName.trim();
    if (!shortName) return { ok: false, error: "EMPTY_SHORT_NAME" };
    patch.shortName = shortName;
  }
  if (typeof event.campus === "string") {
    patch.campus = event.campus.trim();
  }
  if (typeof event.province === "string") {
    patch.province = event.province.trim() || "广东";
  }
  if (typeof event.logoUrl === "string") {
    patch.logoUrl = event.logoUrl.trim();
  }
  if (typeof event.sort === "number") {
    patch.sort = event.sort;
  }
  if (typeof event.isOpen === "boolean") {
    patch.isOpen = event.isOpen;
  }

  await schools.doc(id).update({ data: patch });
  return { ok: true, school: formatSchool({ ...doc, ...patch, _id: id }) };
}

async function handleRemove(event) {
  if (!requireAdmin(event)) {
    return { ok: false, error: "FORBIDDEN" };
  }
  const id = event.id || event.schoolId;
  if (!id) return { ok: false, error: "MISSING_ID" };
  try {
    await schools.doc(id).remove();
  } catch (e) {
    return { ok: false, error: "NOT_FOUND" };
  }
  return { ok: true };
}

async function handleSetOpen(event) {
  if (!requireAdmin(event)) {
    return { ok: false, error: "FORBIDDEN" };
  }
  const id = event.id || event.schoolId;
  if (!id) return { ok: false, error: "MISSING_ID" };
  if (typeof event.isOpen !== "boolean") {
    return { ok: false, error: "INVALID_IS_OPEN" };
  }
  try {
    await schools.doc(id).update({
      data: { isOpen: event.isOpen, updatedAt: db.serverDate() },
    });
  } catch (e) {
    return { ok: false, error: "NOT_FOUND" };
  }
  return { ok: true, isOpen: event.isOpen };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const type = event.type || event.action;

  // 校徽同步：控制台可直接测（需 adminKey）
  if (type === "syncLogos") {
    return handleSyncLogos(event);
  }

  if (!OPENID) {
    return { ok: false, error: "NO_OPENID" };
  }

  if (type === "listOpen") return handleListOpen(event);
  if (type === "listAll") return handleListAll(event);
  if (type === "create") return handleCreate(event);
  if (type === "update") return handleUpdate(event);
  if (type === "remove" || type === "delete") return handleRemove(event);
  if (type === "setOpen") return handleSetOpen(event);

  return { ok: false, error: "UNKNOWN_TYPE" };
};
