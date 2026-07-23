Component({
  properties: {
    /** waterfall | notify | relation | school | detail */
    type: {
      type: String,
      value: "waterfall",
    },
    /** notify / relation / school 行数 */
    rows: {
      type: Number,
      value: 6,
    },
  },

  data: {
    rowItems: [
      { key: 0, thumb: true },
      { key: 1, thumb: false },
      { key: 2, thumb: true },
      { key: 3, thumb: false },
      { key: 4, thumb: true },
      { key: 5, thumb: false },
    ],
    waterfallLeft: [
      { key: "l0", ratio: 1.25 },
      { key: "l1", ratio: 0.95 },
      { key: "l2", ratio: 1.15 },
    ],
    waterfallRight: [
      { key: "r0", ratio: 0.9 },
      { key: "r1", ratio: 1.3 },
      { key: "r2", ratio: 1.05 },
    ],
  },

  observers: {
    rows(n) {
      const count = Math.max(1, Math.min(12, Number(n) || 6));
      const rowItems = [];
      for (let i = 0; i < count; i += 1) {
        rowItems.push({ key: i, thumb: i % 2 === 0 });
      }
      this.setData({ rowItems });
    },
  },
});
