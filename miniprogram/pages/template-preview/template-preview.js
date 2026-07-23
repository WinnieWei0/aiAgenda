const app = getApp();
const cloud = require('../../utils/cloud');

Page({
  data: {
    loading: true,
    exporting: false,
    agendaId: '',
    template: null,
    agenda: null,
    rows: []
  },

  /**
   * 方法是什么：加载两页 A4 模板预览。
   * 方法作用：读取指定草稿并调用云端模板解析得到统一视图模型。
   * 为什么添加：用户导出前需要先确认固定内容和动态议程的最终组合。
   */
  async onLoad(options) {
    const agendaId = options && options.id ? options.id : '';
    this.setData({ agendaId });
    try {
      const previewPayload = app.globalData.previewPayload;
      if (previewPayload && previewPayload.agendaId === agendaId) {
        delete app.globalData.previewPayload;
        const resolved = {
          template: previewPayload.template,
          agenda: previewPayload.agenda,
          rows: previewPayload.rows
        };
        this.renderResolved(resolved);
        await this.resolveCloudImages(resolved);
        this.setData({ template: resolved.template });
        return;
      }
      let agenda = app.globalData.currentAgenda;
      if (agendaId) {
        const data = await cloud.callCloud('agendaQuery', { action: 'get', id: agendaId });
        agenda = data.agenda;
      }
      const resolved = await cloud.callCloud('agendaTemplate', { action: 'resolve', agenda });
      await this.resolveCloudImages(resolved);
      this.renderResolved(resolved);
    } catch (error) {
      this.setData({ loading: false });
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：把已解析的模板数据一次性渲染到预览页。
   * 方法作用：复用编辑页刚保存的议程，避免进入页面后重复等待云端查询产生白屏闪烁。
   * 为什么添加：预览首屏应保持连续，云图片地址可以在页面显示后单独刷新。
   */
  renderResolved(resolved) {
    this.setData({
      template: resolved.template,
      agenda: resolved.agenda,
      rows: this.decorateRows(resolved.rows || [], resolved.agenda && resolved.agenda.meetingInfo && resolved.agenda.meetingInfo.language, resolved.agenda),
      loading: false
    });
  },

  /**
   * 方法是什么：装饰模板预览行。
   * 方法作用：提前生成限时、人员和俱乐部显示文本并兼容所有节点类型。
   * 为什么添加：WXML 中直接访问可选的普通人员、多人签到和备稿人员容易产生空路径。
   */
  decorateRows(rows, languageValue, agendaValue) {
    const language = languageValue === 'en' ? 'en' : 'zh';
    const sectionStartIds = new Set(((agendaValue && agendaValue.sections) || []).map((section) => section.type === 'row' && section.row ? section.row.id : section.id));
    return rows.map((row) => {
      const next = Object.assign({}, row);
      next.previewSectionStart = sectionStartIds.has(row.id);
      next.titleDisplay = language === 'en' ? (row.titleEn || row.titleZh) : row.titleZh;
      if (row.type === 'preparedSpeechBlock') {
        const pathway = row.pathway || {};
        const isOtherPathway = Boolean(pathway.isOther || pathway.code === 'OTHER');
        next.personDisplay = row.speaker && (language === 'en' ? row.speaker.displayNameEn : row.speaker.displayNameZh) || row.speaker && row.speaker.rawName || '';
        next.clubDisplay = row.speaker && (language === 'en' ? row.speaker.clubEn : row.speaker.clubZh) || '';
        next.projectDisplay = language === 'en' ? pathway.fullLabelEn || pathway.fullLabelZh : pathway.fullLabelZh;
        next.objectiveDisplay = language === 'en' ? pathway.objectiveEn || pathway.objectiveZh : pathway.objectiveZh;
        next.showProjectLine = Boolean(!isOtherPathway && next.projectDisplay);
      } else if (Array.isArray(row.persons) && row.persons.length) {
        next.personDisplay = row.persons.map((person) => language === 'en' ? person.displayNameEn || person.rawName : person.displayNameZh || person.rawName).filter(Boolean).join(' && ');
        next.clubDisplay = language === 'en' ? row.clubEn || row.persons.map((person) => person.clubEn).filter(Boolean).join(' && ') : row.clubZh || row.persons.map((person) => person.clubZh).filter(Boolean).join(' && ');
      } else {
        next.personDisplay = row.person && (language === 'en' ? row.person.displayNameEn || row.person.rawName : row.person.displayNameZh || row.person.rawName) || '';
        next.clubDisplay = language === 'en' ? row.clubEn || row.person && row.person.clubEn || '' : row.clubZh || row.person && row.person.clubZh || '';
      }
      next.durationDisplay = row.duration ? `${row.duration} ${language === 'en' ? 'min' : '分钟'}` : '';
      return next;
    });
  },

  /**
   * 方法是什么：解析云存储图片地址。
   * 方法作用：把模板和议程中的 cloud 文件 ID 转换为预览可显示的临时 URL。
   * 为什么添加：普通 image 控件不能直接可靠展示所有云存储标识。
   */
  async resolveCloudImages(resolved) {
    const templateAssets = resolved.template && resolved.template.assets ? resolved.template.assets : {};
    const agendaAssets = resolved.agenda && resolved.agenda.assets ? resolved.agenda.assets : {};
    const entries = Object.entries(Object.assign({}, templateAssets, { meetingGroupQr: agendaAssets.meetingGroupQr }));
    const cloudIds = entries.filter((entry) => String(entry[1] || '').startsWith('cloud://')).map((entry) => entry[1]);
    if (!cloudIds.length) {
      resolved.previewAssets = Object.assign({}, templateAssets, { meetingGroupQr: agendaAssets.meetingGroupQr });
      resolved.template.previewAssets = resolved.previewAssets;
      return;
    }
    const result = await wx.cloud.getTempFileURL({ fileList: cloudIds });
    const urlMap = {};
    (result.fileList || []).forEach((item) => { urlMap[item.fileID] = item.tempFileURL; });
    const previewAssets = {};
    entries.forEach((entry) => { previewAssets[entry[0]] = urlMap[entry[1]] || entry[1]; });
    resolved.template.previewAssets = previewAssets;
  },

  /**
   * 方法是什么：导出当前议程 PDF。
   * 方法作用：调用服务端模板渲染器并在小程序中打开生成文件。
   * 为什么添加：导出动作迁移到模板预览页后可以避免未经确认直接生成。
   */
  async exportPdf() {
    if (this.data.exporting) {
      return;
    }
    if (!this.data.agendaId) {
      wx.showToast({ title: '请先保存议程', icon: 'none' });
      return;
    }
    this.setData({ exporting: true });
    try {
      const data = await cloud.callCloud('exportAgendaPdf', { agendaId: this.data.agendaId });
      const download = await wx.cloud.downloadFile({ fileID: data.fileID });
      await wx.openDocument({ filePath: download.tempFilePath, fileType: 'pdf', showMenu: true });
    } catch (error) {
      cloud.showError(error);
    } finally {
      this.setData({ exporting: false });
    }
  }
});
