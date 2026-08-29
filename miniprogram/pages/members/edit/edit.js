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
    privacyNeeded: false,
    privacySheetVisible: true,
    privacyReady: false,
    privacyContractName: '《隐私政策》',
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
    await this.checkPrivacyAuthorization();
    if (id) {
      await this.loadMember(id);
    }
  },

  /**
   * 方法是什么：查询微信侧隐私协议授权状态。
   * 方法作用：在展示个人信息输入框前确认当前用户是否已同意平台登记的隐私保护指引。
   * 为什么添加：手机号、邮箱和生日只能在用户了解收集规则并完成授权后录入。
   */
  async checkPrivacyAuthorization() {
    if (!wx.getPrivacySetting) {
      this.setData({ privacyNeeded: false, privacyReady: true });
      return;
    }
    await new Promise((resolve) => {
      wx.getPrivacySetting({
        success: (result) => {
          this.setData({
            privacyNeeded: Boolean(result.needAuthorization),
            privacyReady: !result.needAuthorization,
            privacyContractName: '《隐私政策》'
          });
        },
        fail: () => this.setData({ privacyNeeded: true, privacyReady: false }),
        complete: resolve
      });
    });
  },

  /**
   * 方法是什么：处理微信隐私协议同意事件。
   * 方法作用：在微信记录用户同意后开放本页的个人信息授权确认步骤。
   * 为什么添加：平台要求开发者在处理个人信息前同步用户已阅读并同意隐私规则。
   */
  handlePrivacyAgree() {
    this.setData({ privacyNeeded: false, privacyReady: true });
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
   * 方法是什么：关闭隐私确认底部弹窗。
   * 方法作用：收起授权提示，不阻挡用户继续使用非个人信息相关的页面功能。
   * 为什么添加：隐私说明需要主动提示，但不能遮挡整个会员编辑页面。
   */
  closePrivacySheet() {
    this.setData({ privacySheetVisible: false });
  },

  /**
   * 方法是什么：阻止底部弹窗内容区域的点击冒泡。
   * 方法作用：点击协议文字、复选框或按钮时不误触发关闭弹窗。
   * 为什么添加：底部弹窗需要支持内部交互，同时允许点击遮罩关闭。
   */
  noop() {},

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
   * 方法作用：打开项目内完整的《隐私政策》页面。
   * 为什么添加：用户需要在授权前了解个人信息的收集目的、用途和权利路径。
   */
  openPrivacyPolicy() {
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
    const hasPersonalInfo = ['phone', 'email', 'birthday'].some((field) => String(this.data.member[field] || '').trim());
    if (hasPersonalInfo && (!this.data.privacyReady || !this.data.personalInfoAuthorized)) {
      wx.showToast({ title: '请先完成个人信息授权确认', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      await cloud.callCloud('adminMemberships', {
        action: 'save',
        member: this.data.member,
        personalInfoAuthorized: !hasPersonalInfo || this.data.privacyReady && this.data.personalInfoAuthorized
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
