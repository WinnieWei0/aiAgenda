const cloud = require('../../../utils/cloud');

Page({
  data: {
    id: '',
    isEdit: false,
    saving: false,
    pathway: {
      code: '',
      createdAt: '',
      fullLabelEn: '',
      fullLabelZh: '',
      level: '',
      objectiveEn: '',
      objectiveZh: '',
      searchText: '',
      updatedAt: ''
    }
  },

  /**
   * 方法是什么：加载路径编辑页。
   * 方法作用：根据 ID 判断新增或编辑模式。
   * 为什么添加：同一表单需要支持路径数据 CRUD。
   */
  async onLoad(options) {
    const id = options && options.id ? options.id : '';
    this.setData({ id, isEdit: Boolean(id) });
    if (id) {
      await this.loadPathway(id);
    }
  },

  /**
   * 方法是什么：加载路径详情。
   * 方法作用：读取数据库中的完整路径字段。
   * 为什么添加：编辑页必须展示用户要求的全部字段。
   */
  async loadPathway(id) {
    try {
      const data = await cloud.callCloud('adminPathways', { action: 'get', id });
      if (data.record) {
        this.setData({ pathway: Object.assign({}, this.data.pathway, data.record) });
      }
    } catch (error) {
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：处理路径输入。
   * 方法作用：更新路径字段草稿。
   * 为什么添加：表单需要持续保存用户正在编辑的值。
   */
  handleInput(event) {
    const field = event.currentTarget.dataset.field;
    const pathway = Object.assign({}, this.data.pathway, { [field]: event.detail.value });
    this.setData({ pathway });
  },

  /**
   * 方法是什么：保存路径。
   * 方法作用：调用白名单保存接口并返回列表页。
   * 为什么添加：编辑结果必须写回 Pathways 集合。
   */
  async savePathway() {
    this.setData({ saving: true });
    try {
      await cloud.callCloud('adminPathways', { action: 'save', pathway: this.data.pathway });
      cloud.showSuccess('已保存');
      wx.navigateBack();
    } catch (error) {
      cloud.showError(error);
    } finally {
      this.setData({ saving: false });
    }
  },

  /**
   * 方法是什么：取消路径编辑。
   * 方法作用：放弃当前草稿并返回路径列表。
   * 为什么添加：新增和编辑都需要明确的取消入口。
   */
  cancelEdit() {
    wx.navigateBack();
  }
});
