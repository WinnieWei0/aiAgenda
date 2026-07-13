const DEFAULT_CLUB_NAME_ZH = '广州双语';
const DEFAULT_CLUB_NAME_EN = 'Bilingual';

const ROLE_LABELS = [
  { key: 'guestReception', titleZh: '礼宾官（宾客）', titleEn: 'Guest Reception', patterns: ['礼宾官（宾客）', '礼宾官(宾客)'] },
  { key: 'memberReception', titleZh: '礼宾官（会员）', titleEn: 'Member Reception', patterns: ['礼宾官（会员）', '礼宾官(会员)'] },
  { key: 'photoMasterGuest', titleZh: '摄影师（宾客）', titleEn: 'Guest Photo Master', patterns: ['摄影师（宾客）', '摄影师(宾客)'] },
  { key: 'ahCounterGuest', titleZh: '哼哈师（宾客）', titleEn: 'Guest Ah-counter', patterns: ['哼哈师（宾客）', '哼哈师(宾客)'] },
  { key: 'meetingManager', titleZh: '会议经理', titleEn: 'Meeting Manager', patterns: ['会议经理'] },
  { key: 'toastmaster', titleZh: '总主持人', titleEn: 'Toastmaster of the Meeting', patterns: ['总主持人', '主持人'] },
  { key: 'timer', titleZh: '时间官', titleEn: 'Timer', patterns: ['时间官', '计时员'] },
  { key: 'grammarian', titleZh: '语法师', titleEn: 'Grammarian', patterns: ['语法师'] },
  { key: 'generalEvaluator', titleZh: '总体点评', titleEn: 'General Evaluator', patterns: ['总体点评', '总体点评师'] },
  { key: 'tableTopicsMaster', titleZh: '即兴主持人', titleEn: 'Table Topics Master', patterns: ['即兴主持人', '即兴演讲主持'] },
  { key: 'tableTopicsEvaluator', titleZh: '即兴点评', titleEn: 'Table Topics Evaluator', patterns: ['即兴点评', '即兴点评师'] }
];

/**
 * 方法是什么：把任意输入转换为安全字符串。
 * 方法作用：统一处理空值、换行和首尾空格，避免解析流程里反复判断类型。
 * 为什么添加：接龙文本、AI 输出和数据库字段都可能为空，先标准化可以降低后续方法的异常风险。
 */
function normalizeText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

/**
 * 方法是什么：清理姓名中的表情、括号说明和多余符号。
 * 方法作用：把“张国聪(省直中文)”或“[Sun]”这类接龙写法转换为更适合匹配的姓名。
 * 为什么添加：微信群接龙里的姓名格式不稳定，需要先去掉装饰信息才能和会员表可靠匹配。
 */
function normalizeName(value) {
  const text = normalizeText(value);
  return text
    .replace(/\[[^\]]*]/g, '')
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[：:，,。；;、\s]/g, '')
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
    .toLowerCase();
}

/**
 * 方法是什么：移除角色报名行中的装饰符号。
 * 方法作用：删除微信表情占位、冒号前后的空白和多余标点，得到可解析文本。
 * 为什么添加：接龙内容通常包含表情和庆祝符号，直接匹配会导致角色名称识别失败。
 */
