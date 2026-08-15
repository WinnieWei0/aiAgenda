const memberSearch = require('../../utils/member-search');

Component({
  properties: {
    visible: { type: Boolean, value: false },
    members: { type: Array, value: [] },
    selectedId: { type: String, value: '' },
    title: { type: String, value: '选择会员' }
  },
  data: { keyword: '', filteredMembers: [], pendingId: '', pickerValue: [0] },
  observers: {
    'visible,members,selectedId': function sync(visible, members, selectedId) {
      if (!visible) return;
      const filteredMembers = memberSearch.filterMembers(members, '');
      const selectedIndex = Math.max(0, filteredMembers.findIndex((member) => member._id === selectedId));
      const selectedMember = filteredMembers[selectedIndex];
      this.setData({
        keyword: '',
        filteredMembers,
        pendingId: selectedMember ? selectedMember._id : '',
        pickerValue: [selectedIndex]
      });
    }
  },
  methods: {
    handleSearch(event) {
      const keyword = event.detail.value;
      const filteredMembers = memberSearch.filterMembers(this.properties.members, keyword);
      let selectedIndex = filteredMembers.findIndex((member) => member._id === this.data.pendingId);
      if (selectedIndex < 0) selectedIndex = 0;
      const selectedMember = filteredMembers[selectedIndex];
      this.setData({
        keyword,
        filteredMembers,
        pendingId: selectedMember ? selectedMember._id : '',
        pickerValue: [selectedIndex]
      });
    },
    handlePickerChange(event) {
      const selectedIndex = Number(event.detail.value[0]) || 0;
      const selectedMember = this.data.filteredMembers[selectedIndex];
      this.setData({
        pendingId: selectedMember ? selectedMember._id : '',
        pickerValue: [selectedIndex]
      });
    },
    cancel() { this.triggerEvent('cancel'); },
    confirm() {
      const member = (this.properties.members || []).map(memberSearch.unwrapMember).find((item) => item && item._id === this.data.pendingId);
      if (member) this.triggerEvent('confirm', { member });
    },
    noop() {}
  }
});
