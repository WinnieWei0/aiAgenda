const assert = require('assert');
const parser = require('../cloudfunctions/common/parser');
const pdfRenderer = require('../cloudfunctions/common/pdf-renderer');
const workbookParser = require('../cloudfunctions/seedWorkbookData/workbook-parser');
const XLSX = require('../cloudfunctions/seedWorkbookData/node_modules/xlsx');
const membershipImporter = require('../scripts/import-membership');
const pathwayImporter = require('../scripts/import-pathways');
const agendaUtil = require('../miniprogram/utils/agenda');
const agendaQuery = require('../cloudfunctions/agendaQuery');
const common = require('../cloudfunctions/common');
const lookupOptions = require('../cloudfunctions/lookupOptions');
const saveAgenda = require('../cloudfunctions/saveAgenda');
const { PDFDocument } = require('../cloudfunctions/common/node_modules/pdf-lib');

let memberships = [];
let pathways = [];

const SAMPLE_TEXT = `#接龙
广州双语国际演讲俱乐部第760期中文会议，欢迎大家报名角色

📆时间：2026年7月8日周三19:30-21:30
🏠地址：广州市天河区珠江新城华穗路172号星辰大厦西塔1904-A房（5号线珠江新城B1出口）

礼宾官（宾客） ：维奇
会议经理：马威
总主持人：文烨彬
时间官：谢仁
语法师：[太阳]
总体点评：不懂

即兴主持人：文耐
即兴点评：建安

备稿演讲者1：周沫
项目级别：L4P3
点评者1：张国聪

备稿演讲者2：文耐
项目级别：L2P2
点评者2：佩欣

参与者请接龙报名：
1. 文耐
2. Brittany.蔡
3. 张国聪(省直中文)`;

/**
 * 方法是什么：断言姓名可以匹配到指定会员中文名。
 * 方法作用：复用姓名匹配逻辑验证简称、混合名和括号说明。
 * 为什么添加：姓名匹配是接龙解析质量的关键，测试可以防止后续改动破坏匹配。
 */
function assertMember(rawName, expectedNameZh) {
  const match = parser.matchMemberByName(rawName, memberships);
  assert.strictEqual(match.matched, true, `${rawName} 应该匹配成功`);
  assert.strictEqual(match.member.nameZh, expectedNameZh, `${rawName} 应匹配 ${expectedNameZh}`);
}

/**
 * 方法是什么：构造最小 Excel 导入样例。
 * 方法作用：在不读取代码内置数据的情况下，生成包含会员和路径工作表的测试工作簿。
 * 为什么添加：本地测试应验证真实 Excel 解析链路，而不是继续依赖静态 JSON fixture。
 */
function createWorkbookFixture() {
  const workbook = XLSX.utils.book_new();
  const membershipRows = [
    ['昵称', '姓名', '英文名', '加入头马时间', 'Title on Agenda', '议程表填写', '路径', '路径(中文)'],
    ['', '马威', 'Will Ma', '2010-11-01', 'Will Ma(PM)', '马威(PM)', 'Presentation Mastery', '精通演讲'],
    ['', '韦文耐', 'Wen Nai', '', 'Wen Nai(PM)', '韦文耐(PM)', '', ''],
    ['', '不懂先生', 'Franco Huang', '', 'Franco Huang(MS)', '不懂先生(MS)', '', ''],
    ['', '陈佩欣', 'Penny Chen', '', 'Penny Chen(IP1)', '陈佩欣(IP1)', '', ''],
    ['', '蔡艳灵', 'Brittany Cai', '', 'Brittany Cai(IP1)', '蔡艳灵(IP1)', '', ''],
    ['', '周沫', 'Mo Zhou', '', 'Mo Zhou(PM)', '周沫(PM)', '', ''],
    ['', '历史会员', '', '', '', '', '', ''],
    ['', '历史姓名', 'History Name', '', 'History Name(PM)', '历史姓名(PM)', '', '']
  ];
  const pathwayRows = [
    ['', 'Project', 'Objective', '', '项目名称', '项目目标', ''],
    ['Level 2', '', '', '', '', '', ''],
    ['L2P2', 'Effective Body Language', 'Objective', 'L2P2 Effective Body Language', '有效的肢体语言', '目标', 'L2P2 有效的肢体语言'],
    ['Level 4', '', '', '', '', '', ''],
    ['L4P3', 'Project Four', 'Objective Four', 'L4P3 Project Four', '项目四', '目标四', 'L4P3 项目四']
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(membershipRows), 'Membership');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(pathwayRows), 'Pathways(新)');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * 方法是什么：测试 Excel 工作簿解析。
 * 方法作用：确认 Membership 和 Pathways 数据直接从工作簿转换为数据库记录。
 * 为什么添加：基础数据缺失或误读工作表会导致接龙解析和 PDF 项目描述无法正常工作。
 */
