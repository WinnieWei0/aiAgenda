const app = getApp();
const cloud = require('../../utils/cloud');

Page({
  data: {
    envId: '',
    isAdmin: false,
    canClaimAdmin: false,
    userOpenid: '',
    identityText: '加载中',
    adminTip: '正在读取管理员状态'
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
    const isAdmin = app.isAdmin();
    const canClaimAdmin = app.globalData.canClaimAdmin;
    this.setData({
      isAdmin,
      canClaimAdmin,
      userOpenid: app.globalData.user ? app.globalData.user.openid : '',
      identityText: this.buildIdentityText(isAdmin, canClaimAdmin, roles),
      adminTip: this.buildAdminTip(isAdmin, canClaimAdmin)
    });
  },

  /**
   * 方法是什么：生成首页身份展示文本。
   * 方法作用：根据管理员状态、领取状态和角色列表返回用户可读的身份文案。
   * 为什么添加：WXML 中不适合放复杂判断，提前生成文案可以让首页渲染更稳定。
   */
  buildIdentityText(isAdmin, canClaimAdmin, roles) {
    if (isAdmin) {
      return '管理员';
    }
    if (canClaimAdmin) {
      return '可领取管理员';
    }
    return roles.length ? roles.join('、') : '普通用户';
  },

  /**
   * 方法是什么：生成管理中心入口提示。
   * 方法作用：根据当前权限说明管理中心能否直接进入，以及下一步该做什么。
   * 为什么添加：用户需要明确知道管理中心入口在哪里，以及为什么可能暂时无法进入。
   */
  buildAdminTip(isAdmin, canClaimAdmin) {
    if (isAdmin) {
      return 'Membership、Pathways 和系统角色都在管理中心维护。';
    }
    if (canClaimAdmin) {
      return '当前系统还没有管理员，请先点击上方“领取管理员”，再进入管理中心。';
    }
    return '当前账号还不是管理员，如需维护 Membership、Pathways 或角色，请联系管理员分配权限。';
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
    if (!this.data.isAdmin) {
      wx.showToast({ title: '请先领取管理员或联系管理员分配权限', icon: 'none' });
      return;
    }
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
