const app = getApp();
const cloud = require('../../utils/cloud');

Page({
  data: {
    rawText: '',
    parsing: false,
    agenda: null,
    expiresAt: ''
  },

  /**
   * 方法是什么：加载解析页。
   * 方法作用：尝试恢复当前用户未过期的议程草稿。
   * 为什么添加：小程序重启后仍需继续编辑。
   */
  async onLoad() {
    await this.loadCurrentDraft();
  },

  /**
   * 方法是什么：显示解析页。
   * 方法作用：没有当前草稿时重新查询服务端草稿。
   * 为什么添加：从编辑页返回后保持解析入口简洁。
   */
  async onShow() {
    if (!this.data.agenda) {
      await this.loadCurrentDraft();
    }
  },

  /**
   * 方法是什么：查询当前草稿。
   * 方法作用：读取并保存当前用户的议程 JSON。
   * 为什么添加：解析结果保存在数据库而不是只保存在页面内存。
   */
  async loadCurrentDraft() {
    try {
      const data = await cloud.callCloud('agendaQuery', { action: 'current' });
      if (data.agenda) {
        app.setCurrentAgenda(data.agenda);
        this.setData({ agenda: data.agenda, expiresAt: data.agenda.expiresAt || '' });
      }
    } catch (error) {
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：处理接龙输入。
   * 方法作用：保存用户粘贴的原始文本。
   * 为什么添加：解析云函数需要完整接龙内容。
   */
  handleRawTextInput(event) {
    this.setData({ rawText: event.detail.value });
  },

  /**
   * 方法是什么：解析接龙。
   * 方法作用：调用 DeepSeek 解析并立即保存当前议程草稿。
   * 为什么添加：解析结果必须可恢复且不能使用规则降级。
   */
  async parseAgenda() {
    if (!this.data.rawText.trim()) {
      wx.showToast({ title: '请先粘贴接龙文本', icon: 'none' });
      return;
    }
    this.setData({ parsing: true });
    try {
      const data = await cloud.callCloud('parseAgenda', { rawText: this.data.rawText });
      app.setCurrentAgenda(data.agenda);
      this.setData({ agenda: data.agenda, expiresAt: data.expiresAt || data.agenda.expiresAt || '' });
      cloud.showSuccess('解析完成');
    } catch (error) {
      cloud.showError(error);
    } finally {
      this.setData({ parsing: false });
    }
  },

  /**
   * 方法是什么：进入编辑接龙页。
   * 方法作用：把当前解析结果交给模块化编辑器。
   * 为什么添加：解析完成后用户需要校正流程和人员。
   */
  goEditor() {
    if (!this.data.agenda) {
      return;
    }
    app.setCurrentAgenda(this.data.agenda);
    const id = this.data.agenda._id ? `?id=${this.data.agenda._id}` : '';
    wx.navigateTo({ url: `/pages/editor/editor${id}` });
  }
});
