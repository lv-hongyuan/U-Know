/** 聊天时间分隔：相邻消息超过此时长则展示时间条 */
const CHAT_TIME_GAP_MS = 5 * 60 * 1000;

/**
 * 评论/动态相对时间
 */
function formatCommentTime(createdAt, t) {
  if (!createdAt || typeof t !== "function") return "";
  const ts = new Date(createdAt).getTime();
  if (!Number.isFinite(ts)) return "";

  const diff = Date.now() - ts;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < hour) {
    const n = Math.max(1, Math.floor(diff / minute));
    return (t("time.minutesAgo") || "{n}").replace("{n}", String(n));
  }
  if (diff < day) {
    const n = Math.max(1, Math.floor(diff / hour));
    return (t("time.hoursAgo") || "{n}").replace("{n}", String(n));
  }

  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 日历日差：0=今天，1=昨天，… */
function calendarDayDiff(fromTs, toTs) {
  const a = startOfLocalDay(new Date(fromTs));
  const b = startOfLocalDay(new Date(toTs));
  return Math.round((a - b) / (24 * 60 * 60 * 1000));
}

function formatHm(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatHms(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/**
 * 微信风格聊天时间条文案（已确认需展示时再调用）
 * - 当天：时分秒
 * - 昨天：昨天 + 时分
 * - 近 7 天内：周x + 时分
 * - 今年更早：月日 + 时分
 * - 往年：年月日 + 时分
 */
function formatChatDividerTime(createdAt, t) {
  if (!createdAt || typeof t !== "function") return "";
  const ts = new Date(createdAt).getTime();
  if (!Number.isFinite(ts)) return "";

  const d = new Date(ts);
  const now = Date.now();
  const dayDiff = calendarDayDiff(now, ts);
  const hm = formatHm(d);

  if (dayDiff === 0) return formatHms(d);
  if (dayDiff === 1) return `${t("time.yesterday")} ${hm}`;
  if (dayDiff > 1 && dayDiff < 7) {
    return `${t(`time.weekday${d.getDay()}`)} ${hm}`;
  }

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1);
  const dd = String(d.getDate());
  if (y === new Date(now).getFullYear()) {
    return `${(t("time.monthDay") || "{m}/{d}")
      .replace("{m}", m)
      .replace("{d}", dd)} ${hm}`;
  }
  return `${(t("time.yearMonthDay") || "{y}/{m}/{d}")
    .replace("{y}", String(y))
    .replace("{m}", m)
    .replace("{d}", dd)} ${hm}`;
}

function shouldShowChatTime(prevCreatedAt, createdAt, gapMs = CHAT_TIME_GAP_MS) {
  const ts = new Date(createdAt).getTime();
  if (!Number.isFinite(ts)) return false;
  if (prevCreatedAt == null || prevCreatedAt === "") return true;
  const prev = new Date(prevCreatedAt).getTime();
  if (!Number.isFinite(prev)) return true;
  return ts - prev >= gapMs;
}

module.exports = {
  CHAT_TIME_GAP_MS,
  formatCommentTime,
  formatChatDividerTime,
  shouldShowChatTime,
};
