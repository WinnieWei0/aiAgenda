const app = getApp();
const cloud = require('../../utils/cloud');
const agendaUtil = require('../../utils/agenda');

Page({
  data: {
    agenda: agendaUtil.createEmptyAgenda(),
    language: 'zh',
    saving: false,
    exporting: false,
    memberOptions: [],
    sectionDragIndex: -1,
    sectionDragStartY: 0,
    itemDragSectionIndex: -1,
    itemDragIndex: -1,
    itemDragStartY: 0
  },

  /**
   * 方法是什么：加载编辑页。
   * 方法作用：读取传入或当前用户的议程并加载会员选项。
   * 为什么添加：编辑页需要在解析后和应用重启后都能恢复。
   */
  async onLoad(options) {
    await this.loadMembers();
    if (options && options.id) {
      await this.loadAgendaById(options.id);
      return;
    }
    const current = app.globalData.currentAgenda;
    if (current) {
      this.setAgenda(current);
      return;
    }
    try {
      const data = await cloud.callCloud('agendaQuery', { action: 'current' });
      if (data.agenda) {
        app.setCurrentAgenda(data.agenda);
        this.setAgenda(data.agenda);
      }
    } catch (error) {
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：加载会员选项。
   * 方法作用：按数据库顺序读取会员供演讲者选择。
   * 为什么添加：流程表单需要支持会员下拉选择。
   */
  async loadMembers() {
    try {
      const data = await cloud.callCloud('lookupOptions', { type: 'memberships', keyword: '' });
      const memberOptions = (data.list || []).map((member) => ({
        label: [member.nameZh, member.nameEn, member.nickName].filter(Boolean).join(' / '),
        member
      }));
      this.setData({ memberOptions });
    } catch (error) {
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：加载指定议程。
   * 方法作用：通过云函数读取当前有效议程详情。
   * 为什么添加：兼容旧入口并支持重新打开编辑页。
   */
  async loadAgendaById(id) {
    try {
      const data = await cloud.callCloud('agendaQuery', { action: 'get', id });
      this.setAgenda(data.agenda);
    } catch (error) {
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：设置议程状态。
   * 方法作用：规范化模块、时间和会员选择索引后更新页面。
   * 为什么添加：所有表单和排序修改都必须共享同一数据形状。
   */
  setAgenda(value) {
    const agenda = agendaUtil.normalizeAgenda(value);
    this.decorateMemberIndexes(agenda);
    app.setCurrentAgenda(agenda);
    this.setData({ agenda });
  },

  /**
   * 方法是什么：标记会员选择索引。
   * 方法作用：把流程中的 memberId 映射到 picker 下标。
   * 为什么添加：数据库保存 ID，控件显示需要数组位置。
   */
  decorateMemberIndexes(agenda) {
    const options = this.data.memberOptions || [];
    agenda.sections.forEach((section) => {
      section.items.forEach((item) => {
        if (!item.person) {
          return;
        }
        const index = options.findIndex((option) => option.member._id === item.person.memberId);
        item.person.memberIndex = index;
      });
    });
  },

  /**
   * 方法是什么：更新会议信息。
   * 方法作用：写入会议编号、日期、时间、主题和地址。
   * 为什么添加：DeepSeek 结果需要允许人工校正。
   */
  handleMeetingInput(event) {
    const field = event.currentTarget.dataset.field;
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    agenda.meetingInfo[field] = event.detail.value;
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：更新模块标题。
   * 方法作用：允许用户修改模块中英文名称。
   * 为什么添加：PDF 流程名称需要保留可编辑能力。
   */
  handleSectionInput(event) {
    const index = Number(event.currentTarget.dataset.sectionIndex);
    const field = event.currentTarget.dataset.field;
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    agenda.sections[index][field] = event.detail.value;
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：更新流程行。
   * 方法作用：修改流程名称或限时并重新计算开始时间。
   * 为什么添加：限时是议程时间链的输入值。
   */
  handleItemInput(event) {
    const sectionIndex = Number(event.currentTarget.dataset.sectionIndex);
    const itemIndex = Number(event.currentTarget.dataset.itemIndex);
    const field = event.currentTarget.dataset.field;
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    const item = agenda.sections[sectionIndex].items[itemIndex];
    item[field] = field === 'duration' ? Math.max(Number(event.detail.value) || 0, 0) : event.detail.value;
    if (field === 'titleZh' && !item.titleEn) {
      item.titleEn = event.detail.value;
    }
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：更新流程人员。
   * 方法作用：支持手动输入姓名和俱乐部并清除会员绑定。
   * 为什么添加：下拉选择之外必须允许临时人员报名。
   */
  handlePersonInput(event) {
    const sectionIndex = Number(event.currentTarget.dataset.sectionIndex);
    const itemIndex = Number(event.currentTarget.dataset.itemIndex);
    const field = event.currentTarget.dataset.field;
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    const item = agenda.sections[sectionIndex].items[itemIndex];
    item.person = item.person || {};
    item.person[field] = event.detail.value;
    if (field === 'rawName') {
      item.person.displayNameZh = event.detail.value;
      item.person.displayNameEn = event.detail.value;
      item.person.memberId = '';
      item.person.memberIndex = -1;
    }
    item.person.unresolved = false;
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：选择会员。
   * 方法作用：把会员姓名和默认广州双语俱乐部写入流程行。
   * 为什么添加：正式会员显示需要来自数据库记录。
   */
  chooseMember(event) {
    const sectionIndex = Number(event.currentTarget.dataset.sectionIndex);
    const itemIndex = Number(event.currentTarget.dataset.itemIndex);
    const memberIndex = Number(event.detail.value);
    const option = this.data.memberOptions[memberIndex];
    if (!option) {
      return;
    }
    const member = option.member;
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    const item = agenda.sections[sectionIndex].items[itemIndex];
    item.person = {
      rawName: member.nameZh || member.nameEn || member.nickName || '',
      memberId: member._id,
      memberIndex,
      displayNameZh: member.nameZh || member.nameEn || '',
      displayNameEn: member.nameEn || member.nameZh || '',
      clubZh: '广州双语',
      clubEn: 'Bilingual',
      unresolved: false
    };
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：更新备稿字段。
   * 方法作用：允许人工修正项目代码、名称和要求。
   * 为什么添加：Pathways 匹配结果在导出前仍需可校正。
   */
  handleSpeechInput(event) {
    const sectionIndex = Number(event.currentTarget.dataset.sectionIndex);
    const itemIndex = Number(event.currentTarget.dataset.itemIndex);
    const field = event.currentTarget.dataset.field;
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    const item = agenda.sections[sectionIndex].items[itemIndex];
    item.speech = item.speech || {};
    item.speech[field] = event.detail.value;
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：新增流程行。
   * 方法作用：在指定模块尾部创建空流程。
   * 为什么添加：会议可能临时增加颁奖或其他活动。
   */
  addItem(event) {
    const sectionIndex = Number(event.currentTarget.dataset.sectionIndex);
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    const section = agenda.sections[sectionIndex];
    section.items.push(agendaUtil.createEmptyItem(section.items.length + 1, section.id));
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：删除流程行。
   * 方法作用：移除指定模块中的流程并重排时间。
   * 为什么添加：解析结果需要允许人工清理错误流程。
   */
  deleteItem(event) {
    const sectionIndex = Number(event.currentTarget.dataset.sectionIndex);
    const itemIndex = Number(event.currentTarget.dataset.itemIndex);
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    agenda.sections[sectionIndex].items.splice(itemIndex, 1);
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：移动模块。
   * 方法作用：按方向调整模块顺序。
   * 为什么添加：编辑器要求支持模块级排序。
   */
  moveSection(event) {
    const index = Number(event.currentTarget.dataset.sectionIndex);
    const direction = Number(event.currentTarget.dataset.direction);
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    agenda.sections = agendaUtil.moveSection(agenda.sections, index, index + direction);
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：移动流程行。
   * 方法作用：在同一模块内按方向调整流程顺序。
   * 为什么添加：编辑器要求支持模块内行排序。
   */
  moveItem(event) {
    const sectionIndex = Number(event.currentTarget.dataset.sectionIndex);
    const itemIndex = Number(event.currentTarget.dataset.itemIndex);
    const direction = Number(event.currentTarget.dataset.direction);
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    agenda.sections = agendaUtil.moveItem(agenda.sections, sectionIndex, itemIndex, itemIndex + direction);
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：开始拖动模块。
   * 方法作用：记录模块索引和触摸起点。
   * 为什么添加：触摸排序需要计算移动方向。
   */
  handleSectionTouchStart(event) {
    this.setData({
      sectionDragIndex: Number(event.currentTarget.dataset.sectionIndex),
      sectionDragStartY: event.touches && event.touches[0] ? event.touches[0].clientY : 0
    });
  },

  /**
   * 方法是什么：拖动模块。
   * 方法作用：超过阈值时交换相邻模块。
   * 为什么添加：移动端需要直接触摸完成模块排序。
   */
  handleSectionTouchMove(event) {
    const currentY = event.touches && event.touches[0] ? event.touches[0].clientY : this.data.sectionDragStartY;
    if (Math.abs(currentY - this.data.sectionDragStartY) < 36 || this.data.sectionDragIndex < 0) {
      return;
    }
    const direction = currentY > this.data.sectionDragStartY ? 1 : -1;
    const target = this.data.sectionDragIndex + direction;
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    agenda.sections = agendaUtil.moveSection(agenda.sections, this.data.sectionDragIndex, target);
    this.setData({ agenda: agendaUtil.normalizeAgenda(agenda), sectionDragIndex: target, sectionDragStartY: currentY });
  },

  /**
   * 方法是什么：结束模块拖动。
   * 方法作用：清除模块拖动临时状态。
   * 为什么添加：避免下一次触摸继承旧索引。
   */
  handleSectionTouchEnd() {
    this.setData({ sectionDragIndex: -1, sectionDragStartY: 0 });
  },

  /**
   * 方法是什么：开始拖动流程行。
   * 方法作用：记录模块、行索引和触摸起点。
   * 为什么添加：行排序必须限制在当前模块内。
   */
  handleItemTouchStart(event) {
    this.setData({
      itemDragSectionIndex: Number(event.currentTarget.dataset.sectionIndex),
      itemDragIndex: Number(event.currentTarget.dataset.itemIndex),
      itemDragStartY: event.touches && event.touches[0] ? event.touches[0].clientY : 0
    });
  },

  /**
   * 方法是什么：拖动流程行。
   * 方法作用：超过阈值时交换当前模块中的相邻行。
   * 为什么添加：用户需要在手机上快速调整流程顺序。
   */
  handleItemTouchMove(event) {
    const currentY = event.touches && event.touches[0] ? event.touches[0].clientY : this.data.itemDragStartY;
    if (Math.abs(currentY - this.data.itemDragStartY) < 36 || this.data.itemDragIndex < 0) {
      return;
    }
    const direction = currentY > this.data.itemDragStartY ? 1 : -1;
    const target = this.data.itemDragIndex + direction;
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    agenda.sections = agendaUtil.moveItem(agenda.sections, this.data.itemDragSectionIndex, this.data.itemDragIndex, target);
    this.setData({ agenda: agendaUtil.normalizeAgenda(agenda), itemDragIndex: target, itemDragStartY: currentY });
  },

  /**
   * 方法是什么：结束流程行拖动。
   * 方法作用：清除行拖动临时状态。
   * 为什么添加：防止后续触摸误用旧拖动位置。
   */
  handleItemTouchEnd() {
    this.setData({ itemDragSectionIndex: -1, itemDragIndex: -1, itemDragStartY: 0 });
  },

  /**
   * 方法是什么：保存议程。
   * 方法作用：把规范化后的 JSON 草稿写回当前用户记录。
   * 为什么添加：编辑结果必须持久化并保持原七天期限。
   */
  async saveAgenda(showMessage) {
    this.setData({ saving: true });
    try {
      const agenda = agendaUtil.normalizeAgenda(this.data.agenda);
      const data = await cloud.callCloud('saveAgenda', { agenda });
      const saved = agendaUtil.normalizeAgenda(Object.assign({}, agenda, { _id: data._id, expiresAt: data.expiresAt }));
      app.setCurrentAgenda(saved);
      this.setData({ agenda: saved });
      if (showMessage !== false) {
        cloud.showSuccess('已保存');
      }
      return saved;
    } catch (error) {
      cloud.showError(error);
      throw error;
    } finally {
      this.setData({ saving: false });
    }
  },

  /**
   * 方法是什么：切换 PDF 语言。
   * 方法作用：保存中文或英文导出选项。
   * 为什么添加：现有 PDF 支持双语输出。
   */
  switchLanguage(event) {
    this.setData({ language: event.currentTarget.dataset.language });
  },

  /**
   * 方法是什么：导出议程 PDF。
   * 方法作用：先保存当前编辑结果，再请求云函数生成 PDF。
   * 为什么添加：导出的文件必须与页面最新内容一致。
   */
  async exportPdf() {
    this.setData({ exporting: true });
    try {
      const agenda = await this.saveAgenda(false);
      const data = await cloud.callCloud('exportAgendaPdf', {
        agendaId: agenda._id,
        language: this.data.language
      });
      await this.previewPdf(data.fileID);
    } catch (error) {
      if (error && error.code === 'AGENDA_EXPIRED') {
        cloud.showError(error);
      }
    } finally {
      this.setData({ exporting: false });
    }
  },

  /**
   * 方法是什么：预览 PDF 文件。
   * 方法作用：下载云存储文件并调用微信文档预览。
   * 为什么添加：小程序不能直接打开云存储地址。
   */
  async previewPdf(fileID) {
    const downloadRes = await wx.cloud.downloadFile({ fileID });
    await wx.openDocument({ filePath: downloadRes.tempFilePath, fileType: 'pdf', showMenu: true });
  }
});
