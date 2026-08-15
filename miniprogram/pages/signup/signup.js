const cloud = require('../../utils/cloud');

Page({
  data: { publicId: '', data: null, loading: true, modal: false, selectedSlot: null, personType: 'member', allowMember: true, allowClub: true, allowGuest: true, members: [], memberLabels: [], memberIndex: 0, name: '', club: '', submitting: false },
  onLoad(options) {
    this.initialLoadStarted = true;
    this.setData({ publicId: options.publicId || '' });
    this.load();
    this.loadMembers();
  },
  onShow() {
    if (this.refreshOnShow && this.data.publicId) {
      this.refreshOnShow = false;
      this.load();
    }
  },
  onHide() { this.refreshOnShow = true; },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  onShareAppMessage() { const info = this.data.data && this.data.data.meetingInfo || {}; return { title: `第${info.meetingNo || ''}期会议角色报名`, path: `/pages/signup/signup?publicId=${this.data.publicId}` }; },
  async load() { try { const data = await cloud.callCloud('signupService', { action: 'get', publicId: this.data.publicId }); this.setData({ data }); } catch (error) { cloud.showError(error); } finally { this.setData({ loading: false }); } },
  async loadMembers() { try { const result = await cloud.callCloud('lookupOptions', { type: 'memberships', keyword: '' }); const members = result.list || []; this.setData({ members, memberLabels: members.map((m) => m.nameZh || m.nameEn || m.nickName || '未命名会员') }); } catch (error) { cloud.showError(error); } },
  openSignup(event) {
    const slotId = event.currentTarget.dataset.slotId || '';
    const slot = slotId && this.data.data.slots.find((item) => item.id === slotId);
    const guestRoleKeys = ['guestReception', 'photographer', 'ahCounter'];
    const allowed = slot ? (guestRoleKeys.includes(slot.roleKey) ? ['member', 'club', 'guest'] : ['member', 'club']) : ['member', 'club', 'guest'];
    this.setData({ modal: true, selectedSlot: slot || null, personType: allowed[0] || 'member', allowMember: allowed.includes('member'), allowClub: allowed.includes('club'), allowGuest: allowed.includes('guest'), name: '', club: '' });
  },
  closeModal() { this.setData({ modal: false }); },
  chooseType(event) { this.setData({ personType: event.currentTarget.dataset.type }); },
  chooseMember(event) { this.setData({ memberIndex: Number(event.detail.value) }); },
  inputName(event) { this.setData({ name: event.detail.value }); },
  inputClub(event) { this.setData({ club: event.detail.value }); },
  noop() {},
  async submitSignup() {
    if (this.data.submitting) return;
    const member = this.data.members[this.data.memberIndex];
    const payload = { action: 'signup', publicId: this.data.publicId, slotId: this.data.selectedSlot && this.data.selectedSlot.id || '', personType: this.data.personType, memberId: member && member._id || '', name: this.data.name, club: this.data.club };
    this.setData({ submitting: true });
    try {
      const data = await cloud.callCloud('signupService', payload);
      this.setData({ data, modal: false, submitting: false });
    } catch (error) {
      this.setData({ submitting: false });
      cloud.showError(error);
      if (/已被.*报名|SLOT_TAKEN/.test(String(error && error.message || ''))) {
        this.setData({ modal: false });
        await this.load();
      }
    }
  },
  cancelSignup(event) { const signupId = event.currentTarget.dataset.id; wx.showModal({ title:'取消报名', content:'确认取消这项报名吗？', success: async (res) => { if (!res.confirm) return; try { const data = await cloud.callCloud('signupService', { action:'cancel', publicId:this.data.publicId, signupId }); this.setData({ data }); cloud.showSuccess('已取消'); } catch (error) { cloud.showError(error); } } }); }
});
