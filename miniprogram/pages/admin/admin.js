const cloud = require('../../utils/cloud');

Page({
  data: {},

  /**
   * 方法是什么：打开会员列表页面。
   * 方法作用：把旧管理中心入口兼容跳转到新的会员列表。
   * 为什么添加：用户或旧链接进入 `/pages/admin/admin` 时仍能找到会员管理。
   */
  openMembersList() {
    wx.navigateTo({ url: '/pages/members/list/list' });
  },

  /**
   * 方法是什么：打开路径列表页面。
   * 方法作用：把旧管理中心入口兼容跳转到新的 Pathways 列表。
   * 为什么添加：保留旧页面作为导航页可以减少迁移成本。
   */
  openPathwaysList() {
    wx.navigateTo({ url: '/pages/pathways/list/list' });
  },

  /**
   * 方法是什么：打开角色列表页面。
   * 方法作用：把旧管理中心入口兼容跳转到新的角色管理页面。
   * 为什么添加：角色管理已经拆成独立列表页，旧入口需要继续可用。
   */
  openRolesList() {
    wx.navigateTo({ url: '/pages/roles/list/list' });
  },

  /**
   * 方法是什么：初始化 Excel 种子数据。
   * 方法作用：调用 `seedWorkbookData` 写入 Membership 和 Pathways 初始数据。
   * 为什么添加：旧管理中心仍作为兼容导航页，需要保留基础数据初始化入口。
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