function testWorkbookData() {
  const result = workbookParser.parseWorkbook(createWorkbookFixture());
  memberships = result.memberships;
  pathways = result.pathways;
  assert.strictEqual(result.sheets.memberships, 'Membership');
  assert.strictEqual(result.sheets.pathways, 'Pathways(新)');
  assert.strictEqual(memberships.length, 7, 'Membership Excel 数据数量异常');
  assert.strictEqual(pathways.length, 2, 'Pathways Excel 数据数量异常');
  assert.strictEqual(memberships[0].joinedAt, '2010-11-01', 'Excel 日期转换异常');
  assert.strictEqual(memberships[6].status, 'history', '历史会员区域识别异常');
  assert.ok(memberships.some(function findMo(member) {
    return member.nameZh === '周沫';
  }), '应包含周沫');
  assert.ok(pathways.some(function findL2P2(item) {
    return item.code === 'L2P2';
  }), '应包含 L2P2 项目');
  const prepared = membershipImporter.prepareMembers(Array.from({ length: 30 }, function createMember(_, index) {
    return result.memberships[index % result.memberships.length];
  }));
  assert.strictEqual(prepared.length, 26, 'Membership 精简数量异常');
  assert.ok(!Object.prototype.hasOwnProperty.call(prepared[0], 'sourceKey'), '不应保存 sourceKey');
  assert.ok(!Object.prototype.hasOwnProperty.call(prepared[0], 'rawRow'), '不应保存 rawRow');
  assert.ok(!Object.prototype.hasOwnProperty.call(prepared[0], 'titleOnAgenda'), '不应保存 titleOnAgenda');
  const pathway = pathwayImporter.preparePathway(pathways[0]);
  assert.deepStrictEqual(Object.keys(pathway).sort(), ['code', 'fullLabelEn', 'fullLabelZh', 'level', 'objectiveEn', 'objectiveZh', 'searchText'].sort(), 'Pathways 字段白名单异常');
}

/**
 * 方法是什么：测试姓名匹配能力。
 * 方法作用：覆盖中文简称、英文加中文姓、括号俱乐部说明等常见接龙写法。
 * 为什么添加：接龙里姓名写法非常自由，需要确保关键样例能匹配 Membership。
 */
function testNameMatching() {
  assertMember('文耐', '韦文耐');
  assertMember('不懂', '不懂先生');
  assertMember('佩欣', '陈佩欣');
  assertMember('Brittany.蔡', '蔡艳灵');
  assert.strictEqual(parser.matchMemberByName('张国聪(省直中文)', memberships).matched, false, '外部人员应保留待确认');
}

/**
 * 方法是什么：测试规则解析议程。
 * 方法作用：用第 760 期样例接龙验证会议字段、角色、备稿和参与者。
 * 为什么添加：保留纯函数测试覆盖解析结果到议程结构的转换。
 */
function testRuleParser() {
  const agenda = parser.validateAgenda(parser.parseAgendaByRules(SAMPLE_TEXT, memberships, pathways));
  assert.strictEqual(agenda.meetingInfo.meetingNo, '760');
  assert.strictEqual(agenda.meetingInfo.language, 'zh');
  assert.strictEqual(agenda.meetingInfo.date, '2026-07-08');
  assert.strictEqual(agenda.roles.meetingManager.rawName, '马威');
  assert.strictEqual(agenda.roles.grammarian.rawName, '');
  assert.strictEqual(agenda.preparedSpeeches.length, 2);
  assert.ok(agenda.items.length >= 10, '应生成基础流程项目');
  assert.strictEqual(agenda.participants.length, 3);
  return agenda;
}

