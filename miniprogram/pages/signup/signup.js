const cloud = require('../../utils/cloud');
const signupView = require('../../utils/signup-view');

Page({
  data: { data: null, loading: true, loadError: '', modal: false, selectedSlot: null, personType: 'member', allowMember: true, allowClub: true, allowGuest: true, members: [], memberLabels: [], memberIndex: -1, memberSelectorVisible: false, name: '', club: '', submitting: false },
  onLoad() {
    wx.showShareMenu({
      menus: ['shareAppMessage', 'shareTimeline']
    });
    this.initialLoadStarted = true;
    this.load();
    this.loadMembers();
  },
  onShow() {
    if (this.refreshOnShow) {
      this.refreshOnShow = false;
      this.load();
    }
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
      imageUrl: '/images/template/toastmasters-logo.png'
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
      imageUrl: '/images/template/toastmasters-logo.png'
    };
  },
  async load() { try { const data = await cloud.callCloud('signupService', { action: 'get' }); this.setData({ data: signupView.decorateSignupData(data), loadError: '' }); } catch (error) { this.setData({ data: null, loadError: '当前会议尚未开放报名' }); } finally { this.setData({ loading: false }); } },
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
  async submitSignup() {
    if (this.data.submitting) return;
    const member = this.data.members[this.data.memberIndex];
    if (this.data.personType === 'member' && !member) {
      wx.showToast({ title: '请选择会员', icon: 'none' });
      return;
    }
    const payload = { action: 'signup', slotId: this.data.selectedSlot && this.data.selectedSlot.id || '', personType: this.data.personType, memberId: member && member._id || '', name: this.data.name, club: this.data.club };
    this.setData({ submitting: true });
    try {
      const data = await cloud.callCloud('signupService', payload);
      this.setData({ data: signupView.decorateSignupData(data), modal: false, submitting: false });
    } catch (error) {
      this.setData({ submitting: false });
      cloud.showError(error);
      if (/已被.*报名|SLOT_TAKEN/.test(String(error && error.message || ''))) {
        this.setData({ modal: false });
        await this.load();
      }
    }
  },
  cancelSignup(event) { const signupId = event.currentTarget.dataset.id; wx.showModal({ title:'取消报名', content:'确认取消这项报名吗？', success: async (res) => { if (!res.confirm) return; try { const data = await cloud.callCloud('signupService', { action:'cancel', signupId }); this.setData({ data: signupView.decorateSignupData(data) }); cloud.showSuccess('已取消'); } catch (error) { cloud.showError(error); } } }); }
});
