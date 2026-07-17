Page({
  data: {
    isSuperAdmin: false
  },

  /**
   * 方法是什么：首页显示生命周期方法。
   * 方法作用：每次返回首页时同步当前模拟超管状态。
   * 为什么添加：模板编辑器返回后首页按钮必须显示正确身份。
   */
  onShow() {
    this.setData({ isSuperAdmin: getApp().isSuperAdminMode() });
  },

  /**
   * 方法是什么：切换模拟超管身份。
   * 方法作用：点击首页按钮后在普通会员和超管模式之间切换。
   * 为什么添加：用户要求通过简单按钮模拟超管且不做任何授权。
   */
  toggleSuperAdmin() {
    const isSuperAdmin = getApp().toggleSuperAdminMode();
    this.setData({ isSuperAdmin });
    wx.showToast({ title: isSuperAdmin ? '已进入超管模式' : '已退出超管模式', icon: 'none' });
  },

  /**
   * 方法是什么：打开全局模板编辑器。
   * 方法作用：让模拟超管维护固定内容、素材和议程规则。
   * 为什么添加：超管的主要职责是编辑两页议程模板。
   */
  openTemplateEditor() {
    if (!this.data.isSuperAdmin) {
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
  }
});