function stripDecorations(line) {
  return normalizeText(line)
    .replace(/\[[^\]]*]/g, '')
    .replace(/^[^\u4e00-\u9fa5A-Za-z0-9]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 方法是什么：为一个会员生成可搜索别名列表。
 * 方法作用：聚合中文名、英文名、昵称、议程显示名和手工别名，用于姓名模糊匹配。
 * 为什么添加：同一个人在接龙里可能写简称、英文名或带头衔的议程名，统一别名能提高匹配率。
 */
function createAliasList(member) {
  const aliases = [];
  const fields = ['nickName', 'nameZh', 'nameEn', 'titleOnAgenda', 'agendaNameZh'];
  for (const field of fields) {
    if (member && member[field]) {
      aliases.push(member[field]);
    }
  }
  if (member && member.nameEn && member.nameZh) {
    const firstEnglishName = normalizeText(member.nameEn).split(/\s+/)[0];
    const chineseSurname = normalizeText(member.nameZh).slice(0, 1);
    if (firstEnglishName && chineseSurname) {
      aliases.push(`${firstEnglishName}${chineseSurname}`);
    }
  }
  if (member && Array.isArray(member.aliases)) {
    for (const alias of member.aliases) {
      aliases.push(alias);
    }
  }
  return aliases;
}

/**
 * 方法是什么：向候选数组中加入不重复的会员。
 * 方法作用：按 `_id`、`sourceKey` 或中英文姓名去重，避免同一会员多别名重复出现。
 * 为什么添加：简称匹配会同时命中姓名和议程显示名，如果不去重会误判为多个候选人。
 */
function pushUniqueMember(list, member) {
  const key = member._id || member.sourceKey || `${member.nameZh || ''}:${member.nameEn || ''}`;
  for (const item of list) {
    const itemKey = item._id || item.sourceKey || `${item.nameZh || ''}:${item.nameEn || ''}`;
    if (itemKey === key) {
      return;
    }
  }
  list.push(member);
}

/**
 * 方法是什么：根据接龙姓名匹配 Membership 会员。
 * 方法作用：优先精确匹配标准化别名，再做包含式匹配，并返回匹配置信息。
 * 为什么添加：议程表需要使用会员表里的正式显示名和俱乐部信息，不能只保留接龙里的原始称呼。
 */
function matchMemberByName(rawName, memberships) {
  const target = normalizeName(rawName);
  if (!target) {
    return { matched: false, rawName: normalizeText(rawName), member: null, confidence: 0 };
  }
  const exactMatches = [];
  const fuzzyMatches = [];
  for (const member of memberships || []) {
    const aliases = createAliasList(member);
    for (const alias of aliases) {
      const normalizedAlias = normalizeName(alias);
      if (!normalizedAlias) {
        continue;
      }
      if (normalizedAlias === target) {
        pushUniqueMember(exactMatches, member);
      } else if (normalizedAlias.includes(target) || target.includes(normalizedAlias)) {
        pushUniqueMember(fuzzyMatches, member);
      }
    }
  }
  if (exactMatches.length === 1) {
    return { matched: true, rawName: normalizeText(rawName), member: exactMatches[0], confidence: 1 };
  }
  if (exactMatches.length > 1) {
    return { matched: false, rawName: normalizeText(rawName), member: null, candidates: exactMatches, confidence: 0.5 };
  }
  if (fuzzyMatches.length === 1) {
    return { matched: true, rawName: normalizeText(rawName), member: fuzzyMatches[0], confidence: 0.8 };
  }
  return { matched: false, rawName: normalizeText(rawName), member: null, candidates: fuzzyMatches, confidence: fuzzyMatches.length ? 0.4 : 0 };
}

/**
 * 方法是什么：根据项目代码匹配 Pathways 项目。
 * 方法作用：用 `L4P3` 这类项目级别查找中英文项目名称和项目目标。
 * 为什么添加：备稿项目描述必须来自 Pathways 数据库，不能完全依赖 AI 自行编写。
 */
function findPathway(projectCode, pathways) {
  const normalizedCode = normalizeText(projectCode).replace(/\s+/g, '').toUpperCase();
  if (!normalizedCode) {
    return null;
  }
  for (const pathway of pathways || []) {
    const code = normalizeText(pathway.code).replace(/\s+/g, '').toUpperCase();
    const fullZh = normalizeText(pathway.fullLabelZh).replace(/\s+/g, '').toUpperCase();
    const fullEn = normalizeText(pathway.fullLabelEn).replace(/\s+/g, '').toUpperCase();
    if (code === normalizedCode || fullZh.includes(normalizedCode) || fullEn.includes(normalizedCode)) {
      return pathway;
    }
  }
  return null;
}

/**
 * 方法是什么：从接龙文本中解析会议信息。
 * 方法作用：提取会议编号、日期、星期、开始结束时间、地址和默认主题。
 * 为什么添加：会议信息是保存议程和生成 PDF 页眉的基础字段，需要在 AI 不可用时也能得到。
 */
function parseMeetingInfo(rawText) {
  const text = normalizeText(rawText);
  const meetingNoMatch = text.match(/第\s*(\d+)\s*期/);
  const timeMatch = text.match(/时间[:：]\s*(\d{4})年(\d{1,2})月(\d{1,2})日周?([^\d\s]*)\s*(\d{1,2}:\d{2})\s*[-–~至]\s*(\d{1,2}:\d{2})/);
  const addressMatch = text.match(/地址[:：]\s*([^\n]+)/);
  const themeMatch = text.match(/主题[:：]\s*([^\n]+)/);
  return {
    meetingNo: meetingNoMatch ? meetingNoMatch[1] : '',
    date: timeMatch ? `${timeMatch[1]}-${String(timeMatch[2]).padStart(2, '0')}-${String(timeMatch[3]).padStart(2, '0')}` : '',
    weekday: timeMatch ? timeMatch[4] : '',
    startTime: timeMatch ? timeMatch[5] : '19:30',
    endTime: timeMatch ? timeMatch[6] : '21:30',
    address: addressMatch ? normalizeText(addressMatch[1]) : '',
    theme: themeMatch ? normalizeText(themeMatch[1]) : '',
    language: 'zh'
  };
}

/**
 * 方法是什么：从接龙文本中解析会议角色报名。
 * 方法作用：识别会议经理、总主持人、时间官、语法师、总体点评等角色对应的报名姓名。
 * 为什么添加：角色报名是接龙解析的核心内容，需要转换成后续可编辑的流程表单字段。
 */
function parseRoleLines(rawText) {
  const roles = {};
  const lines = normalizeText(rawText).split('\n');
  for (const line of lines) {
    const cleanLine = stripDecorations(line);
    for (const role of ROLE_LABELS) {
      for (const pattern of role.patterns) {
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`${escaped}\\s*[:：]\\s*(.+)$`);
        const match = cleanLine.match(regex);
        if (match) {
          roles[role.key] = {
            key: role.key,
            titleZh: role.titleZh,
            titleEn: role.titleEn,
            rawName: normalizeText(match[1])
          };
        }
      }
    }
  }
  return roles;
}

