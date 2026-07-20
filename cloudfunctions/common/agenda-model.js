const TEMPLATE_ID = 'gz-bilingual-v1';
const AGENDA_SCHEMA_VERSION = 2;
const DYNAMIC_MODULES = {
  icebreaker: { titleZh: '破冰', titleEn: 'Icebreaker', duration: 5, placement: 'facilitatorIntroduction' },
  freeTalk: { titleZh: 'Free Talk', titleEn: 'Free Talk', duration: 10, placement: 'preparedSpeech', languageGate: 'en', movable: true },
  workshop: { titleZh: '工作坊', titleEn: 'Workshop', duration: 30, placement: 'break', movable: true },
  educationAward: { titleZh: '教育积分颁奖', titleEn: 'Education Credit Awards', duration: 10, placement: 'vote', movable: true },
  memberInterview: { titleZh: '新会员面试', titleEn: 'New Member Interview', duration: 3, placement: 'end', postMeeting: true }
};

/**
 * 方法是什么：复制 JSON 数据。
 * 方法作用：为模板和议程创建不共享引用的普通对象。
 * 为什么添加：小程序状态和云函数规范化都不能直接修改调用方对象。
 */
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value === undefined ? {} : value));
}

/**
 * 方法是什么：创建标准人员对象。
 * 方法作用：统一会员选择、手动输入、固定人员和俱乐部字段。
 * 为什么添加：所有议程角色需要共用同一套选择与导出数据结构。
 */
function createPerson(value) {
  const source = value || {};
  const rawName = source.rawName || source.displayNameZh || source.displayNameEn || '';
  return {
    rawName,
    memberId: source.memberId || '',
    memberIndex: Number.isFinite(Number(source.memberIndex)) ? Number(source.memberIndex) : -1,
    displayNameZh: source.displayNameZh || rawName,
    displayNameEn: source.displayNameEn || rawName,
    clubZh: source.clubZh === undefined ? '广州双语' : source.clubZh,
    clubEn: source.clubEn === undefined ? 'Bilingual' : source.clubEn,
    inputMode: source.inputMode || (source.memberId || !rawName ? 'select' : 'input'),
    unresolved: Boolean(source.unresolved)
  };
}

/**
 * 方法是什么：解析时刻字符串。
 * 方法作用：把 HH:mm 转成从零点开始的分钟数。
 * 为什么添加：议程锚点和连续时间链需要使用可计算的数值。
 */
