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
    wx.showShareMenu({
      menus: ['shareAppMessage', 'shareTimeline']
    });
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
   * 方法是什么：首页好友转发配置方法。
   * 方法作用：设置俱乐部首页的转发标题、落地页和品牌缩略图。
   * 为什么添加：让用户可以把公开俱乐部首页直接分享给微信好友。
   */
  onShareAppMessage() {
    return {
      title: '广州双语国际演讲俱乐部',
      path: '/pages/index/index',
      imageUrl: '/images/template/toastmasters-logo.png'
    };
  },

  /**
   * 方法是什么：首页朋友圈分享配置方法。
   * 方法作用：设置分享到朋友圈时展示的俱乐部标题和品牌缩略图。
   * 为什么添加：补充朋友圈分享入口并确保分享后直接进入公开首页。
   */
  onShareTimeline() {
    return {
      title: '广州双语国际演讲俱乐部',
      query: '',
      imageUrl: '/images/template/toastmasters-logo.png'
    };
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
