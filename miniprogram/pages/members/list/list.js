const cloud = require('../../../utils/cloud');
const memberFilter = require('../../../utils/member-filter');

function defaultFilters() {
  return {
    joinedAtStart: '', joinedAtEnd: '', birthdayMonth: '',
    pathNameZh: '', educationProgress: '', competitionEligible: 'all', isMentor: 'all',
    mentorName: '', officerTitleZh: '', role: '', status: 'active'
  };
}

Page({
  data: {
    loading: false,
    keyword: '',
    records: [],
    filteredRecords: [],
    total: 0,
    filterVisible: false,
    filters: defaultFilters(),
    draftFilters: defaultFilters(),
    triLabels: ['全部', '是', '否'], triValues: ['all', 'true', 'false'],
    roleLabels: ['全部', '超管', '管理员', '会员'], roleValues: ['', 'super_admin', 'admin', 'member'],
    statusLabels: ['全部', '在会', '历史会员'], statusValues: ['', 'active', 'history'],
    monthLabels: ['全部月份', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
    monthValues: ['', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'],
    birthdayMonthIndex: 0, competitionIndex: 0, mentorIndex: 0, roleIndex: 0, statusIndex: 1,
    dateRangeVisible: false, dateRangeTarget: '', dateRangeTitle: '', dateRangeStart: '', dateRangeEnd: ''
  },

  /**
   * 方法是什么：会员列表页加载生命周期方法。
   * 方法作用：进入页面时加载 Membership 数据。
   * 为什么添加：用户点击首页会员列表后，需要立即看到当前系统中的会员记录。
   */
  async onLoad() {
    await this.loadRecords();
  },

  /**
   * 方法是什么：会员列表页显示生命周期方法。
   * 方法作用：每次从新增或编辑页返回时重新加载会员数据。
   * 为什么添加：保存或删除后的列表需要刷新，避免显示旧数据。
   */
  async onShow() {
    await this.loadRecords();
  },

  /**
   * 方法是什么：加载会员记录列表。
   * 方法作用：调用 `adminMemberships` 的 list 操作读取会员数据并应用本地搜索。
   * 为什么添加：会员列表页需要独立的数据加载入口，支持刷新和返回后更新。
   */
  async loadRecords() {
    this.setData({ loading: true });
    try {
      const data = await cloud.callCloud('adminMemberships', { action: 'list', pageSize: 100 });
      this.setData({ records: data.list || [], total: data.total || 0 });
      this.applySearch();
    } catch (error) {
      cloud.showError(error);
    } finally {
      this.setData({ loading: false });
    }
  },

  /**
   * 方法是什么：处理会员搜索关键词输入。
   * 方法作用：保存输入框关键词并重新筛选当前列表。
   * 为什么添加：会员数量较多时，需要按姓名、昵称或议程显示名快速定位。
   */
  handleKeywordInput(event) {
    this.setData({ keyword: event.detail.value });
    this.applySearch();
  },

  /**
   * 方法是什么：应用会员本地搜索过滤。
   * 方法作用：根据关键词从已加载记录中筛选匹配项。
   * 为什么添加：当前管理列表一次加载 100 条，本地筛选能减少云函数调用并提升响应速度。
   */
  applySearch() {
    this.setData({ filteredRecords: memberFilter.filterMembers(this.data.records, this.data.keyword, this.data.filters) });
  },

  openFilter() {
    const draftFilters = Object.assign({}, this.data.filters);
    this.setData({ filterVisible: true, draftFilters,
      competitionIndex: Math.max(this.data.triValues.indexOf(draftFilters.competitionEligible), 0),
      mentorIndex: Math.max(this.data.triValues.indexOf(draftFilters.isMentor), 0),
      birthdayMonthIndex: Math.max(this.data.monthValues.indexOf(draftFilters.birthdayMonth), 0),
      roleIndex: Math.max(this.data.roleValues.indexOf(draftFilters.role), 0),
      statusIndex: Math.max(this.data.statusValues.indexOf(draftFilters.status), 0) });
  },
  closeFilter() { this.setData({ filterVisible: false }); },
  handleFilterInput(event) { this.setData({ [`draftFilters.${event.currentTarget.dataset.field}`]: event.detail.value }); },
  handleTriFilter(event) {
    const field = event.currentTarget.dataset.field;
    const index = Number(event.detail.value);
    this.setData({ [`draftFilters.${field}`]: this.data.triValues[index], [field === 'isMentor' ? 'mentorIndex' : 'competitionIndex']: index });
  },
  handleRoleFilter(event) { const roleIndex = Number(event.detail.value); this.setData({ roleIndex, 'draftFilters.role': this.data.roleValues[roleIndex] }); },
  handleStatusFilter(event) { const statusIndex = Number(event.detail.value); this.setData({ statusIndex, 'draftFilters.status': this.data.statusValues[statusIndex] }); },
  handleBirthdayMonth(event) { const birthdayMonthIndex = Number(event.detail.value); this.setData({ birthdayMonthIndex, 'draftFilters.birthdayMonth': this.data.monthValues[birthdayMonthIndex] }); },
  resetFilter() {
    const draftFilters = defaultFilters();
    this.setData({ draftFilters, birthdayMonthIndex: 0, competitionIndex: 0, mentorIndex: 0, roleIndex: 0, statusIndex: 1 });
  },
  applyFilter() { this.setData({ filters: Object.assign({}, this.data.draftFilters), filterVisible: false }, () => this.applySearch()); },
  openDateRange(event) {
    const target = event.currentTarget.dataset.target;
    const prefix = 'joinedAt';
    this.setData({ dateRangeVisible: true, dateRangeTarget: prefix, dateRangeTitle: '选择加入头马时间区间', dateRangeStart: this.data.draftFilters[`${prefix}Start`], dateRangeEnd: this.data.draftFilters[`${prefix}End`] });
  },
  closeDateRange() { this.setData({ dateRangeVisible: false }); },
  confirmDateRange(event) {
    const prefix = this.data.dateRangeTarget;
    this.setData({ dateRangeVisible: false, [`draftFilters.${prefix}Start`]: event.detail.start, [`draftFilters.${prefix}End`]: event.detail.end });
  },

  /**
   * 方法是什么：打开新增会员页面。
   * 方法作用：跳转到无 id 参数的会员编辑页。
   * 为什么添加：新增和编辑复用同一页，无 id 即表示创建新会员。
   */
  openCreate() {
    wx.navigateTo({ url: '/pages/members/edit/edit' });
  },

  /**
   * 方法是什么：打开编辑会员页面。
   * 方法作用：携带会员 id 跳转到会员编辑页。
   * 为什么添加：列表只展示摘要，编辑详情需要由独立页面按 id 加载。
   */
  editRecord(event) {
    const id = event.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/members/edit/edit?id=${id}` });
  },

  /**
   * 方法是什么：确认删除会员记录。
   * 方法作用：弹出确认框并在用户确认后执行删除。
   * 为什么添加：删除会员是不可逆操作，需要避免误触。
   */
  async confirmDelete(event) {
    const id = event.currentTarget.dataset.id;
    const name = event.currentTarget.dataset.name || '该会员';
    const result = await this.showDeleteConfirm(name);
    if (!result.confirm) {
      return;
    }
    await this.deleteRecord(id);
  },

  /**
   * 方法是什么：显示删除确认弹窗。
   * 方法作用：把微信弹窗封装成 Promise，返回用户确认结果。
   * 为什么添加：删除流程需要等待用户选择，Promise 写法能让调用逻辑更清晰。
   */
  showDeleteConfirm(name) {
    return new Promise((resolve) => {
      wx.showModal({
        title: '确认删除',
        content: `确定删除 ${name} 吗？`,
        success(res) {
          resolve(res);
        },
        fail() {
          resolve({ confirm: false });
        }
      });
    });
  },

  /**
   * 方法是什么：删除会员记录。
   * 方法作用：调用 `adminMemberships` 的 delete 操作删除指定 id。
   * 为什么添加：会员列表页需要提供完整 CRUD 中的删除能力。
   */
  async deleteRecord(id) {
    try {
      await cloud.callCloud('adminMemberships', { action: 'delete', id });
      cloud.showSuccess('已删除');
      await this.loadRecords();
    } catch (error) {
      cloud.showError(error);
    }
  },

  async confirmRetire(event) {
    const id = event.currentTarget.dataset.id;
    const name = event.currentTarget.dataset.name || '该会员';
    const result = await this.showRetireConfirm(name);
    if (!result.confirm) return;
    try {
      await cloud.callCloud('adminMemberships', { action: 'retire', id });
      cloud.showSuccess('已转为历史会员');
      await this.loadRecords();
    } catch (error) { cloud.showError(error); }
  },
  showRetireConfirm(name) {
    return new Promise((resolve) => wx.showModal({ title: '确认退会', content: `确认将 ${name} 转为历史会员吗？`, success: resolve, fail: () => resolve({ confirm: false }) }));
  },
  noop() {
  }
});
