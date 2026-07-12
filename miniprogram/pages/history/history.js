const cloud = require('../../utils/cloud');

Page({
  data: {
    loading: false,
    agendas: []
  },

  /**
   * 方法是什么：历史页加载生命周期方法。
   * 方法作用：进入页面时加载当前用户可见的议程列表。
   * 为什么添加：用户需要从历史列表继续编辑或导出已保存议程。
   */
  async onLoad() {
    await this.loadAgendas();
  },

  /**
   * 方法是什么：下拉刷新生命周期方法。
   * 方法作用：重新加载议程列表并停止下拉动画。
   * 为什么添加：用户保存新议程后可以通过刷新查看最新记录。
   */
  async onPullDownRefresh() {
    await this.loadAgendas();
    wx.stopPullDownRefresh();
  },

  /**
   * 方法是什么：加载历史议程列表。
   * 方法作用：从 `agendas` 集合按更新时间倒序读取最近 50 条记录。
   * 为什么添加：历史页面需要展示可继续编辑和导出的议程数据。
   */
  async loadAgendas() {
    this.setData({ loading: true });
    try {
      const data = await cloud.callCloud('agendaQuery', { action: 'list' });
      this.setData({ agendas: data.list || [] });
    } catch (error) {
      cloud.showError(error);
    } finally {
      this.setData({ loading: false });
    }
  },

  /**
   * 方法是什么：打开指定议程进行编辑。
   * 方法作用：携带议程 ID 跳转到编辑页。
   * 为什么添加：历史列表只展示摘要，完整编辑能力由编辑页提供。
   */
  editAgenda(event) {
    const id = event.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/editor/editor?id=${id}` });
  }
});
