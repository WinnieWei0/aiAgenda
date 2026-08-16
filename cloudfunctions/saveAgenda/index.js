const common = require('agenda-common');

const LEGACY_FIELDS = [
  'rawText', 'meetingInfo', 'items', 'sections', 'participants', 'warnings', 'unresolvedNames',
  'confidence', 'source', 'expiresAt'
];

/**
 * 方法是什么：构建议程保存对象。
 * 方法作用：规范化模块、流程行和会议信息后生成 JSON 载荷。
 * 为什么添加：编辑保存和解析保存必须使用相同的数据形状。
 */
function buildAgendaPayload(agenda, template) {
  const normalized = common.agendaModel.normalizeAgenda(agenda, template || common.agendaModel.createDefaultTemplate());
  normalized.items = common.agendaModel.flattenAgendaRows(normalized);
  delete normalized._id;
  delete normalized.expiresAt;
  return normalized;
}

function buildMeetingSummary(agenda) {
  const info = agenda && agenda.meetingInfo || {};
  return {
    meetingNo: info.meetingNo || '',
    date: info.date || '',
    startTime: info.startTime || '',
    endTime: info.endTime || ''
  };
}

/**
 * 方法是什么：读取议程记录中的 JSON 数据。
 * 方法作用：兼容新嵌套议程和旧平面数据格式。
 * 为什么添加：已有草稿升级后仍可被编辑页继续使用。
 */
function getAgendaFromRecord(record) {
  if (!record) {
    return null;
  }
  if (record.agenda) {
    return Object.assign({}, record.agenda, { _id: record._id });
  }
  return Object.assign({}, record);
}

/**
 * 方法是什么：处理议程保存请求。
 * 方法作用：更新全局唯一的长期有效会议议程。
 * 为什么添加：报名流程以组织者主动重置为生命周期终点。
 */
async function main(event) {
  try {
    common.initCloud();
    const openid = common.getOpenid();
    const submitted = event && event.agenda ? event.agenda : null;
    if (!submitted) {
      return common.fail('EMPTY_AGENDA', '缺少议程数据');
    }
    const db = common.getDb();
    const collection = await common.ensureCollection('agendas');
    const existingResult = await collection.where({ _id: common.CURRENT_AGENDA_ID }).limit(1).get();
    const existing = existingResult.data && existingResult.data[0] || null;
    const now = new Date();
    const template = await common.getAgendaTemplate();
    const agenda = buildAgendaPayload(submitted, template);
    const signupSlots = existing
      ? (common.signup && typeof common.signup.mergeSlots === 'function'
        ? common.signup.mergeSlots(existing.signupSlots, agenda)
        : (existing.signupSlots || []))
      : [];
    const payload = {
      ownerOpenid: openid,
      agenda,
      meetingSummary: buildMeetingSummary(agenda),
      signupPublicId: common.CURRENT_AGENDA_ID,
      signupSlots,
      signupVersion: Number(existing && existing.signupVersion || 0),
      updatedAt: now.toISOString()
    };
    if (existing) {
      const updateData = Object.assign({}, payload);
      LEGACY_FIELDS.forEach((field) => {
        updateData[field] = db.command.remove();
      });
      await collection.doc(existing._id).update({ data: updateData });
      return common.ok({ _id: common.CURRENT_AGENDA_ID, action: 'updated', agenda: Object.assign({}, agenda, { _id: common.CURRENT_AGENDA_ID, signupPublicId: common.CURRENT_AGENDA_ID, signupSlots }) });
    }
    await collection.doc(common.CURRENT_AGENDA_ID).set({ data: Object.assign({}, payload, { createdAt: now.toISOString() }) });
    return common.ok({ _id: common.CURRENT_AGENDA_ID, action: 'created', agenda: Object.assign({}, agenda, { _id: common.CURRENT_AGENDA_ID, signupPublicId: common.CURRENT_AGENDA_ID, signupSlots }) });
  } catch (error) {
    return common.handleError(error);
  }
}

module.exports = { buildAgendaPayload, buildMeetingSummary, getAgendaFromRecord, main };
exports.main = main;