/**
 * 方法是什么：从接龙文本中解析备稿演讲和点评者。
 * 方法作用：提取备稿演讲者、项目级别和对应点评者，并按序号组成结构化数组。
 * 为什么添加：备稿项目需要关联 Pathways 描述和点评流程，是生成议程 PDF 的关键板块。
 */
function parsePreparedSpeeches(rawText) {
  const text = normalizeText(rawText);
  const speeches = [];
  const regex = /备稿演讲者\s*(\d+)\s*[:：]\s*([^\n]+)[\s\S]*?项目级别\s*[:：]\s*([^\n]+)[\s\S]*?点评者\s*\1\s*[:：]\s*([^\n]+)/g;
  let match = regex.exec(text);
  while (match) {
    speeches.push({
      index: Number(match[1]),
      speakerRawName: normalizeText(match[2]),
      projectCode: normalizeText(match[3]),
      evaluatorRawName: normalizeText(match[4]),
      title: ''
    });
    match = regex.exec(text);
  }
  return speeches;
}

/**
 * 方法是什么：从接龙文本中解析参与者名单。
 * 方法作用：识别形如 `1. 文耐` 的报名列表，并保留原始顺序。
 * 为什么添加：参与者名单可用于宾客识别、会后统计和 PDF 中的辅助信息。
 */
function parseParticipants(rawText) {
  const participants = [];
  const lines = normalizeText(rawText).split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)[.、]\s*(.+)$/);
    if (match) {
      participants.push({
        order: Number(match[1]),
        rawName: normalizeText(match[2])
      });
    }
  }
  return participants;
}

/**
 * 方法是什么：把会员匹配结果转换成议程显示信息。
 * 方法作用：生成中文显示名、英文显示名、俱乐部和待确认标记。
 * 为什么添加：前端表单和 PDF 都需要一致的人员展示结构，集中转换能减少页面逻辑。
 */
function buildPerson(rawName, memberships) {
  const match = matchMemberByName(rawName, memberships);
  if (match.matched) {
    const member = match.member;
    return {
      rawName: normalizeText(rawName),
      memberId: member._id || member.id || '',
      displayNameZh: member.agendaNameZh || member.nameZh || normalizeText(rawName),
      displayNameEn: member.titleOnAgenda || member.nameEn || normalizeText(rawName),
      clubZh: member.clubZh || DEFAULT_CLUB_NAME_ZH,
      clubEn: member.clubEn || DEFAULT_CLUB_NAME_EN,
      unresolved: false,
      confidence: match.confidence
    };
  }
  return {
    rawName: normalizeText(rawName),
    memberId: '',
    displayNameZh: normalizeText(rawName),
    displayNameEn: normalizeText(rawName),
    clubZh: /宾客|guest/i.test(rawName) ? '宾客' : '',
    clubEn: /宾客|guest/i.test(rawName) ? 'Guest' : '',
    unresolved: true,
    confidence: match.confidence || 0
  };
}

/**
 * 方法是什么：把备稿演讲数据补充为完整议程项目。
 * 方法作用：为演讲者和点评者匹配会员，为项目级别匹配 Pathways 中英文描述。
 * 为什么添加：AI 或规则只能提取粗字段，最终表单和 PDF 需要完整可展示的业务字段。
 */
