const cloud = require('../../../utils/cloud');

/**
 * 方法是什么：格式化会员更新时间。
 * 方法作用：把数据库 ISO 时间转换为本地年月日时分秒。
 * 为什么添加：编辑页需要显示易读的更新时间。
 */
function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

Page({
  data: {
    id: '',
    isEdit: false,
    saving: false,
    formattedUpdatedAt: '',
    termsAccepted: false,
    personalInfoAuthorized: false,
    member: {
      birthday: '', competitionEligible: false, createdAt: '', educationAwards: '',
      educationProgress: '', educationProgressUpdatedAt: '', email: '', isMentor: false,
      joinedAt: '', menteeCount: 0, mentorName: '', nameEn: '', nameZh: '', nickName: '',
      notes: '', officerTitleEn: '', officerTitleZh: '', pathNameEn: '', pathNameZh: '',
      phone: '', quarter: '', searchText: '', status: 'active', updatedAt: '', role: 'member', openid: ''
    },
    roleOptions: [
      { code: 'super_admin', label: '超管' },
      { code: 'admin', label: '管理员' },
      { code: 'member', label: '会员' }
    ],
    roleLabels: ['超管', '管理员', '会员'],
    roleIndex: 2,
    statusOptions: [
      { code: 'active', label: '在会' },
      { code: 'history', label: '历史会员' }
    ],
    statusLabels: ['在会', '历史会员'],
    statusIndex: 0
  },

  /**
   * 方法是什么：加载会员编辑页。
   * 方法作用：根据 ID 判断新增或编辑模式。
   * 为什么添加：同一表单需要支持完整会员 CRUD。
   */
  async onLoad(options) {
    const id = options && options.id ? options.id : '';
    wx.setNavigationBarTitle({ title: id ? '编辑会员' : '新增会员' });
    this.setData({ id, isEdit: Boolean(id) });
    if (id) {
      await this.loadMember(id);
    }
  },

  /**
   * 方法是什么：切换会员本人授权确认状态。
   * 方法作用：记录管理员是否确认已取得该会员对个人信息处理的明确授权。
   * 为什么添加：管理员不能仅凭自身同意代替手机号等个人信息主体的授权。
   */
  handlePersonalInfoAuthorization(event) {
    this.setData({ personalInfoAuthorized: (event.detail.value || []).includes('authorized') });
  },

  /**
   * 方法是什么：切换当前用户的协议同意状态。
   * 方法作用：记录当前操作用户是否明确同意《用户服务协议》和《隐私政策》。
   * 为什么添加：平台审核要求在收集手机号等信息前取得当前用户的主动授权同意。
   */
  handleTermsAgreement(event) {
    this.setData({ termsAccepted: (event.detail.value || []).includes('accepted') });
  },

  /**
   * 方法是什么：打开用户服务协议页面。
   * 方法作用：让信息录入人员在授权前查看本小程序的服务规则。
   * 为什么添加：审核要求在收集个人信息前提供清晰可访问的用户服务协议。
   */
  openServiceAgreement() {
    wx.navigateTo({ url: '/pages/legal/legal?type=service' });
  },

  /**
   * 方法是什么：打开隐私政策页面。
   * 方法作用：优先调用微信官方入口打开公众平台配置的隐私保护指引。
   * 为什么添加：隐私政策必须以微信公众平台当前 AppID 配置的正式内容为准。
   */
  openPrivacyPolicy() {
    if (typeof wx.openPrivacyContract === 'function') {
      wx.openPrivacyContract({
        fail: () => wx.navigateTo({ url: '/pages/legal/legal?type=privacy' })
      });
      return;
    }
    wx.navigateTo({ url: '/pages/legal/legal?type=privacy' });
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
        const member = Object.assign({}, this.data.member, data.record);
        member.status = member.status === 'history' ? 'history' : 'active';
        const roleIndex = Math.max(this.data.roleOptions.findIndex((item) => item.code === member.role), 0);
        const statusIndex = member.status === 'history' ? 1 : 0;
        this.setData({ member, roleIndex, statusIndex, formattedUpdatedAt: formatDateTime(member.updatedAt) });
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

  handleRoleChange(event) {
    const roleIndex = Number(event.detail.value);
    const member = Object.assign({}, this.data.member, { role: this.data.roleOptions[roleIndex].code });
    this.setData({ member, roleIndex });
  },

  /**
   * 方法是什么：切换会员状态。
   * 方法作用：把状态 picker 的下标转换为 active 或 history。
   * 为什么添加：会员状态只允许在会和历史会员两个稳定值。
   */
  handleStatusChange(event) {
    const statusIndex = Number(event.detail.value);
    const member = Object.assign({}, this.data.member, { status: this.data.statusOptions[statusIndex].code });
    this.setData({ member, statusIndex });
  },

  async clearBinding() {
    const result = await new Promise((resolve) => wx.showModal({ title: '清除身份绑定', content: '清除后，该会员需要通过新邀请重新绑定。', success: resolve, fail: () => resolve({ confirm: false }) }));
    if (!result.confirm) return;
    try {
      await cloud.callCloud('adminMemberships', { action: 'clearBinding', id: this.data.member._id });
      this.setData({ 'member.openid': '' });
      cloud.showSuccess('绑定已清除');
    } catch (error) { cloud.showError(error); }
  },

  /**
   * 方法是什么：保存会员。
   * 方法作用：调用白名单保存接口并返回列表页。
   * 为什么添加：编辑结果必须写回 Membership 集合。
   */
  async saveMember() {
    if (!String(this.data.member.nameZh || '').trim() || !String(this.data.member.nameEn || '').trim()) {
      wx.showToast({ title: '请填写中文名和英文名', icon: 'none' });
      return;
    }
    const hasPersonalInfo = ['phone', 'email', 'birthday'].some((field) => String(this.data.member[field] || '').trim());
    if (!this.data.termsAccepted || !this.data.personalInfoAuthorized) {
      wx.showToast({ title: '请先勾选两项授权确认', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      await cloud.callCloud('adminMemberships', {
        action: 'save',
        member: this.data.member,
        agreementAccepted: this.data.termsAccepted,
        personalInfoAuthorized: this.data.personalInfoAuthorized
      });
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
