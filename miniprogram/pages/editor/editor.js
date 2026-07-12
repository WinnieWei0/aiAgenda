const app = getApp();
const cloud = require('../../utils/cloud');
const agendaUtil = require('../../utils/agenda');

Page({
  data: {
    agenda: agendaUtil.createEmptyAgenda(),
    language: 'zh',
    saving: false,
    exporting: false,
    dragIndex: -1,
    dragStartY: 0,
    memberResults: [],
    memberSearchIndex: -1,
    pathwayResults: [],
    pathwaySearchIndex: -1
  },

  /**
   * 方法是什么：编辑页加载生命周期方法。
   * 方法作用：根据页面参数读取历史议程，或使用首页传入的当前议程。
   * 为什么添加：用户既可以从解析结果进入编辑，也可以从历史列表继续编辑。
   */
  async onLoad(options) {
    if (options && options.id) {
      await this.loadAgendaById(options.id);
      return;
    }
    const agenda = app.globalData.currentAgenda || agendaUtil.createEmptyAgenda();
    this.setData({ agenda: agendaUtil.cloneJson(agenda) });
  },

  /**
   * 方法是什么：根据数据库 ID 加载议程。
   * 方法作用：直接读取 `agendas` 集合中的指定记录并放入页面表单。
   * 为什么添加：历史议程跳转编辑时只传 ID，编辑页需要自行拉取完整数据。
   */
  async loadAgendaById(id) {
    try {
      const data = await cloud.callCloud('agendaQuery', { action: 'get', id });
      this.setData({ agenda: agendaUtil.cloneJson(data.agenda) });
    } catch (error) {
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：更新会议信息字段。
   * 方法作用：把会议编号、日期、时间、地址、主题等输入写回议程对象。
   * 为什么添加：AI 解析结果需要允许用户人工校正，最终保存和导出以表单值为准。
   */
  handleMeetingInput(event) {
    const field = event.currentTarget.dataset.field;
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    agenda.meetingInfo[field] = event.detail.value;
    this.setData({ agenda });
  },

  /**
   * 方法是什么：更新流程项目的普通字段。
   * 方法作用：修改流程标题、时长和类型等顶层字段。
   * 为什么添加：用户需要编辑 AI 分析出来的流程名称和时间安排。
   */
  handleItemInput(event) {
    const index = Number(event.currentTarget.dataset.index);
    const field = event.currentTarget.dataset.field;
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    agenda.items[index][field] = event.detail.value;
    this.setData({ agenda });
  },

  /**
   * 方法是什么：更新流程项目的人员字段。
   * 方法作用：修改流程负责人的姓名、显示名和俱乐部信息。
   * 为什么添加：姓名匹配可能需要人工确认，表单必须支持直接修正人员信息。
   */
  handlePersonInput(event) {
    const index = Number(event.currentTarget.dataset.index);
    const field = event.currentTarget.dataset.field;
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    if (!agenda.items[index].person) {
      agenda.items[index].person = {};
    }
    agenda.items[index].person[field] = event.detail.value;
    agenda.items[index].person.unresolved = false;
    this.setData({ agenda });
  },

  /**
   * 方法是什么：更新备稿项目字段。
   * 方法作用：修改备稿演讲标题、项目代码和项目描述。
   * 为什么添加：备稿信息来自接龙和 Pathways 匹配，用户需要在导出前校正细节。
   */
  handleSpeechInput(event) {
    const index = Number(event.currentTarget.dataset.index);
    const field = event.currentTarget.dataset.field;
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    if (!agenda.items[index].speech) {
      agenda.items[index].speech = {};
    }
    agenda.items[index].speech[field] = event.detail.value;
    this.setData({ agenda });
  },

  /**
   * 方法是什么：新增一个手动流程。
   * 方法作用：在流程数组末尾追加空流程并刷新顺序。
   * 为什么添加：会议可能临时增加工作坊、颁奖或其他 AI 没有识别出的环节。
   */
  addItem() {
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    agenda.items.push(agendaUtil.createEmptyItem(agenda.items.length + 1));
    agenda.items = agendaUtil.normalizeItemOrders(agenda.items);
    this.setData({ agenda });
  },

  /**
   * 方法是什么：删除指定流程。
   * 方法作用：从流程数组中移除用户选择的项目并重新排序。
   * 为什么添加：AI 解析可能产生多余流程，用户需要能够清理错误项。
   */
  deleteItem(event) {
    const index = Number(event.currentTarget.dataset.index);
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    agenda.items.splice(index, 1);
    agenda.items = agendaUtil.normalizeItemOrders(agenda.items);
    this.setData({ agenda });
  },

  /**
   * 方法是什么：将流程上移一位。
   * 方法作用：通过按钮调整当前流程和上一项的位置。
   * 为什么添加：除拖拽外提供明确按钮操作，兼容触摸排序不方便的场景。
   */
  moveItemUp(event) {
    const index = Number(event.currentTarget.dataset.index);
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    agenda.items = agendaUtil.moveItem(agenda.items, index, index - 1);
    this.setData({ agenda });
  },

  /**
   * 方法是什么：将流程下移一位。
   * 方法作用：通过按钮调整当前流程和下一项的位置。
   * 为什么添加：用户需要可靠地微调流程顺序，按钮比拖拽更精确。
   */
  moveItemDown(event) {
    const index = Number(event.currentTarget.dataset.index);
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    agenda.items = agendaUtil.moveItem(agenda.items, index, index + 1);
    this.setData({ agenda });
  },

  /**
   * 方法是什么：记录拖拽排序起点。
   * 方法作用：保存当前触摸的流程索引和纵坐标。
   * 为什么添加：触摸移动结束时需要知道用户从哪一项开始拖动。
   */
  handleItemTouchStart(event) {
    this.setData({
      dragIndex: Number(event.currentTarget.dataset.index),
      dragStartY: event.touches && event.touches[0] ? event.touches[0].clientY : 0
    });
  },

  /**
   * 方法是什么：根据触摸移动距离执行排序。
   * 方法作用：当用户上下拖动超过阈值时交换相邻流程。
   * 为什么添加：需求要求支持拖拽修改顺序，触摸排序可以在原生小程序中直接实现。
   */
  handleItemTouchMove(event) {
    const currentY = event.touches && event.touches[0] ? event.touches[0].clientY : this.data.dragStartY;
    const delta = currentY - this.data.dragStartY;
    if (Math.abs(delta) < 36 || this.data.dragIndex < 0) {
      return;
    }
    const direction = delta > 0 ? 1 : -1;
    const targetIndex = this.data.dragIndex + direction;
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    agenda.items = agendaUtil.moveItem(agenda.items, this.data.dragIndex, targetIndex);
    this.setData({
      agenda,
      dragIndex: targetIndex,
      dragStartY: currentY
    });
  },

  /**
   * 方法是什么：结束拖拽排序状态。
   * 方法作用：清空拖拽索引和起点坐标。
   * 为什么添加：拖拽结束后需要重置临时状态，避免影响下一次排序。
   */
  handleItemTouchEnd() {
    this.setData({ dragIndex: -1, dragStartY: 0 });
  },

  /**
   * 方法是什么：转义数据库正则搜索关键词。
   * 方法作用：把用户输入中的正则特殊字符转换为普通字符匹配。
   * 为什么添加：姓名和项目代码可能包含括号或点号，直接拼正则会导致搜索不准或报错。
   */
  escapeSearchKeyword(keyword) {
    return String(keyword || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  },

  /**
   * 方法是什么：搜索当前流程人员对应的会员。
   * 方法作用：根据流程里已有姓名从 `memberships` 集合查询候选会员。
   * 为什么添加：用户编辑人员时应优先选择 Membership 表中的正式显示名，而不是手动输入。
   */
  async searchMemberForItem(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.agenda.items[index];
    const person = item.person || {};
    const keyword = person.displayNameZh || person.rawName || person.displayNameEn || '';
    if (!keyword) {
      wx.showToast({ title: '请先输入姓名', icon: 'none' });
      return;
    }
    try {
      const data = await cloud.callCloud('lookupOptions', { type: 'memberships', keyword });
      this.setData({ memberResults: data.list || [], memberSearchIndex: index });
    } catch (error) {
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：选择会员候选并填入流程。
   * 方法作用：把 Membership 记录里的中英文议程名和俱乐部信息写入当前流程人员字段。
   * 为什么添加：选择数据库会员可以减少姓名格式错误，并保证 PDF 使用正式显示名。
   */
  chooseMember(event) {
    const index = this.data.memberSearchIndex;
    const memberIndex = Number(event.currentTarget.dataset.index);
    const member = this.data.memberResults[memberIndex];
    if (index < 0 || !member) {
      return;
    }
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    agenda.items[index].person = {
      rawName: member.nameZh || member.nameEn,
      memberId: member._id,
      displayNameZh: member.agendaNameZh || member.nameZh,
      displayNameEn: member.titleOnAgenda || member.nameEn,
      clubZh: member.clubZh || '广州双语',
      clubEn: member.clubEn || 'Bilingual',
      unresolved: false
    };
    this.setData({ agenda, memberResults: [], memberSearchIndex: -1 });
  },

  /**
   * 方法是什么：搜索当前备稿流程对应的 Pathways 项目。
   * 方法作用：根据项目代码或项目名从 `pathways` 集合查询候选项目。
   * 为什么添加：备稿项目描述必须来自 Pathways 表，搜索选择可以避免手工复制错误。
   */
  async searchPathwayForItem(event) {
    const index = Number(event.currentTarget.dataset.index);
    const speech = this.data.agenda.items[index].speech || {};
    const keyword = speech.projectCode || speech.projectTitleZh || speech.projectTitleEn || '';
    if (!keyword) {
      wx.showToast({ title: '请先输入项目代码', icon: 'none' });
      return;
    }
    try {
      const data = await cloud.callCloud('lookupOptions', { type: 'pathways', keyword });
      this.setData({ pathwayResults: data.list || [], pathwaySearchIndex: index });
    } catch (error) {
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：选择 Pathways 候选并填入备稿流程。
   * 方法作用：把项目代码、中英文项目名和目标说明写入当前 speech 字段。
   * 为什么添加：导出 PDF 时备稿描述需要准确来自数据库，选择候选比手动输入更可靠。
   */
  choosePathway(event) {
    const index = this.data.pathwaySearchIndex;
    const pathwayIndex = Number(event.currentTarget.dataset.index);
    const pathway = this.data.pathwayResults[pathwayIndex];
    if (index < 0 || !pathway) {
      return;
    }
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    agenda.items[index].speech.projectCode = pathway.code;
    agenda.items[index].speech.pathwayId = pathway._id;
    agenda.items[index].speech.projectTitleZh = pathway.fullLabelZh;
    agenda.items[index].speech.projectTitleEn = pathway.fullLabelEn;
    agenda.items[index].speech.projectObjectiveZh = pathway.objectiveZh;
    agenda.items[index].speech.projectObjectiveEn = pathway.objectiveEn;
    this.setData({ agenda, pathwayResults: [], pathwaySearchIndex: -1 });
  },

  /**
   * 方法是什么：保存当前议程。
   * 方法作用：调用 `saveAgenda` 云函数新增或更新数据库记录。
   * 为什么添加：用户编辑后的流程、排序和字段需要持久化到服务器。
   */
  async saveAgenda() {
    this.setData({ saving: true });
    try {
      const data = await cloud.callCloud('saveAgenda', { agenda: this.data.agenda });
      const agenda = agendaUtil.cloneJson(this.data.agenda);
      agenda._id = data._id;
      app.setCurrentAgenda(agenda);
      this.setData({ agenda });
      cloud.showSuccess('已保存');
    } catch (error) {
      cloud.showError(error);
    } finally {
      this.setData({ saving: false });
    }
  },

  /**
   * 方法是什么：切换导出语言。
   * 方法作用：在中文和英文 PDF 导出选项之间切换。
   * 为什么添加：需求要求导出议程可切换语言，页面需要保存用户选择。
   */
  switchLanguage(event) {
    this.setData({ language: event.currentTarget.dataset.language });
  },

  /**
   * 方法是什么：导出并预览 PDF。
   * 方法作用：确保议程已保存，调用 `exportAgendaPdf`，下载云存储文件并打开。
   * 为什么添加：用户最终需要把编辑后的议程导出为可分享的 PDF 文件。
   */
  async exportPdf() {
    this.setData({ exporting: true });
    try {
      if (!this.data.agenda._id) {
        await this.saveAgenda();
      }
      const data = await cloud.callCloud('exportAgendaPdf', {
        agendaId: this.data.agenda._id,
        language: this.data.language
      });
      await this.previewPdf(data.fileID);
    } catch (error) {
      cloud.showError(error);
    } finally {
      this.setData({ exporting: false });
    }
  },

  /**
   * 方法是什么：预览云存储中的 PDF。
   * 方法作用：下载 fileID 对应文件，并通过 `wx.openDocument` 打开。
   * 为什么添加：微信小程序预览 PDF 需要先下载到本地临时路径。
   */
  async previewPdf(fileID) {
    const downloadRes = await wx.cloud.downloadFile({ fileID });
    await wx.openDocument({
      filePath: downloadRes.tempFilePath,
      fileType: 'pdf',
      showMenu: true
    });
  }
});
