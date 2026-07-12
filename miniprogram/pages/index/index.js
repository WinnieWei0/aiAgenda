const app = getApp();
const cloud = require('../../utils/cloud');

Page({
  data: {
    envId: ''
  },

  /**
   * 方法是什么：首页加载生命周期方法。
   * 方法作用：显示当前云环境，并保留一次登录同步用于创建用户记录。
   * 为什么添加：首页不再承担权限判断，但用户表仍可用于后续角色分配和议程归属。
   */
  async onLoad() {
    this.setData({ envId: app.globalData.envId });
    await app.login();
  },

  /**
   * 方法是什么：首页显示生命周期方法。
   * 方法作用：回到首页时同步一次登录状态。
   * 为什么添加：角色分配后用户信息可能变化，轻量同步可以保持全局状态可用。
   */
  async onShow() {
    await app.login();
  },

  /**
   * 方法是什么：打开会员列表页面。
   * 方法作用：跳转到 Membership 数据管理列表。
   * 为什么添加：首页需要直接提供会员管理导航，不再通过旧管理中心二次选择。
   */
  openMembersList() {
    wx.navigateTo({ url: '/pages/members/list/list' });
  },

  /**
   * 方法是什么：打开路径列表页面。
   * 方法作用：跳转到 Pathways 项目管理列表。
   * 为什么添加：首页需要直接提供路径管理导航，方便维护备稿项目描述。
   */
  openPathwaysList() {
    wx.navigateTo({ url: '/pages/pathways/list/list' });
  },

  /**
   * 方法是什么：打开角色列表页面。
   * 方法作用：跳转到角色管理和角色分配页面。
   * 为什么添加：首页需要直接提供角色管理导航，角色分配不再隐藏在旧 Tab 页面里。
   */
  openRolesList() {
    wx.navigateTo({ url: '/pages/roles/list/list' });
  },

  /**
   * 方法是什么：打开历史议程页面。
   * 方法作用：跳转到用户保存过的议程列表。
   * 为什么添加：首页保留历史议程入口，方便继续编辑或重新导出。
   */
  openHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  /**
   * 方法是什么：切换到解析议程表 Tab。
   * 方法作用：通过底部菜单进入接龙解析页面。
   * 为什么添加：首页聚合管理入口，解析工作仍由独立 Tab 承载。
   */
  openParseTab() {
    wx.switchTab({ url: '/pages/parse/parse' });
  },

  /**
   * 方法是什么：初始化 Excel 种子数据。
   * 方法作用：调用 `seedWorkbookData` 写入 Membership 和 Pathways 初始数据。
   * 为什么添加：首次部署时需要一个不受角色限制的基础数据初始化入口。
   */
  async seedWorkbookData() {
    try {
      const data = await cloud.callCloud('seedWorkbookData', {});
      cloud.showSuccess(`会员${data.memberships.total} 项目${data.pathways.total}`);
    } catch (error) {
      cloud.showError(error);
    }
  }
});
