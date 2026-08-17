Page({
  data: {
    isAdmin: false,
    welcomeName: '宾客'
  },

  /**
   * 方法是什么：首页显示生命周期方法。
   * 方法作用：每次返回首页时同步当前真实管理员身份。
   * 为什么添加：管理入口必须随会员绑定状态更新。
   */
  async onShow() {
    const app = getApp();
    await app.login();
    const identity = app.globalData.identity || {};
    const user = app.globalData.user || {};
    this.setData({
      isAdmin: app.isAdmin(),
      welcomeName: identity.name || user.nickName || '宾客'
    });
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
