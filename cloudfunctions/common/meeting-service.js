const LEGACY_FIELDS = [
  'rawText', 'meetingInfo', 'items', 'sections', 'participants', 'warnings', 'unresolvedNames',
  'confidence', 'source', 'expiresAt'
];

/**
 * 方法是什么：构建规范化会议议程。
 * 方法作用：删除旧版平面字段并保留 AgendaV2 的唯一流程来源。
 * 为什么添加：编辑和报名必须围绕同一个稳定的会议聚合结构工作。
 */
function normalizeAgenda(agendaModel, agenda, template) {
  const normalized = agendaModel.normalizeAgenda(agenda, template || agendaModel.createDefaultTemplate());
  ['rawText', 'items', 'participants', 'warnings', 'unresolvedNames', 'confidence', 'source'].forEach((field) => delete normalized[field]);
  delete normalized._id;
  delete normalized.expiresAt;
  return normalized;
}

/**
 * 方法是什么：构建会议摘要。
 * 方法作用：提取首页、分享和报名页需要的会议信息。
 * 为什么添加：所有页面必须使用同一份摘要，避免重复解释 agenda 结构。
 */
function buildSummary(agenda) {
  const info = agenda && agenda.meetingInfo || {};
  return { meetingNo: info.meetingNo || '', date: info.date || '', startTime: info.startTime || '', endTime: info.endTime || '' };
}

/**
 * 方法是什么：构建议程数据库载荷。
 * 方法作用：合并俱乐部、所有者、报名槽位和版本号形成单一会议聚合。
 * 为什么添加：保存接龙和保存报名状态必须写入同一套字段。
 */
function buildMeetingPayload(agenda, template, context) {
  const options = context || {};
  const normalized = normalizeAgenda(options.agendaModel, agenda, template);
  return {
    clubId: options.clubId || 'default-club',
    ownerOpenid: options.ownerOpenid || '',
    agenda: normalized,
    meetingSummary: buildSummary(normalized),
    signupPublicId: options.signupPublicId || 'current',
    signupSlots: Array.isArray(options.signupSlots) ? options.signupSlots : [],
    signupVersion: Number(options.signupVersion || 0),
    updatedAt: options.updatedAt || new Date().toISOString()
  };
}

/**
 * 方法是什么：列出旧字段清理指令。
 * 方法作用：让更新会议时删除历史平面字段，避免新旧结构并存。
 * 为什么添加：数据库整理必须由领域服务统一执行，不能散落在各个云函数。
 */
function legacyRemovalFields(db) {
  return LEGACY_FIELDS.reduce((result, field) => {
    result[field] = db.command.remove();
    return result;
  }, {});
}

/**
 * 方法是什么：校验会议版本。
 * 方法作用：拒绝基于旧快照的编辑，避免报名和编辑互相覆盖。
 * 为什么添加：编辑器与报名页共享会议聚合后需要显式并发控制。
 */
function assertVersion(expected, actual) {
  if (expected === undefined || expected === null || expected === '') return;
  if (Number(expected) !== Number(actual)) {
    throw Object.assign(new Error('会议数据已更新，请刷新后重试'), { code: 'MEETING_VERSION_CONFLICT' });
  }
}

module.exports = { LEGACY_FIELDS, normalizeAgenda, buildSummary, buildMeetingPayload, legacyRemovalFields, assertVersion };