/**
 * 方法是什么：测试模块化议程时间和排序。
 * 方法作用：验证模块、流程行、限时累计和同模块移动逻辑。
 * 为什么添加：编辑器的核心行为不能只依赖微信开发者工具手工验证。
 */
function testAgendaModel() {
  const template = agendaUtil.createDefaultTemplate();
  const agenda = agendaUtil.createAgendaFromFacts({
    meetingInfo: { startTime: '19:30', endTime: '21:30' },
    preparedSpeeches: [{ id: 'one', duration: 6 }, { id: 'two', duration: 7 }]
  }, template);
  const timeMap = Object.fromEntries(agenda.sections.map(function mapSection(section) {
    return [section.id, [section.startTime, section.duration]];
  }));
  assert.strictEqual(agenda.schemaVersion, 2, '应升级为 AgendaV2');
  assert.deepStrictEqual(timeMap.venueIntroduction, ['19:30', 2]);
  assert.deepStrictEqual(timeMap.opening, ['19:32', 5]);
  assert.deepStrictEqual(timeMap.facilitatorIntroduction, ['19:37', 12]);
  assert.deepStrictEqual(timeMap.tableTopics, ['19:49', 25]);
  assert.deepStrictEqual(timeMap.preparedSpeech, ['20:14', 14]);
  assert.deepStrictEqual(timeMap.break, ['20:28', 5]);
  assert.deepStrictEqual(timeMap.specialSession, ['20:33', 25]);
  assert.deepStrictEqual(timeMap.evaluation, ['20:58', 7]);
  assert.deepStrictEqual(timeMap.facilitatorReport, ['21:05', 17]);
  assert.deepStrictEqual(timeMap.vote, ['21:22', 1]);
  assert.deepStrictEqual(timeMap.closing, ['21:23', 7]);
  assert.deepStrictEqual(timeMap.end, ['21:30', 0]);
  assert.strictEqual(agenda.computedEndTime, '21:30');
  assert.strictEqual(agenda.timeMismatch, false);
}

/**
 * 方法是什么：测试 Pathways 时长和点评派生。
 * 方法作用：验证区间上限、缺省七分钟以及备稿排序删除后的点评同步。
 * 为什么添加：备稿块是新编辑器中数据联动和时间计算最复杂的部分。
 */
function testPreparedSpeechRules() {
  assert.strictEqual(agendaUtil.parsePathwayDuration('建议演讲 4-6分钟', 7), 6);
  assert.strictEqual(agendaUtil.parsePathwayDuration('演讲时间 5至7 分钟', 7), 7);
  assert.strictEqual(agendaUtil.parsePathwayDuration('没有时间', 7), 7);
  const template = agendaUtil.createDefaultTemplate();
  const agenda = agendaUtil.createAgendaFromFacts({
    preparedSpeeches: [
      { id: 'one', titleZh: '第一篇', duration: 6, speaker: { rawName: '甲' }, evaluator: { rawName: '点评甲' } },
      { id: 'two', titleZh: '第二篇', duration: 7, speaker: { rawName: '乙' }, evaluator: { rawName: '点评乙' } }
    ]
  }, template);
  const prepared = agenda.sections.find(function findPrepared(section) { return section.id === 'preparedSpeech'; });
  const evaluation = agenda.sections.find(function findEvaluation(section) { return section.id === 'evaluation'; });
  assert.strictEqual(evaluation.children.length, 2);
  assert.strictEqual(evaluation.children[1].person.rawName, '点评乙');
  prepared.children.splice(0, 1);
  agendaUtil.calculateAgenda(agenda, template);
  assert.strictEqual(evaluation.children.length, 1);
  assert.strictEqual(evaluation.children[0].person.rawName, '点评乙');
}

