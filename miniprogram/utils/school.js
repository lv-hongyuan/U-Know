/**
 * 高校目录客户端封装（云函数 school）
 */

function callSchool(data) {
  return wx.cloud
    .callFunction({
      name: "school",
      data,
    })
    .then((res) => res.result || {});
}

function listOpenSchools({ keyword = "" } = {}) {
  return callSchool({
    type: "listOpen",
    keyword,
  });
}

function formatSchoolLabel(school) {
  if (!school || !school.name) return "";
  if (school.campus) return `${school.name} · ${school.campus}`;
  return school.name;
}

function formatSchoolShortLabel(school) {
  if (!school) return "";
  return school.shortName || school.name || "";
}

/** 将 listOpen 结果按学校名分组，便于二级选校区 */
function groupSchoolsByName(list) {
  const map = {};
  const order = [];
  (list || []).forEach((item) => {
    if (!item || !item.name) return;
    if (!map[item.name]) {
      map[item.name] = {
        name: item.name,
        shortName: item.shortName || "",
        logoUrl: item.logoUrl || "",
        campuses: [],
      };
      order.push(item.name);
    } else if (!map[item.name].logoUrl && item.logoUrl) {
      map[item.name].logoUrl = item.logoUrl;
    }
    map[item.name].campuses.push(item);
  });
  return order.map((name) => map[name]);
}

module.exports = {
  callSchool,
  listOpenSchools,
  formatSchoolLabel,
  formatSchoolShortLabel,
  groupSchoolsByName,
};
