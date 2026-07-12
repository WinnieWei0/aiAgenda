const app = getApp();
const cloud = require('../../utils/cloud');

Page({
  data: {
    envId: '',
    isAdmin: false,
    canClaimAdmin: false,
    userOpenid: '',
    roleText: '加载中'
  },

  /**
   * 方法是什么：首页加载生命周期方法。
   * 方法作用：初始化云环境展示信息，并刷新当前用户的登录和权限状态。
   * 为什么添加：预览默认进入首页时，需要第一时间看到是否可以领取管理员以及后续管理入口。
   */
  async onLoad() {
    this.setData({ envId: app.globalData.envId });
    await this.refreshLoginState();
  },

  /**
   * 方法是什么：首页显示生命周期方法。
   * 方法作用：每次回到首页时重新同步用户角色和管理员领取状态。
   * 为什么添加：领取管理员或在管理中心调整角色后，首页按钮需要跟随最新权限刷新。
   */
  async onShow() {
    await this.refreshLoginState();
  },

  /**
   * 方法是什么：刷新登录和权限状态。
   * 方法作用：调用全局登录方法获取最新用户、角色和是否可领取管理员标记。
   * 为什么添加：微信小程序启动登录是异步过程，首页独立刷新可以避免页面先显示过期状态。
   */
  async refreshLoginState() {
    await app.login();
    this.syncAuthState();
  },

  /**
   * 方法是什么：同步全局权限状态到首页数据。
   * 方法作用：把 openid、角色文本、管理员身份和可领取状态写入页面。
   * 为什么添加：首页展示和按钮显隐都依赖这些状态，集中处理能让页面逻辑更稳定。
   */
  syncAuthState() {
    const roles = app.globalData.roles || [];
    this.setData({
      isAdmin: app.isAdmin(),
      canClaimAdmin: app.globalData.canClaimAdmin,
      userOpenid: app.globalData.user ? app.globalData.user.openid : '',
      roleText: roles.length ? roles.join('、') : '普通用户'
    });
  },

  /**
   * 方法是什么：领取系统首个管理员。
   * 方法作用：调用 `claimInitialAdmin` 云函数把当前用户设置为初始管理员，并刷新登录状态。
   * 为什么添加：新部署系统需要一个可视化入口创建首个管理员，避免手工改数据库。
   */
  async claimAdmin() {
    try {
      await cloud.callCloud('claimInitialAdmin', {});
      await this.refreshLoginState();
      cloud.showSuccess('已成为管理员');
    } catch (error) {
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：打开管理中心页面。
   * 方法作用：跳转到 Membership、Pathways 和角色管理界面。
   * 为什么添加：管理员需要在小程序内维护基础表，保证解析议程时可以匹配成员和项目。
   */
  openAdmin() {
    wx.navigateTo({ url: '/pages/admin/admin' });
  },

  /**
   * 方法是什么：打开历史议程页面。
   * 方法作用：跳转到用户保存过的议程列表。
   * 为什么添加：首页需要提供已保存议程的快捷入口，方便继续编辑或重新导出。
   */
  openHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  /**
   * 方法是什么：切换到解析议程表 Tab。
   * 方法作用：通过底部菜单对应的页面路径进入接龙解析页面。
   * 为什么添加：首页只负责管理员初始化和管理入口，解析工作需要进入独立页面完成。
   */
  openParseTab() {
    wx.switchTab({ url: '/pages/parse/parse' });
  }
});
