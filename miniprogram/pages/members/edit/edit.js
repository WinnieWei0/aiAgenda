const cloud = require('../../../utils/cloud');

Page({
  data: {
    id: '',
    isEdit: false,
    saving: false,
    member: {
      nameZh: '',
      nameEn: '',
      nickName: '',
      agendaNameZh: '',
      titleOnAgenda: '',
      phone: '',
      email: ''
    }
  },

  /**
   * 方法是什么：会员编辑页加载生命周期方法。
   * 方法作用：根据路由 id 判断新增或编辑，并在编辑模式加载会员详情。
   * 为什么添加：新增会员和编辑会员复用同一页面，可以减少重复表单代码。
   */
  async onLoad(options) {
    const id = options && options.id ? options.id : '';
    this.setData({ id, isEdit: Boolean(id) });
    if (id) {
      await this.loadMember(id);
    }
  },

  /**
   * 方法是什么：加载会员详情。
   * 方法作用：调用 `adminMemberships` 的 get 操作读取指定会员。
   * 为什么添加：编辑页需要完整会员数据，不能只依赖列表卡片中的摘要字段。
   */
  async loadMember(id) {
    try {
      const data = await cloud.callCloud('adminMemberships', { action: 'get', id });
      if (data.record) {
        this.setData({ member: Object.assign({}, this.data.member, data.record) });
      }
    } catch (error) {
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：处理会员表单输入。
   * 方法作用：把输入框字段写入 member 草稿对象。
   * 为什么添加：保存前需要持续维护用户正在编辑的会员数据。
   */
  handleInput(event) {
    const field = event.currentTarget.dataset.field;
    const member = Object.assign({}, this.data.member);
    member[field] = event.detail.value;
    this.setData({ member });
  },

  /**
   * 方法是什么：保存会员表单。
   * 方法作用：调用 `adminMemberships` 的 save 操作新增或更新会员记录。
   * 为什么添加：会员编辑页需要把用户修改后的表单写回数据库。
   */
  async saveMember() {
    this.setData({ saving: true });
    try {
      await cloud.callCloud('adminMemberships', { action: 'save', member: this.data.member });
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
   * 方法作用：放弃当前编辑并回到会员列表。
   * 为什么添加：用户需要显式取消新增或编辑操作。
   */
  cancelEdit() {
    wx.navigateBack();
  }
});
