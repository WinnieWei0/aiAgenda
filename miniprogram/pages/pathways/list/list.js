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
   * 方法是什么：路径列表页加载生命周期方法。
   * 方法作用：进入页面时加载 Pathways 数据。
   * 为什么添加：用户点击路径列表后，需要立即看到可维护的项目清单。
   */
  async onLoad() {
    await this.loadRecords();
  },

  /**
   * 方法是什么：路径列表页显示生命周期方法。
   * 方法作用：从新增或编辑页返回时重新加载 Pathways 数据。
   * 为什么添加：保存后的项目变更需要反映到列表中。
   */
  async onShow() {
    await this.loadRecords();
  },

  /**
   * 方法是什么：加载 Pathways 记录列表。
   * 方法作用：调用 `adminPathways` 的 list 操作读取项目数据并应用搜索。
   * 为什么添加：路径列表需要独立加载入口，支持刷新、返回更新和本地筛选。
   */
  async loadRecords() {
    this.setData({ loading: true });
    try {
      const data = await cloud.callCloud('adminPathways', { action: 'list', pageSize: 100 });
      this.setData({ records: data.list || [], total: data.total || 0 });
      this.applySearch();
    } catch (error) {
      cloud.showError(error);
    } finally {
      this.setData({ loading: false });
    }
  },

  /**
   * 方法是什么：处理路径搜索关键词输入。
   * 方法作用：保存关键词并重新筛选当前 Pathways 列表。
   * 为什么添加：项目代码和项目名称较多时，需要快速定位目标项目。
   */
  handleKeywordInput(event) {
    this.setData({ keyword: event.detail.value });
    this.applySearch();
  },

  /**
   * 方法是什么：应用 Pathways 本地搜索过滤。
   * 方法作用：按项目代码、中英文名称和目标描述筛选记录。
   * 为什么添加：本地筛选能让用户输入关键词后立即看到结果。
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
   * 方法是什么：构建 Pathways 搜索文本。
   * 方法作用：合并项目代码、项目名、完整标签和目标描述。
   * 为什么添加：Pathways 查询需要覆盖用户可能记住的不同字段。
   */
  buildSearchText(record) {
    return [
      record.code,
      record.projectNameZh,
      record.projectNameEn,
      record.fullLabelZh,
      record.fullLabelEn,
      record.objectiveZh,
      record.objectiveEn,
      record.searchText
    ].filter(Boolean).join(' ').toLowerCase();
  },

  /**
   * 方法是什么：打开新增路径页面。
   * 方法作用：跳转到无 id 参数的路径编辑页。
   * 为什么添加：新增路径和编辑路径复用同一页面，无 id 表示创建新项目。
   */
  openCreate() {
    wx.navigateTo({ url: '/pages/pathways/edit/edit' });
  },

  /**
   * 方法是什么：打开编辑路径页面。
   * 方法作用：携带 Pathways id 跳转到路径编辑页。
   * 为什么添加：编辑页需要按 id 加载完整项目数据。
   */
  editRecord(event) {
    const id = event.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/pathways/edit/edit?id=${id}` });
  },

  /**
   * 方法是什么：确认删除路径记录。
   * 方法作用：弹出确认框并在用户确认后删除 Pathways 项目。
   * 为什么添加：删除项目会影响后续备稿项目匹配，需要避免误触。
   */
  async confirmDelete(event) {
    const id = event.currentTarget.dataset.id;
    const name = event.currentTarget.dataset.name || '该项目';
    const result = await this.showDeleteConfirm(name);
    if (!result.confirm) {
      return;
    }
    await this.deleteRecord(id);
  },

  /**
   * 方法是什么：显示删除确认弹窗。
   * 方法作用：把微信弹窗封装成 Promise，返回确认结果。
   * 为什么添加：删除路径前必须等待用户确认，封装后删除流程更清楚。
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
   * 方法是什么：删除路径记录。
   * 方法作用：调用 `adminPathways` 的 delete 操作删除指定 id。
   * 为什么添加：路径列表页需要提供完整 CRUD 中的删除能力。
   */
  async deleteRecord(id) {
    try {
      await cloud.callCloud('adminPathways', { action: 'delete', id });
      cloud.showSuccess('已删除');
      await this.loadRecords();
    } catch (error) {
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：刷新路径列表。
   * 方法作用：手动重新加载 Pathways 数据。
   * 为什么添加：用户需要在数据变化后主动刷新当前列表。
   */
  async refreshRecords() {
    await this.loadRecords();
  }
});
