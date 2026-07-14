const cloud = require('../../../utils/cloud');

Page({
  data: {
    id: '',
    isEdit: false,
    saving: false,
    member: {
      birthday: '', competitionEligible: false, createdAt: '', educationAwards: '',
      educationProgress: '', educationProgressUpdatedAt: '', email: '', isMentor: false,
      joinedAt: '', menteeCount: 0, mentorName: '', nameEn: '', nameZh: '', nickName: '',
      notes: '', officerTitleEn: '', officerTitleZh: '', pathNameEn: '', pathNameZh: '',
      phone: '', quarter: '', searchText: '', status: '', updatedAt: ''
    }
  },

  /**
   * 方法是什么：加载会员编辑页。
   * 方法作用：根据 ID 判断新增或编辑模式。
   * 为什么添加：同一表单需要支持完整会员 CRUD。
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
   * 方法作用：读取数据库中的完整会员字段。
   * 为什么添加：编辑页必须展示用户要求的全部字段。
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
   * 方法是什么：处理会员文本输入。
   * 方法作用：更新会员字段草稿并处理数字字段。
   * 为什么添加：表单需要持续保存用户正在编辑的值。
   */
  handleInput(event) {
    const field = event.currentTarget.dataset.field;
    const member = Object.assign({}, this.data.member);
    const value = event.detail.value;
    member[field] = field === 'menteeCount' ? Math.max(Number(value) || 0, 0) : value;
    this.setData({ member });
  },

  /**
   * 方法是什么：处理会员开关输入。
   * 方法作用：更新参赛资格和导师状态。
   * 为什么添加：布尔字段需要使用明确的开关控件。
   */
  handleSwitch(event) {
    const field = event.currentTarget.dataset.field;
    const member = Object.assign({}, this.data.member, { [field]: Boolean(event.detail.value) });
    this.setData({ member });
  },

  /**
   * 方法是什么：保存会员。
   * 方法作用：调用白名单保存接口并返回列表页。
   * 为什么添加：编辑结果必须写回 Membership 集合。
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
   * 方法是什么：取消会员编辑。
   * 方法作用：放弃当前草稿并返回会员列表。
   * 为什么添加：新增和编辑都需要明确的取消入口。
   */
  cancelEdit() {
    wx.navigateBack();
  }
});
