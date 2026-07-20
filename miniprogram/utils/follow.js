/**
 * 关注关系工具（调用云函数 user）
 *
 * follow / unfollow / isFollowing / listRelations
 */
function callUser(data) {
  return wx.cloud
    .callFunction({
      name: "user",
      data,
    })
    .then((res) => res.result || {});
}

function follow(targetOpenid) {
  return callUser({ type: "follow", targetOpenid });
}

function unfollow(targetOpenid) {
  return callUser({ type: "unfollow", targetOpenid });
}

function isFollowing(targetOpenid) {
  return callUser({ type: "isFollowing", targetOpenid });
}

function listRelations({ tab = "following", keyword = "", skip = 0, limit = 20 } = {}) {
  return callUser({
    type: "listRelations",
    tab,
    keyword,
    skip,
    limit,
  });
}

module.exports = {
  follow,
  unfollow,
  isFollowing,
  listRelations,
};
