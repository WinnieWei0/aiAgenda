const memberSearch = require('../../utils/member-search');

Component({
  properties: {
    visible: { type: Boolean, value: false },
    roleSlot: { type: Object, value: null },
    members: { type: Array, value: [] },
    language: { type: String, value: 'zh' },
    submitting: { type: Boolean, value: false }
  },
  data: {
    personType: 'member',
    allowMember: true,
    allowClub: true,
    allowGuest: true,
    memberSelectorVisible: false,
    memberId: '',
    memberLabel: '',
    name: '',
    club: ''
  },
  observers: {
    'visible,roleSlot,members': function sync(visible, slot, members) {
      if (!visible) return;
      const allowed = slot ? (slot.allowedPersonTypes || ['member', 'club']) : ['member', 'club', 'guest'];
      const person = slot && slot.person || {};
      const member = (members || []).map(memberSearch.unwrapMember).find((item) => item && item._id === person.memberId);
      this.setData({
        personType: allowed[0] || 'member',
        allowMember: allowed.includes('member'),
        allowClub: allowed.includes('club'),
        allowGuest: allowed.includes('guest'),
        memberId: member && member._id || '',
        memberLabel: member && (member.nameZh || member.nameEn || member.nickName) || '',
        name: person.rawName || person.displayNameZh || person.displayNameEn || '',
        club: person.clubZh || person.clubEn || ''
      });
    }
  },
  methods: {
    close() { if (!this.properties.submitting) this.triggerEvent('cancel'); },
    noop() {},
    chooseType(event) { this.setData({ personType: event.currentTarget.dataset.type }); },
    openMemberSelector() { this.setData({ memberSelectorVisible: true }); },
    closeMemberSelector() { this.setData({ memberSelectorVisible: false }); },
    confirmMemberSelector(event) {
      const member = event.detail && event.detail.member;
      if (!member) return;
      this.setData({ memberSelectorVisible: false, memberId: member._id, memberLabel: member.nameZh || member.nameEn || member.nickName || '' });
    },
    inputName(event) { this.setData({ name: event.detail.value }); },
    inputClub(event) { this.setData({ club: event.detail.value }); },
    confirm() {
      if (this.data.personType === 'member' && !this.data.memberId) {
        wx.showToast({ title: this.properties.language === 'en' ? 'Select a member' : '请选择会员', icon: 'none' });
        return;
      }
      if (this.data.personType !== 'member' && !String(this.data.name || '').trim()) {
        wx.showToast({ title: this.properties.language === 'en' ? 'Enter a name' : '请输入姓名', icon: 'none' });
        return;
      }
      this.triggerEvent('confirm', { personType: this.data.personType, memberId: this.data.memberId, name: this.data.name, club: this.data.club });
    }
  }
});
