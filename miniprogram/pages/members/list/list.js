const cloud = require('../../../utils/cloud');

Page({
  data: {
    loading: false,
    keyword: '',
    records: [],
    filteredRecords: [],
    total: 0
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
    const keyword = this.data.keyword.trim().toLowerCase();
    if (!keyword) {
      this.setData({ filteredRecords: this.data.records });
      return;
    }
    const filteredRecords = this.data.records.filter((record) => this.buildSearchText(record).includes(keyword));
    this.setData({ filteredRecords });
  },

  /**
   * 方法是什么：构建会员搜索文本。
   * 方法作用：把会员的中文名、英文名、昵称、议程显示名和搜索字段合并成小写文本。
   * 为什么添加：搜索需要覆盖多个常用称呼，集中构建可以保持匹配规则一致。
   */
  buildSearchText(record) {
    return [
      record.nameZh,
      record.nameEn,
      record.nickName,
      record.agendaNameZh,
      record.titleOnAgenda,
      record.searchText
    ].filter(Boolean).join(' ').toLowerCase();
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

  /**
   * 方法是什么：刷新会员列表。
   * 方法作用：手动重新调用列表接口并更新页面。
   * 为什么添加：用户需要在云端数据变化后主动刷新当前列表。
   */
  async refreshRecords() {
    await this.loadRecords();
  }
});
