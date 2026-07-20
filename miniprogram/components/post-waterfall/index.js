const { splitWaterfall } = require("../../utils/post");

Component({
  properties: {
    list: {
      type: Array,
      value: [],
    },
    loading: {
      type: Boolean,
      value: false,
    },
    hasMore: {
      type: Boolean,
      value: true,
    },
    emptyText: {
      type: String,
      value: "",
    },
    loadingText: {
      type: String,
      value: "",
    },
    noMoreText: {
      type: String,
      value: "",
    },
    showViews: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    left: [],
    right: [],
  },

  observers: {
    list(list) {
      const cols = splitWaterfall(list || []);
      this.setData({ left: cols.left, right: cols.right });
    },
  },

  methods: {
    onTapItem(e) {
      const id = e.currentTarget.dataset.id;
      if (!id) return;
      this.triggerEvent("itemtap", { id });
    },
  },
});
