const cloud = require('../../utils/cloud');
const signupView = require('../../utils/signup-view');
const meetingService = require('../../services/meeting-service');

Page({
  data: { data: null, loading: true, loadError: '', modal: false, selectedSlot: null, personType: 'member', allowMember: true, allowClub: true, allowGuest: true, memberAccess: false, members: [], memberLabels: [], memberIndex: -1, memberSelectorVisible: false, name: '', club: '', submitting: false },
  async onLoad() {
    this.destroyed = false;
    wx.showShareMenu({
      menus: ['shareAppMessage', 'shareTimeline']
    });
    const app = getApp();
    await app.login();
    const identity = app.globalData.identity || {};
    this.setData({ memberAccess: ['member', 'admin', 'super_admin'].includes(identity.role) });
    this.initialLoadStarted = true;
    this.requestVersion = 0;
    this.load();
    this.loadMembers();
  },
  onUnload() {
    this.destroyed = true;
    this.requestVersion += 1;
  },
  onShow() {
    if (this.hasShown) {
      this.load();
    }
    this.hasShown = true;
  },
  onHide() { this.refreshOnShow = true; },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },

  /**
   * 方法是什么：报名页好友转发配置方法。
   * 方法作用：根据当前会议语言和期数生成好友转发标题及公开落地页。
   * 为什么添加：让参会者可以把当前公开报名入口直接分享给微信好友。
   */
  onShareAppMessage() {
    const info = this.data.data && this.data.data.meetingInfo || {};
    const english = this.data.data && this.data.data.language === 'en';
    return {
      title: english ? `Meeting No. ${info.meetingNo || ''} Role Sign-up` : `第${info.meetingNo || ''}期会议角色报名`,
      path: '/pages/signup/signup',
      imageUrl: '/images/template/role-signup-share.png'
    };
  },

  /**
   * 方法是什么：报名页朋友圈分享配置方法。
   * 方法作用：根据当前会议语言和期数生成朋友圈标题和品牌缩略图。
   * 为什么添加：让公开报名页支持朋友圈分享并保持与好友转发一致的会议信息。
   */
  onShareTimeline() {
    const info = this.data.data && this.data.data.meetingInfo || {};
    const english = this.data.data && this.data.data.language === 'en';
    return {
      title: english ? `Meeting No. ${info.meetingNo || ''} Role Sign-up` : `第${info.meetingNo || ''}期会议角色报名`,
      query: '',
      imageUrl: '/images/template/role-signup-share.png'
    };
  },
  /**
   * 方法是什么：加载报名页会议数据和模板参会费。
   * 方法作用：会议数据必须加载成功，模板读取失败时仅降级参会费展示。
   * 为什么添加：宾客访问报名页时模板接口可能不可用，不能让辅助信息阻断主流程。
   */
  async load() {
    const version = ++this.requestVersion;
    try {
      const data = await meetingService.signup('get');
      if (this.destroyed || version !== this.requestVersion) return;
      let template = {};
      try {
        const templateData = await cloud.callCloud('agendaTemplate', { action: 'get' });
        template = (templateData && templateData.template) || {};
      } catch (templateError) {
        console.warn('模板加载失败，参会费按空值展示', templateError);
      }
      this.attendanceFee = template.attendanceFee || '';
      this.setSignupData(data);
      this.setData({ loadError: '' });
    } catch (error) {
      if (this.destroyed || version !== this.requestVersion) return;
      this.setData({ data: null, loadError: '会议信息加载失败，请下拉重试' });
      cloud.showError(error);
    } finally {
      if (!this.destroyed && version === this.requestVersion) this.setData({ loading: false });
    }
  },
  setSignupData(data) {
    data.signupDisplay = Object.assign({}, data.signupDisplay, { guestFee: this.attendanceFee || '' });
    this.setData({ data });
  },
  async loadMembers() { try { const result = await cloud.callCloud('lookupOptions', { type: 'memberships', keyword: '' }); const members = result.list || []; this.setData({ members, memberLabels: members.map((m) => m.nameZh || m.nameEn || m.nickName || '未命名会员') }); } catch (error) { cloud.showError(error); } },
  openSignup(event) {
    const slotId = event.currentTarget.dataset.slotId || '';
    const slot = slotId && this.data.data.slots.find((item) => item.id === slotId);
    const guestRoleKeys = signupView.GUEST_ROLE_KEYS;
    const allowed = slot ? (guestRoleKeys.includes(slot.roleKey) ? ['member', 'club', 'guest'] : ['member', 'club']) : ['member', 'club', 'guest'];
    this.setData({ modal: true, selectedSlot: slot || null, personType: allowed[0] || 'member', allowMember: allowed.includes('member'), allowClub: allowed.includes('club'), allowGuest: allowed.includes('guest'), name: '', club: '' });
  },
  closeModal() { this.setData({ modal: false }); },
  chooseType(event) { this.setData({ personType: event.currentTarget.dataset.type }); },
  chooseMember(event) { this.setData({ memberIndex: Number(event.detail.value) }); },
  openMemberSelector() { this.setData({ memberSelectorVisible: true }); },
  closeMemberSelector() { this.setData({ memberSelectorVisible: false }); },
  confirmMemberSelector(event) { const memberIndex = this.data.members.findIndex((member) => member._id === event.detail.member._id); this.setData({ memberIndex, memberSelectorVisible: false }); },
  inputName(event) { this.setData({ name: event.detail.value }); },
  inputClub(event) { this.setData({ club: event.detail.value }); },
  noop() {},
  async submitSignup(event) {
    if (this.data.submitting) return;
    const detail = event.detail || {};
    const payload = { action: 'signup', slotId: this.data.selectedSlot && this.data.selectedSlot.id || '', personType: detail.personType, memberId: detail.memberId || '', name: detail.name || '', club: detail.club || '', signupVersion: this.data.data && this.data.data.signupVersion };
    this.setData({ submitting: true });
    try {
      const data = await meetingService.signup('signup', payload);
      this.setSignupData(data);
      this.setData({ modal: false, submitting: false });
    } catch (error) {
      this.setData({ submitting: false });
      cloud.showError(error);
      if (/已被.*报名|SLOT_TAKEN/.test(String(error && error.message || ''))) {
        this.setData({ modal: false });
        await this.load();
      }
    }
  },
  cancelSignup(event) {
    if (this.cancelingSignup) return;
    const signupId = event.currentTarget.dataset.id;
    const slotId = event.currentTarget.dataset.slotId || '';
    wx.showModal({ title: '取消报名', content: '确认取消这项报名吗？', success: async (res) => {
      if (!res.confirm || this.cancelingSignup) return;
      this.cancelingSignup = true;
      try {
        const data = await meetingService.signup('cancel', { signupId, slotId });
        this.setSignupData(data);
        cloud.showSuccess('已取消');
      } catch (error) {
        cloud.showError(error);
      } finally {
        this.cancelingSignup = false;
      }
    } });
  },
  clearSlot(event) {
    if (this.cancelingSignup) return;
    const slotId = event.currentTarget.dataset.slotId;
    wx.showModal({ title: '清空角色', content: '确认清空该角色并释放名额吗？', success: async (res) => {
      if (!res.confirm || this.cancelingSignup) return;
      this.cancelingSignup = true;
      try {
        const data = await meetingService.signup('cancelSlot', { slotId });
        this.setSignupData(data);
        cloud.showSuccess('已清空');
      } catch (error) {
        cloud.showError(error);
      } finally {
        this.cancelingSignup = false;
      }
    } });
  }
});