function parseTime(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

/**
 * 方法是什么：格式化分钟数。
 * 方法作用：把分钟数转换为稳定的 HH:mm 文本。
 * 为什么添加：预览、编辑器和 PDF 必须显示完全一致的时间。
 */
function formatTime(totalMinutes) {
  const normalized = ((Number(totalMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

/**
 * 方法是什么：解析 Pathways 项目时长。
 * 方法作用：从“4-6分钟”或单一时长描述中取可用的分钟数。
 * 为什么添加：备稿演讲默认限时必须来自项目描述且区间取上限。
 */
function parsePathwayDuration(value, fallback) {
  const text = String(value || '').replace(/\s+/g, '');
  const range = text.match(/(\d+)\s*(?:-|–|—|~|至|到)\s*(\d+)\s*分钟/);
  if (range) {
    return Math.max(Number(range[1]), Number(range[2]));
  }
  const single = text.match(/(\d+)\s*分钟/);
  return single ? Number(single[1]) : Number(fallback || 7);
}

/**
 * 方法是什么：规范化会议语言。
 * 方法作用：把所有非英文值收敛为中文，供模板、动态模块和 PDF 使用。
 * 为什么添加：旧草稿可能没有语言字段，所有入口需要相同的稳定回退值。
 */
function normalizeLanguage(value) {
  return String(value || '').toLowerCase() === 'en' ? 'en' : 'zh';
}

/**
 * 方法是什么：创建英文模板文案。
 * 方法作用：为单模板中的英文视图提供完整页眉、侧栏、计时规则和第二页默认文本。
 * 为什么添加：英文会议不能继续复用中文模板文案。
 */
function createEnglishLocale() {
  return {
    fixedContent: {
      clubTitle: 'GZ Bilingual Toastmasters Club',
      clubSubtitle: 'A Professional Bilingual Platform for Diverse Growth and Sharing',
      charter: 'Charter #01540850\nArea N1, Div.N, D118\nFounded in 2010',
      meetingTime: 'Every Wednesday night 19:30 - 21:30',
      venue: 'Room 1904-A, West Tower, Xingchen Building, 172 Huasui Road, Tianhe District, Guangzhou',
      fees: 'Guest Ticket: RMB 29\nMembership Registration Fee: RMB 300\nMembership Renewal Due (6 months): RMB 720',
      tabooTopics: 'Politics, Religion, Sex, Sales',
      missionEn: 'Toastmasters International is a nonprofit educational organization that helps members improve communication and leadership skills and gain confidence and friendship through participation and practice.',
      missionZh: '',
      values: 'Integrity - Respect - Service - Excellence',
      clubIntro: 'GZ Bilingual Toastmasters Club is the first club in South China named Bilingual. We help members strengthen the communication and leadership skills needed at work and in life.'
    },
    sidebar: { winners: [
      { label: 'Best Meeting Role', value: 'Derwin' },
      { label: 'Best Table Topics', value: 'Jeffery' },
      { label: 'Best Prepared', value: 'Penny' },
      { label: 'Best Evaluator', value: 'Kathrine' }
    ] },
    timerRules: [
      ['Timing Signal', 'Green', 'Yellow', 'Red', 'Applause'],
      ['Speech up to 3 min', '1 min left', '30 sec left', 'Time', '15 sec overtime'],
      ['Speech over 3 min', '2 min left', '1 min left', 'Time', '30 sec overtime']
    ],
    page2: {
      updatesTitle: 'Club Updates',
      notesTitle: 'Notes',
      educationTitle: 'Toastmasters Education Program',
      pathways: ['Dynamic Leadership', 'Engaging Humor', 'Motivational Strategies', 'Persuasive Influence', 'Presentation Mastery', 'Visionary Communication'],
      goal: 'Ultimate Goal: Distinguished Toastmaster',
      achievements: ['The first Toastmasters club in Guangzhou named Bilingual', 'Select Distinguished Club 2010-2011', 'Distinguished Club 2013-2014', 'President’s Distinguished Club 2012-2013, 2015-2025', 'A cradle for District leaders', 'Beat the Clock Awards 2013, 2017', 'Smedley Awards 2014, 2016-2020, 2024'],
      meetingFlow: ['Opening and facilitator introductions', 'Table Topics', 'Prepared speeches', 'Speech evaluations', 'Facilitator reports', 'Awards and role booking'],
      benefits: ['Follow a proven learning path', 'Learn with members from diverse industries', 'Serve as a club or District officer', 'Receive feedback from mentors and experienced members', 'Learn to give feedback and mentor others', 'Join speech contests', 'Practice different meeting roles', 'Visit other Toastmasters clubs'],
      joining: 'New member interviews are normally held after the final meeting of each month. Contact the Vice President Membership in advance.\n\nRequirements:\na. Attend at least three bilingual meetings and take different roles in at least two meetings;\nb. Show a strong willingness to learn and participate;\nc. Pass the interview.',
      resources: 'Resources: www.toastmasters.org    Toastmasters District 118',
      officers: []
    }
  };
}

/**
 * 方法是什么：创建广州双语默认模板。
 * 方法作用：提供两页固定内容、素材地址、议程规则和默认负责人。
 * 为什么添加：数据库尚未初始化时仍需直接得到可预览和可导出的完整模板。
 */
function createDefaultTemplate() {
  const template = {
    _id: TEMPLATE_ID,
    templateId: TEMPLATE_ID,
    schemaVersion: AGENDA_SCHEMA_VERSION,
    fixedContent: {
      clubTitle: '广州双语国际演讲俱乐部 GZ Bilingual Toastmasters Club',
      clubSubtitle: '专业的双语多元化成长分享平台',
      charter: 'Charter #01540850\nArea N1, Div.N, D118\nFounded in 2010',
      meetingTime: '每周三晚 19:30 - 21:30\nEvery Wednesday night 19:30 - 21:30',
      venue: '广州市天河区珠江新城华穗路172号星辰大厦西塔1904-A室\nRoom 1904-A, West Tower, Xingchen Building, 172 Huasui Road, Tianhe District, Guangzhou',
      fees: '宾客场地费 Guest Ticket: RMB 29\n会员注册费 Membership Registration Fee: RMB 300\n会员续费（六个月）Membership Renewal Due: RMB 720',
      tabooTopics: '政治、宗教、性、销售\nPolitics, Religion, Sex, Sales',
      missionEn: 'Toastmasters International (TI) is a nonprofit educational organization that operates clubs worldwide for the purpose of helping members improve communication and leadership skills and gain confidence and friendship through participation and practice.',
      missionZh: '国际演讲会的使命是提供积极的互助成长环境，让成员从中有效地训练沟通技巧和领导力技巧，从而增强自信，收获友谊，实现个人成长。',
      values: '诚信-尊重-服务-追求卓越',
      clubIntro: '广州双语国际演讲俱乐部是华南地区第一家以“双语”命名的俱乐部；俱乐部愿景是帮助会员提升职场软技能。俱乐部口号是--双语成就专业！'
    },
    assets: {
      logo: '/images/template/toastmasters-logo.png',
      educationSystem: '/images/template/education-system.png',
      membershipQr: '/images/template/membership-qr.png',
      officialQr: '/images/template/official-qr.png',
      meetingGroupQr: '/images/template/meeting-group-qr.png'
    },
    sidebar: {
      winners: [
        { label: 'Best Meeting Role', value: 'Derwin' },
        { label: 'Best Table Topics', value: 'Jeffery' },
        { label: 'Best Prepared', value: 'Penny' },
        { label: 'Best Evaluator', value: 'Kathrine' }
      ]
    },
    timerRules: [
      ['计时信号', '绿卡', '黄卡', '红卡', '鼓掌'],
      ['3分钟以内的发言', '剩余1分钟', '剩余30秒', '时间到', '超时15秒'],
      ['3分钟以上的发言', '剩余2分钟', '剩余1分钟', '时间到', '超时30秒']
    ],
    page2: {
      updatesTitle: '双语动态',
      notesTitle: '笔记',
      educationTitle: '头马国际演讲会教育体系',
      pathways: ['动态领导', '运用幽默', '激励策略', '有说服力的影响', '精通演讲', '愿景沟通'],
      goal: '终极目标：杰出沟通和领导成就荣誉会员',
      achievements: ['广州第一家以“双语”命名的俱乐部', '优选杰出俱乐部 2010-2011', '杰出俱乐部 2013-2014', '会长杰出俱乐部 2012-2013, 2015-2025', '头马大区干事的摇篮', '头马争分夺秒殊荣奖 2013, 2017', '2014、2016-2020、2024 史麦德利殊荣奖'],
      meetingFlow: ['开场和会议促进者介绍', '即兴演讲环节', '备稿环节', '备稿点评环节', '促进者报告环节', '颁奖与角色预定'],
      benefits: ['教育路径，一套成熟的演讲目标达成指引', '和来自不同领域的伙伴学习交流', '挑战担任俱乐部乃至大区干事', '从导师和资深会员接收到反馈', '学习给以反馈，甚至成为导师', '参加演讲比赛', '担任不同角色，锻炼不同能力', '免费参加头马其他俱乐部例会'],
      joining: '新会员面试一般定于每月最后一次例会结束后，如有意愿可以提前向会员副会长报名。\n\n入会要求：\na. 参加3次或以上双语例会，并至少在两次例会中担任不同角色；\nb. 有强烈的学习成长意愿，能积极参加例会；\nc. 通过面试。',
      resources: '推荐资源：总部网站 - http://www.toastmasters.org    118大区公众号 - Toastmasters D118',
      officers: [
        { role: '会长 President', name: '白俊杰 Benny', phone: '13560239936', wechat: 'benny-bai' },
        { role: '教育副会长 VPE', name: '韦文耐 Winnie', phone: '13250578375', wechat: 'a15078646220' },
        { role: '会员副会长 VPM', name: '不懂先生 Franco', phone: '15920120728', wechat: 'hgw620782' },
        { role: '公关副会长 VPPR', name: '周沫 Mo', phone: '16601756896', wechat: 'Movision_design' },
        { role: '秘书长 Secretary', name: '廖凤媚 Miranda', phone: '15247155831', wechat: 'M15920143399' },
        { role: '财务官 Treasurer', name: '李鑫 Yolanda', phone: '15625040772', wechat: 'yolanda_lixin' },
        { role: '事务官 SAA', name: '文烨彬 Wendy', phone: '15247155831', wechat: 'Cap-WM' },
        { role: '荣誉会长 IPP', name: '严芷君 Sapphire', phone: '13249154881', wechat: 'YanZhijun18' }
      ]
    },
    settings: {
      specialSessionEnabled: true,
      evaluationDuration: 3,
      preparedFallbackDuration: 7,
      signInTime: '19:00',
      mainStartTime: '19:30'
    },
    agendaRules: [
      { id: 'preparation', titleZh: '会议筹备', titleEn: 'Meeting Preparation', duration: 0, memberPersonEditable: true },
      { id: 'signIn', titleZh: '签到、欢迎来宾', duration: 0, memberPersonEditable: true },
      { id: 'venueIntroduction', titleZh: '会场秩序介绍', duration: 2, memberPersonEditable: true },
      { id: 'openingIcebreaker', titleZh: '破冰', duration: 3 },
      { id: 'guestIntroduction', titleZh: '宾客自我介绍', duration: 2 },
      { id: 'host', titleZh: '主持人', duration: 2, memberPersonEditable: true },
      { id: 'photographer', titleZh: '摄影师', duration: 0, memberPersonEditable: true },
      { id: 'timerIntro', titleZh: '计时员', duration: 1, memberPersonEditable: true },
      { id: 'ahCounterIntro', titleZh: '哼哈师', duration: 1, memberPersonEditable: true },
      { id: 'grammarianIntro', titleZh: '语法师', duration: 2, memberPersonEditable: true },
      { id: 'generalEvaluatorIntro', titleZh: '总体点评师', duration: 1, memberPersonEditable: true },
      { id: 'topicExplanation', titleZh: '解释主题讨论与主题', duration: 2, memberPersonEditable: true },
      { id: 'tableTopicsSpeech', titleZh: '即兴演讲', duration: 15, memberDurationEditable: true, memberPersonEditable: true },
      { id: 'topicNote', titleZh: '给每位演讲者一个不同的主题', duration: 0 },
      { id: 'topicSummary', titleZh: '总结', duration: 1, memberPersonEditable: true },
      { id: 'tableTopicsEvaluation', titleZh: '即兴点评', duration: 7, memberDurationEditable: true, memberPersonEditable: true },
      { id: 'tableTopicsIcebreaker', titleZh: '破冰', duration: 0, memberDurationEditable: true, memberPersonEditable: true },
      { id: 'break', titleZh: '中场休息+合照', duration: 5, memberDurationEditable: true },
      { id: 'specialSession', titleZh: '特别主题环节', duration: 25, memberDurationEditable: true, memberPersonEditable: true, memberTitleEditable: true },
      { id: 'grammarianReport', titleZh: '语法师', duration: 4, memberPersonEditable: true },
      { id: 'ahCounterReport', titleZh: '哼哈师', duration: 1, memberPersonEditable: true },
      { id: 'timerReport', titleZh: '计时员', duration: 1, memberPersonEditable: true },
      { id: 'generalEvaluatorReport', titleZh: '总体点评师', duration: 8, memberPersonEditable: true },
      { id: 'vote', titleZh: '最佳演讲者投票', duration: 1 },
      { id: 'feedback', titleZh: '宾客和会员反馈', duration: 4, memberPersonEditable: true },
      { id: 'award', titleZh: '给最佳演讲者颁奖', duration: 2, memberPersonEditable: true },
      { id: 'roleBooking', titleZh: '会议角色预定', duration: 1, memberPersonEditable: true }
    ]
  };
  const titleEnMap = {
    signIn: 'Registration and Welcome', venueIntroduction: 'Guest SAA Briefing', openingIcebreaker: 'Icebreaker', guestIntroduction: 'Guest Introductions', host: 'Toastmaster of the Evening', photographer: 'Photographer', timerIntro: 'Timer', ahCounterIntro: 'Ah-Counter', grammarianIntro: 'Grammarian', generalEvaluatorIntro: 'General Evaluator', topicExplanation: 'Table Topics Master', tableTopicsSpeech: 'Table Topics Time', topicNote: 'A Different Topic for Each Speaker', topicSummary: 'Summary', tableTopicsEvaluation: 'Table Topics Evaluation', tableTopicsIcebreaker: 'Icebreaker', break: 'Break and Group Photo', specialSession: 'Special Session', grammarianReport: 'Grammarian Report', ahCounterReport: 'Ah-Counter Report', timerReport: 'Timer Report', generalEvaluatorReport: 'General Evaluator Report', vote: 'Best Speaker Voting', feedback: 'Guest and Member Feedback', award: 'Awards', roleBooking: 'Next Meeting Role Booking'
  };
  template.agendaRules = template.agendaRules.map((rule) => Object.assign({}, rule, { titleEn: rule.titleEn || titleEnMap[rule.id] || rule.titleZh }));
  template.locales = {
    zh: { fixedContent: cloneJson(template.fixedContent), sidebar: cloneJson(template.sidebar), timerRules: cloneJson(template.timerRules), page2: cloneJson(template.page2) },
    en: createEnglishLocale()
  };
  template.locales.en.page2.officers = cloneJson(template.page2.officers);
  return template;
}

/**
 * 方法是什么：升级并补齐单模板双语文案。
 * 方法作用：把旧模板顶层中文文案迁入 locales.zh，并补上英文默认值和共享配置。
 * 为什么添加：数据库中的现有模板必须无损升级且继续使用同一模板 ID。
 */
function normalizeTemplate(templateValue) {
  const defaults = createDefaultTemplate();
  const source = cloneJson(templateValue || {});
  const hasLocales = source.locales && source.locales.zh;
  const zhSource = hasLocales ? source.locales.zh : {
    fixedContent: source.fixedContent,
    sidebar: source.sidebar,
    timerRules: source.timerRules,
    page2: source.page2
  };
  const template = Object.assign({}, defaults, source, {
    templateId: TEMPLATE_ID,
    settings: Object.assign({}, defaults.settings, source.settings || {}),
    assets: Object.assign({}, defaults.assets, source.assets || {}),
    agendaRules: Array.isArray(source.agendaRules) && source.agendaRules.length ? source.agendaRules : defaults.agendaRules
  });
  template.agendaRules = template.agendaRules.map((rule) => {
    const fallback = defaults.agendaRules.find((item) => item.id === rule.id) || {};
    return Object.assign({}, fallback, rule);
  });
  template.locales = {
    zh: {
      fixedContent: Object.assign({}, defaults.locales.zh.fixedContent, zhSource && zhSource.fixedContent || {}),
      sidebar: Object.assign({}, defaults.locales.zh.sidebar, zhSource && zhSource.sidebar || {}),
      timerRules: Array.isArray(zhSource && zhSource.timerRules) ? zhSource.timerRules : defaults.locales.zh.timerRules,
      page2: Object.assign({}, defaults.locales.zh.page2, zhSource && zhSource.page2 || {})
    },
    en: {
      fixedContent: Object.assign({}, defaults.locales.en.fixedContent, source.locales && source.locales.en && source.locales.en.fixedContent || {}),
      sidebar: Object.assign({}, defaults.locales.en.sidebar, source.locales && source.locales.en && source.locales.en.sidebar || {}),
      timerRules: Array.isArray(source.locales && source.locales.en && source.locales.en.timerRules) ? source.locales.en.timerRules : defaults.locales.en.timerRules,
      page2: Object.assign({}, defaults.locales.en.page2, source.locales && source.locales.en && source.locales.en.page2 || {})
    }
  };
  return template;
}

/**
 * 方法是什么：解析指定语言的模板视图。
 * 方法作用：保持现有预览和 PDF 字段接口，同时从双语模板中选择正确文案。
 * 为什么添加：页面无需同时处理两套字段，云端和小程序也能共享选择逻辑。
 */
function resolveTemplateLocale(templateValue, languageValue) {
  const template = normalizeTemplate(templateValue);
  const language = normalizeLanguage(languageValue);
  const locale = template.locales[language];
  return Object.assign({}, template, cloneJson(locale), { activeLanguage: language });
}

/**
 * 方法是什么：读取模板规则。
 * 方法作用：按规则 ID 合并模板覆盖值和代码默认值。
 * 为什么添加：超管修改标题、默认时长或会员权限后，构建议程必须立即生效。
 */
function getRule(template, id) {
  const source = template && Array.isArray(template.agendaRules) ? template.agendaRules : [];
  const fallback = createDefaultTemplate().agendaRules.find((item) => item.id === id) || { id, titleZh: id, duration: 0 };
  return Object.assign({}, fallback, source.find((item) => item.id === id) || {});
}

/**
 * 方法是什么：创建模板负责人对象。
 * 方法作用：从第二页干事表中解析当前会长作为默认人员。
 * 为什么添加：开场白和会议尾声需要随模板干事信息自动更新会长姓名。
 */
function createPresidentPerson(template, language) {
  const localized = resolveTemplateLocale(template, language);
  const officers = localized.page2 && Array.isArray(localized.page2.officers) ? localized.page2.officers : [];
  const president = officers.find((item) => String(item.role || '').includes('会长')) || {};
  const name = String(president.name || '会长').split(/\s+/)[0];
  return createPerson({ rawName: name, displayNameZh: name, clubZh: '广州双语', clubEn: 'Bilingual', inputMode: 'input' });
}

/**
 * 方法是什么：创建议程普通行。
 * 方法作用：把模板规则、人员、显示模式和会员权限组合成稳定节点。
 * 为什么添加：固定议程包含大量相同行结构，集中创建可以避免规则遗漏。
 */
function createRow(template, id, options) {
  const rule = getRule(template, id);
  const opts = options || {};
  return {
    id,
    type: opts.type || 'row',
    titleZh: opts.titleZh || rule.titleZh,
    titleEn: opts.titleEn || rule.titleEn || '',
    duration: Math.max(Number(opts.duration === undefined ? rule.duration : opts.duration) || 0, 0),
    person: createPerson(opts.person),
    persons: Array.isArray(opts.persons) ? opts.persons.map(createPerson) : [],
    personMode: opts.personMode || 'editable',
    clubMode: opts.clubMode || 'person',
    clubZh: opts.clubZh || '',
    showDuration: opts.showDuration !== false,
    permissions: {
      memberTitle: Boolean(rule.memberTitleEditable),
      memberDuration: Boolean(rule.memberDurationEditable),
      memberPerson: Boolean(rule.memberPersonEditable),
      memberClub: Boolean(rule.memberPersonEditable || opts.memberClubEditable)
    },
    roleKey: opts.roleKey || ''
  };
}

/**
 * 方法是什么：规范化解析角色人员。
 * 方法作用：从解析事实的 rolePeople 映射中安全读取角色。
 * 为什么添加：接龙可能缺少任意角色，固定模板仍需生成空的可编辑人员控件。
 */
function rolePerson(facts, key, fallback) {
  const people = facts && facts.rolePeople ? facts.rolePeople : {};
  return createPerson(people[key] || fallback || {});
}

/**
 * 方法是什么：创建备稿演讲块。
 * 方法作用：把演讲标题、Pathways、演讲者和点评者组合成可排序小模块。
 * 为什么添加：备稿演讲需要整体增删排序并单向派生点评模块。
 */
function createPreparedBlock(value, index, template) {
  const source = value || {};
  const speech = source.speech || source;
  const pathway = source.pathway || {
    code: speech.projectCode || '',
    fullLabelZh: speech.projectTitleZh || '',
    fullLabelEn: speech.projectTitleEn || '',
    objectiveZh: speech.projectObjectiveZh || '',
    objectiveEn: speech.projectObjectiveEn || ''
  };
  const hasDuration = source.duration !== undefined && source.duration !== null && source.duration !== '';
  const duration = hasDuration ? Number(source.duration) : parsePathwayDuration(pathway.objectiveZh || pathway.fullLabelZh, template.settings.preparedFallbackDuration);
  return {
    id: source.id || `prepared-${Date.now()}-${index}`,
    type: 'preparedSpeechBlock',
    titleZh: source.titleZh || speech.title || '',
    titleEn: source.titleEn || speech.titleEn || source.titleZh || speech.title || '',
    duration: Math.max(Number(duration) || template.settings.preparedFallbackDuration, 0),
    speaker: createPerson(source.speaker || speech.speaker || source.person),
    evaluator: createPerson(source.evaluator || speech.evaluator),
    pathway,
    permissions: { memberTitle: true, memberDuration: true, memberPerson: true, memberClub: true, memberStructure: true }
  };
}

/**
 * 方法是什么：创建完整 AgendaV2。
 * 方法作用：把解析后的会议事实映射到固定议程结构和默认模板规则。
 * 为什么添加：DeepSeek 只提供事实，不能再决定流程结构、时长和权限。
 */
function createAgendaFromFacts(factsValue, templateValue) {
  const facts = factsValue || {};
  const template = normalizeTemplate(templateValue);
  const president = createPresidentPerson(template, facts.meetingInfo && facts.meetingInfo.language);
  const ttMaster = rolePerson(facts, 'tableTopicsMaster');
  const sections = [
    { id: 'preparation', type: 'row', anchorTime: '', children: [], row: createRow(template, 'preparation', { person: rolePerson(facts, 'meetingManager'), roleKey: 'meetingManager' }) },
    { id: 'signIn', type: 'row', anchorTime: '19:00', children: [], row: createRow(template, 'signIn', { persons: [rolePerson(facts, 'guestReception'), rolePerson(facts, 'memberReception')], personMode: 'multiple', clubMode: 'manual', memberClubEditable: true }) },
    { id: 'venueIntroduction', type: 'row', anchorTime: '19:30', children: [], row: createRow(template, 'venueIntroduction', { person: rolePerson(facts, 'venueIntroduction') }) },
    { id: 'opening', type: 'group', titleZh: '开场白', titleEn: 'Opening', transitionPolicy: 'none', children: [
      createRow(template, 'openingIcebreaker', { person: president, personMode: 'fixed' }),
      createRow(template, 'guestIntroduction', { person: createPerson({ rawName: '宾客', clubZh: '宾客', clubEn: 'Guest' }), personMode: 'fixed' })
    ] },
    { id: 'facilitatorIntroduction', type: 'group', titleZh: '会议促进者介绍', titleEn: 'Meeting Facilitator Introductions', transitionPolicy: 'betweenChildren', children: [
      createRow(template, 'host', { person: rolePerson(facts, 'toastmaster'), roleKey: 'toastmaster' }),
      createRow(template, 'photographer', { person: rolePerson(facts, 'photographer'), roleKey: 'photographer', showDuration: false }),
      createRow(template, 'timerIntro', { person: rolePerson(facts, 'timer'), roleKey: 'timer' }),
      createRow(template, 'ahCounterIntro', { person: rolePerson(facts, 'ahCounter'), roleKey: 'ahCounter' }),
      createRow(template, 'grammarianIntro', { person: rolePerson(facts, 'grammarian'), roleKey: 'grammarian' }),
      createRow(template, 'generalEvaluatorIntro', { person: rolePerson(facts, 'generalEvaluator'), roleKey: 'generalEvaluator' })
    ] },
    { id: 'tableTopics', type: 'group', titleZh: '即兴演讲环节', titleEn: 'Table Topics', transitionPolicy: 'none', children: [
      createRow(template, 'topicExplanation', { person: ttMaster, roleKey: 'tableTopicsMaster' }),
      createRow(template, 'tableTopicsSpeech', { person: createPerson({ rawName: '随机演讲者', clubZh: '全部', clubEn: 'All' }) }),
      createRow(template, 'topicNote', { type: 'note', personMode: 'none', showDuration: false }),
      createRow(template, 'topicSummary', { person: ttMaster, roleKey: 'tableTopicsMaster' }),
      createRow(template, 'tableTopicsEvaluation', { person: rolePerson(facts, 'tableTopicsEvaluator'), roleKey: 'tableTopicsEvaluator' }),
      createRow(template, 'tableTopicsIcebreaker', { person: createPerson({ clubZh: '', clubEn: '' }) })
    ] },
    { id: 'preparedSpeech', type: 'group', titleZh: '有准备的演讲环节', titleEn: 'Prepared Speeches', transitionPolicy: 'betweenChildren', children: (facts.preparedSpeeches || []).map((item, index) => createPreparedBlock(item, index, template)) },
    { id: 'break', type: 'row', children: [], row: createRow(template, 'break', { personMode: 'none', clubMode: 'fixed', clubZh: '全体参会人员欢聚' }) },
    { id: 'specialSession', type: 'row', enabled: template.settings.specialSessionEnabled !== false, children: [], row: createRow(template, 'specialSession', { person: createPerson({ clubZh: '', clubEn: '' }) }) },
    { id: 'evaluation', type: 'group', titleZh: '备稿演讲点评', titleEn: 'Prepared Speech Evaluations', transitionPolicy: 'betweenChildren', derived: true, children: [] },
    { id: 'facilitatorReport', type: 'group', titleZh: '会议促进者报告', titleEn: 'Meeting Facilitator Reports', transitionPolicy: 'betweenChildren', children: [
      createRow(template, 'grammarianReport', { person: rolePerson(facts, 'grammarian'), roleKey: 'grammarian' }),
      createRow(template, 'ahCounterReport', { person: rolePerson(facts, 'ahCounter'), roleKey: 'ahCounter' }),
      createRow(template, 'timerReport', { person: rolePerson(facts, 'timer'), roleKey: 'timer' }),
      createRow(template, 'generalEvaluatorReport', { person: rolePerson(facts, 'generalEvaluator'), roleKey: 'generalEvaluator' })
    ] },
    { id: 'vote', type: 'row', children: [], row: createRow(template, 'vote', { person: createPerson({ rawName: '全部', clubZh: '', clubEn: '' }), personMode: 'fixed' }) },
    { id: 'closing', type: 'group', titleZh: '会议尾声', titleEn: 'Closing', transitionPolicy: 'none', children: [
      createRow(template, 'feedback', { person: president }),
      createRow(template, 'award', { person: president }),
      createRow(template, 'roleBooking', { person: rolePerson(facts, 'nextMeetingHost') })
    ] },
    { id: 'end', type: 'end', titleZh: '会议结束', titleEn: 'Meeting Adjourned', duration: 0, children: [] }
  ];
  const agenda = {
    schemaVersion: AGENDA_SCHEMA_VERSION,
    templateId: template.templateId,
    templateUpdatedAt: template.updatedAt || '',
    rawText: facts.rawText || '',
    meetingInfo: Object.assign({ meetingNo: '', date: '', weekday: '', startTime: template.settings.mainStartTime, endTime: '21:30', address: '', theme: '', language: 'zh' }, facts.meetingInfo || {}),
    sections,
    participants: facts.participants || [],
    warnings: facts.warnings || [],
    unresolvedNames: facts.unresolvedNames || [],
    assets: { meetingGroupQr: template.assets.meetingGroupQr }
  };
  return calculateAgenda(agenda, template);
}

/**
 * 方法是什么：同步备稿点评模块。
 * 方法作用：根据备稿演讲块重新创建只读点评行并复制点评者。
 * 为什么添加：排序、删除或修改点评者后不能让两处数据产生冲突。
 */
function syncEvaluationSection(agenda, template) {
  const prepared = agenda.sections.find((section) => section.id === 'preparedSpeech');
  const evaluation = agenda.sections.find((section) => section.id === 'evaluation');
  if (!prepared || !evaluation) {
    return agenda;
  }
  const duration = Math.max(Number(template.settings.evaluationDuration) || 3, 0);
  evaluation.children = (prepared.children || []).map((block, index) => ({
    id: `evaluation-${block.id || index}`,
    type: 'row',
    titleZh: `对${block.speaker.displayNameZh || block.speaker.rawName || `演讲者${index + 1}`}的点评`,
    titleEn: `Evaluation ${index + 1}`,
    duration,
    person: createPerson(block.evaluator),
    persons: [],
    personMode: 'derived',
    clubMode: 'person',
    clubZh: '',
    showDuration: true,
    permissions: { memberTitle: false, memberDuration: false, memberPerson: false, memberClub: false },
    sourceBlockId: block.id
  }));
  return agenda;
}

/**
 * 方法是什么：计算一个模块的占用时长。
 * 方法作用：累加子项时长并按指定策略加入相邻节点过渡时间。
 * 为什么添加：大模块显示时长必须与后续开始时间使用同一口径。
 */
function calculateSectionDuration(section) {
  if (section.type === 'row') {
    return section.enabled === false ? 0 : Math.max(Number(section.row && section.row.duration) || 0, 0);
  }
  if (section.type !== 'group') {
    return 0;
  }
  const children = section.children || [];
  const total = children.reduce((sum, child) => sum + Math.max(Number(child.duration) || 0, 0), 0);
  const transitions = section.transitionPolicy === 'betweenChildren' ? Math.max(children.length - 1, 0) : 0;
  return total + transitions;
}

/**
 * 方法是什么：计算完整议程时间链。
 * 方法作用：应用签到和主流程锚点，写入模块开始时间、总时长与最终结束时间。
 * 为什么添加：任何标题、时长、排序和模板变化后都必须得到可重复的时间结果。
 */
function calculateAgenda(agendaValue, templateValue) {
  const agenda = agendaValue;
  const template = normalizeTemplate(templateValue);
  syncEvaluationSection(agenda, template);
  const language = normalizeLanguage(agenda.meetingInfo && agenda.meetingInfo.language);
  const mainStart = parseTime(template.settings.mainStartTime) === null ? parseTime('19:30') : parseTime(template.settings.mainStartTime);
  const signInTime = parseTime(template.settings.signInTime) === null ? '19:00' : formatTime(parseTime(template.settings.signInTime));
  let cursor = mainStart;
  let meetingEndCursor = null;
  (agenda.sections || []).forEach((section) => {
    const languageVisible = !section.languageGate || section.languageGate === language;
    if (section.enabled === false || !languageVisible) {
      section.startTime = '';
      section.duration = 0;
      return;
    }
    if (section.id === 'preparation') {
      section.startTime = '';
      section.duration = 0;
      return;
    }
    if (section.id === 'signIn') {
      section.startTime = signInTime;
      section.duration = 0;
      return;
    }
    if (section.id === 'venueIntroduction') {
      cursor = mainStart;
    }
    if (section.postMeeting) {
      const postStart = meetingEndCursor === null ? cursor : meetingEndCursor;
      section.startTime = formatTime(postStart);
      section.duration = calculateSectionDuration(section);
      return;
    }
    section.startTime = formatTime(cursor);
    section.duration = calculateSectionDuration(section);
    if (section.type === 'end') {
      meetingEndCursor = cursor;
    } else {
      cursor += section.duration;
    }
  });
  agenda.computedEndTime = formatTime(meetingEndCursor === null ? cursor : meetingEndCursor);
  agenda.timeMismatch = Boolean(agenda.meetingInfo.endTime && agenda.meetingInfo.endTime !== agenda.computedEndTime);
  return agenda;
}

/**
 * 方法是什么：把旧议程升级为 AgendaV2。
 * 方法作用：尽可能从旧 roleKey、speech 和平面模块恢复解析事实后重建固定流程。
 * 为什么添加：部署后七天内的现有草稿仍应能够继续编辑而不是直接报废。
 */
function upgradeLegacyAgenda(value, template) {
  const source = value || {};
  const rolePeople = {};
  const preparedSpeeches = [];
  const items = Array.isArray(source.items) ? source.items : (source.sections || []).reduce((list, section) => list.concat(section.items || []), []);
  items.forEach((item) => {
    if (item.roleKey) {
      rolePeople[item.roleKey] = createPerson(item.person);
    }
    if (item.type === 'preparedSpeech' || item.speech) {
      preparedSpeeches.push(Object.assign({}, item.speech || {}, { id: item.id, titleZh: item.titleZh, duration: item.duration, speaker: item.person || item.speech && item.speech.speaker }));
    }
  });
  return createAgendaFromFacts({
    rawText: source.rawText,
    meetingInfo: source.meetingInfo,
    rolePeople,
    preparedSpeeches,
    participants: source.participants,
    warnings: (source.warnings || []).concat('议程已从旧版结构自动升级'),
    unresolvedNames: source.unresolvedNames
  }, template);
}

/**
 * 方法是什么：把最新模板规则应用到现有草稿。
 * 方法作用：刷新锁定标题、锁定时长和会员权限，同时保留会员可编辑的动态值。
 * 为什么添加：全局模板保存后必须立即作用于当前七天草稿且不能抹掉会员填写内容。
 */
function applyTemplateRules(agenda, template) {
  const templateChanged = String(agenda.templateUpdatedAt || '') !== String(template.updatedAt || '');
  const applyRow = (row) => {
    if (!row || row.type === 'preparedSpeechBlock') {
      return;
    }
    const rule = (template.agendaRules || []).find((item) => item.id === row.id);
    if (!rule) {
      return;
    }
    if (templateChanged && !rule.memberTitleEditable) {
      row.titleZh = rule.titleZh;
      row.titleEn = rule.titleEn || row.titleEn || rule.titleZh;
    }
    if (templateChanged && !rule.memberDurationEditable) {
      row.duration = Math.max(Number(rule.duration) || 0, 0);
    }
    row.permissions = {
      memberTitle: Boolean(rule.memberTitleEditable),
      memberDuration: Boolean(rule.memberDurationEditable),
      memberPerson: Boolean(rule.memberPersonEditable),
      memberClub: Boolean(rule.memberPersonEditable)
    };
  };
  (agenda.sections || []).forEach((section) => {
    applyRow(section.row);
    (section.children || []).forEach(applyRow);
  });
  agenda.templateUpdatedAt = template.updatedAt || '';
  return agenda;
}

/**
 * 方法是什么：规范化 AgendaV2。
 * 方法作用：补齐模板字段、人员对象、备稿块和计算时间，并兼容旧数据。
 * 为什么添加：页面、保存接口和 PDF 入口必须接受同一稳定数据形状。
 */
function normalizeAgenda(value, templateValue) {
  const template = normalizeTemplate(templateValue);
  if (!value || Number(value.schemaVersion) !== AGENDA_SCHEMA_VERSION || !Array.isArray(value.sections)) {
    return upgradeLegacyAgenda(value || {}, template);
  }
  const agenda = cloneJson(value);
  agenda.templateId = agenda.templateId || template.templateId;
  agenda.meetingInfo = Object.assign({}, createAgendaFromFacts({}, template).meetingInfo, agenda.meetingInfo || {});
  agenda.assets = Object.assign({ meetingGroupQr: template.assets.meetingGroupQr }, agenda.assets || {});
  agenda.warnings = Array.isArray(agenda.warnings) ? agenda.warnings : [];
  agenda.sections.forEach((section) => {
    if (section.row) {
      section.row.person = createPerson(section.row.person);
      section.row.persons = Array.isArray(section.row.persons) ? section.row.persons.map(createPerson) : [];
    }
    if (section.id === 'preparedSpeech') {
      section.children = (section.children || []).map((block, index) => createPreparedBlock(block, index, template));
    } else {
      section.children = (section.children || []).map((row) => Object.assign({}, row, {
        duration: Math.max(Number(row.duration) || 0, 0),
        person: createPerson(row.person),
        persons: Array.isArray(row.persons) ? row.persons.map(createPerson) : []
      }));
    }
  });
  const special = agenda.sections.find((section) => section.id === 'specialSession');
  if (special) {
    special.enabled = template.settings.specialSessionEnabled !== false;
  }
  applyTemplateRules(agenda, template);
  return calculateAgenda(agenda, template);
}

/**
 * 方法是什么：创建空议程。
 * 方法作用：用默认模板生成编辑器首次渲染所需的 AgendaV2。
 * 为什么添加：页面初始化不能依赖解析接口已经返回数据。
 */
function createEmptyAgenda() {
  return createAgendaFromFacts({}, createDefaultTemplate());
}

/**
 * 方法是什么：创建每期动态模块行。
 * 方法作用：按模块种类生成双语标题、默认时长、人员和完整会员编辑权限。
 * 为什么添加：动态模块不能污染全局模板规则，但仍需使用标准 AgendaV2 行结构。
 */
function createDynamicRow(kind, index) {
  const spec = DYNAMIC_MODULES[kind];
  if (!spec) {
    return null;
  }
  return {
    id: `dynamic-${kind}-${Date.now()}-${index || 0}`,
    type: 'row',
    dynamic: true,
    moduleKind: kind,
    titleZh: spec.titleZh,
    titleEn: spec.titleEn,
    duration: spec.duration,
    person: createPerson({ clubZh: '', clubEn: '' }),
    persons: [],
    personMode: 'editable',
    clubMode: 'person',
    clubZh: '',
    showDuration: true,
    permissions: { memberTitle: true, memberDuration: true, memberPerson: true, memberClub: true, memberStructure: true }
  };
}

/**
 * 方法是什么：向当前议程添加动态模块。
 * 方法作用：执行唯一性检查并按产品规定插入子行或顶层位置。
 * 为什么添加：编辑器、保存和测试需要共享确定性的默认顺序。
 */
function addDynamicModule(agendaValue, kind) {
  const agenda = cloneJson(agendaValue);
  const spec = DYNAMIC_MODULES[kind];
  if (!spec) {
    return agenda;
  }
  const exists = (agenda.sections || []).some((section) => section.moduleKind === kind || (section.children || []).some((row) => row.moduleKind === kind));
  if (exists) {
    return agenda;
  }
  const row = createDynamicRow(kind, agenda.sections.length);
  if (kind === 'icebreaker') {
    const parent = agenda.sections.find((section) => section.id === 'facilitatorIntroduction');
    if (parent) {
      parent.children.push(row);
    }
    return agenda;
  }
  const anchorIndex = agenda.sections.findIndex((section) => section.id === spec.placement);
  const section = {
    id: row.id,
    type: 'row',
    dynamic: true,
    moduleKind: kind,
    movable: Boolean(spec.movable),
    deletable: true,
    postMeeting: Boolean(spec.postMeeting),
    languageGate: spec.languageGate || '',
    children: [],
    row
  };
  agenda.sections.splice(anchorIndex < 0 ? agenda.sections.length : anchorIndex + 1, 0, section);
  return agenda;
}

/**
 * 方法是什么：创建空备稿块。
 * 方法作用：为会员新增备稿演讲提供默认标题、人员、项目和七分钟时长。
 * 为什么添加：备稿模块需要支持任意数量的小模块增删排序。
 */
function createEmptyPreparedBlock(index, templateValue) {
  const template = templateValue || createDefaultTemplate();
  return createPreparedBlock({ id: `prepared-${Date.now()}-${index}`, duration: template.settings.preparedFallbackDuration }, index, template);
}

/**
 * 方法是什么：移动数组元素。
 * 方法作用：以不可变方式调整备稿块或模板规则顺序。
 * 为什么添加：排序操作需要保持小程序数据更新可预测。
 */
function moveItem(list, fromIndex, toIndex) {
  if (!Array.isArray(list) || fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length) {
    return list;
  }
  const result = list.slice();
  const moving = result.splice(fromIndex, 1)[0];
  result.splice(toIndex, 0, moving);
  return result;
}

/**
 * 方法是什么：展开议程显示行。
 * 方法作用：把顶层模块、子行和备稿块转换为 PDF 与预览可迭代的连续节点。
 * 为什么添加：两个渲染器需要共享相同的行顺序和派生字段。
 */
function flattenAgendaRows(agendaValue) {
  const rows = [];
  const language = normalizeLanguage(agendaValue && agendaValue.meetingInfo && agendaValue.meetingInfo.language);
  (agendaValue.sections || []).forEach((section) => {
    if (section.enabled === false || section.languageGate && section.languageGate !== language) {
      return;
    }
    if (section.type === 'row') {
      rows.push(Object.assign({}, section.row, { startTime: section.startTime, duration: section.duration, isGroup: false }));
      return;
    }
    rows.push({ id: section.id, type: section.type, titleZh: section.titleZh, startTime: section.startTime, duration: section.duration, isGroup: true, personMode: 'none' });
    (section.children || []).forEach((child) => rows.push(Object.assign({}, child, { startTime: '', isGroup: false })));
  });
  return rows;
}

module.exports = {
  TEMPLATE_ID,
  AGENDA_SCHEMA_VERSION,
  cloneJson,
  createPerson,
  parseTime,
  formatTime,
  parsePathwayDuration,
  normalizeLanguage,
  createDefaultTemplate,
  normalizeTemplate,
  resolveTemplateLocale,
  getRule,
  createAgendaFromFacts,
  createEmptyAgenda,
  createDynamicRow,
  addDynamicModule,
  createEmptyPreparedBlock,
  normalizeAgenda,
  calculateAgenda,
  calculateSectionDuration,
  syncEvaluationSection,
  applyTemplateRules,
  moveItem,
  flattenAgendaRows,
  DYNAMIC_MODULES
};
