const { getI18nData, t, onLocaleChange } = require("../../i18n/index");
const { isLoggedIn, getLocalUser, setLocalUser, normalizeUser } = require("../../utils/user");
const {
  listOpenSchools,
  groupSchoolsByName,
} = require("../../utils/school");

Page({
  data: {
    t: getI18nData(),
    keyword: "",
    loading: false,
    step: "school",
    schoolGroups: [],
    selectedName: "",
    campusList: [],
    defaultLogo: "/images/school-badge.svg",
  },

  allGroups: [],

  onLoad() {
    this._offLocale = onLocaleChange(() => this.applyI18n());
    this.applyI18n();
    if (!isLoggedIn()) {
      wx.navigateBack({ fail: () => {} });
      return;
    }
    this.loadSchools();
  },

  onUnload() {
    if (this._offLocale) this._offLocale();
  },

  applyI18n() {
    this.setData({ t: getI18nData() });
    wx.setNavigationBarTitle({ title: t("nav.schoolPicker") });
  },

  async loadSchools() {
    this.setData({ loading: true, schoolGroups: [] });
    try {
      const result = await listOpenSchools({ keyword: "" });
      if (!result.ok) throw new Error(result.error || "list failed");
      this.allGroups = groupSchoolsByName(result.list || []);
      this.applyFilter(this.data.keyword);
    } catch (e) {
      console.error("load schools failed", e);
      this.allGroups = [];
      this.setData({ schoolGroups: [] });
      wx.showToast({ title: t("common.operationFailed"), icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  applyFilter(keyword) {
    const kw = String(keyword || "").trim().toLowerCase();
    let groups = this.allGroups || [];
    if (kw) {
      groups = groups.filter((g) => {
        const name = String(g.name || "").toLowerCase();
        const shortName = String(g.shortName || "").toLowerCase();
        if (name.indexOf(kw) > -1 || shortName.indexOf(kw) > -1) return true;
        return (g.campuses || []).some((c) =>
          String(c.campus || "").toLowerCase().indexOf(kw) > -1
        );
      });
    }
    this.setData({ schoolGroups: groups });
  },

  onKeywordInput(e) {
    const keyword = (e.detail && e.detail.value) || "";
    this.setData({ keyword });
  },

  onSearch() {
    this.applyFilter(this.data.keyword);
    if (this.data.step === "campus") {
      this.setData({ step: "school", selectedName: "", campusList: [] });
    }
  },

  onPickSchool(e) {
    const name = e.currentTarget.dataset.name;
    const group = (this.allGroups || []).find((g) => g.name === name);
    if (!group) return;
    const campuses = group.campuses || [];
    if (campuses.length === 1) {
      this.saveSchool(campuses[0]._id);
      return;
    }
    this.setData({
      step: "campus",
      selectedName: group.name,
      campusList: campuses,
    });
  },

  onBackToSchools() {
    this.setData({ step: "school", selectedName: "", campusList: [] });
  },

  onPickCampus(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.saveSchool(id);
  },

  async saveSchool(schoolId) {
    wx.showLoading({ title: t("common.saving"), mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: "login",
        data: { type: "updateProfile", schoolId: schoolId || "" },
      });
      const result = res.result || {};
      if (!result.ok || !result.user) {
        throw new Error(result.message || result.error || "save failed");
      }
      const user = normalizeUser(result.user);
      if (user) setLocalUser(user);
      wx.showToast({ title: t("common.saved"), icon: "success" });
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 400);
    } catch (e) {
      console.error("save school failed", e);
      wx.showToast({
        title: e.message || t("common.saveFailed"),
        icon: "none",
      });
    } finally {
      wx.hideLoading();
    }
  },

  onClearSchool() {
    this.saveSchool("");
  },
});
