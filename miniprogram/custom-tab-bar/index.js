Component({
  data: {
    selected: 0,
    list: [
      {
        pagePath: "/pages/home/index",
        text: "首页",
        icon: "/images/tab/home.svg",
        iconActive: "/images/tab/home-active.svg",
      },
      {
        pagePath: "/pages/explore/index",
        text: "待定",
        icon: "/images/tab/explore.svg",
        iconActive: "/images/tab/explore-active.svg",
      },
      {
        pagePath: "/pages/publish/index",
        text: "发布",
        isPublish: true,
      },
      {
        pagePath: "/pages/message/index",
        text: "消息",
        icon: "/images/tab/message.svg",
        iconActive: "/images/tab/message-active.svg",
      },
      {
        pagePath: "/pages/profile/index",
        text: "我的",
        icon: "/images/tab/profile.svg",
        iconActive: "/images/tab/profile-active.svg",
      },
    ],
  },

  methods: {
    onTap(e) {
      const { index, path, publish } = e.currentTarget.dataset;

      if (publish) {
        // 发帖入口：后续接入发布流程
        return;
      }

      wx.switchTab({ url: path });
      this.setData({ selected: index });
    },
  },
});
