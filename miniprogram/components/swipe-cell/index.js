Component({
  options: {
    multipleSlots: true,
  },
  properties: {
    /** 右滑露出操作区宽度 rpx → 用 px 在 wxs 里算，这里传 actions 数量 */
    actionWidth: {
      type: Number,
      value: 420,
    },
    disabled: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    offsetX: 0,
    moving: false,
  },

  methods: {
    onTouchStart(e) {
      if (this.data.disabled) return;
      const t = e.touches[0];
      this._startX = t.clientX;
      this._startY = t.clientY;
      this._startOffset = this.data.offsetX || 0;
      this._locked = "";
      this.setData({ moving: true });
    },

    onTouchMove(e) {
      if (this.data.disabled || this._locked === "v") return;
      const t = e.touches[0];
      const dx = t.clientX - this._startX;
      const dy = t.clientY - this._startY;
      if (!this._locked) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        this._locked = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
        if (this._locked === "v") return;
      }
      const max = this.rpxToPx(this.data.actionWidth || 420);
      let next = this._startOffset + dx;
      if (next > 0) next = 0;
      if (next < -max) next = -max;
      this.setData({ offsetX: next });
    },

    onTouchEnd() {
      if (this.data.disabled) return;
      const max = this.rpxToPx(this.data.actionWidth || 420);
      const opened = this.data.offsetX < -max * 0.35;
      this.setData({
        offsetX: opened ? -max : 0,
        moving: false,
      });
      this._locked = "";
    },

    close() {
      this.setData({ offsetX: 0, moving: false });
    },

    rpxToPx(rpx) {
      try {
        const info =
          typeof wx.getWindowInfo === "function"
            ? wx.getWindowInfo()
            : wx.getSystemInfoSync();
        return (rpx / 750) * (info.windowWidth || 375);
      } catch (e) {
        return rpx * 0.5;
      }
    },
  },
});
