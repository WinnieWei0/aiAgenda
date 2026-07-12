const cloud = require('../../utils/cloud');

Page({
  data: {
    tab: 'memberships',
    loading: false,
    records: [],
    draft: {},
    assignOpenid: '',
    assignRoleCode: 'viewer'
  },

  /**
   * 方法是什么：管理页加载生命周期方法。
   * 方法作用：初始化当前标签页并加载对应数据。
   * 为什么添加：管理员进入页面后需要立即看到可维护的基础数据。
   */
  async onLoad() {
    this.resetDraft();
    await this.loadCurrentTab();
  },

  /**
   * 方法是什么：切换管理标签页。
   * 方法作用：在 Membership、Pathways 和角色管理之间切换并重新加载数据。
   * 为什么添加：管理中心承载多张基础表，需要清晰分组维护。
   */
  async switchTab(event) {
    this.setData({ tab: event.currentTarget.dataset.tab, records: [] });
    this.resetDraft();
    await this.loadCurrentTab();
  },

  /**
   * 方法是什么：重置当前标签页的草稿对象。
   * 方法作用：根据 tab 创建对应表单的默认字段。
   * 为什么添加：新增记录时需要干净表单，避免上一次编辑的数据残留。
   */
  resetDraft() {
    if (this.data.tab === 'pathways') {
      this.setData({
        draft: {
          code: '',
          projectNameZh: '',
          projectNameEn: '',
          objectiveZh: '',
          objectiveEn: ''
        }
      });
      return;
    }
    if (this.data.tab === 'roles') {
      this.setData({
        draft: {
          code: '',
          name: '',
          description: ''
        }
      });
      return;
    }
    this.setData({
      draft: {
        nameZh: '',
        nameEn: '',
        nickName: '',
        agendaNameZh: '',
        titleOnAgenda: '',
        phone: '',
        email: ''
      }
    });
  },

  /**
   * 方法是什么：加载当前标签页数据。
   * 方法作用：根据 tab 调用对应云函数列表接口。
   * 为什么添加：三个管理表后端接口不同，页面需要一个统一调度入口。
   */
  async loadCurrentTab() {
    this.setData({ loading: true });
    try {
      if (this.data.tab === 'pathways') {
        await this.loadPathways();
      } else if (this.data.tab === 'roles') {
        await this.loadRoles();
      } else {
        await this.loadMemberships();
      }
    } catch (error) {
      cloud.showError(error);
    } finally {
      this.setData({ loading: false });
    }
  },

  /**
   * 方法是什么：加载会员列表。
   * 方法作用：调用 `adminMemberships` 的 list 操作读取会员数据。
   * 为什么添加：管理员需要在小程序中维护 Membership 数据库表。
   */
  async loadMemberships() {
    const data = await cloud.callCloud('adminMemberships', { action: 'list', pageSize: 50 });
    this.setData({ records: data.list || [] });
  },

  /**
   * 方法是什么：加载 Pathways 列表。
   * 方法作用：调用 `adminPathways` 的 list 操作读取项目数据。
   * 为什么添加：备稿项目描述从 Pathways 表读取，管理员需要可视化维护。
   */
  async loadPathways() {
    const data = await cloud.callCloud('adminPathways', { action: 'list', pageSize: 50 });
    this.setData({ records: data.list || [] });
  },

  /**
   * 方法是什么：加载系统角色列表。
   * 方法作用：调用 `adminRoles` 的 list 操作读取权限角色。
   * 为什么添加：角色管理表需要支持管理员查看和维护。
   */
  async loadRoles() {
    const data = await cloud.callCloud('adminRoles', { action: 'list' });
    this.setData({ records: data.list || [] });
  },

  /**
   * 方法是什么：更新草稿表单字段。
   * 方法作用：把输入框字段写入 draft 对象。
   * 为什么添加：新增和编辑基础数据都需要同一套表单状态。
   */
  handleDraftInput(event) {
    const field = event.currentTarget.dataset.field;
    const draft = Object.assign({}, this.data.draft);
    draft[field] = event.detail.value;
    this.setData({ draft });
  },

  /**
   * 方法是什么：把选中记录放入编辑草稿。
   * 方法作用：复制列表项数据到 draft 表单。
   * 为什么添加：管理员需要在原记录基础上修改，而不是每次重新录入。
   */
  editRecord(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ draft: Object.assign({}, this.data.records[index]) });
  },

  /**
   * 方法是什么：保存当前草稿。
   * 方法作用：根据 tab 调用对应云函数保存 Membership、Pathways 或角色。
   * 为什么添加：基础表 CRUD 的新增和更新可以通过同一个保存按钮完成。
   */
  async saveDraft() {
    try {
      if (this.data.tab === 'pathways') {
        await cloud.callCloud('adminPathways', { action: 'save', pathway: this.data.draft });
      } else if (this.data.tab === 'roles') {
        await cloud.callCloud('adminRoles', { action: 'save', role: this.data.draft });
      } else {
        await cloud.callCloud('adminMemberships', { action: 'save', member: this.data.draft });
      }
      cloud.showSuccess('已保存');
      this.resetDraft();
      await this.loadCurrentTab();
    } catch (error) {
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：删除指定记录。
   * 方法作用：根据当前 tab 调用对应删除接口。
   * 为什么添加：Membership、Pathways 和角色管理都要求支持删除能力。
   */
  async deleteRecord(event) {
    const index = Number(event.currentTarget.dataset.index);
    const record = this.data.records[index];
    try {
      if (this.data.tab === 'pathways') {
        await cloud.callCloud('adminPathways', { action: 'delete', id: record._id });
      } else if (this.data.tab === 'roles') {
        await cloud.callCloud('adminRoles', { action: 'delete', code: record.code });
      } else {
        await cloud.callCloud('adminMemberships', { action: 'delete', id: record._id });
      }
      cloud.showSuccess('已删除');
      await this.loadCurrentTab();
    } catch (error) {
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：初始化 Excel 种子数据。
   * 方法作用：调用 `seedWorkbookData` 把 Membership 和 Pathways JSON 写入数据库。
   * 为什么添加：系统首次部署后需要把现有 Excel 基础数据迁移到 CloudBase。
   */
  async seedWorkbookData() {
    try {
      const data = await cloud.callCloud('seedWorkbookData', {});
      cloud.showSuccess(`会员${data.memberships.total} 项目${data.pathways.total}`);
      await this.loadCurrentTab();
    } catch (error) {
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：更新角色绑定表单字段。
   * 方法作用：保存管理员输入的 openid 或角色编码。
   * 为什么添加：用户角色绑定需要管理员指定目标用户和目标角色。
   */
  handleAssignInput(event) {
    const field = event.currentTarget.dataset.field;
    if (field === 'openid') {
      this.setData({ assignOpenid: event.detail.value });
    } else {
      this.setData({ assignRoleCode: event.detail.value });
    }
  },

  /**
   * 方法是什么：给用户分配系统角色。
   * 方法作用：调用 `adminRoles` 的 assign 操作绑定 openid 和 roleCode。
   * 为什么添加：管理员需要通过界面控制谁可以维护基础数据。
   */
  async assignRole() {
    try {
      await cloud.callCloud('adminRoles', {
        action: 'assign',
        openid: this.data.assignOpenid,
        roleCode: this.data.assignRoleCode
      });
      cloud.showSuccess('已授权');
    } catch (error) {
      cloud.showError(error);
    }
  }
});
