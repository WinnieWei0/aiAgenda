const cloud = require('../../../utils/cloud');

Page({
  data: {
    id: '',
    isEdit: false,
    saving: false,
    pathway: {
      code: '',
      projectNameZh: '',
      projectNameEn: '',
      objectiveZh: '',
      objectiveEn: ''
    }
  },

  /**
   * 方法是什么：路径编辑页加载生命周期方法。
   * 方法作用：根据路由 id 判断新增或编辑，并在编辑模式加载路径详情。
   * 为什么添加：新增路径和编辑路径复用同一表单页面。
   */
  async onLoad(options) {
    const id = options && options.id ? options.id : '';
    this.setData({ id, isEdit: Boolean(id) });
    if (id) {
      await this.loadPathway(id);
    }
  },

  /**
   * 方法是什么：加载 Pathways 项目详情。
   * 方法作用：调用 `adminPathways` 的 get 操作读取指定项目。
   * 为什么添加：编辑页需要完整项目数据，列表页只负责导航。
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
   * 方法是什么：处理路径表单输入。
   * 方法作用：把输入框或文本域字段写入 pathway 草稿对象。
   * 为什么添加：保存前需要持续维护用户正在编辑的 Pathways 数据。
   */
  handleInput(event) {
    const field = event.currentTarget.dataset.field;
    const pathway = Object.assign({}, this.data.pathway);
    pathway[field] = event.detail.value;
    this.setData({ pathway });
  },

  /**
   * 方法是什么：保存路径表单。
   * 方法作用：调用 `adminPathways` 的 save 操作新增或更新项目。
   * 为什么添加：路径编辑页需要把项目代码、名称和目标描述写回数据库。
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
   * 方法是什么：返回上一页。
   * 方法作用：放弃当前编辑并回到路径列表。
   * 为什么添加：用户需要取消新增或编辑路径的入口。
   */
  cancelEdit() {
    wx.navigateBack();
  }
});