/**
 * 方法是什么：测试预览导出前的完整表单校验。
 * 方法作用：验证会议基础信息、流程人员、俱乐部和备稿项目缺失时均会阻止提交。
 * 为什么添加：草稿允许不完整，但进入预览前必须确保所有可见表单项都有值。
 */
function testAgendaPreviewValidation() {
  const template = agendaUtil.createDefaultTemplate();
  const agenda = agendaUtil.createAgendaFromFacts({
    meetingInfo: { meetingNo: '800', date: '2026-07-20', theme: '完整性测试', language: 'zh' },
    rolePeople: {
      meetingManager: { rawName: '经理' },
      memberReception: { rawName: '会员SAA' },
      venueIntroduction: { rawName: '宾客SAA' },
      toastmaster: { rawName: '主持人' },
      photographer: { rawName: '摄影师' },
      timer: { rawName: '时间官' },
      ahCounter: { rawName: '哼哈官' },
      grammarian: { rawName: '语法师' },
      generalEvaluator: { rawName: '总点评' },
      tableTopicsMaster: { rawName: '即兴主持人' },
      tableTopicsEvaluator: { rawName: '即兴点评' },
      nextMeetingHost: { rawName: '下期主持人' }
    },
    preparedSpeeches: [{
      titleZh: '测试演讲',
      duration: 7,
      pathway: { code: 'L1P1', fullLabelZh: 'L1P1 破冰演讲' },
      speaker: { rawName: '演讲者' },
      evaluator: { rawName: '点评者' }
    }]
  }, template);
  assert.deepStrictEqual(agendaUtil.validateAgendaForPreview(agenda), []);
  agenda.meetingInfo.theme = '';
  agenda.sections.find((section) => section.id === 'preparedSpeech').children[0].speaker.clubZh = '';
  const errors = agendaUtil.validateAgendaForPreview(agenda);
  assert.ok(errors.includes('会议主题不能为空'));
  assert.ok(errors.some((message) => message.includes('演讲者俱乐部不能为空')));
}

/**
 * 方法是什么：测试模板开关和旧议程升级。
 * 方法作用：验证特别主题全局停用以及旧 roleKey 草稿能转换为 AgendaV2。
 * 为什么添加：上线后现有七天草稿和超管模板设置都必须继续生效。
 */
function testTemplateAndLegacyUpgrade() {
  const template = agendaUtil.createDefaultTemplate();
  template.settings.specialSessionEnabled = false;
  const normalized = agendaUtil.createAgendaFromFacts({ preparedSpeeches: [{ duration: 6 }, { duration: 7 }] }, template);
  const special = normalized.sections.find(function findSpecial(section) { return section.id === 'specialSession'; });
  assert.strictEqual(special.enabled, false);
  assert.strictEqual(normalized.computedEndTime, '21:05');
  const legacy = agendaUtil.normalizeAgenda({
    meetingInfo: { meetingNo: '700', startTime: '19:30', endTime: '21:30' },
    items: [
      { id: 'manager', roleKey: 'meetingManager', person: { rawName: '经理' } },
      { id: 'speech', type: 'preparedSpeech', titleZh: '旧备稿', duration: 6, person: { rawName: '旧演讲者' }, speech: { evaluator: { rawName: '旧点评者' } } }
    ]
  }, agendaUtil.createDefaultTemplate());
  assert.strictEqual(legacy.schemaVersion, 2);
  assert.ok(legacy.warnings.includes('议程已从旧版结构自动升级'));
  assert.strictEqual(legacy.sections.find(function findPreparation(section) { return section.id === 'preparation'; }).row.person.rawName, '经理');

  const firstTemplate = agendaUtil.createDefaultTemplate();
  firstTemplate.updatedAt = '2026-07-16T00:00:00.000Z';
  const currentAgenda = agendaUtil.createAgendaFromFacts({}, firstTemplate);
  currentAgenda.sections.find(function findTopics(section) { return section.id === 'tableTopics'; }).children.find(function findSpeech(row) { return row.id === 'tableTopicsSpeech'; }).duration = 18;
  const nextTemplate = agendaUtil.cloneJson(firstTemplate);
  nextTemplate.updatedAt = '2026-07-17T00:00:00.000Z';
  nextTemplate.agendaRules.find(function findVenue(rule) { return rule.id === 'venueIntroduction'; }).duration = 3;
  nextTemplate.agendaRules.find(function findVenue(rule) { return rule.id === 'venueIntroduction'; }).titleEn = 'Updated Guest SAA Briefing';
  nextTemplate.agendaRules.find(function findSpeechRule(rule) { return rule.id === 'tableTopicsSpeech'; }).duration = 20;
  const refreshed = agendaUtil.normalizeAgenda(currentAgenda, nextTemplate);
  assert.strictEqual(refreshed.sections.find(function findVenueSection(section) { return section.id === 'venueIntroduction'; }).row.duration, 3, '锁定时长应跟随模板更新');
  assert.strictEqual(refreshed.sections.find(function findVenueTitle(section) { return section.id === 'venueIntroduction'; }).row.titleEn, 'Updated Guest SAA Briefing', '英文锁定标题应跟随模板更新');
  assert.strictEqual(refreshed.sections.find(function findTopicsSection(section) { return section.id === 'tableTopics'; }).children.find(function findMemberSpeech(row) { return row.id === 'tableTopicsSpeech'; }).duration, 18, '会员动态时长不应被模板覆盖');
}

