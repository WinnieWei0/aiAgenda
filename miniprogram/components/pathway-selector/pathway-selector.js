const pathwaySearch = require('../../utils/pathway-search');

Component({
  properties: {
    visible: { type: Boolean, value: false },
    pathways: { type: Array, value: [] },
    selectedCode: { type: String, value: '' },
    title: { type: String, value: '选择 Pathways 项目' }
  },
  data: { keyword: '', filteredPathways: [], pendingKey: '', pickerValue: [0] },
  observers: {
    'visible,pathways,selectedCode': function sync(visible, pathways, selectedCode) {
      if (!visible) return;
      const filteredPathways = pathwaySearch.filterPathways(pathways, '');
      let selectedIndex = filteredPathways.findIndex((pathway) => pathway.code === selectedCode || pathwaySearch.pathwayKey(pathway) === selectedCode);
      if (selectedIndex < 0) selectedIndex = 0;
      const selectedPathway = filteredPathways[selectedIndex];
      this.setData({
        keyword: '',
        filteredPathways,
        pendingKey: pathwaySearch.pathwayKey(selectedPathway),
        pickerValue: [selectedIndex]
      });
    }
  },
  methods: {
    handleSearch(event) {
      const keyword = event.detail.value;
      const filteredPathways = pathwaySearch.filterPathways(this.properties.pathways, keyword);
      let selectedIndex = filteredPathways.findIndex((pathway) => pathwaySearch.pathwayKey(pathway) === this.data.pendingKey);
      if (selectedIndex < 0) selectedIndex = 0;
      const selectedPathway = filteredPathways[selectedIndex];
      this.setData({
        keyword,
        filteredPathways,
        pendingKey: pathwaySearch.pathwayKey(selectedPathway),
        pickerValue: [selectedIndex]
      });
    },
    handlePickerChange(event) {
      const selectedIndex = Number(event.detail.value[0]) || 0;
      const selectedPathway = this.data.filteredPathways[selectedIndex];
      this.setData({
        pendingKey: pathwaySearch.pathwayKey(selectedPathway),
        pickerValue: [selectedIndex]
      });
    },
    cancel() { this.triggerEvent('cancel'); },
    confirm() {
      const pathway = this.data.filteredPathways.find((item) => pathwaySearch.pathwayKey(item) === this.data.pendingKey);
      if (pathway) this.triggerEvent('confirm', { pathway });
    },
    noop() {}
  }
});
