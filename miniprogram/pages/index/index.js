Page({
  data: {
    isAdmin: false
  },

  /**
   * 方法是什么：首页显示生命周期方法。
   * 方法作用：每次返回首页时同步当前真实管理员身份。
   * 为什么添加：管理入口必须随会员绑定状态更新。
   */
  async onShow() {
    await getApp().login();
    this.setData({ isAdmin: getApp().isAdmin() });
  },

  /**
   * 方法是什么：打开全局模板编辑器。
   * 方法作用：让管理员维护固定内容、素材和议程规则。
   * 为什么添加：模板编辑必须由真实管理员身份控制。
   */
  openTemplateEditor() {
    if (!this.data.isAdmin) {
      return;
    }
    wx.navigateTo({ url: '/pages/template-editor/template-editor' });
  },
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
  },

  openMembershipInvite() {
    if (this.data.isAdmin) {
      wx.navigateTo({ url: '/pages/membership-invite/membership-invite' });
    }
  }
});