/**
 * 方法是什么：测试双语模板迁移和模板时间锚点。
 * 方法作用：验证旧中文文案进入 locale、英文默认文案可用，且编辑页时间不能覆盖模板锚点。
 * 为什么添加：模板语言和时间来源是本次重构的核心数据契约。
 */
function testLocalizedTemplateAndAnchors() {
  const migrated = agendaUtil.normalizeTemplate({ fixedContent: { clubTitle: '旧中文模板' } });
  assert.strictEqual(migrated.locales.zh.fixedContent.clubTitle, '旧中文模板');
  assert.ok(migrated.locales.en.fixedContent.clubTitle.includes('Bilingual'));
  const englishView = agendaUtil.resolveTemplateLocale(migrated, 'en');
  assert.strictEqual(englishView.activeLanguage, 'en');
  assert.ok(englishView.timerRules[0][0].includes('Timing'));

  const template = agendaUtil.createDefaultTemplate();
  template.settings.signInTime = '18:45';
  template.settings.mainStartTime = '20:00';
  const agenda = agendaUtil.createAgendaFromFacts({ meetingInfo: { startTime: '10:00' } }, template);
  assert.strictEqual(agenda.sections.find((section) => section.id === 'signIn').startTime, '18:45');
  assert.strictEqual(agenda.sections.find((section) => section.id === 'venueIntroduction').startTime, '20:00');
  agenda.sections.forEach((section) => { section.startTime = '01:01'; });
  const normalized = agendaUtil.normalizeAgenda(agenda, template);
  assert.strictEqual(normalized.sections.find((section) => section.id === 'venueIntroduction').startTime, '20:00');
}

/**
 * 方法是什么：测试动态模块顺序、语言门控和会后计时。
 * 方法作用：覆盖五类模块默认值、Free Talk 英文显示和面试不改变会议结束时间。
 * 为什么添加：动态模块必须在保存、预览和 PDF 共用模型中保持确定行为。
 */