function enrichPreparedSpeeches(speeches, memberships, pathways) {
  const enriched = [];
  for (const speech of speeches || []) {
    const speaker = buildPerson(speech.speakerRawName, memberships);
    const evaluator = buildPerson(speech.evaluatorRawName, memberships);
    const pathway = findPathway(speech.projectCode, pathways);
    enriched.push({
      index: speech.index,
      title: speech.title || '',
      projectCode: speech.projectCode,
      pathwayId: pathway ? pathway._id || pathway.id || '' : '',
      projectTitleZh: pathway ? pathway.fullLabelZh || `${pathway.code} ${pathway.projectNameZh || ''}`.trim() : speech.projectCode,
      projectTitleEn: pathway ? pathway.fullLabelEn || `${pathway.code} ${pathway.projectNameEn || ''}`.trim() : speech.projectCode,
      projectObjectiveZh: pathway ? pathway.objectiveZh || '' : '',
      projectObjectiveEn: pathway ? pathway.objectiveEn || '' : '',
      speaker,
      evaluator
    });
  }
  return enriched;
}

/**
 * 方法是什么：根据解析结果生成默认议程流程。
 * 方法作用：把会议信息、角色、备稿和点评串成可编辑、可排序的流程数组。
 * 为什么添加：前端需要统一的表单数据模型，而接龙文本本身不是按 PDF 流程顺序组织的。
 */
function buildAgendaItems(parsed, memberships, pathways) {
  const roles = parsed.roles || {};
  const preparedSpeeches = enrichPreparedSpeeches(parsed.preparedSpeeches || [], memberships, pathways);
  const items = [];
  let order = 1;

  const roleSequence = [
    { section: 'opening', roleKey: 'meetingManager', titleZh: '会议筹备', titleEn: 'Meeting Manager', duration: 0 },
    { section: 'opening', roleKey: 'guestReception', titleZh: '签到、欢迎来宾', titleEn: 'Sign In & Welcome Guests', duration: 0 },
    { section: 'opening', roleKey: 'toastmaster', titleZh: '主持人', titleEn: 'Toastmaster of the Meeting', duration: 2 },
    { section: 'opening', roleKey: 'timer', titleZh: '计时员', titleEn: 'Timer', duration: 1 },
    { section: 'opening', roleKey: 'grammarian', titleZh: '语法师', titleEn: 'Grammarian', duration: 2 },
    { section: 'opening', roleKey: 'generalEvaluator', titleZh: '总体点评师', titleEn: 'General Evaluator', duration: 1 },
    { section: 'tableTopics', roleKey: 'tableTopicsMaster', titleZh: '即兴演讲', titleEn: 'Table Topics', duration: 16 },
    { section: 'tableTopics', roleKey: 'tableTopicsEvaluator', titleZh: '即兴点评', titleEn: 'Table Topics Evaluation', duration: 7 }
  ];

  for (const config of roleSequence) {
    const role = roles[config.roleKey];
    const person = buildPerson(role ? role.rawName : '', memberships);
    items.push({
      id: `role-${config.roleKey}`,
      order,
      type: 'role',
      section: config.section,
      roleKey: config.roleKey,
      titleZh: config.titleZh,
      titleEn: config.titleEn,
      duration: config.duration,
      person
    });
    order += 1;
  }

  for (const speech of preparedSpeeches) {
    items.push({
      id: `speech-${speech.index}`,
      order,
      type: 'preparedSpeech',
      section: 'preparedSpeech',
      titleZh: speech.title || `备稿演讲 ${speech.index}`,
      titleEn: speech.title || `Prepared Speech ${speech.index}`,
      duration: 7,
      speech
    });
    order += 1;
    items.push({
      id: `evaluation-${speech.index}`,
      order,
      type: 'evaluation',
      section: 'evaluation',
      titleZh: `对${speech.speaker.displayNameZh || speech.speaker.rawName}的点评`,
      titleEn: `Evaluation for ${speech.speaker.displayNameEn || speech.speaker.rawName}`,
      duration: 3,
      person: speech.evaluator,
      speechIndex: speech.index
    });
    order += 1;
  }

  return items;
}

/**
 * 方法是什么：使用规则从接龙文本生成结构化议程。
 * 方法作用：在没有 DeepSeek API Key 或 AI 调用失败时，仍然提取基础议程数据。
 * 为什么添加：开发、测试和弱网场景不能完全依赖大模型，规则解析可以作为稳定降级。
 */
