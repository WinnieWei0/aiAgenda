const app = getApp();
const cloud = require('../../utils/cloud');
const agendaUtil = require('../../utils/agenda');

Page({
  data: {
    agenda: agendaUtil.createEmptyAgenda(),
    template: agendaUtil.createDefaultTemplate(),
    isSuperAdmin: false,
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
    validationRemaining: 0
  },

  /**
   * 方法是什么：加载 AgendaV2 编辑器。
   * 方法作用：并行读取模板、会员和 Pathways，再恢复当前草稿。
   * 为什么添加：字段权限、默认规则和下拉选项必须在议程规范化前准备完成。
   */
  async onLoad(options) {
    this.setData({ isSuperAdmin: app.isSuperAdminMode() });
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
  onShow() {
    if (this.data.previewing) {
      this.setData({ previewing: false });
    }
    const isSuperAdmin = app.isSuperAdminMode();
    if (isSuperAdmin !== this.data.isSuperAdmin) {
      this.setData({ isSuperAdmin });
      this.setAgenda(this.data.agenda);
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
   * 方法作用：在应用重启或全局状态缺失时恢复七天内的 AgendaV2。
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
    app.setCurrentAgenda(agenda);
    this.setData({ agenda, addModuleOptions, addModuleLabels: addModuleOptions.map((item) => item.label) });
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
      row.canEditTitle = this.data.isSuperAdmin || Boolean(row.permissions && row.permissions.memberTitle);
      row.canEditDuration = this.data.isSuperAdmin || Boolean(row.permissions && row.permissions.memberDuration);
      row.canEditPerson = this.data.isSuperAdmin || Boolean(row.permissions && row.permissions.memberPerson);
      row.canEditClub = this.data.isSuperAdmin || Boolean(row.permissions && row.permissions.memberClub);
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
    if (this.data.isSuperAdmin) {
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
   * 方法作用：仅接受会议期数和主题，日期继续使用接龙解析结果且不可编辑。
   * 为什么添加：编辑页顶部需要提供统一基础信息区，同时明确保护解析得到的会议日期。
   */
  handleBasicInfoInput(event) {
    const field = event.currentTarget.dataset.field;
    if (field !== 'meetingNo' && field !== 'theme') {
      return;
    }
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    agenda.meetingInfo[field] = event.detail.value;
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：修改只读会议信息。
   * 方法作用：仅允许模拟超管校正编号、日期、主题、时间和地址。
   * 为什么添加：普通会员必须保留解析结果，不能修改页眉字段。
   */
  handleMeetingInput(event) {
    if (!this.data.isSuperAdmin) {
      return;
    }
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    agenda.meetingInfo[event.currentTarget.dataset.field] = event.detail.value;
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：修正当前会议使用的模板语言。
   * 方法作用：允许模拟超管在中文和英文模板文案之间切换并重新计算语言门控模块。
   * 为什么添加：接龙自动识别可能出错，但普通会员不能修改模板选择。
   */
  handleLanguageChange(event) {
    if (!this.data.isSuperAdmin) {
      return;
    }
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
  deletePreparedBlock(event) {
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    const section = agenda.sections.find((item) => item.id === 'preparedSpeech');
    section.children.splice(Number(event.currentTarget.dataset.childIndex), 1);
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
  deleteDynamicModule(event) {
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    const dataset = event.currentTarget.dataset;
    const section = agenda.sections[Number(dataset.sectionIndex)];
    if (!section) {
      return;
    }
    if (dataset.childIndex !== undefined && dataset.childIndex !== '') {
      const child = section.children[Number(dataset.childIndex)];
      if (child && child.dynamic) {
        section.children.splice(Number(dataset.childIndex), 1);
      }
    } else if (section.dynamic && section.deletable) {
      agenda.sections.splice(Number(dataset.sectionIndex), 1);
    }
    this.setAgenda(agenda);
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
   * 方法作用：提交服务端规范化结果并保持原七天过期时间。
   * 为什么添加：预览和 PDF 必须使用数据库中的最新议程。
   */
  async saveAgenda(options) {
    const manageSaving = !(options && options.manageSaving === false);
    if (manageSaving) {
      this.setData({ saving: true });
    }
    try {
      const data = await cloud.callCloud('saveAgenda', { agenda: this.data.agenda });
      this.setAgenda(data.agenda);
      if (!(options && options.silent)) {
        cloud.showSuccess('已保存');
      }
      return data.agenda;
    } catch (error) {
      cloud.showError(error);
      return null;
    } finally {
      if (manageSaving) {
        this.setData({ saving: false });
      }
    }
  },

  /**
   * 方法是什么：保存后打开 A4 模板预览。
   * 方法作用：确保预览和 PDF 使用服务端最新 AgendaV2 与全局模板。
   * 为什么添加：新的编辑流程要求在导出前先确认完整两页版式。
   */
  async goPreview() {
    if (this.data.saving || this.data.previewing) {
      return;
    }
    const validationErrors = agendaUtil.validateAgendaForPreview(this.data.agenda);
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
    this.setData({ previewing: true });
    const agenda = await this.saveAgenda({ silent: true, manageSaving: false });
    if (agenda && agenda._id) {
      app.globalData.previewPayload = {
        agendaId: agenda._id,
        agenda,
        template: agendaUtil.resolveTemplateLocale(this.data.template, agenda.meetingInfo && agenda.meetingInfo.language),
        rows: agendaUtil.flattenAgendaRows(agenda)
      };
      wx.navigateTo({ url: `/pages/template-preview/template-preview?id=${agenda._id}` });
    } else {
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
