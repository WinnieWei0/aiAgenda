const memberSearch = require('../../utils/member-search');

Component({
  properties: {
    visible: { type: Boolean, value: false },
    members: { type: Array, value: [] },
    selectedId: { type: String, value: '' },
    title: { type: String, value: '选择会员' }
  },
  data: { keyword: '', filteredMembers: [], pendingId: '' },
  observers: {
    'visible,members,selectedId': function sync(visible, members, selectedId) {
      if (!visible) return;
      this.setData({ keyword: '', pendingId: selectedId || '', filteredMembers: memberSearch.filterMembers(members, '') });
    }
  },
  methods: {
    handleSearch(event) {
      const keyword = event.detail.value;
      this.setData({ keyword, filteredMembers: memberSearch.filterMembers(this.properties.members, keyword) });
    },
    selectMember(event) { this.setData({ pendingId: event.currentTarget.dataset.id }); },
    cancel() { this.triggerEvent('cancel'); },
    confirm() {
      const member = (this.properties.members || []).map(memberSearch.unwrapMember).find((item) => item && item._id === this.data.pendingId);
      if (member) this.triggerEvent('confirm', { member });
    },
    noop() {}
  }
});
