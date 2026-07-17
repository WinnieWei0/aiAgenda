const common = require('agenda-common');

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LEGACY_FIELDS = [
  'rawText', 'meetingInfo', 'items', 'sections', 'participants', 'warnings', 'unresolvedNames',
  'confidence', 'source'
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
    return Object.assign({}, record.agenda, { _id: record._id, expiresAt: record.expiresAt });
  }
  return Object.assign({}, record);
}

/**
 * 方法是什么：处理议程保存请求。
 * 方法作用：更新用户唯一草稿并保持原有七天过期时间。
 * 为什么添加：编辑修改不能通过保存动作延长草稿生命周期。
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
    const collection = db.collection('agendas');
    const existingResult = await collection.where({ ownerOpenid: openid }).get();
    const existingRecords = (existingResult.data || []).sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
    const existing = existingRecords.length ? existingRecords[0] : null;
    for (const duplicate of existingRecords.slice(1)) {
      await collection.doc(duplicate._id).remove();
    }
    const now = new Date();
    const existingExpiry = existing && existing.expiresAt ? new Date(existing.expiresAt) : null;
    if (existingExpiry && existingExpiry.getTime() <= now.getTime()) {
      return common.fail('AGENDA_EXPIRED', '议程草稿已过期，请重新解析接龙');
    }
    const expiresAt = existingExpiry
      ? existingExpiry.toISOString()
      : new Date(now.getTime() + DRAFT_TTL_MS).toISOString();
    const template = await common.getAgendaTemplate();
    const agenda = buildAgendaPayload(submitted, template);
    const payload = {
      ownerOpenid: openid,
      agenda,
      expiresAt,
      updatedAt: now.toISOString()
    };
    if (existing) {
      const updateData = Object.assign({}, payload);
      LEGACY_FIELDS.forEach((field) => {
        updateData[field] = db.command.remove();
      });
      await collection.doc(existing._id).update({ data: updateData });
      return common.ok({ _id: existing._id, action: 'updated', agenda: Object.assign({}, agenda, { _id: existing._id, expiresAt }) });
    }
    const addResult = await collection.add({
      data: Object.assign({}, payload, { createdAt: now.toISOString() })
    });
    return common.ok({ _id: addResult._id, action: 'created', agenda: Object.assign({}, agenda, { _id: addResult._id, expiresAt }) });
  } catch (error) {
    return common.handleError(error);
  }
}

module.exports = { DRAFT_TTL_MS, buildAgendaPayload, getAgendaFromRecord, main };
exports.main = main;