function parseAgendaByRules(rawText, memberships, pathways) {
  const parsed = {
    meetingInfo: parseMeetingInfo(rawText),
    roles: parseRoleLines(rawText),
    preparedSpeeches: parsePreparedSpeeches(rawText),
    participants: parseParticipants(rawText),
    nextMeeting: {},
    confidence: 0.72,
    source: 'rules'
  };
  parsed.items = buildAgendaItems(parsed, memberships || [], pathways || []);
  return parsed;
}

/**
 * 方法是什么：合并 AI 解析结果和规则解析结果。
 * 方法作用：优先使用 AI 返回的会议信息和备稿题目，同时保留规则解析的稳定字段。
 * 为什么添加：AI 擅长理解上下文，规则擅长稳定提取，两者合并能提高首版解析质量。
 */
function mergeAiResult(aiResult, ruleResult, memberships, pathways) {
  if (!aiResult || typeof aiResult !== 'object') {
    return ruleResult;
  }
  const merged = {
    meetingInfo: Object.assign({}, ruleResult.meetingInfo, aiResult.meetingInfo || {}),
    roles: Object.assign({}, ruleResult.roles, aiResult.roles || {}),
    preparedSpeeches: Array.isArray(aiResult.preparedSpeeches) && aiResult.preparedSpeeches.length ? aiResult.preparedSpeeches : ruleResult.preparedSpeeches,
    participants: Array.isArray(aiResult.participants) && aiResult.participants.length ? aiResult.participants : ruleResult.participants,
    nextMeeting: aiResult.nextMeeting || ruleResult.nextMeeting || {},
    confidence: aiResult.confidence || ruleResult.confidence,
    source: 'deepseek'
  };
  merged.items = buildAgendaItems(merged, memberships || [], pathways || []);
  return merged;
}

/**
 * 方法是什么：把 DeepSeek 返回结果补全为可编辑议程。
 * 方法作用：以 AI 返回的会议、角色、备稿和参与者为主，再从数据库匹配人员和 Pathways 描述。
 * 为什么添加：生产解析明确使用 DeepSeek，不能先生成规则结果再把规则结果作为 AI 降级数据源。
 */
function buildAgendaFromAi(aiResult, memberships, pathways) {
  if (!aiResult || typeof aiResult !== 'object') {
    const error = new Error('DeepSeek 未返回有效的议程结果');
    error.code = 'DEEPSEEK_EMPTY_RESULT';
    throw error;
  }
  const agenda = {
    meetingInfo: aiResult.meetingInfo || {},
    roles: aiResult.roles || {},
    preparedSpeeches: Array.isArray(aiResult.preparedSpeeches) ? aiResult.preparedSpeeches : [],
    participants: Array.isArray(aiResult.participants) ? aiResult.participants : [],
    nextMeeting: aiResult.nextMeeting || {},
    confidence: aiResult.confidence || 0,
    source: 'deepseek'
  };
  agenda.items = buildAgendaItems(agenda, memberships || [], pathways || []);
  return agenda;
}

/**
 * 方法是什么：校验结构化议程并补充待确认列表。
 * 方法作用：统计未匹配人员、空流程和必要会议信息缺失情况。
 * 为什么添加：前端需要明确提示用户哪些字段需要人工检查，避免直接导出错误议程。
 */
function validateAgenda(agenda) {
  const warnings = [];
  const unresolvedNames = [];
  if (!agenda.meetingInfo || !agenda.meetingInfo.date) {
    warnings.push('未识别到会议日期');
  }
  if (!agenda.meetingInfo || !agenda.meetingInfo.meetingNo) {
    warnings.push('未识别到会议编号');
  }
  for (const item of agenda.items || []) {
    const people = [];
    if (item.person) {
      people.push(item.person);
    }
    if (item.speech && item.speech.speaker) {
      people.push(item.speech.speaker);
    }
    if (item.speech && item.speech.evaluator) {
      people.push(item.speech.evaluator);
    }
    for (const person of people) {
      if (person && person.unresolved && person.rawName) {
        unresolvedNames.push(person.rawName);
      }
    }
  }
  return Object.assign({}, agenda, {
    warnings,
    unresolvedNames: Array.from(new Set(unresolvedNames))
  });
}

module.exports = {
  ROLE_LABELS,
  normalizeText,
  normalizeName,
  stripDecorations,
  createAliasList,
  pushUniqueMember,
  matchMemberByName,
  findPathway,
  parseMeetingInfo,
  parseRoleLines,
  parsePreparedSpeeches,
  parseParticipants,
  buildPerson,
  enrichPreparedSpeeches,
  buildAgendaItems,
  parseAgendaByRules,
  mergeAiResult,
  buildAgendaFromAi,
  validateAgenda
};