function testDynamicAgendaModules() {
  const template = agendaUtil.createDefaultTemplate();
  let agenda = agendaUtil.createEmptyAgenda();
  agenda.meetingInfo.language = 'en';
  agenda = agendaUtil.addDynamicModule(agenda, 'workshop');
  agenda = agendaUtil.addDynamicModule(agenda, 'freeTalk');
  agenda = agendaUtil.addDynamicModule(agenda, 'educationAward');
  agenda = agendaUtil.addDynamicModule(agenda, 'memberInterview');
  agenda = agendaUtil.addDynamicModule(agenda, 'icebreaker');
  agenda = agendaUtil.normalizeAgenda(agenda, template);
  const order = agenda.sections.map((section) => section.moduleKind || section.id);
  assert.ok(order.indexOf('freeTalk') < order.indexOf('break'));
  assert.ok(order.indexOf('break') < order.indexOf('workshop'));
  assert.strictEqual(agenda.sections.find((section) => section.moduleKind === 'freeTalk').row.duration, 10);
  assert.strictEqual(agenda.sections.find((section) => section.moduleKind === 'workshop').row.duration, 30);
  assert.strictEqual(agenda.sections.find((section) => section.moduleKind === 'educationAward').row.duration, 10);
  const facilitator = agenda.sections.find((section) => section.id === 'facilitatorIntroduction');
  assert.strictEqual(facilitator.children[facilitator.children.length - 1].moduleKind, 'icebreaker');
  assert.strictEqual(facilitator.children[facilitator.children.length - 1].duration, 5);
  const end = agenda.sections.find((section) => section.id === 'end');
  const interview = agenda.sections.find((section) => section.moduleKind === 'memberInterview');
  assert.strictEqual(interview.row.duration, 3);
  assert.strictEqual(interview.startTime, end.startTime);
  assert.strictEqual(agenda.computedEndTime, end.startTime);

  agenda.meetingInfo.language = 'zh';
  agenda = agendaUtil.normalizeAgenda(agenda, template);
  const freeTalk = agenda.sections.find((section) => section.moduleKind === 'freeTalk');
  assert.strictEqual(freeTalk.startTime, '');
  assert.strictEqual(freeTalk.duration, 0);
  assert.strictEqual(agendaUtil.flattenAgendaRows(agenda).some((row) => row.moduleKind === 'freeTalk'), false);
}

/**
 * 方法是什么：测试接龙会议语言识别。
 * 方法作用：验证明确英文标志选择英文模板，普通接龙仍回退中文。
 * 为什么添加：Free Talk 和模板文案选择依赖稳定的语言字段。
 */
function testMeetingLanguageDetection() {
  const english = parser.parseAgendaByRules('广州双语国际演讲俱乐部第800期英文会议，欢迎大家报名角色\n时间：2026年7月8日周三 19:30-21:30', [], []);
  const chinese = parser.parseAgendaByRules('广州双语国际演讲俱乐部第801期中文会议，欢迎大家报名角色\n时间：2026年7月8日周三 19:30-21:30', [], []);
  assert.strictEqual(english.meetingInfo.language, 'en');
  assert.strictEqual(english.meetingInfo.meetingNo, '800');
  assert.strictEqual(chinese.meetingInfo.language, 'zh');
  assert.strictEqual(chinese.meetingInfo.meetingNo, '801');
}

/**
 * 方法是什么：测试角色报名占位符清洗。
 * 方法作用：验证太阳、玫瑰和空值不会进入演讲者字段，并覆盖 AI 结果二次清洗。
 * 为什么添加：接龙使用装饰符号表示角色空缺，误当姓名会污染编辑页和 PDF。
 */
function testEmptyRolePlaceholders() {
  const text = [
    '广州双语国际演讲俱乐部第802期中文会议，欢迎大家报名角色',
    '会议经理：☀️',
    '总主持人：🌞',
    '时间官：🌹',
    '摄影师：[sun]',
    '语法师：[太阳]',
    '总体点评：玫瑰花',
    '即兴主持人：'
  ].join('\n');
  const agenda = parser.parseAgendaByRules(text, [], []);
  ['meetingManager', 'toastmaster', 'timer', 'photographer', 'grammarian', 'generalEvaluator', 'tableTopicsMaster'].forEach(function assertEmpty(key) {
    assert.strictEqual(agenda.roles[key].rawName, '', `${key} 应保持空白`);
  });

  const aiAgenda = parser.buildAgendaFromAi({
    meetingInfo: { meetingNo: '802', language: 'zh' },
    roles: {
      timer: { key: 'timer', rawName: '🌹' },
      grammarian: { key: 'grammarian', rawName: '[太阳]' }
    }
  }, [], []);
  assert.strictEqual(aiAgenda.roles.timer.rawName, '');
  assert.strictEqual(aiAgenda.roles.grammarian.rawName, '');
  assert.strictEqual(parser.cleanRoleSignupValue('[sun]'), '');
}

