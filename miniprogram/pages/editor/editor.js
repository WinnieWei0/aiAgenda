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
    pathwaySelectorVisible: false,
    pathwaySelectorContext: null,
    pathwaySelectorSelectedCode: '',
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
    signupData: null,
    signupModalVisible: false,
    signupSelectedSlot: null,
    signupPersonType: 'member',
    signupAllowMember: true,
    signupAllowClub: true,
    signupAllowGuest: true,
    signupMemberIndex: -1,
    signupName: '',
    signupClub: '',
    signupEditingSlotId: '',
    signupSubmitting: false,
    agendaGenerated: false,
    meetingGroupQrCustom: false
  },

  /**
   * 方法是什么：加载 AgendaV2 编辑器。
   * 方法作用：并行读取模板、会员和 Pathways，再恢复当前草稿。
   * 为什么添加：字段权限、默认规则和下拉选项必须在议程规范化前准备完成。
   */
  async onLoad(options) {
    await app.login();
    if ((app.globalData.identity || {}).role === 'guest') {
      wx.showToast({ title: '宾客仅可访问报名页', icon: 'none' });
      wx.redirectTo({ url: '/pages/parse/parse' });
      return;
    }
    this.setData({ isAdmin: app.isAdmin() });
    await Promise.all([this.loadTemplate(), this.loadMembers(), this.loadPathways()]);
    if (options && options.id) {
      await this.loadAgendaById(options.id);
    } else if (app.globalData.currentAgenda) {
      this.setAgenda(app.globalData.currentAgenda);
      this.setData({ agendaGenerated: Boolean(app.globalData.currentAgenda.meetingInfo && String(app.globalData.currentAgenda.meetingInfo.meetingNo || '').trim()) });
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

  /**
   * 方法是什么：读取当前会议报名槽位。
   * 方法作用：让编辑接龙页显示报名状态，并在其他页面修改后刷新人员按钮。
   * 为什么添加：报名页和编辑页必须使用同一份服务端槽位数据。
   */
  async loadSignupData() {
    try {
      const signupData = await cloud.callCloud('signupService', { action: 'get' });
      const agenda = this.reconcileAgendaWithSignupData(this.data.agenda, signupData);
      this.setData({ signupData }, () => this.setAgenda(agenda));
    } catch (error) {
      this.setData({ signupData: null }, () => this.setAgenda(this.data.agenda));
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
      const agenda = data.agenda || agendaUtil.createEmptyAgenda();
      this.setAgenda(agenda);
      this.setData({ agendaGenerated: Boolean(agenda.meetingInfo && String(agenda.meetingInfo.meetingNo || '').trim()) });
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
      this.setData({ agendaGenerated: Boolean(data.agenda && data.agenda.meetingInfo && String(data.agenda.meetingInfo.meetingNo || '').trim()) });
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
    const meetingGroupQr = agenda.assets && agenda.assets.meetingGroupQr || '';
    app.setCurrentAgenda(agenda);
    this.setData({ agenda, mmMemberIndex, meetingGroupQrCustom: Boolean(meetingGroupQr), addModuleOptions, addModuleLabels: addModuleOptions.map((item) => item.label) });
  },

  /**
   * 方法是什么：装饰编辑器视图字段。
   * 方法作用：为人员选择下标、字段权限和 Pathways 下标生成页面专用值。
   * 为什么添加：WXML 不能调用权限函数或在模板中执行复杂查找。
   */
  decorateAgenda(agenda) {
    const language = agendaUtil.normalizeLanguage(agenda.meetingInfo && agenda.meetingInfo.language);
    const signupSlots = new Map((this.data.signupData && this.data.signupData.slots || []).map((slot) => [slot.id, slot]));
    const decorateSignupPerson = (person, slotId) => {
      if (!person || !slotId) return;
      const slot = signupSlots.get(slotId);
      person.signupSlotId = slotId;
      person.signupSlotOccupied = Boolean(slot && slot.occupied);
      person.signupSlotSignupId = slot && slot.signupId || '';
      person.signupSlotLabel = slot && slot.label || '';
      person.signupSlotHasValue = person.signupSlotOccupied || Boolean(person.rawName || person.memberId || person.displayNameZh || person.displayNameEn);
    };
    const decorateRow = (row) => {
      if (!row) {
        return;
      }
      row.canEditTitle = this.data.isAdmin || Boolean(row.permissions && row.permissions.memberTitle);
      row.canEditDuration = this.data.isAdmin || Boolean(row.permissions && row.permissions.memberDuration);
      row.canEditPerson = this.data.isAdmin || Boolean(row.permissions && row.permissions.memberPerson);
      row.canEditClub = this.data.isAdmin || Boolean(row.permissions && row.permissions.memberClub);
      row.displayTitle = row.titleZh;
      if (row.id === 'topicExplanation') {
        row.displayTitle = '即兴主持人';
      }
      if (row.id === 'tableTopicsSpeech') {
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
        decorateSignupPerson(row.speaker, `prepared:${row.id}:speaker`);
        decorateSignupPerson(row.evaluator, `prepared:${row.id}:evaluator`);
        row.pathwayIndex = this.data.pathwayOptions.findIndex((option) => option.pathway._id === row.pathway._id || option.pathway.code === row.pathway.code);
      }
      if (row.roleKey) decorateSignupPerson(row.person, `role:${row.roleKey}`);
      if (row.dynamic && (row.moduleKind === 'icebreaker' || row.moduleKind === 'workshop')) {
        decorateSignupPerson(row.person, `dynamic:${row.id}`);
      }
      if (row.id === 'signIn') {
        (row.persons || []).forEach((person, index) => decorateSignupPerson(person, index === 1 ? 'role:memberReception' : 'role:guestReception'));
      }
      if (row.id === 'venueIntroduction') decorateSignupPerson(row.person, 'role:guestReception');
    };
    agenda.sections.forEach((section) => {
      section.displayTitle = section.titleZh || section.row && section.row.titleZh;
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
      tableTopics: '即兴演讲环节',
      icebreaker: '破冰',
      freeTalk: 'Free Talk',
      workshop: '工作坊',
      educationAward: '教育积分颁奖',
      memberInterview: '新会员面试'
    };
    const tableTopics = agenda.sections.find((section) => section.id === 'tableTopics');
    const options = Object.keys(agendaUtil.DYNAMIC_MODULES).filter((kind) => !existing.has(kind) && (kind !== 'freeTalk' || language === 'en')).map((kind) => ({ kind, label: labels[kind] }));
    if (tableTopics && tableTopics.enabled === false) options.unshift({ kind: 'tableTopics', label: labels.tableTopics });
    return options;
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
   * 方法是什么：推导人员控件对应的报名槽位。
   * 方法作用：把编辑器中的人员位置映射到 signupService 使用的稳定槽位 ID。
   * 为什么添加：清空人员前必须同步释放报名页中的同一角色。
   */
  getPersonSignupSlotId(agenda, dataset) {
    const section = agenda.sections[Number(dataset.sectionIndex)];
    const row = this.getRowTarget(agenda, dataset);
    if (!section || !row) return '';
    if (section.id === 'venueIntroduction') return 'role:guestReception';
    if (section.id === 'signIn' && dataset.personField === 'multi') {
      return Number(dataset.personIndex) === 1 ? 'role:memberReception' : 'role:guestReception';
    }
    if (row.type === 'preparedSpeechBlock') {
      return `prepared:${row.id}:${dataset.personField}`;
    }
    if (row.roleKey) return `role:${row.roleKey}`;
    if (row.dynamic) return `dynamic:${row.id}`;
    return '';
  },

  /**
   * 方法是什么：清空议程人员。
   * 方法作用：清除姓名、会员绑定和俱乐部，并同步取消对应报名槽位。
   * 为什么添加：编辑器清空人员不能留下报名页的孤立占位记录。
   */
  async clearPerson(event) {
    const dataset = event.currentTarget.dataset;
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    const target = this.getPersonTarget(agenda, dataset);
    if (!target) return;
    const hasPerson = Boolean(target.rawName || target.memberId || target.clubZh || target.clubEn);
    if (!hasPerson || !this.canEditRow(this.getRowTarget(agenda, dataset), 'person')) return;
    const slotId = this.getPersonSignupSlotId(agenda, dataset);
    if (slotId && agenda.signupPublicId && !(await this.confirmAndCancelSlots([slotId], '该人员已有报名，清空后将取消报名。确认继续吗？'))) return;
    const empty = agendaUtil.createPerson({});
    if (dataset.personField === 'speaker' || dataset.personField === 'evaluator') {
      const row = this.getRowTarget(agenda, dataset);
      row[dataset.personField] = empty;
    } else if (dataset.personField === 'multi') {
      const row = this.getRowTarget(agenda, dataset);
      row.persons[Number(dataset.personIndex)] = empty;
    } else {
      this.getRowTarget(agenda, dataset).person = empty;
    }
    this.setAgenda(agenda);
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
   * 方法作用：把基础信息中的 MM 作为会议筹备人写入 preparation 的 meetingManager 人员位。
   * 为什么添加：编辑页不再重复显示会议筹备模块，报名页和正式议程仍共用同一 MM 数据。
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

  /**
   * 方法是什么：打开统一会员选择器。
   * 方法作用：根据 MM、议程人员或角色报名上下文恢复当前选中会员。
   * 为什么添加：编辑人员和角色报名共用同一个可搜索选择组件。
   */
  openMemberSelector(event) {
    const dataset = Object.assign({}, event.currentTarget.dataset);
    let selectedId = dataset.memberId || '';
    if (dataset.selectorKind === 'mm') {
      selectedId = this.data.memberOptions[this.data.mmMemberIndex] && this.data.memberOptions[this.data.mmMemberIndex].member._id || '';
    } else if (dataset.selectorKind === 'signup') {
      selectedId = this.data.signupMemberIndex >= 0 && this.data.memberOptions[this.data.signupMemberIndex] && this.data.memberOptions[this.data.signupMemberIndex].member._id || '';
    }
    this.setData({ memberSelectorVisible: true, memberSelectorContext: dataset, memberSelectorSelectedId: selectedId });
  },

  /**
   * 方法是什么：关闭会员选择器。
   * 方法作用：结束当前选择上下文而不修改人员或报名数据。
   * 为什么添加：取消选择必须避免上下文残留到下一次打开。
   */
  closeMemberSelector() {
    this.setData({ memberSelectorVisible: false, memberSelectorContext: null });
  },

  /**
   * 方法是什么：确认会员选择器结果。
   * 方法作用：按上下文写入 MM、议程人员或报名弹窗的会员索引。
   * 为什么添加：同一组件需要服务三种人员选择流程。
   */
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
    if (context.selectorKind === 'signup') {
      this.setData({ signupMemberIndex: index });
      return;
    }
    this.chooseMember({ detail: { value: index }, currentTarget: { dataset: context } });
  },

  /**
   * 方法是什么：关闭角色报名弹窗。
   * 方法作用：清除当前角色弹窗但保留服务端报名状态。
   * 为什么添加：取消报名填写不能改变议程人员。
   */
  closeSignupModal() {
    if (!this.data.signupSubmitting) this.setData({ signupModalVisible: false, signupSelectedSlot: null, signupEditingSlotId: '' });
  },

  /**
   * 方法是什么：切换角色报名身份。
   * 方法作用：控制会员、友会和宾客输入模式。
   * 为什么添加：不同角色允许的报名身份由服务端槽位决定。
   */
  chooseSignupType(event) {
    this.setData({ signupPersonType: event.currentTarget.dataset.type });
  },

  /**
   * 方法是什么：输入临时报名姓名。
   * 方法作用：保存友会或宾客报名弹窗中的姓名。
   * 为什么添加：非会员报名不使用会员选择器。
   */
  inputSignupName(event) {
    this.setData({ signupName: event.detail.value });
  },

  /**
   * 方法是什么：输入报名俱乐部。
   * 方法作用：保存友会报名使用的俱乐部字段。
   * 为什么添加：俱乐部信息需要随报名槽位一起提交服务端。
   */
  inputSignupClub(event) {
    this.setData({ signupClub: event.detail.value });
  },

  /**
   * 方法是什么：确保当前会议存在报名会话。
   * 方法作用：从当前议程恢复可编辑的报名槽位快照。
   * 为什么添加：编辑页报名和清空只能修改本地草稿，保存时才提交服务端。
   */
  async ensureSignupData() {
    if (this.data.signupData && Array.isArray(this.data.signupData.slots)) return this.data.signupData;
    const signupData = { slots: (this.data.agenda.signupSlots || []).map((slot) => Object.assign({}, slot)) };
    this.setData({ signupData });
    return signupData;
  },

  /**
   * 方法是什么：打开或清空编辑页角色报名。
   * 方法作用：未占用角色打开报名弹窗，已占用角色调用统一清空流程。
   * 为什么添加：编辑接龙页需要与报名页保持同一报名状态和按钮语义。
   */
  async openRoleSignup(event) {
    const slotId = event.currentTarget.dataset.slotId || this.getPersonSignupSlotId(this.data.agenda, event.currentTarget.dataset);
    const editing = event.currentTarget.dataset.action === 'edit';
    if (!slotId) return;
    try {
      const signupData = await this.ensureSignupData();
      if (!signupData) return;
      const slot = (signupData.slots || []).find((item) => item.id === slotId);
      if (!slot) return;
      if (slot.occupied && !editing) {
        this.clearLocalSignupSlot(slot.id);
        return;
      }
      const allowed = slot.allowedPersonTypes || ['member', 'club'];
      const memberIndex = this.data.memberOptions.findIndex((option) => option.member._id === (slot.person && slot.person.memberId));
      this.setData({
        signupModalVisible: true,
        signupSelectedSlot: slot,
        signupPersonType: allowed[0] || 'member',
        signupAllowMember: allowed.includes('member'),
        signupAllowClub: allowed.includes('club'),
        signupAllowGuest: allowed.includes('guest'),
        signupMemberIndex: memberIndex,
        signupName: '',
        signupClub: '',
        signupEditingSlotId: editing && slot.signupId ? slot.id : ''
      });
    } catch (error) {
      cloud.showError(error);
    }
  },

  /**
   * 方法是什么：提交编辑页角色报名。
   * 方法作用：把弹窗资料写入当前议程和本地槽位状态。
   * 为什么添加：编辑页只有底部保存操作才允许同步数据库。
   */
  async submitRoleSignup(event) {
    if (this.data.signupSubmitting) return;
    const slot = this.data.signupSelectedSlot;
    const detail = event.detail || {};
    if (!slot) return;
    this.setData({ signupSubmitting: true });
    try {
      const agenda = this.applyLocalSignup(this.data.agenda, slot, detail);
      const signupData = Object.assign({}, this.data.signupData || {}, {
        slots: (this.data.signupData && this.data.signupData.slots || []).map((item) => item.id === slot.id ? Object.assign({}, item, { occupied: true, preset: true, signupId: '', person: this.personFromSignupDetail(detail) }) : item)
      });
      agenda.signupSlots = signupData.slots;
      this.setAgenda(agenda);
      this.setData({ signupData, signupModalVisible: false, signupSelectedSlot: null, signupEditingSlotId: '', signupSubmitting: false });
    } catch (error) {
      this.setData({ signupSubmitting: false });
      cloud.showError(error);
    }
  },

  personFromSignupDetail(detail) {
    const member = this.data.memberOptions.find((option) => option.member._id === detail.memberId);
    const source = member && member.member;
    const name = source ? (source.nameZh || source.nameEn || source.nickName || '') : (detail.name || '');
    const club = source ? '广州双语' : (detail.club || (detail.personType === 'guest' && name ? '宾客' : ''));
    return agendaUtil.createPerson({ rawName: name, memberId: source ? source._id : '', displayNameZh: source ? (source.nameZh || name) : name, displayNameEn: source ? (source.nameEn || source.nameZh || name) : name, clubZh: club, clubEn: source ? 'Guangzhou Bilingual' : club, inputMode: source ? 'select' : 'input' });
  },

  applyLocalSignup(agendaValue, slot, detail) {
    const agenda = agendaUtil.cloneJson(agendaValue);
    const person = this.personFromSignupDetail(detail);
    const target = slot.target || {};
    const visitRows = (visitor) => agenda.sections.forEach((section) => { if (section.row) visitor(section.row, section); (section.children || []).forEach((row) => visitor(row, section)); });
    if (target.kind === 'multi') {
      const section = agenda.sections.find((item) => item.id === target.sectionId);
      if (section && section.row) section.row.persons[target.index] = person;
      if (slot.roleKey === 'guestReception') { const venue = agenda.sections.find((item) => item.id === 'venueIntroduction'); if (venue && venue.row) venue.row.person = agendaUtil.cloneJson(person); }
    } else if (target.kind === 'roleKey') visitRows((row) => { if (row.roleKey === target.roleKey) row.person = agendaUtil.cloneJson(person); });
    else if (target.kind === 'prepared') { const section = agenda.sections.find((item) => item.id === 'preparedSpeech'); const block = section && (section.children || []).find((item) => item.id === target.blockId); if (block) block[target.field] = person; }
    else if (target.kind === 'row') visitRows((row) => { if (row.id === target.rowId) row.person = agendaUtil.cloneJson(person); });
    return agenda;
  },

  /**
   * 方法是什么：用最新报名槽位同步编辑页人员。
   * 方法作用：写入仍有效的报名人，并清空已经在报名页取消的角色。
   * 为什么添加：编辑页返回前台时不能继续显示服务端已取消的旧报名。
   */
  reconcileAgendaWithSignupData(agendaValue, signupData) {
    return (signupData && signupData.slots || []).reduce((agenda, slot) => {
      const person = slot.occupied && slot.person || {};
      return this.applyLocalSignup(agenda, slot, {
        personType: person.memberId ? 'member' : (person.clubZh && person.clubZh !== '宾客' ? 'club' : 'guest'),
        memberId: person.memberId || '',
        name: person.rawName || person.displayNameZh || person.displayNameEn || '',
        club: person.clubZh || person.clubEn || ''
      });
    }, agendaUtil.cloneJson(agendaValue));
  },

  clearLocalSignupSlot(slotId) {
    const slot = (this.data.signupData && this.data.signupData.slots || []).find((item) => item.id === slotId);
    if (!slot) return;
    const empty = { personType: 'guest', memberId: '', name: '', club: '' };
    const agenda = this.applyLocalSignup(this.data.agenda, slot, empty);
    const signupData = Object.assign({}, this.data.signupData, { slots: this.data.signupData.slots.map((item) => item.id === slotId ? Object.assign({}, item, { occupied: false, preset: false, person: null, signupId: '' }) : item) });
    agenda.signupSlots = signupData.slots;
    this.setData({ signupData }, () => this.setAgenda(agenda));
  },

  /**
   * 方法是什么：打开 Pathways 搜索选择器。
   * 方法作用：记录备稿块位置和当前项目，让弹窗确认后能准确更新对应演讲。
   * 为什么添加：原生 picker 无法同时搜索 level 和中英文项目标签。
   */
  openPathwaySelector(event) {
    const dataset = Object.assign({}, event.currentTarget.dataset);
    this.setData({
      pathwaySelectorVisible: true,
      pathwaySelectorContext: dataset,
      pathwaySelectorSelectedCode: dataset.pathwayCode || ''
    });
  },

  /**
   * 方法是什么：关闭 Pathways 搜索选择器。
   * 方法作用：清除本次选择上下文并恢复备稿编辑状态。
   * 为什么添加：取消选择不能修改议程，也不能让上一次上下文残留到下一次打开。
   */
  closePathwaySelector() {
    this.setData({ pathwaySelectorVisible: false, pathwaySelectorContext: null });
  },

  /**
   * 方法是什么：确认 Pathways 项目选择。
   * 方法作用：把弹窗返回的完整项目记录交给统一项目更新逻辑。
   * 为什么添加：项目名称、目标描述和默认限时必须在一次确认操作中保持一致。
   */
  confirmPathwaySelector(event) {
    const context = this.data.pathwaySelectorContext || {};
    const pathway = event.detail && event.detail.pathway;
    this.closePathwaySelector();
    if (pathway) {
      this.choosePathway({ detail: { pathway }, currentTarget: { dataset: context } });
    }
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
    const pathway = event.detail && event.detail.pathway
      ? event.detail.pathway
      : this.data.pathwayOptions[Number(event.detail.value)] && this.data.pathwayOptions[Number(event.detail.value)].pathway;
    if (!block || !pathway) {
      return;
    }
    block.pathway = agendaUtil.cloneJson(pathway);
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
    if (section.id === 'tableTopics') {
      if (!(await this.confirmAndCancelSlots(['role:tableTopicsMaster', 'role:tableTopicsEvaluator'], '即兴演讲环节已有报名，删除后将同时取消主持人和点评师报名。确认删除吗？'))) return;
      section.enabled = false;
      (section.children || []).forEach((row) => {
        if (row.id === 'topicExplanation' || row.id === 'topicSummary' || row.id === 'tableTopicsEvaluation') row.person = agendaUtil.createPerson({});
      });
      this.setAgenda(agenda);
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
    if (!this.data.agenda.signupPublicId) return true;
    if (!this.data.signupData) await this.loadSignupData();
    const occupied = (this.data.signupData && this.data.signupData.slots || []).filter((slot) => slotIds.includes(slot.id) && slot.occupied);
    if (!occupied.length) return true;
    const confirmed = await new Promise((resolve) => wx.showModal({ title: '确认删除', content: message, confirmColor: '#b91c1c', success: (res) => resolve(Boolean(res.confirm)), fail: () => resolve(false) }));
    if (!confirmed) return false;
    try {
      for (const slot of occupied) {
        await cloud.callCloud('signupService', { action: 'cancelSlot', slotId: slot.id });
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
        'agenda.signupSlots': savedAgenda.signupSlots || [],
        agendaGenerated: true
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

  handleWorkshopTopicInput(event) {
    const agenda = agendaUtil.cloneJson(this.data.agenda);
    const row = this.getRowTarget(agenda, event.currentTarget.dataset);
    if (!row || row.moduleKind !== 'workshop' || !this.canEditRow(row, 'titleZh')) return;
    row.topic = event.detail.value;
    this.setAgenda(agenda);
  },

  /**
   * 方法是什么：响应底部生成或保存按钮。
   * 方法作用：首次生成和后续保存共用议程保存流程，并由保存结果更新按钮状态。
   * 为什么添加：重置后的议程需要明确区分首次生成与后续保存。
  */
  async saveAgendaFromButton() {
    const wasGenerated = this.data.agendaGenerated;
    const agenda = await this.saveAgenda({ silent: true });
    if (agenda) {
      cloud.showSuccess(wasGenerated ? '已保存' : '议程表已生成');
    }
  },

  async openSignupPage() {
    const agenda = await this.saveAgenda({ silent: true });
    if (!agenda) return;
    try {
      const data = await cloud.callCloud('signupService', { action: 'create' });
      this.setData({ signupData: data, 'agenda.signupPublicId': data.publicId, 'agenda.signupSlots': data.slots });
      wx.navigateTo({ url: '/pages/signup/signup' });
    } catch (error) { cloud.showError(error); }
  },

  cancelManagedSlot(event) {
    const slotId = event.currentTarget.dataset.slotId;
    wx.showModal({ title: '取消角色', content: '确认清空该角色报名并释放名额吗？', success: async (res) => {
      if (!res.confirm) return;
      try {
        const data = await cloud.callCloud('signupService', { action: 'cancelSlot', slotId });
        this.setData({ signupData: data });
        await this.loadAgendaById(this.data.agenda._id);
        cloud.showSuccess('已取消');
      } catch (error) { cloud.showError(error); }
    } });
  },

  resetMeeting() {
    wx.showModal({ title: '重置当前会议', content: '将清空本期议程和全部报名，原报名链接立即失效。此操作不可撤销。', confirmColor: '#b42318', success: async (res) => {
      if (!res.confirm) return;
      try {
        const data = await cloud.callCloud('signupService', { action: 'reset' });
        this.setData({ signupData: null, agendaGenerated: false });
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
      await this.openPdfPreview(agenda._id);
    } catch (error) {
      cloud.showError(error);
    } finally {
      this.setData({ previewing: false });
    }
  },

  async continuePreview() {
    this.setData({ validationDialogVisible: false });
    await this.openPdfPreview(this.data.agenda && this.data.agenda._id);
  },

  async openPdfPreview(agendaId) {
    if (!agendaId) return;
    this.setData({ previewing: true });
    try {
      const data = await cloud.callCloud('exportAgendaPdf', { agendaId });
      const download = await wx.cloud.downloadFile({ fileID: data.fileID });
      await wx.openDocument({ filePath: download.tempFilePath, fileType: 'pdf', showMenu: true });
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
