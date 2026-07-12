const cloud = require('../../../utils/cloud');

Page({
  data: {
    loading: false,
    keyword: '',
    records: [],
    filteredRecords: [],
    assignOpenid: '',
    assignRoleCode: 'viewer'
  },

  /**
   * 方法是什么：角色列表页加载生命周期方法。
   * 方法作用：进入页面时加载角色列表。
   * 为什么添加：用户进入角色管理后需要立即看到可维护的角色定义。
   */
  async onLoad() {
    await this.loadRecords();
  },

  /**
   * 方法是什么：角色列表页显示生命周期方法。
   * 方法作用：从新增或编辑角色页返回时重新加载列表。
   * 为什么添加：角色保存后列表需要刷新，确保显示最新名称和描述。
   */
  async onShow() {
    await this.loadRecords();
  },

  /**
   * 方法是什么：加载角色记录列表。
   * 方法作用：调用 `adminRoles` 的 list 操作读取角色定义并应用搜索。
   * 为什么添加：角色管理拆成独立页面后，需要自己的数据加载入口。
   */
  async loadRecords() {
    this.setData({ loading: true });
    try {
      const data = await cloud.callCloud('adminRoles', { action: 'list' });
      this.setData({ records: data.list || [] });
      this.applySearch();
    } catch (error) {
      cloud.showError(error);
    } finally {
      this.setData({ loading: false });
    }
  },

  /**
   * 方法是什么：处理角色搜索关键词输入。
   * 方法作用：保存关键词并筛选角色列表。
   * 为什么添加：角色较多时需要按编码或名称快速定位。
   */
  handleKeywordInput(event) {
    this.setData({ keyword: event.detail.value });
    this.applySearch();
  },

  /**
   * 方法是什么：应用角色本地搜索过滤。
   * 方法作用：根据角色编码、名称和描述筛选记录。
   * 为什么添加：本地筛选能让角色列表交互更轻量。
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
   * 方法是什么：构建角色搜索文本。
   * 方法作用：合并角色编码、名称和描述。
   * 为什么添加：角色搜索需要覆盖用户可能记住的不同字段。
   */
  buildSearchText(record) {
    return [record.code, record.name, record.description].filter(Boolean).join(' ').toLowerCase();
  },

  /**
   * 方法是什么：打开新增角色页面。
   * 方法作用：跳转到无 code 参数的角色编辑页。
   * 为什么添加：新增角色和编辑角色复用同一个表单页面。
   */
  openCreate() {
    wx.navigateTo({ url: '/pages/roles/edit/edit' });
  },

  /**
   * 方法是什么：打开编辑角色页面。
   * 方法作用：携带角色 code 跳转到角色编辑页。
   * 为什么添加：编辑角色时需要按 code 加载记录，并禁止修改 code。
   */
  editRecord(event) {
    const code = event.currentTarget.dataset.code;
    wx.navigateTo({ url: `/pages/roles/edit/edit?code=${code}` });
  },

  /**
   * 方法是什么：确认删除角色记录。
   * 方法作用：弹出确认框并在用户确认后删除角色。
   * 为什么添加：删除角色会影响后续角色分配，需要避免误触。
   */
  async confirmDelete(event) {
    const code = event.currentTarget.dataset.code;
    const result = await this.showDeleteConfirm(code);
    if (!result.confirm) {
      return;
    }
    await this.deleteRecord(code);
  },

  /**
   * 方法是什么：显示删除确认弹窗。
   * 方法作用：把微信弹窗封装成 Promise，返回确认结果。
   * 为什么添加：删除角色前必须等待用户确认。
   */
  showDeleteConfirm(code) {
    return new Promise((resolve) => {
      wx.showModal({
        title: '确认删除',
        content: `确定删除角色 ${code} 吗？`,
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
   * 方法是什么：删除角色记录。
   * 方法作用：调用 `adminRoles` 的 delete 操作删除指定角色编码。
   * 为什么添加：角色列表页需要提供完整 CRUD 中的删除能力。
   */
  async deleteRecord(code) {
    try {
      await cloud.callCloud('adminRoles', { action: 'delete', code });
      cloud.showSuccess('已删除');
      await this.loadRecords();
    } catch (error) {
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：刷新角色列表。
   * 方法作用：手动重新加载角色数据。
   * 为什么添加：用户需要在角色定义变化后主动刷新当前列表。
   */
  async refreshRecords() {
    await this.loadRecords();
  },

  /**
   * 方法是什么：处理角色分配表单输入。
   * 方法作用：保存用户输入的 openid 和 roleCode。
   * 为什么添加：角色列表页保留角色分配能力，需要维护绑定表单状态。
   */
  handleAssignInput(event) {
    const field = event.currentTarget.dataset.field;
    if (field === 'openid') {
      this.setData({ assignOpenid: event.detail.value });
      return;
    }
    this.setData({ assignRoleCode: event.detail.value });
  },

  /**
   * 方法是什么：给用户分配角色。
   * 方法作用：调用 `adminRoles` 的 assign 操作绑定 openid 和 roleCode。
   * 为什么添加：虽然当前角色不限制管理权限，但仍需要维护角色分配数据。
   */
  async assignRole() {
    try {
      await cloud.callCloud('adminRoles', {
        action: 'assign',
        openid: this.data.assignOpenid,
        roleCode: this.data.assignRoleCode
      });
      cloud.showSuccess('已分配');
    } catch (error) {
      cloud.showError(error);
    }
  }
});
