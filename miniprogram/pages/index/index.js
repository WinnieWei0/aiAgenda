Page({
  /**
   * 方法是什么：打开解析 Tab。
   * 方法作用：切换到底部解析议程表页面。
   * 为什么添加：首页主操作需要直达解析入口。
   */
  openParseTab() {
    wx.switchTab({ url: '/pages/parse/parse' });
  },

  /**
   * 方法是什么：打开时间牌。
   * 方法作用：进入时间牌占位页面。
   * 为什么添加：首页需要保留会议工具入口。
   */
  openTimer() {
    wx.navigateTo({ url: '/pages/timer/timer' });
  },

  /**
   * 方法是什么：打开会员列表。
   * 方法作用：进入会员数据管理页面。
   * 为什么添加：首页需要直接访问会员数据。
   */
  openMembersList() {
    wx.navigateTo({ url: '/pages/members/list/list' });
  },

  /**
   * 方法是什么：打开路径列表。
   * 方法作用：进入路径数据管理页面。
   * 为什么添加：首页需要直接访问路径数据。
   */
  openPathwaysList() {
    wx.navigateTo({ url: '/pages/pathways/list/list' });
  }
});
