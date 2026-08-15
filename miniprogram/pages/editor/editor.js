const app = getApp();
const cloud = require('../../utils/cloud');
const agendaUtil = require('../../utils/agenda');

Page({
  data: {
    agenda: agendaUtil.createEmptyAgenda(),
    template: agendaUtil.createDefaultTemplate(),
    isAdmin: false,
    memberSelectorVisible: false,
    memberSelectorContext: null,
    memberSelectorSelectedId: '',
    loading: true,
    saving: false,
    previewing: false,
    memberLoading: false,
    memberLoadError: false,
    memberOptions: [],
    memberLabels: [],
    pathwayOptions: [],
    languageLabels: ['中文', 'English'],
    addModuleOptions: [],
    addModuleLabels: [],
    validationDialogVisible: false,
    validationErrors: [],
    validationRemaining: 0,
    signupData: null
  },

  /**
   * 方法是什么：加载 AgendaV2 编辑器。
   * 方法作用：并行读取模板、会员和 Pathways，再恢复当前草稿。
   * 为什么添加：字段权限、默认规则和下拉选项必须在议程规范化前准备完成。
   */
  async onLoad(options) {
    await app.login();
    this.setData({ isAdmin: app.isAdmin() });
    await Promise.all([this.loadTemplate(), this.loadMembers(), this.loadPathways()]);
    if (options && options.id) {
      await this.loadAgendaById(options.id);
    } else if (app.globalData.currentAgenda) {
      this.setAgenda(app.globalData.currentAgenda);
    } else {
      await this.loadCurrentAgenda();
    }
    this.setData({ loading: false });
  },

  /**
   * 方法是什么：同步编辑器身份状态。
   * 方法作用：从首页切换模拟超管后返回编辑器时重新装饰权限。
   * 为什么添加：页面栈保留期间全局模拟身份可能发生变化。
   */
  async onShow() {
    if (this.data.previewing) {
      this.setData({ previewing: false });
    }
    const isAdmin = app.isAdmin();
    if (isAdmin !== this.data.isAdmin) {
      this.setData({ isAdmin });
      this.setAgenda(this.data.agenda);
    }
    if (this.data.agenda && this.data.agenda.signupPublicId) {
      if (this.data.agenda._id) {
        await this.loadAgendaById(this.data.agenda._id);
      }
      await this.loadSignupData();
    }
  },

  async loadSignupData() {
    try {
      const signupData = await cloud.callCloud('signupService', { action: 'get', publicId: this.data.agenda.signupPublicId });
      this.setData({ signupData });
    } catch (error) {
      this.setData({ signupData: null });
    }
  },

  /**
   * 方法是什么：加载全局议程模板。
   * 方法作用：获取超管维护的固定规则和默认配置。
   * 为什么添加：编辑权限和时间计算不能继续依赖前端写死的旧模块。
   */
  async loadTemplate() {
    try {
      const data = await cloud.callCloud('agendaTemplate', { action: 'get' });
      this.setData({ template: data.template || agendaUtil.createDefaultTemplate() });
    } catch (error) {
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：加载会员选项。
   * 方法作用：为所有人员字段提供正式会员下拉选择。
   * 为什么添加：选择会员时需要自动填入姓名和广州双语俱乐部。
   */
  async loadMembers() {
    this.setData({ memberLoading: true, memberLoadError: false });
    try {
      const data = await cloud.callCloud('lookupOptions', { type: 'memberships', keyword: '' });
      const memberOptions = (data.list || []).map((member) => ({
        label: [member.nameZh, member.nameEn, member.nickName].filter(Boolean).join(' / '),
        member
      }));
      this.setData({
        memberOptions,
        memberLabels: memberOptions.map((option) => option.label || '未命名会员'),
        memberLoadError: false
      });
    } catch (error) {
      this.setData({ memberOptions: [], memberLabels: [], memberLoadError: true });
      cloud.showError(error);
    } finally {
      this.setData({ memberLoading: false });
    }
  },

  /**
   * 方法是什么：加载 Pathways 选项。
   * 方法作用：提供项目中文全名、目标描述和默认限时来源。
   * 为什么添加：备稿项目不能继续由会员手工录入不受控描述。
   */
  async loadPathways() {
    try {
      const data = await cloud.callCloud('lookupOptions', { type: 'pathways', keyword: '' });
      const pathwayOptions = (data.list || []).map((pathway) => ({
        label: pathway.fullLabelZh || pathway.code,
        pathway
      }));
      pathwayOptions.push({
        label: '其他',
        pathway: {
          code: 'OTHER',
          fullLabelZh: '其他',
          fullLabelEn: 'Other',
          objectiveZh: '',
          objectiveEn: '',
          isOther: true
        }
      });
      this.setData({ pathwayOptions });
    } catch (error) {
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：读取当前用户草稿。
   * 方法作用：在应用重启或全局状态缺失时恢复当前 AgendaV2。
   * 为什么添加：编辑流程不能依赖解析页始终留在页面栈中。
   */
  async loadCurrentAgenda() {
    try {
      const data = await cloud.callCloud('agendaQuery', { action: 'current' });
      this.setAgenda(data.agenda || agendaUtil.createEmptyAgenda());
    } catch (error) {
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：读取指定议程草稿。
   * 方法作用：兼容携带议程 ID 的旧入口。
   * 为什么添加：已存在的页面链接仍需能够打开并自动升级旧数据。
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
   * 方法是什么：设置并装饰议程状态。
   * 方法作用：规范化时间链、同步点评、匹配 picker 下标并计算可编辑状态。
   * 为什么添加：所有事件处理后都必须回到同一个稳定视图模型。
   */
  setAgenda(value) {
    const agenda = agendaUtil.normalizeAgenda(value, this.data.template);
    this.decorateAgenda(agenda);
    const addModuleOptions = this.getAvailableModules(agenda);
    const preparation = agenda.sections.find((section) => section.id === 'preparation');
    const mmMemberIndex = preparation && preparation.row && preparation.row.person ? preparation.row.person.memberIndex : -1;
    app.setCurrentAgenda(agenda);
    this.setData({ agenda, mmMemberIndex, addModuleOptions, addModuleLabels: addModuleOptions.map((item) => item.label) });
  },

  /**
   * 方法是什么：装饰编辑器视图字段。
   * 方法作用：为人员选择下标、字段权限和 Pathways 下标生成页面专用值。
   * 为什么添加：WXML 不能调用权限函数或在模板中执行复杂查找。
   */
  decorateAgenda(agenda) {
    const language = agendaUtil.normalizeLanguage(agenda.meetingInfo && agenda.meetingInfo.language);
    const groupTitles = {
      opening: 'Opening', facilitatorIntroduction: 'Meeting Facilitator Introductions', tableTopics: 'Table Topics', preparedSpeech: 'Prepared Speeches', evaluation: 'Prepared Speech Evaluations', facilitatorReport: 'Meeting Facilitator Reports', closing: 'Closing', end: 'Meeting Adjourned'
    };
    const decorateRow = (row) => {
      if (!row) {
        return;
      }
      row.canEditTitle = this.data.isAdmin || Boolean(row.permissions && row.permissions.memberTitle);
      row.canEditDuration = this.data.isAdmin || Boolean(row.permissions && row.permissions.memberDuration);
      row.canEditPerson = this.data.isAdmin || Boolean(row.permissions && row.permissions.memberPerson);
      row.canEditClub = this.data.isAdmin || Boolean(row.permissions && row.permissions.memberClub);
      row.displayTitle = language === 'en' ? (row.titleEn || row.titleZh) : row.titleZh;
      if (row.id === 'topicExplanation' && language === 'zh') {
        row.displayTitle = '即兴主持人';
      }
      if (row.id === 'tableTopicsSpeech' && language === 'zh') {
        row.displayTitle = '即兴演讲时间';
      }
      row.person = this.decoratePerson(row.person);
      if (row.id === 'openingIcebreaker') {
        row.canEditPerson = true;
        row.person.inputMode = 'select';
      }
      if (row.id === 'openingRemarks') {
        row.canEditPerson = true;
        row.person.inputMode = 'select';
      }
      row.persons = (row.persons || []).map((person) => this.decoratePerson(person));
      if (row.type === 'preparedSpeechBlock') {
        row.speaker = this.decoratePerson(row.speaker);
        row.evaluator = this.decoratePerson(row.evaluator);
        row.pathwayIndex = this.data.pathwayOptions.findIndex((option) => option.pathway._id === row.pathway._id || option.pathway.code === row.pathway.code);
      }
    };
    agenda.sections.forEach((section) => {
      section.displayTitle = language === 'en' ? (section.titleEn || groupTitles[section.id] || section.titleZh || section.row && section.row.titleEn) : (section.titleZh || section.row && section.row.titleZh);
      decorateRow(section.row);
      (section.children || []).forEach(decorateRow);
    });
    const visibleSections = agenda.sections.filter((section) => section.enabled !== false && (!section.languageGate || section.languageGate === language));
    visibleSections.forEach((section, index) => {
      const previous = index > 0 ? visibleSections[index - 1] : null;
      section.positionAfterLabel = previous ? (previous.displayTitle || previous.row && previous.row.displayTitle || '') : '';
      const sourceIndex = agenda.sections.findIndex((item) => item.id === section.id);
      const firstMovableIndex = agenda.sections.findIndex((item) => item.id === 'facilitatorIntroduction') + 1;
      const endIndex = agenda.sections.findIndex((item) => item.id === 'end');
      section.canMoveUp = sourceIndex > firstMovableIndex;
      section.canMoveDown = sourceIndex >= firstMovableIndex && sourceIndex < endIndex - 1;
    });
    agenda.sections.forEach((section) => {
      (section.children || []).forEach((row, index) => {
        if (row.dynamic) {
          const previous = index > 0 ? section.children[index - 1] : null;
          row.positionAfterLabel = previous ? previous.displayTitle : section.displayTitle;
        }
      });
    });
  },

  /**
   * 方法是什么：计算当前可新增的每期模块。
   * 方法作用：过滤已存在模块，并仅在英文会议提供 Free Talk。
   * 为什么添加：每种动态模块每期最多一个，新增菜单必须随议程状态即时变化。
   */
  getAvailableModules(agenda) {
    const language = agendaUtil.normalizeLanguage(agenda.meetingInfo && agenda.meetingInfo.language);
    const existing = new Set();
    (agenda.sections || []).forEach((section) => {
      if (section.moduleKind) {
        existing.add(section.moduleKind);
      }
      (section.children || []).forEach((row) => {
        if (row.moduleKind) {
          existing.add(row.moduleKind);
        }
      });
    });
    const labels = {
      icebreaker: language === 'en' ? 'Icebreaker' : '破冰',
      freeTalk: 'Free Talk',
      workshop: language === 'en' ? 'Workshop' : '工作坊',
      educationAward: language === 'en' ? 'Education Credit Awards' : '教育积分颁奖',
      memberInterview: language === 'en' ? 'New Member Interview' : '新会员面试'
    };
    return Object.keys(agendaUtil.DYNAMIC_MODULES).filter((kind) => !existing.has(kind) && (kind !== 'freeTalk' || language === 'en')).map((kind) => ({ kind, label: labels[kind] }));
  },

  /**
   * 方法是什么：装饰单个人员。
   * 方法作用：把 memberId 映射到会员 picker 下标并补齐输入模式。
   * 为什么添加：数据库保存稳定 ID，而微信 picker 使用数组索引。
   */
  decoratePerson(personValue) {
    const person = agendaUtil.createPerson(personValue);
    person.memberIndex = this.data.memberOptions.findIndex((option) => option.member._id === person.memberId);
    if (person.memberIndex >= 0) {
      const member = this.data.memberOptions[person.memberIndex].member;
      Object.assign(person, {
        educationAwards: member.educationAwards || '',
        educationProgress: member.educationProgress || '',
        pathNameZh: member.pathNameZh || '',
        pathNameEn: member.pathNameEn || '',
        officerTitleZh: member.officerTitleZh || '',
        officerTitleEn: member.officerTitleEn || ''
      });
    }
    return person;
  },

  /**
   * 方法是什么：读取事件对应的流程行。
   * 方法作用：统一定位顶层行、模块内行和备稿演讲块。
   * 为什么添加：人员、标题和时长控件需要复用同一组事件处理器。
   */
  getRowTarget(agenda, dataset) {
    const section = agenda.sections[Number(dataset.sectionIndex)];
    if (!section) {
      return null;
    }
    return dataset.scope === 'section' ? section.row : section.children[Number(dataset.childIndex)];
  },

  /**
   * 方法是什么：读取事件对应的人员对象。
   * 方法作用：定位普通行、多人签到、演讲者或点评者人员字段。
   * 为什么添加：统一人员控件需要覆盖多种 AgendaV2 节点形态。
   */
  getPersonTarget(agenda, dataset) {
    const row = this.getRowTarget(agenda, dataset);
    if (!row) {
      return null;
    }
    if (dataset.personField === 'speaker' || dataset.personField === 'evaluator') {
      return row[dataset.personField];
    }
    if (dataset.personField === 'multi') {
      return row.persons[Number(dataset.personIndex)];
    }
    return row.person;
  },

  /**
   * 方法是什么：判断行字段是否允许修改。
   * 方法作用：在事件处理层阻止普通会员绕过 disabled 属性修改锁定数据。
   * 为什么添加：只做界面置灰不足以表达可靠的前端权限边界。
   */
  canEditRow(row, field) {
    if (this.data.isAdmin) {
      return true;
    }
    if (row && row.id === 'openingIcebreaker' && field === 'person') {
      return true;
    }
    const map = { titleZh: 'memberTitle', titleEn: 'memberTitle', duration: 'memberDuration', person: 'memberPerson', club: 'memberClub' };
    return Boolean(row && row.permissions && row.permissions[map[field]]);
  },

  /**
   * 方法是什么：修改所有会员可维护的会议基础信息。
   * 方法作用：接受会议期数、日期和主题并立即更新当前议程。
   * 为什么添加：取消接龙解析后，组织者必须能直接维护完整基础信息。
   */
  handleBasicInfoInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!['meetingNo', 'date', 'theme'].includes(field)) {
      return;
    }
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    agenda.meetingInfo[field] = event.detail.value;
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：处理基础信息中的日期选择。
   * 方法作用：把微信日期选择器返回的 YYYY-MM-DD 写入会议日期。
   * 为什么添加：日期应使用标准选择组件，避免手工输入格式错误。
   */
  handleDateChange(event) {
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    agenda.meetingInfo.date = event.detail.value;
    const selected = new Date(`${event.detail.value}T00:00:00`);
    agenda.meetingInfo.weekday = Number.isNaN(selected.getTime()) ? '' : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][selected.getDay()];
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：选择本期会议经理 MM。
   * 方法作用：把会员库中的完整人员资料写入 preparation 的 meetingManager 人员位。
   * 为什么添加：报名页会议信息需要显示与正式议程一致的 MM。
   */
  chooseMeetingManager(event) {
    const option = this.data.memberOptions[Number(event.detail.value)];
    if (!option) return;
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    const preparation = agenda.sections.find((section) => section.id === 'preparation');
    if (!preparation || !preparation.row) return;
    const member = option.member;
    preparation.row.person = Object.assign({}, preparation.row.person || {}, {
      rawName: member.nameZh || member.nameEn || member.nickName || '',
      memberId: member._id,
      displayNameZh: member.nameZh || member.nameEn || '',
      displayNameEn: member.nameEn || member.nameZh || '',
      educationAwards: member.educationAwards || '',
      educationProgress: member.educationProgress || '',
      pathNameZh: member.pathNameZh || '',
      pathNameEn: member.pathNameEn || '',
      officerTitleZh: member.officerTitleZh || '',
      officerTitleEn: member.officerTitleEn || '',
      clubZh: '广州双语',
      clubEn: 'Bilingual',
      inputMode: 'select',
      unresolved: false
    });
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：修改本期会议最佳结果。
   * 方法作用：保存最佳备稿、即兴、角色和点评四项文本。
   * 为什么添加：会议结果需要随议程草稿一并保存，供后续流程使用。
   */
  handleBestAwardInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!['preparedSpeech', 'tableTopics', 'role', 'evaluator'].includes(field)) {
      return;
    }
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    agenda.bestAwards = Object.assign({ preparedSpeech: '', tableTopics: '', role: '', evaluator: '' }, agenda.bestAwards || {});
    agenda.bestAwards[field] = event.detail.value;
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：修改只读会议信息。
   * 方法作用：仅允许模拟超管校正编号、日期、主题、时间和地址。
   * 为什么添加：普通会员必须保留解析结果，不能修改页眉字段。
   */
  handleMeetingInput(event) {
    if (!this.data.isAdmin) {
      return;
    }
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    agenda.meetingInfo[event.currentTarget.dataset.field] = event.detail.value;
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：修正当前会议使用的模板语言。
   * 方法作用：允许组织者在中文和英文之间切换并重新计算语言门控模块。
   * 为什么添加：会议语言属于每期基础信息，不再依赖接龙识别或超管修改。
   */
  handleLanguageChange(event) {
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    agenda.meetingInfo.language = Number(event.detail.value) === 1 ? 'en' : 'zh';
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：修改议程普通字段。
   * 方法作用：按字段权限更新标题或数字时长并重新计算时间链。
   * 为什么添加：会员与超管对同一行拥有不同的可编辑范围。
   */
  handleRowInput(event) {
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    const row = this.getRowTarget(agenda, event.currentTarget.dataset);
    const field = event.currentTarget.dataset.field;
    if (!row || !this.canEditRow(row, field)) {
      return;
    }
    row[field] = field === 'duration' ? Math.max(Number(event.detail.value) || 0, 0) : event.detail.value;
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：切换人员输入模式。
   * 方法作用：在会员下拉选择和手动姓名输入之间切换按钮文案与控件。
   * 为什么添加：所有可编辑演讲者都必须同时支持正式会员和临时来宾。
   */
  togglePersonMode(event) {
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    const row = this.getRowTarget(agenda, event.currentTarget.dataset);
    const person = this.getPersonTarget(agenda, event.currentTarget.dataset);
    if (!row || !person || !this.canEditRow(row, 'person')) {
      return;
    }
    const nextMode = person.inputMode === 'select' ? 'input' : 'select';
    person.inputMode = nextMode;
    if (nextMode === 'input') {
      person.memberId = '';
      person.memberIndex = -1;
      person.clubZh = '';
      person.clubEn = '';
    }
    this.setAgenda(agenda);
  },

  openMemberSelector(event) {
    const dataset = Object.assign({}, event.currentTarget.dataset);
    const selectedId = dataset.selectorKind === 'mm'
      ? (this.data.memberOptions[this.data.mmMemberIndex] && this.data.memberOptions[this.data.mmMemberIndex].member._id || '')
      : (dataset.memberId || '');
    this.setData({ memberSelectorVisible: true, memberSelectorContext: dataset, memberSelectorSelectedId: selectedId });
  },

  closeMemberSelector() {
    this.setData({ memberSelectorVisible: false, memberSelectorContext: null });
  },

  confirmMemberSelector(event) {
    const member = event.detail.member;
    const index = this.data.memberOptions.findIndex((option) => option.member._id === member._id);
    const context = this.data.memberSelectorContext || {};
    this.closeMemberSelector();
    if (index < 0) return;
    if (context.selectorKind === 'mm') {
      this.chooseMeetingManager({ detail: { value: index } });
      return;
    }
    this.chooseMember({ detail: { value: index }, currentTarget: { dataset: context } });
  },

  /**
   * 方法是什么：选择正式会员。
   * 方法作用：写入会员 ID、中英文名并自动锁定广州双语俱乐部。
   * 为什么添加：下拉选择必须和手动输入产生可区分的数据来源。
   */
  chooseMember(event) {
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    const row = this.getRowTarget(agenda, event.currentTarget.dataset);
    const target = this.getPersonTarget(agenda, event.currentTarget.dataset);
    const option = this.data.memberOptions[Number(event.detail.value)];
    if (!row || !target || !option || !this.canEditRow(row, 'person')) {
      return;
    }
    const member = option.member;
    Object.assign(target, {
      rawName: member.nameZh || member.nameEn || member.nickName || '',
      memberId: member._id,
      displayNameZh: member.nameZh || member.nameEn || '',
      displayNameEn: member.nameEn || member.nameZh || '',
      educationAwards: member.educationAwards || '',
      educationProgress: member.educationProgress || '',
      pathNameZh: member.pathNameZh || '',
      pathNameEn: member.pathNameEn || '',
      officerTitleZh: member.officerTitleZh || '',
      officerTitleEn: member.officerTitleEn || '',
      clubZh: '广州双语',
      clubEn: 'Bilingual',
      inputMode: 'select',
      unresolved: false
    });
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：手动输入人员或俱乐部。
   * 方法作用：清除会员绑定并允许临时姓名配套自定义俱乐部。
   * 为什么添加：宾客和外部演讲者可能不在 Membership 数据中。
   */
  handlePersonInput(event) {
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    const row = this.getRowTarget(agenda, event.currentTarget.dataset);
    const person = this.getPersonTarget(agenda, event.currentTarget.dataset);
    const field = event.currentTarget.dataset.field;
    if (!row || !person || !this.canEditRow(row, field === 'clubZh' || field === 'clubEn' ? 'club' : 'person')) {
      return;
    }
    person[field] = event.detail.value;
    if (field === 'rawName') {
      person.memberId = '';
      person.memberIndex = -1;
      person.displayNameZh = event.detail.value;
      person.displayNameEn = event.detail.value;
      person.inputMode = 'input';
      person.unresolved = false;
    }
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：选择备稿 Pathways 项目。
   * 方法作用：填入项目全名、目标描述并从描述区间上限更新默认时长。
   * 为什么添加：项目数据和演讲限时必须保持数据库来源一致。
   */
  choosePathway(event) {
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    const block = this.getRowTarget(agenda, event.currentTarget.dataset);
    const option = this.data.pathwayOptions[Number(event.detail.value)];
    if (!block || !option) {
      return;
    }
    block.pathway = agendaUtil.cloneJson(option.pathway);
    block.duration = agendaUtil.parsePathwayDuration(block.pathway.objectiveZh || block.pathway.fullLabelZh, this.data.template.settings.preparedFallbackDuration);
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：填写“其他”Pathways 的自定义项目描述。
   * 方法作用：按当前会议语言更新备稿块的目标描述并保留其他项目标识。
   * 为什么添加：选择其他项目时没有数据库项目名称，模板只需显示用户填写的描述。
   */
  handleOtherPathwayInput(event) {
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    const block = this.getRowTarget(agenda, event.currentTarget.dataset);
    if (!block || !block.pathway || !(block.pathway.isOther || block.pathway.code === 'OTHER')) {
      return;
    }
    const field = agenda.meetingInfo.language === 'en' ? 'objectiveEn' : 'objectiveZh';
    block.pathway[field] = event.detail.value;
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：新增备稿演讲块。
   * 方法作用：在备稿模块尾部创建可编辑的七分钟空演讲并同步点评。
   * 为什么添加：会员需要按实际报名数量增加备稿小模块。
   */
  addPreparedBlock() {
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    const section = agenda.sections.find((item) => item.id === 'preparedSpeech');
    section.children.push(agendaUtil.createEmptyPreparedBlock(section.children.length, this.data.template));
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：移动备稿演讲块。
   * 方法作用：在模块内部按按钮方向调整整组演讲、项目和点评者。
   * 为什么添加：演讲顺序变化时点评模块必须跟随同一块顺序更新。
   */
  movePreparedBlock(event) {
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    const section = agenda.sections.find((item) => item.id === 'preparedSpeech');
    const index = Number(event.currentTarget.dataset.childIndex);
    section.children = agendaUtil.moveItem(section.children, index, index + Number(event.currentTarget.dataset.direction));
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：删除备稿演讲块。
   * 方法作用：移除整组演讲数据并自动删除对应派生点评。
   * 为什么添加：报名取消时不能遗留孤立的点评行。
   */
  async deletePreparedBlock(event) {
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    const section = agenda.sections.find((item) => item.id === 'preparedSpeech');
    const index = Number(event.currentTarget.dataset.childIndex);
    const block = section.children[index];
    const slotIds = block ? [`prepared:${block.id}:speaker`, `prepared:${block.id}:evaluator`] : [];
    if (!(await this.confirmAndCancelSlots(slotIds, '该备稿已有报名，删除后将同时取消演讲者和点评师报名。确认删除吗？'))) return;
    section.children.splice(index, 1);
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：新增当前议程的动态模块。
   * 方法作用：按模块菜单选择执行唯一性检查和规定位置插入。
   * 为什么添加：工作坊、Free Talk 等内容属于每期议程，不能加入全局模板结构。
   */
  addDynamicModule(event) {
    const option = this.data.addModuleOptions[Number(event.detail.value)];
    if (!option) {
      return;
    }
    this.setAgenda(agendaUtil.addDynamicModule(this.data.agenda, option.kind));
  },

  /**
   * 方法是什么：删除动态模块。
   * 方法作用：支持删除顶层动态模块或会议促进者介绍中的动态破冰。
   * 为什么添加：动态模块必须可撤销且删除后重新出现在新增菜单中。
   */
  async deleteDynamicModule(event) {
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    const dataset = event.currentTarget.dataset;
    const section = agenda.sections[Number(dataset.sectionIndex)];
    if (!section) {
      return;
    }
    if (dataset.childIndex !== undefined && dataset.childIndex !== '') {
      const child = section.children[Number(dataset.childIndex)];
      if (child && child.dynamic) {
        if (!(await this.confirmAndCancelSlots([`dynamic:${child.id}`], '该模块已有报名，删除后将同时取消报名。确认删除吗？'))) return;
        section.children.splice(Number(dataset.childIndex), 1);
      }
    } else if (section.dynamic && section.deletable) {
      if (!(await this.confirmAndCancelSlots([`dynamic:${section.row && section.row.id}`], '该模块已有报名，删除后将同时取消报名。确认删除吗？'))) return;
      agenda.sections.splice(Number(dataset.sectionIndex), 1);
    }
    this.setAgenda(agenda);
  },

  async confirmAndCancelSlots(slotIds, message) {
    if (!this.data.signupData || !this.data.agenda.signupPublicId) return true;
    const occupied = (this.data.signupData.slots || []).filter((slot) => slotIds.includes(slot.id) && slot.occupied);
    if (!occupied.length) return true;
    const confirmed = await new Promise((resolve) => wx.showModal({ title: '确认删除', content: message, confirmColor: '#b91c1c', success: (res) => resolve(Boolean(res.confirm)), fail: () => resolve(false) }));
    if (!confirmed) return false;
    try {
      for (const slot of occupied) {
        await cloud.callCloud('signupService', { action: 'cancelSlot', publicId: this.data.agenda.signupPublicId, slotId: slot.id });
      }
      await this.loadSignupData();
      return true;
    } catch (error) { cloud.showError(error); return false; }
  },

  /**
   * 方法是什么：移动可排序的顶层模块。
   * 方法作用：允许中场休息及指定动态模块在主流程范围内逐项上移或下移。
   * 为什么添加：模块位置变化必须直接改变 AgendaV2 顺序并触发时间重算。
   */
  moveAgendaSection(event) {
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    const index = Number(event.currentTarget.dataset.sectionIndex);
    const direction = Number(event.currentTarget.dataset.direction);
    const section = agenda.sections[index];
    const firstMovableIndex = agenda.sections.findIndex((item) => item.id === 'facilitatorIntroduction') + 1;
    const endIndex = agenda.sections.findIndex((item) => item.id === 'end');
    const target = index + direction;
    const movable = section && (section.id === 'break' || section.dynamic && section.movable);
    if (!movable || target < firstMovableIndex || target >= endIndex) {
      return;
    }
    agenda.sections = agendaUtil.moveItem(agenda.sections, index, target);
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：替换例会群二维码。
   * 方法作用：选择图片、上传云存储并写入当前议程动态素材。
   * 为什么添加：截图红框中的例会群二维码属于普通会员可维护基础信息。
   */
  async chooseMeetingGroupQr() {
    try {
      const media = await wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'] });
      const file = media.tempFiles && media.tempFiles[0];
      if (!file) {
        return;
      }
      const extension = String(file.tempFilePath).split('.').pop() || 'png';
      const upload = await wx.cloud.uploadFile({ cloudPath: `agenda-assets/meeting-group-${Date.now()}.${extension}`, filePath: file.tempFilePath });
      const agenda = agendaUtil.cloneJson(this.data.agenda);
      agenda.assets.meetingGroupQr = upload.fileID;
      this.setAgenda(agenda);
    } catch (error) {
      if (!String(error && error.errMsg || '').includes('cancel')) {
        cloud.showError(error);
      }
    }
  },

  /**
   * 方法是什么：保存 AgendaV2 草稿。
   * 方法作用：提交服务端规范化结果并同步现有报名槽位。
   * 为什么添加：预览和 PDF 必须使用数据库中的最新议程。
   */
  async saveAgenda(options) {
    const manageSaving = !(options && options.manageSaving === false);
    if (manageSaving) {
      this.setData({ saving: true });
    }
    try {
      const data = await cloud.callCloud('saveAgenda', { agenda: this.data.agenda });
      const savedAgenda = data.agenda;
      app.setCurrentAgenda(savedAgenda);
      this.setData({
        'agenda._id': savedAgenda._id || '',
        'agenda.signupPublicId': savedAgenda.signupPublicId || '',
        'agenda.signupSlots': savedAgenda.signupSlots || []
      });
      if (!(options && options.silent)) {
        cloud.showSuccess('已保存');
      }
      return savedAgenda;
    } catch (error) {
      cloud.showError(error);
      return null;
    } finally {
      if (manageSaving) {
        this.setData({ saving: false });
      }
    }
  },

  async openSignupPage() {
    const agenda = await this.saveAgenda({ silent: true });
    if (!agenda) return;
    try {
      const data = await cloud.callCloud('signupService', { action: 'create', agendaId: agenda._id });
      this.setData({ signupData: data, 'agenda.signupPublicId': data.publicId, 'agenda.signupSlots': data.slots });
      wx.navigateTo({ url: `/pages/signup/signup?publicId=${data.publicId}` });
    } catch (error) { cloud.showError(error); }
  },

  cancelManagedSlot(event) {
    const slotId = event.currentTarget.dataset.slotId;
    wx.showModal({ title: '取消角色', content: '确认清空该角色报名并释放名额吗？', success: async (res) => {
      if (!res.confirm) return;
      try {
        const data = await cloud.callCloud('signupService', { action: 'cancelSlot', publicId: this.data.agenda.signupPublicId, slotId });
        this.setData({ signupData: data });
        await this.loadAgendaById(this.data.agenda._id);
        cloud.showSuccess('已取消');
      } catch (error) { cloud.showError(error); }
    } });
  },

  resetMeeting() {
    wx.showModal({ title: '重置当前会议', content: '将清空本期议程和全部报名，原报名链接立即失效。此操作不可撤销。', confirmColor: '#b91c1c', success: async (res) => {
      if (!res.confirm) return;
      try {
        const data = await cloud.callCloud('signupService', { action: 'reset', agendaId: this.data.agenda._id });
        this.setData({ signupData: null });
        this.setAgenda(data.agenda);
        cloud.showSuccess('会议已重置');
      } catch (error) { cloud.showError(error); }
    } });
  },

  noop() {},

  /**
   * 方法是什么：先保存议程，再执行 PDF 预览流程。
   * 方法作用：保存当前表单后校验服务端结果，再调用正式 PDF 云函数并打开微信文档页。
   * 为什么添加：预览必须基于刚保存的数据库版本，且保存提示与独立保存操作保持一致。
   */
  async goPreview() {
    if (this.data.saving || this.data.previewing) {
      return;
    }
    this.setData({ previewing: true });
    try {
      const agenda = await this.saveAgenda({ manageSaving: false });
      if (!agenda || !agenda._id) {
        return;
      }
      const validationErrors = agendaUtil.validateAgendaForPreview(agenda);
      if (validationErrors.length) {
        const visibleErrors = validationErrors.slice(0, 6);
        const remaining = validationErrors.length - visibleErrors.length;
        this.setData({
          validationDialogVisible: true,
          validationErrors: visibleErrors,
          validationRemaining: remaining
        });
        return;
      }
      const data = await cloud.callCloud('exportAgendaPdf', { agendaId: agenda._id });
      const download = await wx.cloud.downloadFile({ fileID: data.fileID });
      let filePath = download.tempFilePath;
      if (data.fileName && wx.env && wx.env.USER_DATA_PATH) {
        const fileSystem = wx.getFileSystemManager();
        const previewDirectory = `${wx.env.USER_DATA_PATH}/agenda-preview-${Date.now()}`;
        await new Promise((resolve, reject) => {
          fileSystem.mkdir({
            dirPath: previewDirectory,
            recursive: true,
            success: resolve,
            fail: reject
          });
        });
        filePath = `${previewDirectory}/${data.fileName}`;
        await new Promise((resolve, reject) => {
          fileSystem.copyFile({
            srcPath: download.tempFilePath,
            destPath: filePath,
            success: resolve,
            fail: reject
          });
        });
      }
      await wx.openDocument({
        filePath,
        fileType: 'pdf',
        showMenu: true
      });
    } catch (error) {
      cloud.showError(error);
    } finally {
      this.setData({ previewing: false });
    }
  },

  /**
   * 方法是什么：关闭议程校验错误弹窗。
   * 方法作用：隐藏逐行错误列表并清除上一次校验结果。
   * 为什么添加：自定义弹窗需要由页面显式维护显示状态，避免系统弹窗折叠换行。
   */
  dismissValidationDialog() {
    this.setData({
      validationDialogVisible: false,
      validationErrors: [],
      validationRemaining: 0
    });
  }
});
