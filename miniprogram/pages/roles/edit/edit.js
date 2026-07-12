const cloud = require('../../../utils/cloud');

Page({
  data: {
    code: '',
    isEdit: false,
    saving: false,
    role: {
      code: '',
      name: '',
      description: ''
    }
  },

  /**
   * 方法是什么：角色编辑页加载生命周期方法。
   * 方法作用：根据路由 code 判断新增或编辑，并在编辑模式加载角色详情。
   * 为什么添加：新增角色和编辑角色复用同一页面，code 存在时进入编辑模式。
   */
  async onLoad(options) {
    const code = options && options.code ? options.code : '';
    this.setData({ code, isEdit: Boolean(code) });
    if (code) {
      await this.loadRole(code);
    }
  },

  /**
   * 方法是什么：加载角色详情。
   * 方法作用：调用 `adminRoles` 的 get 操作读取指定角色。
   * 为什么添加：编辑角色时需要加载完整描述，并确保已有 code 不被修改。
   */
  async loadRole(code) {
    try {
      const data = await cloud.callCloud('adminRoles', { action: 'get', code });
      if (data.record) {
        this.setData({ role: Object.assign({}, this.data.role, data.record) });
      }
    } catch (error) {
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：处理角色表单输入。
   * 方法作用：把输入字段写入 role 草稿对象，编辑模式下忽略 code 变更。
   * 为什么添加：已有角色的 code 是业务主键，编辑时不能被用户改掉。
   */
  handleInput(event) {
    const field = event.currentTarget.dataset.field;
    if (this.data.isEdit && field === 'code') {
      return;
    }
    const role = Object.assign({}, this.data.role);
    role[field] = event.detail.value;
    this.setData({ role });
  },

  /**
   * 方法是什么：保存角色表单。
   * 方法作用：调用 `adminRoles` 的 save 操作新增或更新角色。
   * 为什么添加：角色编辑页需要把角色定义写回数据库。
   */
  async saveRole() {
    this.setData({ saving: true });
    try {
      await cloud.callCloud('adminRoles', { action: 'save', role: this.data.role });
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
   * 方法作用：放弃当前编辑并回到角色列表。
   * 为什么添加：用户需要取消新增或编辑角色的入口。
   */
  cancelEdit() {
    wx.navigateBack();
  }
});
