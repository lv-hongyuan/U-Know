/**
 * 社区发帖客户端封装（云函数 post）
 */
const TITLE_MAX = 30;
const CONTENT_MAX = 1200;
const TOPIC_MAX_LEN = 10;
const IMAGE_MAX = 9;
const COMMENT_MAX = 300;
const DEFAULT_AVATAR = "/images/default-avatar.svg";
const COVER_RATIO_MAX = 1.5;
const COVER_RATIO_DEFAULT = 1.25;

function callPost(data) {
  return wx.cloud
    .callFunction({
      name: "post",
      data,
    })
    .then((res) => res.result || {});
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

function createPost(payload) {
  const postType = payload && payload.type === "image" ? "image" : "text";
  return callPost({
    action: "create",
    type: "create",
    postType,
    mediaType: postType,
    title: payload && payload.title,
    content: payload && payload.content,
    images: payload && payload.images,
    visibility: payload && payload.visibility,
  });
}

function updatePost(payload) {
  return callPost({
    action: "update",
    type: "update",
    postId: payload && payload.postId,
    title: payload && payload.title,
    content: payload && payload.content,
    images: payload && payload.images,
    visibility: payload && payload.visibility,
  });
}

function getPostDetail(postId) {
  return callPost({
    action: "getDetail",
    type: "getDetail",
    postId,
  });
}

function listFeed({ feed = "plaza", skip = 0, limit = 10 } = {}) {
  return callPost({
    action: "listFeed",
    type: "listFeed",
    feed,
    skip,
    limit,
  });
}

function listMine({ visibility = "public", skip = 0, limit = 10 } = {}) {
  return callPost({
    action: "listMine",
    type: "listMine",
    visibility,
    skip,
    limit,
  });
}

function listCollected({ skip = 0, limit = 10 } = {}) {
  return callPost({
    action: "listCollected",
    type: "listCollected",
    skip,
    limit,
  });
}

function toggleLike(postId) {
  return callPost({
    action: "toggleLike",
    type: "toggleLike",
    postId,
  });
}

function toggleCollect(postId) {
  return callPost({
    action: "toggleCollect",
    type: "toggleCollect",
    postId,
  });
}

function listComments({ postId, skip = 0, limit = 20 } = {}) {
  return callPost({
    action: "listComments",
    type: "listComments",
    postId,
    skip,
    limit,
  });
}

function createComment({ postId, content }) {
  return callPost({
    action: "createComment",
    type: "createComment",
    postId,
    content,
  });
}

function clampCoverRatio(ratio) {
  const n = Number(ratio);
  if (!Number.isFinite(n) || n <= 0) return COVER_RATIO_DEFAULT;
  return Math.min(COVER_RATIO_MAX, Math.max(0.75, n));
}

function toFeedCard(post) {
  if (!post) return null;
  const cover =
    post.type === "image" && post.images && post.images[0]
      ? post.images[0]
      : "";
  return {
    id: post._id,
    openid: post.openid,
    nickName: post.nickName || "",
    avatarUrl: post.avatarUrl || DEFAULT_AVATAR,
    title: post.title || "",
    cover,
    isText: !cover,
    likeCount: Number(post.likeCount) || 0,
    viewCount: Number(post.viewCount) || 0,
    coverRatio: COVER_RATIO_DEFAULT,
    visibility: post.visibility || "public",
  };
}

function enrichCoverRatio(card) {
  return new Promise((resolve) => {
    if (!card || !card.cover) {
      resolve({ ...card, coverRatio: COVER_RATIO_DEFAULT });
      return;
    }
    wx.getImageInfo({
      src: card.cover,
      success: (res) => {
        const ratio =
          res.width > 0 ? clampCoverRatio(res.height / res.width) : COVER_RATIO_DEFAULT;
        resolve({ ...card, coverRatio: ratio });
      },
      fail: () => resolve({ ...card, coverRatio: COVER_RATIO_DEFAULT }),
    });
  });
}

async function mapFeedCards(list) {
  const cards = (list || []).map(toFeedCard).filter(Boolean);
  return Promise.all(cards.map(enrichCoverRatio));
}

function splitWaterfall(items) {
  const left = [];
  const right = [];
  let leftH = 0;
  let rightH = 0;
  (items || []).forEach((item) => {
    const h = Number(item.coverRatio) || COVER_RATIO_DEFAULT;
    if (leftH <= rightH) {
      left.push(item);
      leftH += h + 0.35;
    } else {
      right.push(item);
      rightH += h + 0.35;
    }
  });
  return { left, right };
}

function isCloudFileId(path) {
  return typeof path === "string" && path.indexOf("cloud://") === 0;
}

module.exports = {
  TITLE_MAX,
  CONTENT_MAX,
  TOPIC_MAX_LEN,
  IMAGE_MAX,
  COMMENT_MAX,
  COVER_RATIO_MAX,
  DEFAULT_AVATAR,
  extractTopics,
  createPost,
  updatePost,
  getPostDetail,
  listFeed,
  listMine,
  listCollected,
  toggleLike,
  toggleCollect,
  listComments,
  createComment,
  toFeedCard,
  mapFeedCards,
  splitWaterfall,
  isCloudFileId,
};
