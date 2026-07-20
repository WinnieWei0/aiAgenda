const app = getApp();
const cloud = require('../../utils/cloud');
const agendaUtil = require('../../utils/agenda');

Page({
  data: {
    loading: true,
    saving: false,
    tab: 'page1',
    activeLocale: 'zh',
    template: agendaUtil.createDefaultTemplate(),
    textFields: {}
  },

  /**
   * 方法是什么：加载模拟超管模板编辑器。
   * 方法作用：校验本地模式并读取当前全局模板。
   * 为什么添加：普通会员不能进入固定内容和议程规则维护界面。
   */
  async onLoad() {
    if (!app.isSuperAdminMode()) {
      wx.showToast({ title: '请先在首页进入超管模式', icon: 'none' });
      wx.navigateBack();
      return;
    }
    try {
      const data = await cloud.callCloud('agendaTemplate', { action: 'get' });
      const template = agendaUtil.normalizeTemplate(data.template);
      this.setData({ template, textFields: this.buildTextFields(template, 'zh'), loading: false });
    } catch (error) {
      this.setData({ loading: false });
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：构建数组字段的文本表示。
   * 方法作用：把列表和计时表转换成 textarea 可编辑的换行文本。
   * 为什么添加：小程序原生表单不适合逐项维护大量固定文案。
   */
  buildTextFields(template, localeKey) {
    const locale = template.locales[localeKey || this.data.activeLocale || 'zh'];
    return {
      winners: (locale.sidebar.winners || []).map((item) => `${item.label}|${item.value}`).join('\n'),
      timerRules: (locale.timerRules || []).map((row) => row.join('|')).join('\n'),
      pathways: (locale.page2.pathways || []).join('\n'),
      achievements: (locale.page2.achievements || []).join('\n'),
      meetingFlow: (locale.page2.meetingFlow || []).join('\n'),
      benefits: (locale.page2.benefits || []).join('\n')
    };
  },

  /**
   * 方法是什么：切换模板编辑视图。
   * 方法作用：在第一页固定内容、议程规则和第二页资料之间切换。
   * 为什么添加：模板字段较多，需要按职责分组避免形成超长混杂表单。
   */
  switchTab(event) {
    this.setData({ tab: event.currentTarget.dataset.tab });
  },

  /**
   * 方法是什么：切换模板文案语言。
   * 方法作用：在同一模板记录的中文和英文 locale 之间切换编辑状态。
   * 为什么添加：两套文案共用规则和素材，但必须能够分别维护。
   */
  switchLocale(event) {
    const activeLocale = event.currentTarget.dataset.locale === 'en' ? 'en' : 'zh';
    this.setData({ activeLocale, textFields: this.buildTextFields(this.data.template, activeLocale) });
  },

  /**
   * 方法是什么：修改模板对象字段。
   * 方法作用：按 group 和 field 更新固定文案、设置或第二页字符串。
   * 为什么添加：大量文本输入可以共用安全的嵌套对象更新逻辑。
   */
  handleTemplateInput(event) {
    const template = agendaUtil.cloneJson(this.data.template);
    const group = event.currentTarget.dataset.group;
    const field = event.currentTarget.dataset.field;
    const locale = template.locales[this.data.activeLocale];
    locale[group] = locale[group] || {};
    locale[group][field] = event.detail.value;
    this.setData({ template });
  },

  /**
   * 方法是什么：修改模板共享设置。
   * 方法作用：更新中英文模板共同使用的签到和主流程时间锚点。
   * 为什么添加：时间规则不属于任一语言文案，不能写入 locale。
   */
  handleSharedTemplateInput(event) {
    const template = agendaUtil.cloneJson(this.data.template);
    const group = event.currentTarget.dataset.group;
    template[group] = template[group] || {};
    template[group][event.currentTarget.dataset.field] = event.detail.value;
    this.setData({ template });
  },

  /**
   * 方法是什么：修改模板列表文本。
   * 方法作用：保存 textarea 状态并同步转换获奖、计时或第二页数组。
   * 为什么添加：列表数据保存前必须恢复为结构化数组供预览和 PDF 使用。
   */
  handleTextListInput(event) {
    const key = event.currentTarget.dataset.key;
    const textFields = Object.assign({}, this.data.textFields, { [key]: event.detail.value });
    const template = agendaUtil.cloneJson(this.data.template);
    const lines = event.detail.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    if (key === 'winners') {
      template.locales[this.data.activeLocale].sidebar.winners = lines.map((line) => {
        const parts = line.split('|');
        return { label: parts[0] || '', value: parts.slice(1).join('|') || '' };
      });
    } else if (key === 'timerRules') {
      template.locales[this.data.activeLocale].timerRules = lines.map((line) => line.split('|'));
    } else {
      template.locales[this.data.activeLocale].page2[key] = lines;
    }
    this.setData({ textFields, template });
  },

  /**
   * 方法是什么：修改议程规则字段。
   * 方法作用：更新标题、默认时长和普通会员字段权限。
   * 为什么添加：模拟超管需要在不改代码的情况下维护基础信息边界。
   */
  handleRuleInput(event) {
    const template = agendaUtil.cloneJson(this.data.template);
    const rule = template.agendaRules[Number(event.currentTarget.dataset.index)];
    const field = event.currentTarget.dataset.field;
    if (field === 'duration') {
      rule[field] = Math.max(Number(event.detail.value) || 0, 0);
    } else if (field.startsWith('member')) {
      rule[field] = Boolean(event.detail.value.length);
    } else {
      rule[field] = event.detail.value;
    }
    this.setData({ template });
  },

  /**
   * 方法是什么：切换特别主题环节。
   * 方法作用：控制该可选环节是否出现在所有当前议程预览和导出中。
   * 为什么添加：样例包含特别主题，但标准议程需要允许超管全局停用。
   */
  toggleSpecialSession(event) {
    const template = agendaUtil.cloneJson(this.data.template);
    template.settings.specialSessionEnabled = Boolean(event.detail.value);
    this.setData({ template });
  },

  /**
   * 方法是什么：修改干事表字段。
   * 方法作用：维护第二页角色、姓名、电话和微信，并同步会长默认人员。
   * 为什么添加：干事信息会定期换届且会长还被开场和尾声环节引用。
   */
  handleOfficerInput(event) {
    const template = agendaUtil.cloneJson(this.data.template);
    const officer = template.locales[this.data.activeLocale].page2.officers[Number(event.currentTarget.dataset.index)];
    officer[event.currentTarget.dataset.field] = event.detail.value;
    this.setData({ template });
  },

  /**
   * 方法是什么：替换模板图片素材。
   * 方法作用：选择图片并将 Logo、固定二维码或教育体系图上传云存储。
   * 为什么添加：固定素材属于模拟超管可维护模板内容。
   */
  async replaceAsset(event) {
    try {
      const field = event.currentTarget.dataset.field;
      const media = await wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'] });
      const file = media.tempFiles && media.tempFiles[0];
      if (!file) {
        return;
      }
      const extension = String(file.tempFilePath).split('.').pop() || 'png';
      const upload = await wx.cloud.uploadFile({ cloudPath: `template-assets/${field}-${Date.now()}.${extension}`, filePath: file.tempFilePath });
      const template = agendaUtil.cloneJson(this.data.template);
      template.assets[field] = upload.fileID;
      this.setData({ template });
    } catch (error) {
      if (!String(error && error.errMsg || '').includes('cancel')) {
        cloud.showError(error);
      }
    }
  },

  /**
   * 方法是什么：保存全局模板。
   * 方法作用：提交固定内容、素材、规则和第二页资料到模板单例。
   * 为什么添加：所有当前草稿的预览和导出需要立即使用超管最新修改。
   */
  async saveTemplate() {
    this.setData({ saving: true });
    try {
      const data = await cloud.callCloud('agendaTemplate', { action: 'save', template: this.data.template });
      const template = agendaUtil.normalizeTemplate(data.template);
      this.setData({ template, textFields: this.buildTextFields(template, this.data.activeLocale) });
      cloud.showSuccess('模板已保存');
      return true;
    } catch (error) {
      cloud.showError(error);
      return false;
    } finally {
      this.setData({ saving: false });
    }
  },

  /**
   * 方法是什么：保存模板后打开预览。
   * 方法作用：使用当前草稿检查模板修改后的两页实际效果。
   * 为什么添加：固定内容变化后必须在导出前完成可视化确认。
   */
  async previewTemplate() {
    const saved = await this.saveTemplate();
    if (!saved) {
      return;
    }
    const agenda = app.globalData.currentAgenda;
    const query = agenda && agenda._id ? `?id=${agenda._id}` : '';
    wx.navigateTo({ url: `/pages/template-preview/template-preview${query}` });
  }
});