/**
 * 方法是什么：测试议程草稿过期判断。
 * 方法作用：验证七天前、无日期和未来日期的处理。
 * 为什么添加：草稿生命周期是数据库保存契约的一部分。
 */
function testDraftExpiry() {
  const now = new Date('2026-07-14T00:00:00.000Z');
  assert.strictEqual(agendaQuery.isExpired({ expiresAt: '2026-07-13T00:00:00.000Z' }, now), true);
  assert.strictEqual(agendaQuery.isExpired({ expiresAt: '2026-07-15T00:00:00.000Z' }, now), false);
  assert.strictEqual(agendaQuery.isExpired({}, now), true);
}

/**
 * 方法是什么：测试集合不存在错误识别。
 * 方法作用：覆盖 CloudBase 数字错误码和文本错误两种返回形式。
 * 为什么添加：新环境必须自动创建 agenda_templates 和 agendas，而不是首次读取直接失败。
 */
function testCollectionMissingError() {
  assert.strictEqual(common.isCollectionMissingError({ errCode: -502005 }), true);
  assert.strictEqual(common.isCollectionMissingError({ message: 'database collection not exists' }), true);
  assert.strictEqual(common.isCollectionMissingError({ errCode: -502003 }), false);
}

/**
 * 方法是什么：测试会员选择候选排序和议程保存载荷。
 * 方法作用：覆盖会员 picker 的稳定顺序以及 JSON 草稿的规范化存储形状。
 * 为什么添加：会员查询不能依赖数据库排序索引，保存结果也必须保持完整 AgendaV2。
 */
function testMemberOptionsAndAgendaPayload() {
  const sorted = lookupOptions.sortMembers([
    { _id: '2', nameZh: '周沫' },
    { _id: '1', nameZh: '马威' },
    { _id: '3', nameEn: 'Brittany Cai' }
  ]);
  assert.deepStrictEqual(sorted.map((member) => member._id), ['1', '2', '3']);

  const agenda = agendaUtil.createAgendaFromFacts({ meetingInfo: { theme: '保存测试' } }, agendaUtil.createDefaultTemplate());
  agenda._id = 'temporary-id';
  agenda.expiresAt = '2026-07-25T00:00:00.000Z';
  const payload = saveAgenda.buildAgendaPayload(agenda, agendaUtil.createDefaultTemplate());
  assert.strictEqual(payload.schemaVersion, 2);
  assert.strictEqual(payload.meetingInfo.theme, '保存测试');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(payload, '_id'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(payload, 'expiresAt'), false);
}

/**
 * 方法是什么：测试 PDF 生成能力。
 * 方法作用：用规则解析出的议程生成中文 PDF，并确认返回内容是 PDF 文件。
 * 为什么添加：导出 PDF 是核心交付物，测试可以提前发现字体、依赖或渲染器异常。
 */
async function testPdfRenderer(agenda) {
  const buffer = await pdfRenderer.renderAgendaPdf(agenda, 'zh', agendaUtil.createDefaultTemplate());
  assert.ok(buffer.length > 10000, 'PDF 文件大小异常');
  assert.strictEqual(buffer.slice(0, 4).toString(), '%PDF', '应生成 PDF 文件');
  const englishAgenda = agendaUtil.cloneJson(agenda);
  englishAgenda.meetingInfo.language = 'en';
  const englishBuffer = await pdfRenderer.renderAgendaPdf(englishAgenda, 'en', agendaUtil.createDefaultTemplate());
  assert.ok(englishBuffer.length > 10000, '英文 PDF 文件大小异常');
  assert.strictEqual(englishBuffer.slice(0, 4).toString(), '%PDF', '应生成英文 PDF 文件');
}

/**
 * 方法是什么：测试 PDF 议程区域的分隔线绘制规则。
 * 方法作用：确认表头和数据行没有单元格边框，且只有顶层模块行会额外绘制横线。
 * 为什么添加：导出样式要求取消竖线及小模块横线，需要防止后续表格重构恢复默认边框。
 */
function testPdfAgendaLineStyle() {
  const rectangles = [];
  const lines = [];
  const page = {
    drawRectangle(options) { rectangles.push(options); },
    drawLine(options) { lines.push(options); },
    drawText() {}
  };
  const font = {
    widthOfTextAtSize(text, size) { return String(text).length * size; }
  };
  const table = pdfRenderer.drawAgendaHeader(page, font, 100, 'zh');
  assert.strictEqual(rectangles.length, 5);
  assert.ok(rectangles.every((rectangle) => rectangle.borderWidth === 0), '议程表头不应绘制竖线');
  assert.strictEqual(lines.length, 1, '议程表头只应绘制底部横线');

  rectangles.length = 0;
  lines.length = 0;
  pdfRenderer.drawAgendaRow(page, font, { id: 'opening', titleZh: '开场白', pdfSectionStart: true }, table, 111, 'zh');
  assert.ok(rectangles.every((rectangle) => rectangle.borderWidth === 0), '大模块行不应绘制单元格边框');
  assert.strictEqual(lines.length, 1, '大模块开始处应绘制一条横线');

  rectangles.length = 0;
  lines.length = 0;
  pdfRenderer.drawAgendaRow(page, font, { id: 'icebreaker', titleZh: '破冰', pdfSectionStart: false }, table, 121, 'zh');
  assert.ok(rectangles.every((rectangle) => rectangle.borderWidth === 0), '小模块行不应绘制单元格边框');
  assert.strictEqual(lines.length, 0, '小模块之间不应绘制横线');
}

/**
 * 方法是什么：测试超长议程 PDF 续页。
 * 方法作用：用八个备稿块验证渲染器会插入议程续页并保留最终资料页。
 * 为什么添加：会员可多次新增备稿，第一页溢出时绝不能裁切或覆盖计时区。
 */
async function testPdfOverflow() {
  const template = agendaUtil.createDefaultTemplate();
  const preparedSpeeches = Array.from({ length: 8 }, function createSpeech(_, index) {
    return {
      id: `overflow-${index}`,
      titleZh: `超长备稿演讲 ${index + 1}`,
      duration: 7,
      speaker: { rawName: `演讲者${index + 1}` },
      evaluator: { rawName: `点评者${index + 1}` },
      pathway: { fullLabelZh: 'L2P1 了解你的沟通风格', objectiveZh: '这是用于验证自动分页的较长项目目标描述，建议演讲时间为5-7分钟。' }
    };
  });
  const agenda = agendaUtil.createAgendaFromFacts({ preparedSpeeches }, template);
  const buffer = await pdfRenderer.renderAgendaPdf(agenda, 'zh', template);
  const document = await PDFDocument.load(buffer);
  assert.ok(document.getPageCount() >= 3, '超长议程应生成至少一个续页');
}

/**
 * 方法是什么：运行全部测试。
 * 方法作用：依次执行种子数据、姓名匹配和规则解析测试。
 * 为什么添加：提供一个不依赖微信开发者工具的本地验证入口。
 */
async function main() {
  testWorkbookData();
  testNameMatching();
  const agenda = testRuleParser();
  testAgendaModel();
  testPreparedSpeechRules();
  testAgendaPreviewValidation();
  testTemplateAndLegacyUpgrade();
  testLocalizedTemplateAndAnchors();
  testDynamicAgendaModules();
  testMeetingLanguageDetection();
  testEmptyRolePlaceholders();
  testDraftExpiry();
  testCollectionMissingError();
  testMemberOptionsAndAgendaPayload();
  testPdfAgendaLineStyle();
  await testPdfRenderer(agenda);
  await testPdfOverflow();
  console.log('核心测试通过。');
}

/**
 * 方法是什么：处理测试运行中的异常。
 * 方法作用：打印错误并以非零状态码结束进程。
 * 为什么添加：异步 PDF 测试失败时需要让 CI 或本地命令明确失败。
 */
function handleTestError(error) {
  console.error(error);
  process.exit(1);
}

main().catch(handleTestError);
